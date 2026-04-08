import type { CSSProperties } from "react";

export const SHIPMENT_TONE_COLORS: Record<string, string> = {
  slate: "#94a3b8",
  blue: "#2563eb",
  sky: "#0ea5e9",
  green: "#059669",
  red: "#e53935",
  orange: "#d97706",
  indigo: "#4f46e5",
};

export type ShipmentSegment = {
  key: string;
  label: string;
  value: number;
  tone: string;
};

type ShipmentDonutProps = {
  segments: ShipmentSegment[];
  size?: number;
  strokeWidth?: number;
  radius?: number;
  variant?: "default" | "hero";
  showTotal?: boolean;
  showLegend?: boolean;
  centerValue?: string;
  centerLabel?: string;
};

const DEFAULT_RADIUS = 68;
const DEFAULT_STROKE = 16;
const DEFAULT_SIZE = 180;
const GAP = 4;

export function ShipmentDonut({
  segments,
  size = DEFAULT_SIZE,
  strokeWidth = DEFAULT_STROKE,
  radius = DEFAULT_RADIUS,
  variant = "default",
  showTotal = true,
  showLegend = true,
  centerValue,
  centerLabel,
}: ShipmentDonutProps) {
  const CX = size / 2;
  const C = 2 * Math.PI * radius;
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  const deliveredSeg = segments.find((s) => s.key === "delivered");
  const deliveredPct =
    total > 0 ? Math.round(((deliveredSeg?.value ?? 0) / total) * 100) : 0;

  const active = segments.filter((s) => s.value > 0);
  const resolvedCenterValue = centerValue ?? `${deliveredPct}%`;
  const resolvedCenterLabel = centerLabel ?? "entregado";
  let cum = 0;
  const arcs = active.map((seg) => {
    const len = (seg.value / total) * C;
    const dash = Math.max(2, len - (active.length > 1 ? GAP : 0));
    const offset = cum;
    cum += len;
    return {
      ...seg,
      dash,
      offset,
      color: SHIPMENT_TONE_COLORS[seg.tone] ?? "#94a3b8",
    };
  });

  if (total === 0) {
    return (
      <div className={`shipment-donut-wrap${variant === "hero" ? " is-hero" : ""}`}>
        <div className="shipment-donut-chart">
          <svg
            aria-hidden="true"
            className="shipment-donut-svg"
            viewBox={`0 0 ${size} ${size}`}
            style={{ "--donut-size": `${size}px` } as CSSProperties}
          >
            <circle
              cx={CX}
              cy={CX}
              fill="none"
              r={radius}
              stroke="var(--border)"
              strokeWidth={strokeWidth}
            />
          </svg>
          <div className="shipment-donut-center">
            <strong className="shipment-donut-pct">—</strong>
            <span className="shipment-donut-sublabel">sin datos</span>
          </div>
        </div>
        {showLegend ? (
          <div className="shipment-donut-legend">
            <p className="shipment-donut-empty-msg">
              Sin expediciones en el rango seleccionado.
            </p>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`shipment-donut-wrap${variant === "hero" ? " is-hero" : ""}`}>
      {/* SVG donut */}
      <div className="shipment-donut-chart">
        <svg
          aria-hidden="true"
          className="shipment-donut-svg"
          viewBox={`0 0 ${size} ${size}`}
          style={{ "--donut-size": `${size}px` } as CSSProperties}
        >
          {/* Track */}
          <circle
            cx={CX}
            cy={CX}
            fill="none"
            r={radius}
            stroke="var(--border)"
            strokeWidth={strokeWidth}
          />
          {/* Segments — rotated so first segment starts at 12 o'clock */}
          <g transform={`rotate(-90 ${CX} ${CX})`}>
            {arcs.map((arc) => (
              <circle
                key={arc.key}
                cx={CX}
                cy={CX}
                fill="none"
                r={radius}
                stroke={arc.color}
                strokeDasharray={`${arc.dash} ${C}`}
                strokeDashoffset={-arc.offset}
                strokeLinecap={active.length === 1 ? "butt" : "round"}
                strokeWidth={strokeWidth}
              />
            ))}
          </g>
        </svg>

        {/* Center label */}
        <div className="shipment-donut-center">
          <strong className="shipment-donut-pct">{resolvedCenterValue}</strong>
          <span className="shipment-donut-sublabel">{resolvedCenterLabel}</span>
        </div>
      </div>

      {/* Legend */}
      {showLegend ? (
        <div className="shipment-donut-legend">
          {showTotal ? (
            <div className="shipment-donut-total">
              <strong>{total}</strong>
              <span>expediciones</span>
            </div>
          ) : null}
          <div className="shipment-donut-legend-list">
            {active.map((seg) => (
              <div key={seg.key} className="shipment-donut-legend-row">
                <span
                  className="shipment-donut-legend-dot"
                  style={{ "--dot-color": SHIPMENT_TONE_COLORS[seg.tone] ?? "#94a3b8" } as CSSProperties}
                />
                <span className="shipment-donut-legend-label">{seg.label}</span>
                <span className="shipment-donut-legend-count">{seg.value}</span>
                <span className="shipment-donut-legend-pct">
                  {Math.round((seg.value / total) * 100)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
