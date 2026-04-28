import type { AnalyticsFlow } from "@/lib/types";

type Props = { flow: AnalyticsFlow };

function fmtHours(h: number | null | undefined): string {
  if (h == null) return "—";
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

const STEPS = [
  { key: "orders_received",        label: "Recibidos",    emoji: "📥", color: "#6366f1" },
  { key: "orders_prepared",        label: "Preparados",   emoji: "📦", color: "#0ea5e9" },
  { key: "orders_in_transit",      label: "En tránsito",  emoji: "🚚", color: "#f59e0b" },
  { key: "orders_out_for_delivery",label: "En reparto",   emoji: "🛵", color: "#8b5cf6" },
  { key: "orders_delivered",       label: "Entregados",   emoji: "✅", color: "#22c55e" },
] as const;

const INTERVALS: Array<{ from: number; label: string; timeKey: keyof AnalyticsFlow }> = [
  { from: 0, label: "Pedido → preparado",  timeKey: "avg_order_to_prepared_hours" },
  { from: 1, label: "Preparado → recogida", timeKey: "avg_prepared_to_picked_up_hours" },
  { from: 2, label: "Recogida → entregado", timeKey: "avg_picked_up_to_delivered_hours" },
  { from: 3, label: "Reparto → entregado",  timeKey: "avg_transit_to_delivery_hours" },
];

export function ProductionFunnel({ flow }: Props) {
  const values = STEPS.map((s) => (flow[s.key as keyof AnalyticsFlow] as number | undefined) ?? 0);
  const max = Math.max(...values, 1);

  return (
    <div className="pfunnel">
      <div className="pfunnel-steps">
        {STEPS.map((step, i) => {
          const value = values[i];
          const widthPct = 40 + (value / max) * 60; // min 40% width
          // % vs total received (first step), only shown when < 100%
          const convRate = i > 0 && values[0] > 0
            ? Math.round((value / values[0]) * 100)
            : null;

          return (
            <div className="pfunnel-row" key={step.key}>
              <div
                className="pfunnel-bar"
                style={{
                  width: `${widthPct}%`,
                  background: step.color,
                }}
              >
                <span className="pfunnel-bar-emoji">{step.emoji}</span>
                <span className="pfunnel-bar-label">{step.label}</span>
                <span className="pfunnel-bar-value">{value.toLocaleString("es-ES")}</span>
              </div>
              {convRate !== null && (
                <span className="pfunnel-conv">
                  {convRate}%
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="pfunnel-times">
        <span className="eyebrow">Tiempos medios por etapa</span>
        <div className="pfunnel-times-grid">
          {INTERVALS.map((interval) => {
            const val = flow[interval.timeKey] as number | null | undefined;
            return (
              <div className="pfunnel-time-item" key={interval.timeKey}>
                <div className="pfunnel-time-label">{interval.label}</div>
                <div className="pfunnel-time-value">{fmtHours(val)}</div>
              </div>
            );
          })}
          <div className="pfunnel-time-item pfunnel-time-total">
            <div className="pfunnel-time-label">Total pedido → entrega</div>
            <div className="pfunnel-time-value">{fmtHours(flow.avg_total_hours)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
