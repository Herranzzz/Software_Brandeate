"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface PrintCutlinePreviewProps {
  src: string;
  variantTitle?: string | null;
  orderId: number;
  printVariant?: "30x40" | "18x24";
}

// Page dimensions per variant
const PAGE_DIMS = {
  "30x40": { w: 297, h: 420 },  // A3
  "18x24": { w: 210, h: 297 },  // A4
} as const;

// Design area within page (mm)
const DESIGN_DIMS = {
  "30x40": { w: 297, h: 420 },  // fills full A3
  "18x24": { w: 180, h: 240 },  // centred on A4
} as const;

const DEFAULT_MARGIN_MM = 20;
const A3_W = 297;
const A3_H = 420;
const SNAP_THRESHOLD = 3;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.15;

function getSnapPoints(marginPctW: number, marginPctH: number) {
  return [
    { x: 0, y: 0 },
    { x: marginPctW, y: 0 },
    { x: -marginPctW, y: 0 },
    { x: 0, y: marginPctH },
    { x: 0, y: -marginPctH },
  ];
}

type DownloadState = "idle" | "loading" | "done" | "error";

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

export function PrintCutlinePreview({ src, variantTitle, orderId, printVariant = "30x40" }: PrintCutlinePreviewProps) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [snapping, setSnapping] = useState(false);
  const [dlState, setDlState] = useState<DownloadState>("idle");
  const [dlError, setDlError] = useState<string | null>(null);

  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const stageRef = useRef<HTMLDivElement>(null);

  const page = PAGE_DIMS[printVariant];
  const design = DESIGN_DIMS[printVariant];

  // For 30x40: top-only cut line (design fills page). For 18x24: full rect cut line centred.
  const is18x24 = printVariant === "18x24";
  const cutLeft   = ((page.w - design.w) / 2 / page.w) * 100;
  const cutTop    = ((page.h - design.h) / 2 / page.h) * 100;
  const cutRight  = cutLeft;
  const cutBottom = cutTop;

  const marginPctW = (DEFAULT_MARGIN_MM / A3_W) * 100;
  const marginPctH = (DEFAULT_MARGIN_MM / A3_H) * 100;
  const snapPoints = getSnapPoints(marginPctW, marginPctH);

  const trySnap = useCallback((x: number, y: number) => {
    for (const sp of snapPoints) {
      if (Math.abs(x - sp.x) < SNAP_THRESHOLD && Math.abs(y - sp.y) < SNAP_THRESHOLD) {
        setSnapping(true);
        return { x: sp.x, y: sp.y };
      }
    }
    setSnapping(false);
    return { x, y };
  }, [snapPoints]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
    e.preventDefault();
  }, []);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    dragging.current = true;
    lastPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, []);

  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    setZoom(z => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z - e.deltaY * 0.001)));
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [onWheel]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current || !stageRef.current) return;
      const rect = stageRef.current.getBoundingClientRect();
      const dx = ((e.clientX - lastPos.current.x) / rect.width) * 100;
      const dy = ((e.clientY - lastPos.current.y) / rect.height) * 100;
      lastPos.current = { x: e.clientX, y: e.clientY };
      setOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!dragging.current || !stageRef.current) return;
      const rect = stageRef.current.getBoundingClientRect();
      const dx = ((e.touches[0].clientX - lastPos.current.x) / rect.width) * 100;
      const dy = ((e.touches[0].clientY - lastPos.current.y) / rect.height) * 100;
      lastPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      setOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      setOffset(prev => trySnap(prev.x, prev.y));
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onUp);
    };
  }, [trySnap]);

  const handleDownload = useCallback(async () => {
    setDlState("loading");
    setDlError(null);
    try {
      // 1. Create job
      const createRes = await fetch("/api/orders/bulk/download-designs/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_ids: [orderId] }),
      });
      if (!createRes.ok) throw new Error("No se pudo iniciar la descarga.");
      let job = await createRes.json();

      // 2. Poll until done
      const deadline = Date.now() + 60_000;
      while (job.status !== "done") {
        if (job.status === "failed") throw new Error(job.error || "La descarga falló.");
        if (Date.now() > deadline) throw new Error("La descarga tardó demasiado.");
        await sleep(1200);
        const pollRes = await fetch(`/api/orders/bulk/download-designs/jobs/${job.job_id}`, { cache: "no-store" });
        if (!pollRes.ok) throw new Error("Error consultando el progreso.");
        job = await pollRes.json();
      }

      // 3. Get download URL
      const urlRes = await fetch(`/api/orders/bulk/download-designs/jobs/${job.job_id}/download-url`, { method: "POST" });
      if (!urlRes.ok) throw new Error("No se pudo generar el enlace.");
      const { token } = await urlRes.json();

      // 4. Trigger download
      const a = document.createElement("a");
      a.href = `/api/orders/bulk/download-designs/jobs/${job.job_id}/download?token=${encodeURIComponent(token)}`;
      a.download = "";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setDlState("done");
      setTimeout(() => setDlState("idle"), 3000);
    } catch (err) {
      setDlError(err instanceof Error ? err.message : "Error desconocido.");
      setDlState("error");
    }
  }, [orderId]);

  const reset = () => { setOffset({ x: 0, y: 0 }); setZoom(1); setSnapping(false); };

  return (
    <div className="pcl-wrap">
      <div className="pcl-header">
        <span className="pcl-title">Vista previa de impresión</span>
        {variantTitle && <span className="pcl-variant">{variantTitle}</span>}
        <div className="pcl-zoom-controls">
          <button className="pcl-zoom-btn" onClick={() => setZoom(z => Math.min(MAX_ZOOM, z + ZOOM_STEP))}>+</button>
          <span className="pcl-zoom-label">{Math.round(zoom * 100)}%</span>
          <button className="pcl-zoom-btn" onClick={() => setZoom(z => Math.max(MIN_ZOOM, z - ZOOM_STEP))}>−</button>
        </div>
        <button
          className={`pcl-download-btn${dlState === "loading" ? " is-loading" : ""}${dlState === "done" ? " is-done" : ""}`}
          onClick={handleDownload}
          disabled={dlState === "loading"}
        >
          {dlState === "loading" ? "Generando…" : dlState === "done" ? "✓ Descargado" : "↓ Descargar PDF A3"}
        </button>
      </div>

      <div className="pcl-stage" ref={stageRef}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt="Diseño"
          className="pcl-img"
          draggable={false}
          style={{
            transform: `translate(${offset.x}%, ${offset.y}%) scale(${zoom})`,
            transformOrigin: "center center",
          }}
          onMouseDown={onMouseDown}
          onTouchStart={onTouchStart}
        />

        {/* Cut line — top edge only */}
        <div className="pcl-cutline-top" style={{ top: `${marginPctH}%` }}>
          <span className="pcl-corner pcl-corner-tl" />
          <span className="pcl-corner pcl-corner-tr" />
        </div>

        {snapping && <div className="pcl-snap-badge">⊕ Encajado</div>}
        <div className="pcl-badge">2 cm</div>
      </div>

      {dlState === "error" && dlError && (
        <p className="pcl-error">{dlError}</p>
      )}

      <p className="pcl-hint">
        Arrastra para mover · Rueda para zoom ·{" "}
        <button className="pcl-reset" onClick={reset}>Resetear</button>
      </p>
    </div>
  );
}
