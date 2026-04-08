"use client";

import { useState } from "react";

import { AppModal } from "@/components/app-modal";
import { getItemPrimaryAsset } from "@/lib/personalization";
import type { Order } from "@/lib/types";


type Phase = "confirm" | "loading" | "done" | "error";
type JobStatus = "queued" | "running" | "done" | "failed";

type BulkDesignDownloadModalProps = {
  orders: Order[];
  onClose: () => void;
};

type BulkDownloadJobState = {
  job_id: string;
  status: JobStatus;
  progress_total: number;
  progress_done: number;
  ok_count: number;
  failed_count: number;
  no_design_count: number;
  error?: string | null;
  ready?: boolean;
};

type BulkDownloadUrlResponse = {
  token: string;
  expires_at: number;
  download_path: string;
  job_id: string;
};

const POLL_INTERVAL_MS = 1200;
const POLL_TIMEOUT_MS = 12 * 60 * 1000;


async function readErrorDetail(response: Response, fallback: string) {
  const text = (await response.text()).trim();
  if (!text) return fallback;
  try {
    const payload = JSON.parse(text) as { detail?: unknown };
    if (typeof payload.detail === "string" && payload.detail.trim()) {
      return payload.detail.trim();
    }
    if (payload.detail !== undefined) {
      return String(payload.detail);
    }
  } catch {
    // plain text error
  }
  return text || fallback;
}


function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


export function BulkDesignDownloadModal({ orders, onClose }: BulkDesignDownloadModalProps) {
  const [phase, setPhase] = useState<Phase>("confirm");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus>("queued");
  const [jobId, setJobId] = useState<string | null>(null);
  const [downloadedCount, setDownloadedCount] = useState(0);
  const [totalWithDesign, setTotalWithDesign] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [noDesignCount, setNoDesignCount] = useState(0);
  const [progressDone, setProgressDone] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);

  const ordersWithDesign = orders.filter((o) =>
    o.items.some((item) => getItemPrimaryAsset(item) !== null || item.design_link),
  );
  const ordersWithoutDesign = orders.length - ordersWithDesign.length;

  function syncStateFromJob(job: BulkDownloadJobState) {
    setJobStatus(job.status);
    setJobId(job.job_id);
    setProgressTotal(Number(job.progress_total || 0));
    setProgressDone(Number(job.progress_done || 0));
    setDownloadedCount(Number(job.ok_count || 0));
    setFailedCount(Number(job.failed_count || 0));
    setNoDesignCount(Number(job.no_design_count || 0));
    if (Number(job.progress_total || 0) > 0) {
      setTotalWithDesign(Number(job.progress_total || 0));
    }
  }

  async function handleDownload() {
    setPhase("loading");
    setErrorMsg(null);
    setJobStatus("queued");
    setDownloadedCount(0);
    setFailedCount(0);
    setNoDesignCount(0);
    setProgressDone(0);
    setProgressTotal(0);
    setTotalWithDesign(ordersWithDesign.length);

    try {
      const createResponse = await fetch("/api/orders/bulk/download-designs/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_ids: orders.map((o) => o.id) }),
      });
      if (!createResponse.ok) {
        throw new Error(await readErrorDetail(createResponse, "No se pudo iniciar la descarga de diseños."));
      }

      let currentJob = (await createResponse.json()) as BulkDownloadJobState;
      syncStateFromJob(currentJob);

      const deadlineAt = Date.now() + POLL_TIMEOUT_MS;
      while (currentJob.status !== "done") {
        if (currentJob.status === "failed") {
          throw new Error(currentJob.error || "La descarga de diseños falló durante el procesamiento.");
        }
        if (Date.now() > deadlineAt) {
          throw new Error("La descarga tardó demasiado. Inténtalo de nuevo en unos segundos.");
        }

        await sleep(POLL_INTERVAL_MS);
        const statusResponse = await fetch(`/api/orders/bulk/download-designs/jobs/${currentJob.job_id}`, {
          cache: "no-store",
        });
        if (!statusResponse.ok) {
          throw new Error(await readErrorDetail(statusResponse, "No se pudo consultar el progreso de la descarga."));
        }
        currentJob = (await statusResponse.json()) as BulkDownloadJobState;
        syncStateFromJob(currentJob);
      }

      const downloadUrlResponse = await fetch(
        `/api/orders/bulk/download-designs/jobs/${currentJob.job_id}/download-url`,
        { method: "POST" },
      );
      if (!downloadUrlResponse.ok) {
        throw new Error(await readErrorDetail(downloadUrlResponse, "No se pudo generar la URL de descarga."));
      }
      const downloadMeta = (await downloadUrlResponse.json()) as BulkDownloadUrlResponse;

      const token = encodeURIComponent(downloadMeta.token);
      const downloadHref = `/api/orders/bulk/download-designs/jobs/${currentJob.job_id}/download?token=${token}`;
      const anchor = document.createElement("a");
      anchor.href = downloadHref;
      anchor.download = "diseños-bulk.zip";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();

      setPhase("done");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Error desconocido");
      setPhase("error");
    }
  }

  const isLoading = phase === "loading";
  const progressPct = progressTotal > 0 ? Math.max(0, Math.min(100, Math.round((progressDone / progressTotal) * 100))) : 0;

  return (
    <AppModal
      eyebrow="Producción"
      onClose={isLoading ? () => {} : onClose}
      open
      title="Descargar diseños en bulk"
      subtitle={`${orders.length} pedido${orders.length !== 1 ? "s" : ""} seleccionado${orders.length !== 1 ? "s" : ""}`}
      width="default"
      actions={
        phase === "done" || phase === "error" ? (
          <button className="button" onClick={onClose} type="button">
            Cerrar
          </button>
        ) : (
          <>
            <button
              className="button-secondary"
              disabled={isLoading}
              onClick={onClose}
              type="button"
            >
              Cancelar
            </button>
            {phase === "confirm" ? (
              <button
                className="button"
                disabled={ordersWithDesign.length === 0}
                onClick={() => void handleDownload()}
                type="button"
              >
                Descargar diseños
              </button>
            ) : null}
          </>
        )
      }
    >
      <div className="stack">
        {phase === "confirm" ? (
          <>
            <div className="bulk-design-info">
              <div className="bulk-design-info-row">
                <span className="bulk-design-info-icon">🎨</span>
                <div>
                  <div className="table-primary">
                    {ordersWithDesign.length} pedido{ordersWithDesign.length !== 1 ? "s" : ""} con diseño detectable
                  </div>
                  <div className="table-secondary">
                    Los diseños se empaquetarán en un ZIP nombrado como:<br />
                    <code className="bulk-design-name-example">NUMERO_PEDIDO - Nombre del producto.png</code>
                  </div>
                </div>
              </div>
              {ordersWithoutDesign > 0 ? (
                <div className="bulk-design-info-row">
                  <span className="bulk-design-info-icon">⚠️</span>
                  <div>
                    <div className="table-primary">{ordersWithoutDesign} pedido{ordersWithoutDesign !== 1 ? "s" : ""} sin diseño visible</div>
                    <div className="table-secondary">Se omitirán automáticamente del ZIP.</div>
                  </div>
                </div>
              ) : null}
              {ordersWithDesign.length === 0 ? (
                <div className="feedback feedback-error">
                  Ninguno de los pedidos seleccionados tiene un diseño asociado visible. Selecciona pedidos personalizados con diseño disponible.
                </div>
              ) : null}
            </div>
            <div className="table-secondary">
              El servidor preparará la descarga en segundo plano y te avisará en cuanto el ZIP esté listo.
            </div>
          </>
        ) : null}

        {phase === "loading" ? (
          <div className="bulk-label-loading">
            <div className="bulk-label-spinner" aria-hidden="true" />
            <div className="stack">
              <div>
                <div className="table-primary">Generando ZIP de diseños...</div>
                <div className="table-secondary">
                  Estado: <strong>{jobStatus}</strong> {jobId ? <>· Job <code>{jobId.slice(0, 8)}</code></> : null}
                </div>
              </div>

              <div className="bulk-design-progress">
                <div className="bulk-design-progress-meta">
                  <span>{progressDone}/{progressTotal || totalWithDesign || 0} procesados</span>
                  <strong>{progressPct}%</strong>
                </div>
                <div className="bulk-design-progress-track">
                  <div className="bulk-design-progress-fill" style={{ width: `${progressPct}%` }} />
                </div>
                <div className="bulk-design-progress-counters">
                  <span>OK: {downloadedCount}</span>
                  <span>Fallidos: {failedCount}</span>
                  <span>Sin diseño: {noDesignCount}</span>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {phase === "done" ? (
          <div className="stack">
            <div className="feedback feedback-success">
              ZIP descargado con <strong>{downloadedCount}</strong> diseño{downloadedCount !== 1 ? "s" : ""}.
              {failedCount > 0 ? <> {failedCount} no pudieron descargarse por error remoto o timeout.</> : null}
              {noDesignCount > 0 ? <> {noDesignCount} se omitieron por no tener diseño visible.</> : null}
            </div>
            <div className="table-secondary">
              Revisa la carpeta de descargas de tu navegador para encontrar el archivo <code>diseños-bulk.zip</code>.
            </div>
          </div>
        ) : null}

        {phase === "error" ? (
          <div className="feedback feedback-error">
            {errorMsg ?? "Error al generar la descarga."}
          </div>
        ) : null}
      </div>
    </AppModal>
  );
}
