"use client";

/**
 * Floating indicator that follows a bulk-design-download job across page
 * navigations. Mounted once in the app shell. Reads the active job id from
 * localStorage (written by BulkDesignDownloadModal on submit), polls the
 * server, and shows a progress chip in the bottom-right corner. When the job
 * finishes the chip switches to "✓ Listo" with a "Descargar ZIP" button.
 *
 * Closing the modal no longer cancels the job — operators wanted to keep
 * working while a long export runs. The chip is the single visible reminder
 * that there's still something running, and the only place to either resume
 * the download or cancel it explicitly.
 */

import { useEffect, useState } from "react";


export const ACTIVE_DESIGN_JOB_KEY = "brandeate_active_design_job";

type StoredJob = {
  job_id: string;
  started_at: number;
};

type ServerJobState = {
  job_id: string;
  status: "queued" | "running" | "done" | "failed";
  progress_total?: number;
  progress_done?: number;
  ok_count?: number;
  failed_count?: number;
  no_design_count?: number;
  error?: string | null;
};

const POLL_MS = 3000;


export function readActiveDesignJob(): StoredJob | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ACTIVE_DESIGN_JOB_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredJob>;
    if (typeof parsed.job_id !== "string" || !parsed.job_id) return null;
    return {
      job_id: parsed.job_id,
      started_at: typeof parsed.started_at === "number" ? parsed.started_at : Date.now(),
    };
  } catch {
    return null;
  }
}

export function writeActiveDesignJob(job: StoredJob): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ACTIVE_DESIGN_JOB_KEY, JSON.stringify(job));
    // Custom event so chip in same tab reacts instantly (storage event only
    // fires across tabs).
    window.dispatchEvent(new Event("brandeate:design-job-changed"));
  } catch {
    // ignore storage quota / private mode
  }
}

export function clearActiveDesignJob(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(ACTIVE_DESIGN_JOB_KEY);
    window.dispatchEvent(new Event("brandeate:design-job-changed"));
  } catch {
    // ignore
  }
}


export function BackgroundDesignJobChip() {
  const [stored, setStored] = useState<StoredJob | null>(null);
  const [job, setJob] = useState<ServerJobState | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // Track localStorage state — react to writes from the modal (same tab via
  // custom event) and other tabs (storage event).
  useEffect(() => {
    if (typeof window === "undefined") return;
    setStored(readActiveDesignJob());
    const onChange = () => setStored(readActiveDesignJob());
    window.addEventListener("brandeate:design-job-changed", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("brandeate:design-job-changed", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  // Poll server for current state of the active job.
  useEffect(() => {
    if (!stored) {
      setJob(null);
      return;
    }
    let cancelled = false;
    let timer: number | null = null;

    async function tick() {
      if (!stored) return;
      try {
        const res = await fetch(`/api/orders/bulk/download-designs/jobs/${stored.job_id}`, {
          cache: "no-store",
        });
        if (cancelled) return;
        if (res.status === 404) {
          // Job evicted server-side (cleanup TTL or restart). Drop it.
          clearActiveDesignJob();
          return;
        }
        if (res.ok) {
          const data = (await res.json()) as ServerJobState;
          setJob(data);
          // Auto-clear localStorage on terminal failure so a stale job doesn't
          // haunt the chip forever. Done state stays so user can still hit
          // "Descargar ZIP".
          if (data.status === "failed") {
            // Give the chip one render to show the error, then it's the user's
            // choice whether to dismiss.
          }
        }
      } catch {
        // Network blip — keep polling.
      } finally {
        if (!cancelled) {
          timer = window.setTimeout(tick, POLL_MS);
        }
      }
    }

    void tick();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [stored]);

  if (!stored || !job) return null;

  const total = job.progress_total ?? 0;
  const done = job.progress_done ?? 0;
  const pct = total > 0 ? Math.max(0, Math.min(100, Math.round((done / total) * 100))) : 0;
  const isRunning = job.status === "queued" || job.status === "running";
  const isDone = job.status === "done";
  const isFailed = job.status === "failed";

  async function triggerDownload() {
    if (!job || job.status !== "done") return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const urlRes = await fetch(`/api/orders/bulk/download-designs/jobs/${job.job_id}/download-url`, {
        method: "POST",
      });
      if (!urlRes.ok) {
        const body = (await urlRes.json().catch(() => ({}))) as { detail?: string };
        throw new Error(body?.detail || `Error ${urlRes.status}`);
      }
      const meta = (await urlRes.json()) as { token: string; job_id: string };
      const token = encodeURIComponent(meta.token);
      const href = `/api/orders/bulk/download-designs/jobs/${meta.job_id}/download?token=${token}`;
      const dlRes = await fetch(href, { cache: "no-store" });
      if (!dlRes.ok) {
        throw new Error(`Error ${dlRes.status} al descargar el ZIP`);
      }
      const blob = await dlRes.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `diseños-bulk-${job.job_id.slice(0, 8)}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      clearActiveDesignJob();
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Error descargando");
    } finally {
      setDownloading(false);
    }
  }

  async function cancelJob() {
    if (!job) return;
    if (!window.confirm("¿Cancelar la descarga? El trabajo en curso se perderá.")) return;
    try {
      await fetch(`/api/orders/bulk/download-designs/jobs/${job.job_id}`, {
        method: "DELETE",
        cache: "no-store",
      });
    } catch {
      // best effort
    }
    clearActiveDesignJob();
  }

  function dismiss() {
    clearActiveDesignJob();
  }

  return (
    <div
      role="status"
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        zIndex: 50,
        width: 300,
        padding: "12px 14px",
        background: "var(--surface-1, #fff)",
        color: "var(--text, #111)",
        border: "1px solid var(--border, rgba(0,0,0,0.12))",
        borderRadius: 12,
        boxShadow: "0 6px 24px rgba(0,0,0,0.18)",
        fontSize: 13,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <strong>
          {isDone ? "✓ Diseños listos" : isFailed ? "⚠ Descarga falló" : "Descargando diseños…"}
        </strong>
        <span style={{ opacity: 0.7, fontSize: 12 }}>
          {total > 0 ? `${done}/${total}` : isRunning ? "preparando…" : ""}
        </span>
      </div>

      {isRunning && total > 0 ? (
        <div
          aria-label={`${pct}%`}
          style={{
            height: 6,
            borderRadius: 999,
            background: "var(--surface-2, rgba(0,0,0,0.08))",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              background: "var(--accent, #3458d6)",
              transition: "width 200ms ease",
            }}
          />
        </div>
      ) : null}

      {(job.failed_count ?? 0) > 0 || (job.no_design_count ?? 0) > 0 ? (
        <div style={{ opacity: 0.75, fontSize: 12 }}>
          {job.ok_count ?? 0} ok
          {(job.failed_count ?? 0) > 0 ? ` · ${job.failed_count} con error` : ""}
          {(job.no_design_count ?? 0) > 0 ? ` · ${job.no_design_count} sin diseño` : ""}
        </div>
      ) : null}

      {isFailed && job.error ? (
        <div style={{ color: "var(--error, #c43d3d)", fontSize: 12 }}>{job.error}</div>
      ) : null}

      {downloadError ? (
        <div style={{ color: "var(--error, #c43d3d)", fontSize: 12 }}>{downloadError}</div>
      ) : null}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        {isDone ? (
          <>
            <button
              className="button-link muted"
              onClick={dismiss}
              type="button"
              style={{ fontSize: 12 }}
            >
              Cerrar
            </button>
            <button
              className="button button-primary"
              disabled={downloading}
              onClick={() => void triggerDownload()}
              type="button"
              style={{ fontSize: 13 }}
            >
              {downloading ? "Descargando…" : "Descargar ZIP"}
            </button>
          </>
        ) : isFailed ? (
          <button
            className="button-secondary"
            onClick={dismiss}
            type="button"
            style={{ fontSize: 12 }}
          >
            Descartar
          </button>
        ) : (
          <button
            className="button-link muted"
            onClick={() => void cancelJob()}
            type="button"
            style={{ fontSize: 12 }}
          >
            Cancelar descarga
          </button>
        )}
      </div>
    </div>
  );
}
