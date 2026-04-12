"use client";

import { useCallback, useRef, useState, type MouseEvent } from "react";
import type { AnalyticsShippingPerformancePoint } from "@/lib/types";

/* ── Formatters ─────────────────────────────────────────────────────── */

function formatShortDate(dateStr: string) {
  const d = new Date(`${dateStr}T12:00:00`);
  return d.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

function formatPercent(v: number | null): string {
  if (v === null || Number.isNaN(v)) return "—";
  return `${Math.round(v)}%`;
}

function formatCount(n: number): string {
  return n.toLocaleString("es-ES");
}

function formatHoursAsShort(h: number | null): string {
  if (h === null || Number.isNaN(h)) return "—";
  if (h < 1) return "< 1h";
  if (h < 24) return `${Math.round(h)}h`;
  const d = Math.floor(h / 24);
  const rem = Math.round(h % 24);
  return rem === 0 ? `${d}d` : `${d}d ${rem}h`;
}

/* ── Shared tooltip ─────────────────────────────────────────────────── */

type TooltipData = {
  x: number;
  y: number;
  lines: string[];
};

function ChartTooltip({ data }: { data: TooltipData | null }) {
  if (!data) return null;
  return (
    <div
      className="exp-tooltip"
      style={{ left: data.x, top: data.y }}
    >
      {data.lines.map((line, i) => (
        <div key={i} className={i === 0 ? "exp-tooltip-title" : "exp-tooltip-value"}>
          {line}
        </div>
      ))}
    </div>
  );
}

/* ── Line path builder ──────────────────────────────────────────────── */

function buildLinePath(values: Array<number | null>, width = 280, height = 72) {
  const filtered = values.filter((v): v is number => v !== null && !Number.isNaN(v));
  if (filtered.length === 0) return "";
  const max = Math.max(...filtered, 1);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  return values
    .map((v, i) => {
      const sv = v ?? 0;
      const x = i * step;
      const y = height - (sv / max) * height * 0.9;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

/* ── useChartHover hook ─────────────────────────────────────────────── */

function useChartHover(points: AnalyticsShippingPerformancePoint[]) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  const handleMove = useCallback(
    (e: MouseEvent) => {
      const el = wrapRef.current;
      if (!el || points.length === 0) return;
      const rect = el.getBoundingClientRect();
      const relX = e.clientX - rect.left;
      const pct = relX / rect.width;
      const idx = Math.min(Math.max(0, Math.round(pct * (points.length - 1))), points.length - 1);
      setActiveIdx(idx);
    },
    [points],
  );

  const handleLeave = useCallback(() => {
    setTooltip(null);
    setActiveIdx(null);
  }, []);

  return { wrapRef, tooltip, setTooltip, activeIdx, handleMove, handleLeave };
}

/* ── MiniTrendChart ─────────────────────────────────────────────────── */

type TrendChartProps = {
  points: AnalyticsShippingPerformancePoint[];
  valueKey: "on_time_delivery_rate" | "avg_transit_hours" | "avg_total_hours";
  tone: "blue" | "green" | "red";
  label: string;
  eyebrow: string;
  format?: "percent" | "hours";
};

const FORMATTERS: Record<string, (v: number | null) => string> = {
  percent: formatPercent,
  hours: formatHoursAsShort,
};

export function MiniTrendChart({ points, valueKey, tone, label, eyebrow, format = "percent" }: TrendChartProps) {
  const valueFormatter = FORMATTERS[format] ?? formatPercent;
  const values = points.map((p) => p[valueKey]);
  const latest = values.at(-1) ?? null;
  const path = buildLinePath(values);
  const colorMap = { blue: "#3b82f6", green: "#10b981", red: "#ef4444" };
  const softMap  = { blue: "#eff6ff", green: "#f0fdf4", red: "#fef2f2" };
  const color = colorMap[tone];
  const soft  = softMap[tone];

  const { wrapRef, activeIdx, handleMove, handleLeave } = useChartHover(points);

  const activePoint = activeIdx !== null ? points[activeIdx] : null;
  const activeValue = activeIdx !== null ? values[activeIdx] : null;

  return (
    <div className="exp-mini-chart">
      <div className="exp-mini-chart-head">
        <span className="exp-mini-eyebrow">{eyebrow}</span>
        <strong className="exp-mini-value" style={{ color }}>
          {activePoint ? valueFormatter(activeValue ?? null) : valueFormatter(latest)}
        </strong>
      </div>
      <p className="exp-mini-label">{activePoint ? formatShortDate(activePoint.date) : label}</p>
      <div
        className="exp-mini-svg-wrap"
        style={{ background: soft }}
        ref={wrapRef}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
      >
        <svg aria-hidden="true" viewBox="0 0 280 72" preserveAspectRatio="none" width="100%" height="72">
          {path ? (
            <>
              <path d={`${path} L 280 72 L 0 72 Z`} fill={color} fillOpacity="0.12" stroke="none" />
              <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              {activeIdx !== null && points.length > 1 && (() => {
                const step = 280 / (points.length - 1);
                const x = activeIdx * step;
                const max = Math.max(...values.filter((v): v is number => v !== null && !Number.isNaN(v)), 1);
                const val = (values[activeIdx] ?? 0) as number;
                const y = 72 - (val / max) * 72 * 0.9;
                return (
                  <>
                    <line x1={x} x2={x} y1="0" y2="72" stroke={color} strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />
                    <circle cx={x} cy={y} r="4" fill={color} stroke="#fff" strokeWidth="2" />
                  </>
                );
              })()}
            </>
          ) : (
            <text x="140" y="40" textAnchor="middle" fill="#9ca3af" fontSize="12">Sin datos</text>
          )}
        </svg>
      </div>
      <div className="exp-mini-axis">
        {points.slice(-4).map((p) => (
          <span key={`${valueKey}-${p.date}`}>{formatShortDate(p.date)}</span>
        ))}
      </div>
    </div>
  );
}

/* ── DailyBarsChart ─────────────────────────────────────────────────── */

type BarChartProps = {
  points: AnalyticsShippingPerformancePoint[];
};

export function DailyBarsChart({ points }: BarChartProps) {
  const sliced = points.slice(-14);
  const max = Math.max(...sliced.map((p) => p.created_shipments), 1);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const activePoint = hoverIdx !== null ? sliced[hoverIdx] : null;

  return (
    <div className="exp-mini-chart">
      <div className="exp-mini-chart-head">
        <span className="exp-mini-eyebrow">Volumen</span>
        <strong className="exp-mini-value" style={{ color: "#ef4444" }}>
          {activePoint ? formatCount(activePoint.created_shipments) : formatCount(sliced.reduce((s, p) => s + p.created_shipments, 0))}
        </strong>
      </div>
      <p className="exp-mini-label">{activePoint ? formatShortDate(activePoint.date) : "Expediciones por día"}</p>
      <div className="exp-mini-bars-wrap">
        {sliced.map((p, i) => (
          <div
            className={`exp-mini-bar-col${hoverIdx === i ? " is-hover" : ""}`}
            key={`day-${p.date}`}
            onMouseEnter={() => setHoverIdx(i)}
            onMouseLeave={() => setHoverIdx(null)}
          >
            <div
              className="exp-mini-bar"
              style={{ height: `${Math.max(p.created_shipments > 0 ? 8 : 2, (p.created_shipments / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="exp-mini-axis">
        {sliced.slice(-4).map((p) => <span key={`ax-${p.date}`}>{formatShortDate(p.date)}</span>)}
      </div>
    </div>
  );
}

/* ── HourlyBarsChart ────────────────────────────────────────────────── */

type HourlyPoint = { hour: number; total: number };

export function HourlyBarsChart({ points }: { points: HourlyPoint[] }) {
  const max = Math.max(...points.map((p) => p.total), 1);
  const total = points.reduce((s, p) => s + p.total, 0);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const active = hoverIdx !== null ? points[hoverIdx] : null;

  return (
    <div className="exp-mini-chart">
      <div className="exp-mini-chart-head">
        <span className="exp-mini-eyebrow">Volumen</span>
        <strong className="exp-mini-value" style={{ color: "#ef4444" }}>
          {active ? formatCount(active.total) : formatCount(total)}
        </strong>
      </div>
      <p className="exp-mini-label">
        {active ? `${String(active.hour).padStart(2, "0")}:00 – ${String(active.hour + 1).padStart(2, "0")}:00` : "Pedidos por hora"}
      </p>
      <div className="exp-mini-bars-wrap">
        {points.map((p, i) => (
          <div
            className={`exp-mini-bar-col${hoverIdx === i ? " is-hover" : ""}`}
            key={`h-${p.hour}`}
            onMouseEnter={() => setHoverIdx(i)}
            onMouseLeave={() => setHoverIdx(null)}
          >
            <div
              className="exp-mini-bar"
              style={{ height: `${Math.max(p.total > 0 ? 8 : 2, (p.total / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="exp-mini-axis">
        {[0, 6, 12, 18].map((h) => (
          <span key={h}>{String(h).padStart(2, "0")}h</span>
        ))}
      </div>
    </div>
  );
}

/* ── DualBarsChart ──────────────────────────────────────────────────── */

export function DualBarsChart({ points }: BarChartProps) {
  const sliced = points.slice(-14);
  const max = Math.max(...sliced.flatMap((p) => [p.delivered_orders, p.exception_orders]), 1);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const activePoint = hoverIdx !== null ? sliced[hoverIdx] : null;

  return (
    <div className="exp-mini-chart">
      <div className="exp-mini-chart-head">
        <span className="exp-mini-eyebrow">Calidad</span>
        <strong className="exp-mini-value" style={{ color: "#10b981" }}>
          {activePoint
            ? `${formatCount(activePoint.delivered_orders)} / ${activePoint.exception_orders}`
            : formatCount(sliced.reduce((s, p) => s + p.delivered_orders, 0))}
        </strong>
      </div>
      <p className="exp-mini-label">{activePoint ? formatShortDate(activePoint.date) : "Entregadas vs incidencias"}</p>
      <div className="exp-mini-bars-wrap is-dual">
        {sliced.map((p, i) => (
          <div
            className={`exp-mini-bar-col${hoverIdx === i ? " is-hover" : ""}`}
            key={`dual-${p.date}`}
            onMouseEnter={() => setHoverIdx(i)}
            onMouseLeave={() => setHoverIdx(null)}
          >
            <div className="exp-mini-bar is-green"
              style={{ height: `${Math.max(p.delivered_orders > 0 ? 6 : 2, (p.delivered_orders / max) * 100)}%` }} />
            <div className="exp-mini-bar is-red"
              style={{ height: `${Math.max(p.exception_orders > 0 ? 6 : 1, (p.exception_orders / max) * 60)}%` }} />
          </div>
        ))}
      </div>
      <div className="exp-mini-axis">
        {sliced.slice(-4).map((p) => <span key={`dax-${p.date}`}>{formatShortDate(p.date)}</span>)}
      </div>
    </div>
  );
}
