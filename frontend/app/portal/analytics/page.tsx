import Link from "next/link";

import { Card } from "@/components/card";
import { PageHeader } from "@/components/page-header";
import { PortalTenantControl } from "@/components/portal-tenant-control";
import { fetchAnalyticsOverview } from "@/lib/api";
import { fetchMyShops, requirePortalUser } from "@/lib/auth";
import { resolveTenantScope } from "@/lib/tenant-scope";
import type { AnalyticsOverview } from "@/lib/types";


type PortalAnalyticsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};


function readValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}


function readBoolean(value: string | string[] | undefined) {
  const normalized = readValue(value);
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return undefined;
}


function formatPercent(value: number | null) {
  return value === null ? "—" : `${Math.round(value)}%`;
}


function formatHours(value: number | null): string {
  if (value === null) return "—";
  if (value < 1) return "< 1h";
  if (value < 24) return `${Math.round(value)}h`;
  const d = Math.floor(value / 24);
  const h = Math.round(value % 24);
  return h === 0 ? `${d}d` : `${d}d ${h}h`;
}


function maxValue(items: { value: number }[]) {
  return items.reduce((max, item) => Math.max(max, item.value), 0) || 1;
}

function formatNumber(value: number | null) {
  return value === null ? "—" : new Intl.NumberFormat("es-ES").format(value);
}

const STATUS_DISPLAY_LABELS: Record<string, string> = {
  pending: "Pendiente",
  in_progress: "En producción",
  ready_to_ship: "Preparado",
  label_created: "Etiqueta creada",
  picked_up: "Recogido",
  shipped: "Enviado",
  in_transit: "En tránsito",
  out_for_delivery: "En reparto",
  delivered: "Entregado",
  exception: "Excepción",
  unknown: "Desconocido",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "#94A3B8",
  in_progress: "#F59E0B",
  ready_to_ship: "#38BDF8",
  label_created: "#38BDF8",
  picked_up: "#0EA5E9",
  shipped: "#6366F1",
  in_transit: "#6366F1",
  out_for_delivery: "#F97316",
  delivered: "#22C55E",
  exception: "#EF4444",
  unknown: "#94A3B8",
};

function resolveStatusLabel(raw: string): string {
  return STATUS_DISPLAY_LABELS[raw] ?? raw;
}

function resolveStatusColor(raw: string, fallbackIndex: number): string {
  return STATUS_COLORS[raw] ?? ["#94A3B8", "#F59E0B", "#38BDF8", "#22C55E", "#F97316", "#6366F1"][fallbackIndex % 6];
}

function buildDonutSegments(items: Array<{ label: string; value: number; color: string }>, radius: number, circumference: number) {
  const total = items.reduce((sum, item) => sum + item.value, 0) || 1;
  let offset = 0;
  return items.map((item) => {
    const dash = circumference * (item.value / total);
    const segment = { ...item, radius, dash, offset };
    offset += dash;
    return segment;
  });
}


export default async function PortalAnalyticsPage({ searchParams }: PortalAnalyticsPageProps) {
  await requirePortalUser();
  const shops = await fetchMyShops();
  const params = (await searchParams) ?? {};
  const tenantScope = resolveTenantScope(shops, readValue(params.shop_id));
  const shippingStatusParam = readValue(params.shipping_status);
  const shippingStatus =
    shippingStatusParam === "picked_up" ||
    shippingStatusParam === "in_transit" ||
    shippingStatusParam === "out_for_delivery" ||
    shippingStatusParam === "delivered"
      ? shippingStatusParam
      : undefined;
  const filters = {
    date_from: readValue(params.date_from),
    date_to: readValue(params.date_to),
    shop_id: tenantScope.selectedShopId,
    channel: readValue(params.channel),
    is_personalized: readBoolean(params.is_personalized),
    status: readValue(params.status),
    production_status: readValue(params.production_status),
    carrier: readValue(params.carrier),
    shipping_status: shippingStatus,
  };
  let analytics: AnalyticsOverview | null = null;
  try {
    analytics = await fetchAnalyticsOverview(filters);
  } catch {
    // graceful degradation
  }

  if (!analytics) {
    return (
      <div className="stack">
        <PageHeader eyebrow="Analítica" title="Análisis logístico" description="No se pudieron cargar los datos. Inténtalo de nuevo." />
        <PortalTenantControl action="/portal/analytics" hiddenFields={{}} selectedShopId={tenantScope.selectedShopId} shops={tenantScope.shops} submitLabel="Ver" />
        <Card className="portal-glass-card">
          <div className="empty-state">
            <div className="empty-state-icon">⚠️</div>
            <h3 className="empty-state-title">Datos no disponibles</h3>
            <p className="empty-state-description">El servicio no respondió. Recarga la página para intentarlo de nuevo.</p>
          </div>
        </Card>
      </div>
    );
  }

  // ── Derived data ──────────────────────────────────────────────────
  const ordersByDayMax = maxValue(analytics.charts.orders_by_day.map((p) => ({ value: p.total })));
  const incidentMax = maxValue(analytics.charts.incidents_by_type);
  const carrierMax = maxValue(analytics.charts.carrier_performance);
  const statusMix = analytics.charts.status_distribution
    .map((item, index) => ({
      ...item,
      label: resolveStatusLabel(item.label),
      _raw: item.label,
      color: resolveStatusColor(item.label, index),
    }))
    .filter((item) => item.value > 0);
  const statusRadius = 60;
  const statusCircumference = 2 * Math.PI * statusRadius;
  const statusSegments = buildDonutSegments(statusMix, statusRadius, statusCircumference);

  const slaRate = analytics.operational.delivered_in_sla_rate ?? 0;
  const slaColor = slaRate >= 90 ? "#22C55E" : slaRate >= 70 ? "#F59E0B" : "#EF4444";
  const slaRing = 2 * Math.PI * 36;

  const activeShipments =
    (analytics.shipping.in_transit_orders ?? 0) +
    (analytics.shipping.out_for_delivery_orders ?? 0) +
    (analytics.shipping.picked_up_orders ?? 0);

  const generatedAt = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(analytics.scope.generated_at),
  );

  const dayLabels: Record<string, string> = { Mon: "L", Tue: "M", Wed: "X", Thu: "J", Fri: "V", Sat: "S", Sun: "D" };

  return (
    <div className="stack portal-analytics-v2">

      {/* ── Header ── */}
      <div className="pa2-header">
        <PageHeader
          eyebrow="📊 Analítica"
          title="Panel logístico avanzado"
          description="Análisis completo de tu operativa: volumen, tiempos de servicio, estado de envíos e indicadores de riesgo en tiempo real."
          actions={
            <span className="pa2-generated-badge">Actualizado {generatedAt}</span>
          }
        />
      </div>

      <PortalTenantControl
        action="/portal/analytics"
        hiddenFields={{
          date_from: filters.date_from,
          date_to: filters.date_to,
          channel: filters.channel,
          is_personalized: filters.is_personalized === undefined ? undefined : String(filters.is_personalized),
          shipping_status: filters.shipping_status,
        }}
        selectedShopId={tenantScope.selectedShopId}
        shops={tenantScope.shops}
        submitLabel="Aplicar"
      />

      {/* ── Hero KPI strip ── */}
      <section className="pa2-kpi-hero">
        <div className="pa2-kpi-card pa2-kpi-accent">
          <span className="pa2-kpi-emoji">📦</span>
          <div className="pa2-kpi-body">
            <span className="pa2-kpi-label">Pedidos totales</span>
            <strong className="pa2-kpi-value">{formatNumber(analytics.kpis.total_orders)}</strong>
            <span className="pa2-kpi-delta">{analytics.kpis.orders_today} nuevos hoy</span>
          </div>
        </div>
        <div className="pa2-kpi-card pa2-kpi-green">
          <span className="pa2-kpi-emoji">✅</span>
          <div className="pa2-kpi-body">
            <span className="pa2-kpi-label">Entregados</span>
            <strong className="pa2-kpi-value">{formatNumber(analytics.kpis.delivered_orders)}</strong>
            <span className="pa2-kpi-delta">de {formatNumber(analytics.kpis.shipped_orders)} enviados</span>
          </div>
        </div>
        <div className="pa2-kpi-card pa2-kpi-blue">
          <span className="pa2-kpi-emoji">🚚</span>
          <div className="pa2-kpi-body">
            <span className="pa2-kpi-label">En ruta ahora</span>
            <strong className="pa2-kpi-value">{formatNumber(activeShipments)}</strong>
            <span className="pa2-kpi-delta">{analytics.shipping.out_for_delivery_orders ?? 0} en última milla</span>
          </div>
        </div>
        <div className="pa2-kpi-card" style={{ "--pa2-kpi-accent-raw": slaColor } as React.CSSProperties}>
          <span className="pa2-kpi-emoji">🎯</span>
          <div className="pa2-kpi-body">
            <span className="pa2-kpi-label">Envíos en SLA</span>
            <strong className="pa2-kpi-value" style={{ color: slaColor }}>{formatPercent(analytics.operational.delivered_in_sla_rate)}</strong>
            <span className="pa2-kpi-delta">{analytics.shipping.delivered_orders} entregados total</span>
          </div>
        </div>
        <div className="pa2-kpi-card pa2-kpi-red">
          <span className="pa2-kpi-emoji">⚠️</span>
          <div className="pa2-kpi-body">
            <span className="pa2-kpi-label">Incidencias</span>
            <strong className="pa2-kpi-value">{formatNumber(analytics.kpis.open_incidents)}</strong>
            <span className="pa2-kpi-delta">{analytics.shipping.exception_orders} envíos con excepción</span>
          </div>
        </div>
      </section>

      {/* ── Logistics pipeline ── */}
      <Card className="portal-glass-card pa2-pipeline-card">
        <div className="pa2-pipeline-header">
          <span className="eyebrow">🔄 Flujo operativo</span>
          <h3 className="section-title section-title-small">Dónde están tus pedidos ahora mismo</h3>
        </div>
        <div className="pa2-pipeline">
          {[
            { emoji: "📥", label: "Recibidos", value: analytics.flow.orders_received, color: "#94A3B8" },
            { emoji: "⚙️", label: "Producción", value: analytics.kpis.in_production_orders, color: "#F59E0B" },
            { emoji: "🏷️", label: "Preparados", value: analytics.flow.orders_prepared, color: "#38BDF8" },
            { emoji: "🚚", label: "En tránsito", value: analytics.flow.orders_in_transit, color: "#6366F1" },
            { emoji: "📬", label: "En reparto", value: analytics.flow.orders_out_for_delivery ?? 0, color: "#F97316" },
            { emoji: "✅", label: "Entregados", value: analytics.flow.orders_delivered, color: "#22C55E" },
            { emoji: "🚨", label: "Excepción", value: analytics.flow.orders_exception, color: "#EF4444" },
          ].map((step, index, arr) => (
            <div className="pa2-pipeline-step-wrap" key={step.label}>
              <div className="pa2-pipeline-step" style={{ "--step-color": step.color } as React.CSSProperties}>
                <span className="pa2-pipeline-emoji">{step.emoji}</span>
                <strong className="pa2-pipeline-value">{formatNumber(step.value)}</strong>
                <span className="pa2-pipeline-label">{step.label}</span>
              </div>
              {index < arr.length - 1 && <div className="pa2-pipeline-arrow">›</div>}
            </div>
          ))}
        </div>

        {/* Service time row */}
        <div className="pa2-service-times">
          {[
            { label: "📋 Pedido → Producción", value: formatHours(analytics.operational.avg_order_to_production_hours) },
            { label: "🏷️ Producción → Envío", value: formatHours(analytics.operational.avg_production_to_shipping_hours) },
            { label: "🚚 Envío → Entrega", value: formatHours(analytics.operational.avg_shipping_to_delivery_hours) },
            { label: "⏱️ Ciclo completo", value: formatHours(analytics.flow.avg_total_hours) },
          ].map((t) => (
            <div className="pa2-service-time-pill" key={t.label}>
              <span className="pa2-service-time-label">{t.label}</span>
              <strong className="pa2-service-time-value">{t.value}</strong>
            </div>
          ))}
        </div>
      </Card>

      {/* ── Main 3-col grid ── */}
      <section className="portal-analytics-overview-grid">

        {/* Donut + legend */}
        <Card className="portal-glass-card stack pa2-donut-card">
          <span className="eyebrow">🌍 Estado global</span>
          <h3 className="section-title section-title-small">Mix de pedidos</h3>
          <div className="portal-analytics-status-layout">
            <div className="portal-analytics-donut-wrap">
              <svg aria-hidden="true" className="portal-analytics-donut" viewBox="0 0 160 160">
                <circle className="portal-analytics-donut-track" cx="80" cy="80" r={statusRadius} />
                {statusSegments.map((segment) => (
                  <circle
                    className="portal-analytics-donut-segment"
                    cx="80"
                    cy="80"
                    key={`${segment.label}-${segment.value}`}
                    r={segment.radius}
                    stroke={segment.color}
                    strokeDasharray={`${segment.dash} ${statusCircumference - segment.dash}`}
                    strokeDashoffset={-segment.offset}
                  />
                ))}
              </svg>
              <div className="portal-analytics-donut-center">
                <strong>{formatNumber(analytics.kpis.total_orders)}</strong>
                <span>Pedidos</span>
              </div>
            </div>
            <div className="portal-analytics-status-legend">
              {statusMix.map((item) => (
                <div className="portal-analytics-status-row" key={item.label}>
                  <span className="portal-analytics-status-dot" style={{ backgroundColor: item.color }} />
                  <span className="portal-analytics-status-label">{item.label}</span>
                  <strong className="portal-analytics-status-value">{item.value}</strong>
                  {item.percentage !== null && (
                    <span className="pa2-status-pct">{Math.round(item.percentage ?? 0)}%</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* SLA ring + risk */}
        <Card className="portal-glass-card stack pa2-sla-card">
          <span className="eyebrow">🎯 Cumplimiento</span>
          <h3 className="section-title section-title-small">Calidad de entrega</h3>
          <div className="pa2-sla-layout">
            <div className="pa2-sla-ring-wrap">
              <svg aria-hidden="true" className="pa2-sla-ring" viewBox="0 0 100 100">
                <circle className="pa2-sla-track" cx="50" cy="50" r="36" />
                <circle
                  className="pa2-sla-fill"
                  cx="50"
                  cy="50"
                  r="36"
                  stroke={slaColor}
                  strokeDasharray={`${slaRing * (slaRate / 100)} ${slaRing}`}
                  strokeDashoffset={slaRing * 0.25}
                />
              </svg>
              <div className="pa2-sla-center">
                <strong style={{ color: slaColor }}>{Math.round(slaRate)}%</strong>
                <span>en SLA</span>
              </div>
            </div>
            <div className="pa2-sla-breakdown">
              {[
                { label: "✅ Entregados en SLA", value: analytics.shipping.delivered_orders, good: true },
                { label: "🚨 Excepción carrier", value: analytics.shipping.exception_orders, good: false },
                { label: "⏸️ Tracking parado", value: analytics.operational.stalled_tracking_orders, good: analytics.operational.stalled_tracking_orders === 0 },
                { label: "❌ Sin envío", value: analytics.operational.orders_without_shipment, good: analytics.operational.orders_without_shipment === 0 },
              ].map((item) => (
                <div className="pa2-sla-row" key={item.label}>
                  <span className="pa2-sla-row-label">{item.label}</span>
                  <strong className={`pa2-sla-row-value ${!item.good && item.value > 0 ? "is-bad" : "is-good"}`}>
                    {item.value}
                  </strong>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* Attention / risk */}
        <Card className="portal-glass-card stack pa2-risk-card">
          <span className="eyebrow">🚨 Alertas activas</span>
          <h3 className="section-title section-title-small">Qué necesita atención</h3>
          <div className="pa2-risk-list">
            {[
              { emoji: "🔒", label: "Bloqueados", value: analytics.operational.blocked_orders, hint: "requieren acción", level: analytics.operational.blocked_orders > 0 ? "high" : "ok" },
              { emoji: "⏸️", label: "Tracking parado", value: analytics.operational.stalled_tracking_orders, hint: "sin movimiento +48h", level: analytics.operational.stalled_tracking_orders > 2 ? "high" : analytics.operational.stalled_tracking_orders > 0 ? "mid" : "ok" },
              { emoji: "⚠️", label: "Incidencias abiertas", value: analytics.kpis.open_incidents, hint: "requieren gestión", level: analytics.kpis.open_incidents > 3 ? "high" : analytics.kpis.open_incidents > 0 ? "mid" : "ok" },
              { emoji: "🚚", label: "Excepción carrier", value: analytics.shipping.exception_orders, hint: "desvíos o retenciones", level: analytics.shipping.exception_orders > 0 ? "high" : "ok" },
              { emoji: "📭", label: "Sin tracking", value: analytics.operational.orders_without_tracking ?? 0, hint: "sin señal carrier", level: (analytics.operational.orders_without_tracking ?? 0) > 0 ? "mid" : "ok" },
              { emoji: "🧾", label: "Sin etiqueta", value: analytics.operational.orders_without_shipment, hint: "pendiente de generar", level: analytics.operational.orders_without_shipment > 5 ? "high" : analytics.operational.orders_without_shipment > 0 ? "mid" : "ok" },
            ].map((item) => (
              <div className={`pa2-risk-row pa2-risk-${item.level}`} key={item.label}>
                <span className="pa2-risk-emoji">{item.emoji}</span>
                <div className="pa2-risk-body">
                  <span className="pa2-risk-label">{item.label}</span>
                  <span className="pa2-risk-hint">{item.hint}</span>
                </div>
                <strong className="pa2-risk-value">{item.value}</strong>
              </div>
            ))}
          </div>
          <Link className="button button-secondary" href="/portal/shipments" style={{ marginTop: 8 }}>
            Ver expediciones →
          </Link>
        </Card>
      </section>

      {/* ── Orders by day + Carrier performance ── */}
      <section className="portal-analytics-grid">
        <Card className="portal-glass-card stack">
          <span className="eyebrow">📈 Tendencia</span>
          <h3 className="section-title section-title-small">Pedidos por día</h3>
          {analytics.charts.orders_by_day.length > 0 ? (
            <div className="pa2-bar-chart">
              {analytics.charts.orders_by_day.map((point) => {
                const date = new Date(`${point.date}T12:00:00`);
                const dayShort = date.toLocaleDateString("es-ES", { weekday: "short" });
                const pct = (point.total / ordersByDayMax) * 100;
                return (
                  <div className="pa2-bar-col" key={point.date}>
                    <span className="pa2-bar-val">{point.total > 0 ? point.total : ""}</span>
                    <div className="pa2-bar-track">
                      <div
                        className="pa2-bar-fill pa2-bar-fill-blue"
                        style={{ height: `${Math.max(pct, 2)}%` }}
                      />
                    </div>
                    <span className="pa2-bar-label">{dayLabels[dayShort] ?? dayShort}</span>
                    <span className="pa2-bar-sublabel">{point.delivered > 0 ? `✅${point.delivered}` : ""}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="table-secondary">Sin datos en el rango seleccionado.</p>
          )}
        </Card>

        <Card className="portal-glass-card stack">
          <span className="eyebrow">🚛 Carriers</span>
          <h3 className="section-title section-title-small">Volumen por transportista</h3>
          {analytics.charts.carrier_performance.length > 0 ? (
            <div className="pa2-hbar-chart">
              {analytics.charts.carrier_performance.map((item) => (
                <div className="pa2-hbar-row" key={item.label}>
                  <span className="pa2-hbar-label">{item.label}</span>
                  <div className="pa2-hbar-track">
                    <div
                      className="pa2-hbar-fill pa2-hbar-fill-indigo"
                      style={{ width: `${(item.value / carrierMax) * 100}%` }}
                    />
                  </div>
                  <strong className="pa2-hbar-value">{item.value}</strong>
                  {item.percentage !== null && (
                    <span className="pa2-hbar-pct">{Math.round(item.percentage ?? 0)}%</span>
                  )}
                </div>
              ))}

              {/* Carrier deep metrics */}
              {analytics.shipping.carrier_performance.length > 0 && (
                <div className="pa2-carrier-detail">
                  <div className="pa2-carrier-detail-head">Detalle por carrier</div>
                  {analytics.shipping.carrier_performance.map((cp) => (
                    <div className="pa2-carrier-row" key={cp.carrier}>
                      <span className="pa2-carrier-name">🚚 {cp.carrier}</span>
                      <div className="pa2-carrier-stats">
                        <span>{cp.shipments} envíos</span>
                        <span>✅ {cp.delivered_orders} entregados</span>
                        {cp.avg_delivery_hours !== null && (
                          <span>⏱️ {formatHours(cp.avg_delivery_hours)}</span>
                        )}
                        {cp.incident_rate !== null && (
                          <span className={cp.incident_rate > 5 ? "pa2-stat-bad" : ""}>
                            ⚠️ {formatPercent(cp.incident_rate)} incid.
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="table-secondary">No hay datos de carriers en el rango actual.</p>
          )}
        </Card>
      </section>

      {/* ── Mix + Incidents ── */}
      <section className="portal-analytics-grid">
        <Card className="portal-glass-card stack">
          <span className="eyebrow">🎨 Mix</span>
          <h3 className="section-title section-title-small">Personalización y carga</h3>
          <div className="pa2-mix-grid">
            {[
              { emoji: "🎨", label: "Personalizados", value: analytics.kpis.personalized_orders, pct: formatPercent(analytics.personalization.personalized_share), color: "#6366F1" },
              { emoji: "📦", label: "Estándar", value: analytics.kpis.standard_orders, pct: formatPercent(analytics.personalization.standard_share), color: "#0EA5E9" },
              { emoji: "⏳", label: "Pend. assets", value: analytics.personalization.pending_assets_orders, pct: "sin material", color: "#F59E0B" },
              { emoji: "🔍", label: "Pend. revisión", value: analytics.personalization.pending_review_orders, pct: "requiere validación", color: "#94A3B8" },
            ].map((item) => (
              <div className="pa2-mix-tile" key={item.label} style={{ "--mix-color": item.color } as React.CSSProperties}>
                <span className="pa2-mix-emoji">{item.emoji}</span>
                <strong className="pa2-mix-value">{formatNumber(item.value)}</strong>
                <span className="pa2-mix-label">{item.label}</span>
                <span className="pa2-mix-pct">{item.pct}</span>
              </div>
            ))}
          </div>

          {/* Personalization share bar */}
          {analytics.personalization.personalized_share !== null && (
            <div className="pa2-share-bar-wrap">
              <div className="pa2-share-bar">
                <div
                  className="pa2-share-bar-fill pa2-share-bar-personalized"
                  style={{ width: `${analytics.personalization.personalized_share}%` }}
                  title={`${formatPercent(analytics.personalization.personalized_share)} personalizados`}
                />
                <div
                  className="pa2-share-bar-fill pa2-share-bar-standard"
                  style={{ width: `${analytics.personalization.standard_share ?? 0}%` }}
                  title={`${formatPercent(analytics.personalization.standard_share)} estándar`}
                />
              </div>
              <div className="pa2-share-bar-legend">
                <span>🎨 {formatPercent(analytics.personalization.personalized_share)} personalizados</span>
                <span>📦 {formatPercent(analytics.personalization.standard_share)} estándar</span>
              </div>
            </div>
          )}
        </Card>

        <Card className="portal-glass-card stack">
          <span className="eyebrow">⚠️ Excepciones</span>
          <h3 className="section-title section-title-small">Incidencias por tipo</h3>
          {analytics.charts.incidents_by_type.length > 0 ? (
            <div className="pa2-hbar-chart">
              {analytics.charts.incidents_by_type.map((item) => (
                <div className="pa2-hbar-row" key={item.label}>
                  <span className="pa2-hbar-label">{item.label}</span>
                  <div className="pa2-hbar-track">
                    <div
                      className="pa2-hbar-fill pa2-hbar-fill-red"
                      style={{ width: `${(item.value / incidentMax) * 100}%` }}
                    />
                  </div>
                  <strong className="pa2-hbar-value">{item.value}</strong>
                </div>
              ))}
            </div>
          ) : (
            <div className="pa2-no-incidents">
              <span style={{ fontSize: "2rem" }}>🎉</span>
              <p className="table-primary">Sin incidencias en este rango</p>
              <p className="table-secondary">Todo ha ido bien en el periodo seleccionado.</p>
            </div>
          )}

          {/* Aging */}
          {analytics.operational.aging_buckets && (
            <div className="pa2-aging-wrap">
              <div className="pa2-aging-title">⏱️ Antigüedad de pedidos activos</div>
              <div className="pa2-aging-grid">
                {[
                  { label: "0–24h", value: analytics.operational.aging_buckets.bucket_0_24, color: "#22C55E" },
                  { label: "24–48h", value: analytics.operational.aging_buckets.bucket_24_48, color: "#F59E0B" },
                  { label: "48–72h", value: analytics.operational.aging_buckets.bucket_48_72, color: "#F97316" },
                  { label: "+72h", value: analytics.operational.aging_buckets.bucket_72_plus, color: "#EF4444" },
                ].map((bucket) => (
                  <div className="pa2-aging-tile" key={bucket.label} style={{ "--aging-color": bucket.color } as React.CSSProperties}>
                    <strong className="pa2-aging-value">{bucket.value}</strong>
                    <span className="pa2-aging-label">{bucket.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </section>

      {/* ── Top SKUs + Delayed ── */}
      <section className="portal-analytics-grid">
        <Card className="portal-glass-card stack">
          <span className="eyebrow">📦 Ranking</span>
          <h3 className="section-title section-title-small">Tus productos más activos</h3>
          {analytics.rankings.top_skus.length > 0 ? (
            <div className="pa2-ranking-list">
              {analytics.rankings.top_skus.slice(0, 8).map((item, index) => (
                <div className="pa2-ranking-row" key={`${item.sku}-${item.name}`}>
                  <span className="pa2-ranking-pos">{index + 1}</span>
                  <div className="pa2-ranking-info">
                    <div className="table-primary">{item.name}</div>
                    <div className="table-secondary">{item.sku}</div>
                  </div>
                  <div className="pa2-ranking-metrics">
                    <span className="pa2-metric-pill pa2-metric-blue">{item.quantity} uds</span>
                    <span className="pa2-metric-pill pa2-metric-slate">{item.orders} ped.</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="table-secondary">Sin datos de SKU en el rango actual.</p>
          )}
        </Card>

        <Card className="portal-glass-card stack">
          <span className="eyebrow">🔔 Urgente</span>
          <h3 className="section-title section-title-small">Pedidos más retrasados</h3>
          {analytics.rankings.delayed_orders.length > 0 ? (
            <div className="pa2-ranking-list">
              {analytics.rankings.delayed_orders.slice(0, 8).map((order) => {
                const urgency = order.age_hours > 72 ? "pa2-urgent-high" : order.age_hours > 48 ? "pa2-urgent-mid" : "pa2-urgent-low";
                return (
                  <Link className={`pa2-ranking-row pa2-ranking-link ${urgency}`} href={`/portal/orders/${order.order_id}`} key={order.order_id}>
                    <span className="pa2-urgent-dot" />
                    <div className="pa2-ranking-info">
                      <div className="table-primary">{order.external_id}</div>
                      <div className="table-secondary">{order.customer_name} · {order.reason}</div>
                    </div>
                    <div className="pa2-ranking-metrics">
                      <span className={`pa2-metric-pill ${order.age_hours > 48 ? "pa2-metric-red" : "pa2-metric-orange"}`}>
                        {order.age_hours.toFixed(0)}h
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="pa2-no-incidents">
              <span style={{ fontSize: "2rem" }}>🏆</span>
              <p className="table-primary">Sin pedidos retrasados</p>
              <p className="table-secondary">Todo el flujo está dentro del SLA.</p>
            </div>
          )}
        </Card>
      </section>

      {/* ── Quick links ── */}
      <div className="pa2-quick-links">
        <Link className="button" href="/portal/shipments">🚚 Ver expediciones</Link>
        <Link className="button button-secondary" href="/portal/orders">📋 Ver pedidos</Link>
        <Link className="button button-secondary" href="/portal/incidencias">⚠️ Ver incidencias</Link>
      </div>
    </div>
  );
}
