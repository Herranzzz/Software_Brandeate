import Link from "next/link";

import { KpiCard } from "@/components/kpi-card";
import type { AnalyticsOverview } from "@/lib/types";

type PortalPerformanceViewProps = {
  analytics: AnalyticsOverview | null;
  shopQuery: string;
  rangeLabel: string;
};

function formatHours(value: number | null | undefined, fallback = "—") {
  if (value === null || value === undefined) return fallback;
  if (value < 24) return `${value.toFixed(1)} h`;
  const days = value / 24;
  return `${days.toFixed(1)} días`;
}

function formatPercent(value: number | null | undefined, fallback = "—") {
  if (value === null || value === undefined) return fallback;
  return `${Math.round(value * 100)}%`;
}

function rateTone(rate: number | null | undefined) {
  if (rate === null || rate === undefined) return "default" as const;
  if (rate >= 0.95) return "success" as const;
  if (rate >= 0.85) return "accent" as const;
  return "danger" as const;
}

export function PortalPerformanceView({ analytics, shopQuery, rangeLabel }: PortalPerformanceViewProps) {
  if (!analytics) {
    return (
      <section className="card portal-glass-card">
        <div className="addrbook-empty-inner">
          <span className="addrbook-empty-icon" aria-hidden>📉</span>
          <h3 className="section-title section-title-small">Sin datos de rendimiento</h3>
          <p className="subtitle">
            Cuando tengas envíos activos verás aquí tus tasas de entrega a tiempo, tiempos de tránsito y ranking de carriers.
          </p>
        </div>
      </section>
    );
  }

  const perf = analytics.shipping_performance_by_day ?? [];
  const totalCreated = perf.reduce((s, p) => s + p.created_shipments, 0);
  const totalDelivered = perf.reduce((s, p) => s + p.delivered_orders, 0);
  const totalException = perf.reduce((s, p) => s + p.exception_orders, 0);
  const weighted = perf.filter((p) => p.on_time_delivery_rate !== null && p.delivered_orders > 0);
  const onTimeRate = weighted.length === 0
    ? null
    : weighted.reduce((s, p) => s + (p.on_time_delivery_rate ?? 0) * p.delivered_orders, 0) /
      Math.max(weighted.reduce((s, p) => s + p.delivered_orders, 0), 1);

  const carriers = [...(analytics.shipping.carrier_performance ?? [])].sort(
    (a, b) => (b.shipments || 0) - (a.shipments || 0),
  );

  const trendMax = Math.max(1, ...perf.map((p) => Math.max(p.created_shipments, p.delivered_orders)));

  return (
    <div className="stack">
      <section className="kpi-grid">
        <KpiCard
          label="📦 Envíos creados"
          value={String(totalCreated)}
          delta={rangeLabel}
          tone="default"
        />
        <KpiCard
          label="✅ Entregados"
          value={String(totalDelivered)}
          delta={totalCreated > 0 ? `${Math.round((totalDelivered / totalCreated) * 100)}% del total` : "—"}
          tone="success"
        />
        <KpiCard
          label="⏱️ Tránsito medio"
          value={formatHours(analytics.shipping.avg_transit_hours)}
          delta="origen → destino"
          tone="accent"
        />
        <KpiCard
          label="🎯 On-time delivery"
          value={formatPercent(onTimeRate)}
          delta={onTimeRate === null ? "sin datos" : onTimeRate >= 0.95 ? "Excelente" : onTimeRate >= 0.85 ? "En rango" : "Por debajo del objetivo"}
          tone={rateTone(onTimeRate)}
        />
        <KpiCard
          label="🚨 Incidencias"
          value={String(totalException)}
          delta={totalCreated > 0 ? `${Math.round((totalException / totalCreated) * 100)}% del total` : "—"}
          tone={totalException === 0 ? "success" : "danger"}
        />
        <KpiCard
          label="⏳ Pedido → entrega"
          value={formatHours(analytics.shipping.avg_order_to_delivery_hours ?? analytics.flow.avg_total_hours)}
          delta="ciclo completo"
          tone="default"
        />
      </section>

      <section className="card portal-glass-card stack">
        <header className="calc-form-head">
          <span className="eyebrow">📈 Tendencia</span>
          <h3 className="section-title section-title-small">Rendimiento día a día</h3>
          <p className="subtitle">Envíos creados, entregas completadas y tasa on-time.</p>
        </header>
        {perf.length === 0 ? (
          <p className="subtitle">Aún no hay suficientes datos para el periodo seleccionado.</p>
        ) : (
          <div className="perf-trend-grid">
            {perf.map((point) => {
              const createdH = (point.created_shipments / trendMax) * 100;
              const deliveredH = (point.delivered_orders / trendMax) * 100;
              const rate = point.on_time_delivery_rate;
              return (
                <div key={point.date} className="perf-trend-col">
                  <div className="perf-trend-bars">
                    <div className="perf-trend-bar perf-trend-bar-created" style={{ height: `${Math.max(createdH, 4)}%` }} title={`Creados: ${point.created_shipments}`} />
                    <div className="perf-trend-bar perf-trend-bar-delivered" style={{ height: `${Math.max(deliveredH, 4)}%` }} title={`Entregados: ${point.delivered_orders}`} />
                  </div>
                  <span className="perf-trend-rate" data-tone={rateTone(rate)}>
                    {rate === null || rate === undefined ? "—" : `${Math.round(rate * 100)}%`}
                  </span>
                  <span className="perf-trend-day">
                    {new Date(`${point.date}T12:00:00`).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        <div className="perf-legend">
          <span><span className="perf-legend-dot perf-trend-bar-created" /> Envíos creados</span>
          <span><span className="perf-legend-dot perf-trend-bar-delivered" /> Entregados</span>
          <span className="perf-legend-muted">Porcentaje bajo cada columna = on-time de ese día.</span>
        </div>
      </section>

      <section className="card portal-glass-card stack">
        <header className="calc-form-head">
          <span className="eyebrow">🏁 Carriers</span>
          <h3 className="section-title section-title-small">Ranking de transportistas</h3>
          <p className="subtitle">Volumen, tiempo medio y tasa de incidencias para cada carrier.</p>
        </header>
        {carriers.length === 0 ? (
          <p className="subtitle">Sin envíos asignados a carriers en el periodo.</p>
        ) : (
          <div className="perf-carrier-list">
            {carriers.map((c) => {
              const incidentRate = c.incident_rate ?? 0;
              const successRate = Math.max(0, 1 - incidentRate);
              return (
                <article key={c.carrier} className="perf-carrier-row">
                  <div className="perf-carrier-head">
                    <strong>{c.carrier || "Sin carrier"}</strong>
                    <span className="perf-carrier-volume">{c.shipments} envíos · {c.delivered_orders} entregados</span>
                  </div>
                  <div className="perf-carrier-bar-wrap">
                    <div
                      className="perf-carrier-bar"
                      style={{ width: `${Math.round(successRate * 100)}%` }}
                      data-tone={rateTone(successRate)}
                    />
                  </div>
                  <div className="perf-carrier-stats">
                    <span>Éxito: <strong>{Math.round(successRate * 100)}%</strong></span>
                    <span>Incidencias: <strong>{Math.round(incidentRate * 100)}%</strong></span>
                    <span>Tránsito medio: <strong>{formatHours(c.avg_delivery_hours)}</strong></span>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="card portal-glass-card stack">
        <header className="calc-form-head">
          <span className="eyebrow">🧭 Embudo operativo</span>
          <h3 className="section-title section-title-small">Del pedido a la entrega</h3>
          <p className="subtitle">Tiempos medios por etapa de tu flujo logístico actual.</p>
        </header>
        <div className="perf-funnel">
          {[
            { label: "📝 Pedido → Preparado", value: analytics.flow.avg_order_to_label_hours ?? analytics.flow.avg_order_to_prepared_hours ?? null },
            { label: "🏷️ Preparado → Recogido", value: analytics.flow.avg_label_to_transit_hours ?? analytics.flow.avg_prepared_to_picked_up_hours ?? null },
            { label: "🚚 Recogido → Entregado", value: analytics.flow.avg_transit_to_delivery_hours ?? analytics.flow.avg_picked_up_to_delivered_hours ?? null },
            { label: "🎯 Total", value: analytics.flow.avg_total_hours ?? analytics.flow.avg_order_to_delivered_hours ?? null },
          ].map((row) => (
            <div key={row.label} className="perf-funnel-row">
              <span>{row.label}</span>
              <strong>{formatHours(row.value)}</strong>
            </div>
          ))}
        </div>
        <div className="addrbook-toolbar-actions" style={{ justifyContent: "flex-end" }}>
          <Link href={`/portal/shipments${shopQuery}`} className="button button-secondary">Ver expediciones</Link>
          <Link href={`/portal/reports${shopQuery}`} className="button button-secondary">Ver informes</Link>
        </div>
      </section>
    </div>
  );
}
