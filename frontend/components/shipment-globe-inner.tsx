"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import Globe from "react-globe.gl";
import type { ProvincePoint } from "./shipment-globe";

type Point = ProvincePoint & { lat: number; lng: number; name: string };
type Props = { points: Point[] };

const ORIGIN = { lat: 40.42, lng: -3.70 };

const STATUS_COLOR: Record<string, string> = {
  exception:        "#f43f5e",
  out_for_delivery: "#fb923c",
  in_transit:       "#60a5fa",
  delivered:        "#34d399",
  other:            "#a78bfa",
};

function dominantColor(p: Point) {
  if (p.exception > 0)        return STATUS_COLOR.exception;
  if (p.out_for_delivery > 0) return STATUS_COLOR.out_for_delivery;
  if (p.in_transit > 0)       return STATUS_COLOR.in_transit;
  if (p.delivered > 0)        return STATUS_COLOR.delivered;
  return STATUS_COLOR.other;
}

/** Floating badge — only for top-N provinces */
function makeBadge(p: Point, color: string): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText = "pointer-events:none; transform:translate(-50%,-100%);";
  el.innerHTML = `
    <div style="
      background:rgba(6,9,24,0.88);
      border:1.5px solid ${color};
      border-radius:7px;
      padding:3px 9px 3px 7px;
      font:600 12px/1.5 system-ui,sans-serif;
      color:#fff;
      white-space:nowrap;
      box-shadow:0 0 14px ${color}99;
      display:flex; align-items:baseline; gap:5px;
    ">
      <span style="color:${color};font-size:10px">●</span>
      ${p.name}
      <span style="font-weight:400;color:${color};font-size:11px">${p.total}</span>
    </div>
    <div style="width:0;height:0;
      border-left:5px solid transparent;border-right:5px solid transparent;
      border-top:6px solid ${color};margin:0 auto;"></div>`;
  return el;
}

export default function ShipmentGlobeInner({ points }: Props) {
  const globeRef = useRef<{ pointOfView: (pov: object, ms?: number) => void } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });

  const updateSize = useCallback(() => {
    if (!containerRef.current) return;
    const w = containerRef.current.offsetWidth;
    setSize({ w, h: Math.min(Math.round(w * 0.58), 540) });
  }, []);

  useEffect(() => {
    updateSize();
    const ro = new ResizeObserver(updateSize);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [updateSize]);

  // Fly close to Spain
  useEffect(() => {
    const t = setTimeout(() => {
      globeRef.current?.pointOfView({ lat: 40.2, lng: -3.5, altitude: 0.55 }, 1200);
    }, 800);
    return () => clearTimeout(t);
  }, []);

  const maxTotal = Math.max(...points.map(p => p.total), 1);

  // ── Arcs: use plain strings so the color field works reliably ─────────
  const arcs = points.map(p => ({
    startLat: ORIGIN.lat, startLng: ORIGIN.lng,
    endLat: p.lat,        endLng: p.lng,
    color: dominantColor(p),
    label: `${p.name} · ${p.total} pedidos`,
  }));

  // ── Glowing points for every province ────────────────────────────────
  const pts = points.map(p => {
    const color = dominantColor(p);
    const r = 0.18 + (p.total / maxTotal) * 0.55;
    return { lat: p.lat, lng: p.lng, r, color, label: `${p.name}: ${p.total}` };
  });

  // ── Rings: just the top 20 provinces ─────────────────────────────────
  const rings = points
    .slice(0, 20)
    .flatMap(p => {
      const color = dominantColor(p);
      const base = 0.4 + (p.total / maxTotal) * 1.6;
      return [
        { lat: p.lat, lng: p.lng, maxR: base,        propagationSpeed: 2,   repeatPeriod: 900,  color },
        { lat: p.lat, lng: p.lng, maxR: base * 0.5,  propagationSpeed: 2.8, repeatPeriod: 1200, color: `${color}77` },
      ];
    });

  // ── HTML badges: top 12 only to avoid crowding ────────────────────────
  const topPoints = [...points].sort((a, b) => b.total - a.total).slice(0, 12);
  const htmlData = topPoints.map(p => {
    const color = dominantColor(p);
    return { lat: p.lat, lng: p.lng, __el: makeBadge(p, color) };
  });

  return (
    <div ref={containerRef} className="sglobe-container">
      <Globe
        ref={globeRef as React.RefObject<never>}
        width={size.w}
        height={size.h}
        backgroundColor="rgba(0,0,0,0)"

        /* Earth */
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
        bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
        atmosphereColor="#4f46e5"
        atmosphereAltitude={0.18}

        /* Arcs — thick, animated */
        arcsData={arcs}
        arcColor="color"
        arcDashLength={0.4}
        arcDashGap={0.15}
        arcDashAnimateTime={1600}
        arcStroke={1.2}
        arcAltitudeAutoScale={0.28}
        arcLabel="label"

        /* Glowing points */
        pointsData={pts}
        pointColor="color"
        pointRadius="r"
        pointAltitude={0.005}
        pointResolution={16}
        pointLabel="label"

        /* Rings */
        ringsData={rings}
        ringColor="color"
        ringMaxRadius="maxR"
        ringPropagationSpeed="propagationSpeed"
        ringRepeatPeriod="repeatPeriod"

        /* Floating badges (top 12 only) */
        htmlElementsData={htmlData}
        htmlElement={(d) => (d as typeof htmlData[0]).__el}
        htmlAltitude={0.01}
      />
    </div>
  );
}
