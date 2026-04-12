"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface PrintCutlinePreviewProps {
  srcs: string[];
  variantTitle?: string | null;
  orderId: number;
  printVariant?: "30x40" | "18x24";
}

// Page dimensions (mm) — A4 portrait for 18x24 portrait, A4 landscape for 18x24 landscape
const PAGE_PORTRAIT      = { w: 210, h: 297 };  // A4 portrait
const PAGE_LANDSCAPE     = { w: 297, h: 210 };  // A4 landscape
const PAGE_A3            = { w: 297, h: 420 };  // A3 portrait
const PAGE_A3_LANDSCAPE  = { w: 420, h: 297 };  // A3 landscape

// Design area within page (mm)
const DESIGN_18x24_PORTRAIT    = { w: 180, h: 240 };  // 18x24 portrait in A4p
const DESIGN_18x24_LANDSCAPE   = { w: 240, h: 180 };  // 18x24 landscape in A4l
const DESIGN_30x40             = { w: 297, h: 420 };  // fills full A3 portrait
const DESIGN_30x40_LANDSCAPE   = { w: 420, h: 297 };  // fills full A3 landscape

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

export function PrintCutlinePreview({ srcs, variantTitle, orderId, printVariant = "30x40" }: PrintCutlinePreviewProps) {
  const [designIdx, setDesignIdx] = useState(0);
  const src = srcs[designIdx] ?? srcs[0];
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [snapping, setSnapping] = useState(false);
  const [dlState, setDlState] = useState<DownloadState>("idle");
  const [dlError, setDlError] = useState<string | null>(null);
  const [isImgLandscape, setIsImgLandscape] = useState(false);

  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const stageRef = useRef<HTMLDivElement>(null);

  const is18x24 = printVariant === "18x24";

  // Pick page + design based on variant AND detected orientation
  const page   = is18x24
    ? (isImgLandscape ? PAGE_LANDSCAPE    : PAGE_PORTRAIT)
    : (isImgLandscape ? PAGE_A3_LANDSCAPE : PAGE_A3);
  const design = is18x24
    ? (isImgLandscape ? DESIGN_18x24_LANDSCAPE : DESIGN_18x24_PORTRAIT)
    : (isImgLandscape ? DESIGN_30x40_LANDSCAPE : DESIGN_30x40);

  // design as % of page
  const designWidthPct  = (design.w / page.w) * 100;
  const designHeightPct = (design.h / page.h) * 100;

  // Cut margin: 2cm from top (portrait 30x40) or 2cm from right (landscape 30x40)
  const margin2cmTopPct   = (20 / page.h) * 100;   // horizontal cut line Y position
  const margin2cmRightPct = ((page.w - 20) / page.w) * 100; // vertical cut line X position

  const marginPctW = 0;
  const marginPctH = 0;
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
      const createRes = await fetch("/api/orders/bulk/download-designs/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_ids: [orderId] }),
      });
      if (!createRes.ok) throw new Error("No se pudo iniciar la descarga.");
      let job = await createRes.json();

      const deadline = Date.now() + 60_000;
      while (job.status !== "done") {
        if (job.status === "failed") throw new Error(job.error || "La descarga falló.");
        if (Date.now() > deadline) throw new Error("La descarga tardó demasiado.");
        await sleep(1200);
        const pollRes = await fetch(`/api/orders/bulk/download-designs/jobs/${job.job_id}`, { cache: "no-store" });
        if (!pollRes.ok) throw new Error("Error consultando el progreso.");
        job = await pollRes.json();
      }

      const urlRes = await fetch(`/api/orders/bulk/download-designs/jobs/${job.job_id}/download-url`, { method: "POST" });
      if (!urlRes.ok) throw new Error("No se pudo generar el enlace.");
      const { token } = await urlRes.json();

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

  const goToDesign = (idx: number) => {
    setDesignIdx(idx);
    setOffset({ x: 0, y: 0 });
    setZoom(1);
    setIsImgLandscape(false);
  };

  const pdfLabel = is18x24 ? "↓ Descargar PDF A4" : "↓ Descargar PDF A3";
  const pageLabel = is18x24
    ? (isImgLandscape ? "A4 Horizontal · 18×24 cm" : "A4 · 18×24 cm")
    : "A3 · 30×40 cm";

  return (
    <div className="pcl-wrap">
      <div className="pcl-header">
        <span className="pcl-title">Vista previa de impresión</span>
        {variantTitle && <span className="pcl-variant">{variantTitle}</span>}
        {/* Multi-design navigation */}
        {srcs.length > 1 && (
          <div className="pcl-design-nav">
            <button
              className="pcl-design-nav-btn"
              disabled={designIdx === 0}
              onClick={() => goToDesign(designIdx - 1)}
              title="Diseño anterior"
            >‹</button>
            <span className="pcl-design-nav-pos">{designIdx + 1} / {srcs.length}</span>
            <button
              className="pcl-design-nav-btn"
              disabled={designIdx === srcs.length - 1}
              onClick={() => goToDesign(designIdx + 1)}
              title="Diseño siguiente"
            >›</button>
          </div>
        )}
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
          {dlState === "loading" ? "Generando…" : dlState === "done" ? "✓ Descargado" : pdfLabel}
        </button>
      </div>

      {/* Stage: aspect ratio matches the physical page */}
      <div
        className="pcl-stage"
        ref={stageRef}
        style={{ aspectRatio: `${page.w} / ${page.h}` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt="Diseño"
          className="pcl-img"
          draggable={false}
          style={{
            transform: `translate(${offset.x}%, ${offset.y}%) scale(${zoom})`,
            transformOrigin: "top left",
            width:    `${designWidthPct}%`,
            height:   `${designHeightPct}%`,
            top:      "0",
            left:     "0",
            position: "absolute",
          }}
          onLoad={(e) => {
            const img = e.currentTarget;
            setIsImgLandscape(img.naturalWidth > img.naturalHeight);
          }}
          onMouseDown={onMouseDown}
          onTouchStart={onTouchStart}
        />

        {is18x24 ? (
          /* 18x24 corner layout: only right + bottom cut lines */
          <>
            <div className="pcl-cutline-v" style={{ left: `${designWidthPct}%` }} />
            <div className="pcl-cutline-h" style={{ top: `${designHeightPct}%` }} />
          </>
        ) : isImgLandscape ? (
          /* 30x40 landscape: right-only cut line at 2cm from right edge */
          <div className="pcl-cutline-v" style={{ left: `${margin2cmRightPct}%` }} />
        ) : (
          /* 30x40 portrait: top-only red cut line at 2cm from top */
          <div className="pcl-cutline-top" style={{ top: `${margin2cmTopPct}%` }}>
            <span className="pcl-corner pcl-corner-tl" />
            <span className="pcl-corner pcl-corner-tr" />
          </div>
        )}

        {snapping && <div className="pcl-snap-badge">⊕ Encajado</div>}
        <div className="pcl-badge">{pageLabel}</div>
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
