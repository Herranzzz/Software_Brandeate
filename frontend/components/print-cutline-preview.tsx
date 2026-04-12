"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface PrintCutlinePreviewProps {
  src: string;
  variantTitle?: string | null;
}

const DEFAULT_MARGIN_MM = 20; // 2cm
const A3_H = 420; // mm

export function PrintCutlinePreview({ src, variantTitle }: PrintCutlinePreviewProps) {
  const [marginMm] = useState(DEFAULT_MARGIN_MM);
  // Image offset in % relative to the stage
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const stageRef = useRef<HTMLDivElement>(null);

  const marginPctW = (marginMm / 297) * 100;
  const marginPctH = (marginMm / A3_H) * 100;

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
    e.preventDefault();
  }, []);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    dragging.current = true;
    lastPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, []);

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

    const onUp = () => { dragging.current = false; };

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
  }, []);

  return (
    <div className="pcl-wrap">
      <div className="pcl-header">
        <span className="pcl-title">Vista previa de impresión</span>
        {variantTitle && <span className="pcl-variant">{variantTitle}</span>}
      </div>

      <div className="pcl-stage" ref={stageRef}>
        {/* Draggable design image */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt="Diseño"
          className="pcl-img"
          draggable={false}
          style={{ transform: `translate(${offset.x}%, ${offset.y}%)` }}
          onMouseDown={onMouseDown}
          onTouchStart={onTouchStart}
        />

        {/* Fixed cut line — top edge only */}
        <div
          className="pcl-cutline-top"
          style={{ top: `${marginPctH}%` }}
        >
          <span className="pcl-corner pcl-corner-tl" />
          <span className="pcl-corner pcl-corner-tr" />
        </div>

        {/* Margin badge */}
        <div className="pcl-badge">{(marginMm / 10).toFixed(0)} cm de margen</div>
      </div>

      <p className="pcl-hint">
        Arrastra el diseño para posicionarlo ·{" "}
        <button className="pcl-reset" onClick={() => setOffset({ x: 0, y: 0 })}>
          Centrar
        </button>
      </p>
    </div>
  );
}
