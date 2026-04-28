"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import Globe from "react-globe.gl";
import type { ProvincePoint } from "./shipment-globe";

type Point = ProvincePoint & { lat: number; lng: number; name: string };
type Props = { points: Point[] };

const ORIGIN = { lat: 40.42, lng: -3.70 };

const STATUS: Record<string, { color: string; label: string }> = {
  exception:        { color: "#f43f5e", label: "Excepción" },
  out_for_delivery: { color: "#fb923c", label: "En reparto" },
  in_transit:       { color: "#38bdf8", label: "En tránsito" },
  delivered:        { color: "#4ade80", label: "Entregado" },
  other:            { color: "#a78bfa", label: "Sin envío" },
};

function dominant(p: Point) {
  if (p.exception > 0)        return "exception";
  if (p.out_for_delivery > 0) return "out_for_delivery";
  if (p.in_transit > 0)       return "in_transit";
  if (p.delivered > 0)        return "delivered";
  return "other";
}
const color = (p: Point) => STATUS[dominant(p)].color;

export default function ShipmentGlobeInner({ points }: Props) {
  const globeRef = useRef<{ pointOfView: (pov: object, ms?: number) => void } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(680);

  const updateW = useCallback(() => {
    if (containerRef.current) setW(containerRef.current.offsetWidth);
  }, []);

  useEffect(() => {
    updateW();
    const ro = new ResizeObserver(updateW);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [updateW]);

  // Fly in to Spain
  useEffect(() => {
    const t = setTimeout(() => {
      globeRef.current?.pointOfView({ lat: 40.2, lng: -3.5, altitude: 0.9 }, 1500);
    }, 600);
    return () => clearTimeout(t);
  }, []);

  const maxTotal = Math.max(...points.map(p => p.total), 1);
  const top10 = [...points].sort((a, b) => b.total - a.total).slice(0, 10);

  // ─── Arcs: FIXED altitude 0.3 so they curve dramatically ──────────────
  const arcs = points.map(p => ({
    startLat: ORIGIN.lat, startLng: ORIGIN.lng,
    endLat:   p.lat,      endLng:   p.lng,
    color:    color(p),
    tooltip:  `${p.name}: ${p.total} pedidos`,
  }));

  // ─── Large glowing points ──────────────────────────────────────────────
  const pts = points.map(p => ({
    lat: p.lat, lng: p.lng,
    r: 0.25 + (p.total / maxTotal) * 0.65,
    color: color(p),
    label: `${p.name} · ${p.total}`,
  }));

  // ─── Rings (top 15) ───────────────────────────────────────────────────
  const rings = [...points].sort((a, b) => b.total - a.total).slice(0, 15).map(p => ({
    lat: p.lat, lng: p.lng,
    maxR: 0.5 + (p.total / maxTotal) * 1.4,
    propagationSpeed: 2.2,
    repeatPeriod: 850,
    color: color(p),
  }));

  const H = Math.round(w * 0.56);

  return (
    <div style={{ display: "flex", gap: 0, alignItems: "stretch" }}>
      {/* ── Globe ── */}
      <div ref={containerRef} style={{ flex: "1 1 0", minWidth: 0, borderRadius: "12px 0 0 12px", overflow: "hidden", background: "#020817" }}>
        <Globe
          ref={globeRef as React.RefObject<never>}
          width={w}
          height={H}
          backgroundColor="#020817"

          globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
          bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
          atmosphereColor="#3730a3"
          atmosphereAltitude={0.15}

          /* ── Arcs: thin animated lines ── */
          arcsData={arcs}
          arcColor="color"
          arcAltitude={0.3}
          arcStroke={0.25}
          arcDashLength={0.5}
          arcDashGap={0.1}
          arcDashAnimateTime={1400}
          arcLabel="tooltip"

          /* ── Points ── */
          pointsData={pts}
          pointColor="color"
          pointRadius="r"
          pointAltitude={0.006}
          pointResolution={20}
          pointLabel="label"

          /* ── Rings ── */
          ringsData={rings}
          ringColor="color"
          ringMaxRadius="maxR"
          ringPropagationSpeed="propagationSpeed"
          ringRepeatPeriod="repeatPeriod"
        />
      </div>

      {/* ── Sidebar ranking ── */}
      <div style={{
        width: 196, flexShrink: 0,
        background: "rgba(2,8,23,0.92)",
        borderRadius: "0 12px 12px 0",
        borderLeft: "1px solid rgba(255,255,255,0.07)",
        padding: "16px 12px",
        display: "flex", flexDirection: "column", gap: 4,
        height: H, overflowY: "auto", boxSizing: "border-box",
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", color: "#64748b", marginBottom: 8 }}>
          Top provincias
        </div>
        {top10.map((p, i) => {
          const c = color(p);
          const pct = Math.round((p.total / maxTotal) * 100);
          return (
            <div key={p.province_code} style={{ marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 10, color: "#475569", width: 14, textAlign: "right" }}>{i + 1}</span>
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: c, boxShadow: `0 0 6px ${c}` }} />
                  <span style={{ fontSize: 12, color: "#e2e8f0", fontWeight: 500 }}>{p.name}</span>
                </div>
                <span style={{ fontSize: 11, color: c, fontWeight: 700 }}>{p.total}</span>
              </div>
              <div style={{ height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 99, marginLeft: 20 }}>
                <div style={{ height: "100%", width: `${pct}%`, background: c, borderRadius: 99, boxShadow: `0 0 6px ${c}88` }} />
              </div>
            </div>
          );
        })}

        {/* Status legend */}
        <div style={{ marginTop: "auto", paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.07)" }}>
          {Object.entries(STATUS).map(([, { color: c, label }]) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: c }} />
              <span style={{ fontSize: 10, color: "#64748b" }}>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
