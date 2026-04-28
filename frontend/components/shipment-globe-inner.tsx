"use client";

import { useEffect, useRef, useCallback } from "react";
import Globe from "react-globe.gl";
import type { ProvincePoint } from "./shipment-globe";

type Point = ProvincePoint & { lat: number; lng: number; name: string };
type Props = { points: Point[] };

const ORIGIN = { lat: 40.42, lng: -3.70 }; // Madrid warehouse

const STATUS_COLOR: Record<string, string> = {
  exception:        "#f43f5e",
  out_for_delivery: "#fb923c",
  in_transit:       "#60a5fa",
  delivered:        "#34d399",
  other:            "#a78bfa",
};

function getDominantStatus(p: Point): string {
  if (p.exception > 0)        return "exception";
  if (p.out_for_delivery > 0) return "out_for_delivery";
  if (p.in_transit > 0)       return "in_transit";
  if (p.delivered > 0)        return "delivered";
  return "other";
}

function getDominantColor(p: Point): string {
  return STATUS_COLOR[getDominantStatus(p)];
}

/** Build a glowing HTML badge pinned to each province. */
function makeBadge(p: Point, maxTotal: number): HTMLDivElement {
  const color = getDominantColor(p);
  const size = 28 + Math.round((p.total / maxTotal) * 20); // 28–48 px
  const el = document.createElement("div");
  el.style.cssText = `
    display:flex; flex-direction:column; align-items:center; gap:1px;
    cursor:default; pointer-events:none; transform:translate(-50%,-100%);
  `;
  el.innerHTML = `
    <div style="
      background:rgba(10,10,20,0.82);
      border:1.5px solid ${color};
      border-radius:8px;
      padding:3px 7px;
      font-family:system-ui,sans-serif;
      font-size:11px;
      font-weight:600;
      color:#fff;
      white-space:nowrap;
      box-shadow:0 0 10px ${color}88, 0 2px 8px rgba(0,0,0,0.6);
      line-height:1.4;
    ">
      <span style="color:${color}">${p.name}</span>
      <span style="font-weight:400;color:#cbd5e1;font-size:10px;margin-left:4px">${p.total}</span>
    </div>
    <div style="
      width:0; height:0;
      border-left:4px solid transparent;
      border-right:4px solid transparent;
      border-top:5px solid ${color};
    "></div>
    <div style="
      width:${size}px; height:${size}px; border-radius:50%;
      background:radial-gradient(circle, ${color}dd 0%, ${color}44 55%, transparent 75%);
      box-shadow:0 0 ${size}px ${color}88;
      animation:globe-pulse 2.4s ease-in-out infinite;
      margin-top:-2px;
    "></div>
  `;
  return el;
}

export default function ShipmentGlobeInner({ points }: Props) {
  const globeRef = useRef<{ pointOfView: (pov: object, ms?: number) => void } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 800, h: 520 });

  // Inject keyframe animation once
  useEffect(() => {
    if (document.getElementById("globe-pulse-style")) return;
    const s = document.createElement("style");
    s.id = "globe-pulse-style";
    s.textContent = `
      @keyframes globe-pulse {
        0%,100%{ transform:scale(1); opacity:.85; }
        50%{ transform:scale(1.22); opacity:1; }
      }
    `;
    document.head.appendChild(s);
  }, []);

  // Responsive size
  const updateSize = useCallback(() => {
    if (!containerRef.current) return;
    const w = containerRef.current.offsetWidth;
    const h = Math.min(w * 0.6, 560);
    sizeRef.current = { w, h };
  }, []);

  useEffect(() => {
    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, [updateSize]);

  // Pan to Spain after mount
  useEffect(() => {
    const t = setTimeout(() => {
      globeRef.current?.pointOfView({ lat: 40, lng: -3.5, altitude: 1.0 }, 1400);
    }, 700);
    return () => clearTimeout(t);
  }, []);

  const maxTotal = Math.max(...points.map(p => p.total), 1);

  // Arcs: Madrid → each province
  const arcs = points.map(p => ({
    startLat: ORIGIN.lat, startLng: ORIGIN.lng,
    endLat: p.lat, endLng: p.lng,
    color: [
      "rgba(139,92,246,0.9)",   // purple at origin
      `${getDominantColor(p)}ee`, // status color at dest
    ],
    label: `${p.name} · ${p.total} pedidos`,
    value: p.total,
  }));

  // Rings at each province — two rings per province for depth
  const rings = points.flatMap(p => {
    const color = getDominantColor(p);
    const base = 0.5 + (p.total / maxTotal) * 2.2;
    return [
      { lat: p.lat, lng: p.lng, maxR: base,        propagationSpeed: 1.8, repeatPeriod: 800,  color },
      { lat: p.lat, lng: p.lng, maxR: base * 0.55, propagationSpeed: 2.4, repeatPeriod: 1100, color: `${color}88` },
    ];
  });

  const htmlData = points.map(p => ({ ...p, __badge: makeBadge(p, maxTotal) }));

  const { w, h } = sizeRef.current;

  return (
    <div ref={containerRef} className="sglobe-container" style={{ position: "relative" }}>
      <Globe
        ref={globeRef as React.RefObject<never>}
        width={w}
        height={h}
        backgroundColor="rgba(0,0,0,0)"

        /* ── Earth ── */
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
        bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
        atmosphereColor="#6d28d9"
        atmosphereAltitude={0.22}

        /* ── Arcs ── */
        arcsData={arcs}
        arcColor="color"
        arcDashLength={0.5}
        arcDashGap={0.08}
        arcDashAnimateTime={1400}
        arcStroke={0.55}
        arcAltitudeAutoScale={0.32}
        arcLabel="label"

        /* ── Rings ── */
        ringsData={rings}
        ringColor="color"
        ringMaxRadius="maxR"
        ringPropagationSpeed="propagationSpeed"
        ringRepeatPeriod="repeatPeriod"

        /* ── HTML badges ── */
        htmlElementsData={htmlData}
        htmlElement={(d) => (d as typeof htmlData[0]).__badge}
        htmlAltitude={0.02}
      />
    </div>
  );
}
