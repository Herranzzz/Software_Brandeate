"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { Card } from "@/components/card";
import { ShipmentDonut } from "@/components/shipment-donut";
import type { ShipmentSegment } from "@/components/shipment-donut";
import type { AnalyticsOverview, Shop } from "@/lib/types";

// Types
type SharedReportingViewProps = {
  analytics: AnalyticsOverview;
  eyebrow: string;
  title: string;
  subtitle: string;
  dateFrom: string;
  dateTo: string;
  basePath: string;
  shipmentsBasePath: string;
  shops: Shop[];
  selectedShopId?: string;
  controls?: ReactNode;
};

// Range shortcuts helper
function toDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function getRangeShortcuts(basePath: string, selectedShopId: string | undefined, dateTo: string) {
  const end = new Date(`${dateTo}T23:59:59`);
  const shopQ = selectedShopId ? `&shop_id=${selectedShopId}` : "";
  const makeHref = (days: number) => {
    const from = new Date(end);
    from.setDate(end.getDate() - (days - 1));
    return `${basePath}?date_from=${toDateInputValue(from)}&date_to=${dateTo}${shopQ}`;
  };
  return [
    { label: "7 días", href: makeHref(7) },
    { label: "30 días", href: makeHref(30) },
    { label: "90 días", href: makeHref(90) },
    { label: "Este año", href: `${basePath}?date_from=${new Date().getFullYear()}-01-01&date_to=${dateTo}${shopQ}` },
  ];
}

// Helpers
function fmtHours(h: number | null | undefined): string {
  if (h === null || h === undefined) return "—";
  if (h < 1) return "<1h";
  if (h < 24) return `${Math.round(h)}h`;
  const days = Math.round((h / 24) * 10) / 10;
  return `${days}d`;
}

function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `${v}%`;
}

export function SharedReportingView({
  analytics,
  eyebrow,
  title,
  subtitle,
  dateFrom,
  dateTo,
  basePath,
  shipmentsBasePath,
  shops,
  selectedShopId,
  controls,
}: SharedReportingViewProps) {
  const { kpis, operational, shipping, charts, rankings } = analytics;
  const rangeShortcuts = getRangeShortcuts(basePath, selectedShopId, dateTo);

  // Flow metrics
  const flow = analytics.flow;
  const received = flow.orders_received;
  const prepared = flow.orders_prepared;
  const pickedUp = flow.orders_picked_up ?? 0;
  const inTransit = flow.orders_in_transit;
  const outForDelivery = flow.orders_out_for_delivery ?? 0;
  const delivered = flow.orders_delivered;
  const exception = flow.orders_exception;

  const flowSteps = [
    { key: "received", label: "📦 Recibido", value: received, tone: "slate" },
    { key: "prepared", label: "🏷️ Preparado", value: prepared, tone: "indigo" },
    { key: "picked_up", label: "🚚 Recogido", value: pickedUp, tone: "blue" },
    { key: "in_transit", label: "🚚 En tránsito", value: inTransit, tone: "blue" },
    { key: "out_for_delivery", label: "📬 En reparto", value: outForDelivery, tone: "orange" },
    { key: "delivered", label: "✅ Entregado", value: delivered, tone: "green" },
    { key: "exception", label: "🚨 Incidencia", value: exception, tone: "red" },
  ] as const;

  // Donut segments from status distribution
  const donutSegments: ShipmentSegment[] = charts.status_distribution
    .filter((item) => item.value > 0)
    .map((item) => ({
      key: item.label,
      label: item.label.charAt(0).toUpperCase() + item.label.slice(1).replace(/_/g, " "),
      value: item.value,
      tone:
        item.label === "delivered"
          ? "green"
          : item.label === "exception"
            ? "red"
            : item.label === "shipped"
              ? "blue"
              : item.label === "in_progress" || item.label === "ready_to_ship"
                ? "indigo"
                : "slate",
    }));

  // Bar chart - orders by day (last 14 points max)
  const ordersChart = charts.orders_by_day.slice(-14);
  const chartMax = Math.max(1, ...ordersChart.map((p) => p.total));

  // Risk items
  const riskItems = [
    { label: "❌ Sin shipment", value: operational.orders_without_shipment, warning: operational.orders_without_shipment > 0 },
    { label: "⏸️ Tracking parado", value: operational.stalled_tracking_orders, warning: operational.stalled_tracking_orders > 0 },
    { label: "🔒 Bloqueados", value: operational.blocked_orders, warning: operational.blocked_orders > 0 },
    { label: "⚠️ Incidencias abiertas", value: kpis.open_incidents, warning: kpis.open_incidents > 0 },
  ];

  // Time metrics
  const timeMetrics = [
    { label: "📋 Pedido → Etiqueta", value: fmtHours(flow.avg_order_to_label_hours ?? operational.avg_production_to_shipping_hours), hint: "tiempo de preparación" },
    { label: "🏷️ Etiqueta → Tránsito", value: fmtHours(flow.avg_label_to_transit_hours), hint: "recogida por carrier" },
    { label: "🚚 Tránsito → Entrega", value: fmtHours(flow.avg_transit_to_delivery_hours ?? operational.avg_shipping_to_delivery_hours), hint: "tiempo en ruta" },
    { label: "🏁 Pedido → Entrega", value: fmtHours(flow.avg_total_hours), hint: "ciclo completo" },
  ];

  return (
    <div className="stack reporting-page">

      {/* ── Hero ── */}
      <section className="reporting-hero">
        <div className="reporting-hero-copy">
          <span className="eyebrow">{eyebrow}</span>
          <h1 className="reporting-title">{title}</h1>
          <p className="reporting-subtitle">{subtitle}</p>
        </div>
        <div className="reporting-hero-actions">
          {controls}
        </div>
      </section>

      {/* ── Range pills ── */}
      <div className="reporting-range-pills">
        <span className="reporting-range-label">Período</span>
        {rangeShortcuts.map((s) => (
          <Link key={s.label} href={s.href} className="shipments-range-pill">
            {s.label}
          </Link>
        ))}
        <span className="reporting-range-dates">
          {dateFrom} → {dateTo}
        </span>
      </div>

      {/* ── Flow funnel ── */}
      <Card className="reporting-flow-card">
        <div className="reporting-flow-header">
          <span className="eyebrow">🔄 Flujo real del pedido</span>
          <h3 className="section-title section-title-small">De recibido a entregado</h3>
        </div>
        <div className="reporting-flow-steps">
          {flowSteps.map((step, i) => (
            <div className="reporting-flow-step" key={step.key}>
              <div className={`reporting-flow-step-bar reporting-flow-tone-${step.tone}`} />
              <div className="reporting-flow-step-count">{step.value.toLocaleString("es-ES")}</div>
              <div className="reporting-flow-step-label">{step.label}</div>
              {i < flowSteps.length - 1 && (
                <div className="reporting-flow-arrow">→</div>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* ── KPI grid ── */}
      <section className="reporting-kpis">
        <Card className="reporting-kpi">
          <span className="reporting-kpi-label">📦 Total pedidos</span>
          <strong className="reporting-kpi-value">{kpis.total_orders.toLocaleString("es-ES")}</strong>
          <span className="reporting-kpi-hint">en el período</span>
        </Card>
        <Card className="reporting-kpi">
          <span className="reporting-kpi-label">✅ Entregados</span>
          <strong className="reporting-kpi-value reporting-kpi-green">{kpis.delivered_orders.toLocaleString("es-ES")}</strong>
          <span className="reporting-kpi-hint">{kpis.total_orders > 0 ? `${Math.round((kpis.delivered_orders / kpis.total_orders) * 100)}% del total` : "—"}</span>
        </Card>
        <Card className="reporting-kpi">
          <span className="reporting-kpi-label">⏱️ Tiempo medio entrega</span>
          <strong className="reporting-kpi-value">{fmtHours(flow?.avg_total_hours ?? operational.avg_shipping_to_delivery_hours)}</strong>
          <span className="reporting-kpi-hint">pedido → entregado</span>
        </Card>
        <Card className="reporting-kpi">
          <span className="reporting-kpi-label">🎯 % Entregado en SLA</span>
          <strong className="reporting-kpi-value">{fmtPct(operational.delivered_in_sla_rate)}</strong>
          <span className="reporting-kpi-hint">dentro de 72h</span>
        </Card>
        <Card className="reporting-kpi">
          <span className="reporting-kpi-label">🚚 En tránsito</span>
          <strong className="reporting-kpi-value reporting-kpi-blue">{shipping.in_transit_orders.toLocaleString("es-ES")}</strong>
          <span className="reporting-kpi-hint">ahora mismo</span>
        </Card>
        <Card className="reporting-kpi">
          <span className="reporting-kpi-label">🔴 Incidencias abiertas</span>
          <strong className={`reporting-kpi-value ${kpis.open_incidents > 0 ? "reporting-kpi-red" : ""}`}>{kpis.open_incidents.toLocaleString("es-ES")}</strong>
          <span className="reporting-kpi-hint">{fmtPct(operational.incident_rate)} tasa</span>
        </Card>
      </section>

      {/* ── Main columns ── */}
      <div className="reporting-columns">

        {/* Left column */}
        <div className="stack reporting-column-main">

          {/* Orders by day chart */}
          <Card className="stack reporting-chart-card">
            <div className="reporting-card-head">
              <div>
                <span className="eyebrow">📈 Volumen</span>
                <h3 className="section-title section-title-small">Pedidos por día</h3>
              </div>
            </div>
            <div className="reporting-bar-chart">
              {ordersChart.map((point) => (
                <div className="reporting-bar-group" key={point.date}>
                  <div className="reporting-bar-track">
                    <div
                      className="reporting-bar"
                      style={{ height: `${Math.max(6, Math.round((point.total / chartMax) * 100))}%` }}
                    />
                  </div>
                  <div className="reporting-bar-value">{point.total}</div>
                  <div className="reporting-bar-label">
                    {new Intl.DateTimeFormat("es-ES", { weekday: "short" }).format(new Date(point.date + "T12:00:00"))}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Status distribution donut */}
          <Card className="stack reporting-donut-card">
            <div className="reporting-card-head">
              <div>
                <span className="eyebrow">📊 Distribución</span>
                <h3 className="section-title section-title-small">Estado de pedidos</h3>
              </div>
            </div>
            <ShipmentDonut segments={donutSegments} />
          </Card>

          {/* Time metrics */}
          <Card className="stack reporting-times-card">
            <div className="reporting-card-head">
              <div>
                <span className="eyebrow">⏱️ Tiempos</span>
                <h3 className="section-title section-title-small">Tiempos medios por fase</h3>
              </div>
            </div>
            <div className="reporting-times-grid">
              {timeMetrics.map((m) => (
                <div className="reporting-time-item" key={m.label}>
                  <span className="reporting-time-label">{m.label}</span>
                  <strong className="reporting-time-value">{m.value}</strong>
                  <span className="reporting-time-hint">{m.hint}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Right column */}
        <div className="stack reporting-column-side">

          {/* Risk block */}
          <Card className="stack reporting-risk-card">
            <div className="reporting-card-head">
              <div>
                <span className="eyebrow">🚨 Atención</span>
                <h3 className="section-title section-title-small">Riesgos operativos</h3>
              </div>
            </div>
            <div className="reporting-risk-list">
              {riskItems.map((item) => (
                <div className={`reporting-risk-item ${item.warning ? "is-warning" : ""}`} key={item.label}>
                  <span className="reporting-risk-label">{item.label}</span>
                  <strong className="reporting-risk-value">{item.value}</strong>
                </div>
              ))}
            </div>
            <Link className="admin-dashboard-inline-link" href={shipmentsBasePath}>
              Ver expediciones →
            </Link>
          </Card>

          {/* Delayed orders */}
          {rankings.delayed_orders.length > 0 && (
            <Card className="stack reporting-delayed-card">
              <div className="reporting-card-head">
                <div>
                  <span className="eyebrow">⚠️ Pedidos en riesgo</span>
                  <h3 className="section-title section-title-small">Requieren atención</h3>
                </div>
              </div>
              <div className="reporting-delayed-list">
                {rankings.delayed_orders.slice(0, 5).map((order) => (
                  <div className="reporting-delayed-item" key={order.order_id}>
                    <div className="reporting-delayed-main">
                      <div className="activity-title">{order.external_id}</div>
                      <div className="table-secondary">{order.customer_name} · {order.shop_name}</div>
                    </div>
                    <div className="reporting-delayed-meta">
                      <span className="reporting-delayed-age">{Math.round(order.age_hours / 24)}d</span>
                      <span className="reporting-delayed-reason table-secondary">{order.reason}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Top SKUs */}
          {rankings.top_skus.length > 0 && (
            <Card className="stack reporting-skus-card">
              <div className="reporting-card-head">
                <div>
                  <span className="eyebrow">📦 Productos</span>
                  <h3 className="section-title section-title-small">Top SKUs</h3>
                </div>
              </div>
              <div className="reporting-sku-list">
                {rankings.top_skus.slice(0, 6).map((sku) => (
                  <div className="reporting-sku-item" key={sku.sku}>
                    <div className="reporting-sku-name">{sku.name}</div>
                    <div className="reporting-sku-meta table-secondary">{sku.sku}</div>
                    <div className="reporting-sku-count"><strong>{sku.quantity}</strong> uds</div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Incidents by type */}
          {rankings.top_incidents.length > 0 && (
            <Card className="stack reporting-incidents-card">
              <div className="reporting-card-head">
                <div>
                  <span className="eyebrow">🔴 Incidencias</span>
                  <h3 className="section-title section-title-small">Por tipo</h3>
                </div>
              </div>
              <div className="reporting-incidents-list">
                {rankings.top_incidents.slice(0, 5).map((inc) => (
                  <div className="reporting-incident-item" key={inc.label}>
                    <span className="reporting-incident-label">{inc.label.replace(/_/g, " ")}</span>
                    <strong className="reporting-incident-count">{inc.value}</strong>
                    <span className="reporting-incident-pct table-secondary">{fmtPct(inc.percentage)}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
