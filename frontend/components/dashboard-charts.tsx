"use client";

import { useState } from "react";
import Link from "next/link";

type ChartPoint = { dayKey: string; day: string; value: number };

const TONE_COLOR: Record<string, string> = {
  blue: "#3b82f6", green: "#10b981", red: "#ef4444",
  orange: "#f97316", slate: "#94a3b8",
};

/* ── Main volume bars chart ──────────────────────────────────────────── */

export function DashVolumeChart({
  chart,
  isHourly,
  chartTotal,
  chartLinkHref,
  chartLinkLabel,
}: {
  chart: ChartPoint[];
  isHourly: boolean;
  chartTotal: number;
  chartLinkHref: string;
  chartLinkLabel: string;
}) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const hoverPoint = hoverId ? chart.find((p) => p.dayKey === hoverId) ?? null : null;
  const maxValue = Math.max(1, ...chart.map((p) => p.value));

  return (
    <>
      <div className="dash-chart-header">
        <div className="exp-section-head" style={{ marginBottom: 0 }}>
          <div>
            <span className="eyebrow">Volumen</span>
            <h3 className="exp-card-title">{isHourly ? "Pedidos por hora" : "Pedidos por día"}</h3>
          </div>
        </div>
        <div className="dash-chart-total">
          <strong className="dash-chart-total-num">
            {hoverPoint !== null ? hoverPoint.value : chartTotal}
          </strong>
          <span className="dash-chart-total-label">
            {hoverPoint !== null ? hoverPoint.day : "en el periodo"}
          </span>
        </div>
      </div>

      <div className="dash-chart-bars-v2">
        {chart.map((point, idx) => {
          const pct = Math.max(point.value > 0 ? 8 : 2, (point.value / maxValue) * 100);
          const isHover = hoverId === point.dayKey;
          const showDayLabel  = !isHourly && chart.length <= 10;
          const showHourLabel = isHourly && idx % 6 === 0;
          const axisLabel = isHourly
            ? (showHourLabel ? point.day : "")
            : (showDayLabel ? point.day : point.dayKey.slice(8));

          return (
            <div
              className={`dash-chart-col-v2${isHover ? " is-hover" : ""}`}
              key={point.dayKey}
              onMouseEnter={() => setHoverId(point.dayKey)}
              onMouseLeave={() => setHoverId(null)}
            >
              <span className="dash-chart-val-label">
                {isHover && point.value > 0 ? point.value : (!isHourly && showDayLabel && point.value > 0 ? point.value : "")}
              </span>
              <div className="dash-chart-bar-wrap-v2">
                <div
                  className={`dash-chart-bar-v2${isHover ? " is-hover" : ""}`}
                  style={{ height: `${pct}%` }}
                />
              </div>
              <span className="dash-chart-day-label">{axisLabel}</span>
            </div>
          );
        })}
      </div>

      <div className="dash-chart-footer-v2">
        <Link className="exp-period-pill" href={chartLinkHref}>
          {chartLinkLabel} →
        </Link>
      </div>
    </>
  );
}

/* ── Mini sparkline card ─────────────────────────────────────────────── */

export function DashMiniSparklineCard({
  eyebrow,
  label,
  value,
  hint,
  points = [],
  tone = "blue",
}: {
  eyebrow: string;
  label: string;
  value: number;
  hint: string;
  points?: number[];
  tone?: "red" | "green" | "blue" | "orange" | "slate";
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const pts = points.slice(-14);
  const maxPt = Math.max(...pts, 1);
  const color = TONE_COLOR[tone];
  const hoverValue = hoverIdx !== null ? pts[hoverIdx] : null;

  return (
    <div className="dash-mini-chart-card">
      <span className="dash-mini-chart-eyebrow">{eyebrow}</span>
      <strong className="dash-mini-chart-value" style={{ color }}>
        {hoverValue !== null
          ? hoverValue.toLocaleString("es-ES")
          : (value === -1 ? label : value.toLocaleString("es-ES"))}
      </strong>
      {value !== -1 && (
        <span className="dash-mini-chart-label">
          {hoverValue !== null ? `día ${pts.length - (hoverIdx ?? 0)}` : label}
        </span>
      )}
      {pts.length > 0 && (
        <div className="dash-mini-chart-bars">
          {pts.map((v, i) => (
            <div
              key={i}
              className={`dash-mini-chart-bar${hoverIdx === i ? " is-hover" : ""}`}
              style={{
                height: `${Math.max(v > 0 ? 20 : 3, (v / maxPt) * 100)}%`,
                background: color,
                opacity: hoverIdx === null ? (v > 0 ? 0.75 : 0.15) : (hoverIdx === i ? 1 : 0.3),
              }}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
            />
          ))}
        </div>
      )}
      <span className="dash-mini-chart-hint">{hoverValue !== null ? `${hoverValue} pedidos` : hint}</span>
    </div>
  );
}
