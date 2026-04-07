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
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return undefined;
}


function formatPercent(value: number | null) {
  return value === null ? "n/d" : `${Math.round(value)}%`;
}


function formatHours(value: number | null) {
  return value === null ? "n/d" : `${value.toFixed(value >= 10 ? 0 : 1)}h`;
}


function maxValue(items: { value: number }[]) {
  return items.reduce((max, item) => Math.max(max, item.value), 0) || 1;
}

function formatNumber(value: number | null) {
  return value === null ? "n/d" : new Intl.NumberFormat("es-ES").format(value);
}

function buildDonutSegments(items: Array<{ label: string; value: number; color: string }>, radius: number, circumference: number) {
  const total = items.reduce((sum, item) => sum + item.value, 0) || 1;
  let offset = 0;

  return items.map((item) => {
    const dash = circumference * (item.value / total);
    const segment = {
      ...item,
      radius,
      dash,
      offset,
    };
    offset += dash;
    return segment;
  });
}


function buildHighlights(analytics: AnalyticsOverview) {
  return [
    {
      label: "📦 Pedidos totales",
      value: String(analytics.kpis.total_orders),
      meta: `${analytics.kpis.orders_today} hoy`,
    },
    {
      label: "🎨 Personalización",
      value: formatPercent(analytics.personalization.personalized_share),
      meta: `${analytics.personalization.pending_assets_orders} con assets pendientes`,
    },
    {
      label: "🎯 Envíos a tiempo",
      value: formatPercent(analytics.operational.delivered_in_sla_rate),
      meta: `${analytics.shipping.delivered_orders} entregados`,
    },
    {
      label: "⚠️ Incidencias abiertas",
      value: String(analytics.kpis.open_incidents),
      meta: `${analytics.shipping.exception_orders} envíos con excepción`,
    },
  ];
}


export default async function PortalAnalyticsPage({ searchParams }: PortalAnalyticsPageProps) {
  await requirePortalUser();
  const shops = await fetchMyShops();
  const params = (await searchParams) ?? {};
  const tenantScope = resolveTenantScope(shops, readValue(params.shop_id));
  const filters = {
    date_from: readValue(params.date_from),
    date_to: readValue(params.date_to),
    shop_id: tenantScope.selectedShopId,
    channel: readValue(params.channel),
    is_personalized: readBoolean(params.is_personalized),
    status: readValue(params.status),
    production_status: readValue(params.production_status),
    carrier: readValue(params.carrier),
  };
  let analytics: AnalyticsOverview | null = null;
  try {
    analytics = await fetchAnalyticsOverview(filters);
  } catch {
    // Graceful degradation — rendered below
  }

  if (!analytics) {
    return (
      <div className="stack">
        <PageHeader
          eyebrow="Reporting"
          title="Rendimiento de tu operativa"
          description="No hemos podido cargar los datos de analítica en este momento. Inténtalo de nuevo más tarde."
        />
        <PortalTenantControl
          action="/portal/analytics"
          hiddenFields={{}}
          selectedShopId={tenantScope.selectedShopId}
          shops={tenantScope.shops}
          submitLabel="Ver"
        />
        <Card className="portal-glass-card">
          <div className="empty-state">
            <div className="empty-state-icon">⚠️</div>
            <h3 className="empty-state-title">Datos no disponibles</h3>
            <p className="empty-state-description">El servicio de analítica no respondió correctamente. Prueba a recargar la página.</p>
          </div>
        </Card>
      </div>
    );
  }

  const highlights = buildHighlights(analytics);
  const ordersByDayMax = maxValue(analytics.charts.orders_by_day.map((point) => ({ value: point.total })));
  const carrierMax = maxValue(analytics.charts.carrier_performance);
  const statusMix = analytics.charts.status_distribution
    .map((item, index) => ({
      ...item,
      color: ["#94A3B8", "#F59E0B", "#38BDF8", "#22C55E", "#F97316", "#6366F1"][index % 6],
    }))
    .filter((item) => item.value > 0);
  const statusRadius = 56;
  const statusCircumference = 2 * Math.PI * statusRadius;
  const statusSegments = buildDonutSegments(statusMix, statusRadius, statusCircumference);
  const riskItems = [
    { label: "🔒 Bloqueados", value: analytics.operational.blocked_orders, meta: "requieren seguimiento" },
    { label: "❌ Sin envío", value: analytics.operational.orders_without_shipment, meta: "pendientes de etiqueta" },
    { label: "⏸️ Tracking parado", value: analytics.operational.stalled_tracking_orders, meta: "sin movimiento reciente" },
    { label: "⚠️ Incidencias", value: analytics.kpis.open_incidents, meta: "abiertas ahora mismo" },
  ];
  const serviceItems = [
    { label: "📋 Pedido a producción", value: formatHours(analytics.operational.avg_order_to_production_hours) },
    { label: "🏷️ Producción a envío", value: formatHours(analytics.operational.avg_production_to_shipping_hours) },
    { label: "🚚 Envío a entrega", value: formatHours(analytics.operational.avg_shipping_to_delivery_hours) },
    { label: "🎯 Entregado en SLA", value: formatPercent(analytics.operational.delivered_in_sla_rate) },
  ];
  const mixItems = [
    { label: "🎨 Personalizados", value: analytics.kpis.personalized_orders, meta: formatPercent(analytics.personalization.personalized_share) },
    { label: "📦 Estándar", value: analytics.kpis.standard_orders, meta: formatPercent(analytics.personalization.standard_share) },
    { label: "⏳ Pend. assets", value: analytics.personalization.pending_assets_orders, meta: "falta material" },
    { label: "🔍 Pend. revisión", value: analytics.personalization.pending_review_orders, meta: "requiere validación" },
  ];

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Reporting"
        title="Rendimiento de tu operativa"
        description="Un reporting claro y visual para entender volumen, cumplimiento, incidencias y tiempos de servicio sin complejidad técnica."
        actions={
          <div className="analytics-header-meta">
            <span className="analytics-generated">
              Generado {new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(new Date(analytics.scope.generated_at))}
            </span>
          </div>
        }
      />

      <PortalTenantControl
        action="/portal/analytics"
        hiddenFields={{
          date_from: filters.date_from,
          date_to: filters.date_to,
          channel: filters.channel,
          is_personalized:
            filters.is_personalized === undefined ? undefined : String(filters.is_personalized),
          status: filters.status,
          production_status: filters.production_status,
          carrier: filters.carrier,
        }}
        selectedShopId={tenantScope.selectedShopId}
        shops={tenantScope.shops}
        submitLabel="Ver"
      />

      <Card className="portal-glass-card portal-analytics-hero">
        <div className="portal-glass-header">
          <div>
            <span className="eyebrow">📊 Resumen ejecutivo</span>
            <h3 className="section-title section-title-small">Qué está pasando ahora mismo</h3>
            <p className="subtitle">
              Una lectura rápida de volumen, cumplimiento y excepciones. Si necesitas más detalle, usa filtros o baja a rankings y tendencias.
            </p>
          </div>
          <form action="/portal/shipments" className="portal-analytics-filter-row" method="get">
            <div className="portal-analytics-date-field">
              <label className="portal-analytics-date-label" htmlFor="portal-analytics-date-from">
                Desde
              </label>
              <input
                className="portal-inline-select"
                defaultValue={filters.date_from ?? ""}
                id="portal-analytics-date-from"
                name="date_from"
                type="date"
              />
            </div>
            <div className="portal-analytics-date-field">
              <label className="portal-analytics-date-label" htmlFor="portal-analytics-date-to">
                Hasta
              </label>
              <input
                className="portal-inline-select"
                defaultValue={filters.date_to ?? ""}
                id="portal-analytics-date-to"
                name="date_to"
                type="date"
              />
            </div>
            {tenantScope.selectedShopId ? <input name="shop_id" type="hidden" value={tenantScope.selectedShopId} /> : null}
            <select className="portal-inline-select" defaultValue={filters.is_personalized === undefined ? "" : String(filters.is_personalized)} name="is_personalized">
              <option value="">Todo el mix</option>
              <option value="true">Solo personalizados</option>
              <option value="false">Solo estándar</option>
            </select>
            <button className="button button-secondary" type="submit">Aplicar</button>
            <Link className="button button-secondary" href="/portal/shipments">Limpiar</Link>
          </form>
        </div>

        <div className="portal-analytics-highlight-grid">
          {highlights.map((item) => (
            <article className="portal-analytics-highlight" key={item.label}>
              <span className="portal-analytics-highlight-label">{item.label}</span>
              <strong className="portal-analytics-highlight-value">{item.value}</strong>
              <span className="portal-analytics-highlight-meta">{item.meta}</span>
            </article>
          ))}
        </div>
      </Card>

      <section className="portal-analytics-overview-grid">
        <Card className="portal-glass-card stack portal-analytics-status-card">
          <div className="section-header-inline">
            <div>
              <span className="eyebrow">🌍 Estado global</span>
              <h3 className="section-title section-title-small">Dónde están tus pedidos</h3>
            </div>
          </div>
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
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card className="portal-glass-card stack">
          <div className="section-header-inline">
            <div>
              <span className="eyebrow">⚙️ Servicio</span>
              <h3 className="section-title section-title-small">Ritmo operativo</h3>
            </div>
          </div>
          <div className="portal-analytics-stat-grid">
            {serviceItems.map((item) => (
              <article className="portal-analytics-stat-tile" key={item.label}>
                <span className="portal-analytics-stat-label">{item.label}</span>
                <strong className="portal-analytics-stat-value">{item.value}</strong>
              </article>
            ))}
          </div>
        </Card>

        <Card className="portal-glass-card stack">
          <div className="section-header-inline">
            <div>
              <span className="eyebrow">🚨 Riesgo</span>
              <h3 className="section-title section-title-small">Qué requiere atención</h3>
            </div>
          </div>
          <div className="portal-analytics-risk-list">
            {riskItems.map((item) => (
              <article className="portal-analytics-risk-row" key={item.label}>
                <div>
                  <div className="portal-analytics-risk-label">{item.label}</div>
                  <div className="table-secondary">{item.meta}</div>
                </div>
                <strong className="portal-analytics-risk-value">{item.value}</strong>
              </article>
            ))}
          </div>
        </Card>
      </section>

      <section className="portal-analytics-grid">
        <Card className="portal-glass-card stack">
          <div className="section-header-inline">
            <div>
              <span className="eyebrow">🎨 Mix</span>
              <h3 className="section-title section-title-small">Personalización y carga</h3>
            </div>
          </div>
          <div className="portal-analytics-stat-grid">
            {mixItems.map((item) => (
              <article className="portal-analytics-stat-tile" key={item.label}>
                <span className="portal-analytics-stat-label">{item.label}</span>
                <strong className="portal-analytics-stat-value">{formatNumber(item.value)}</strong>
                <span className="portal-analytics-stat-meta">{item.meta}</span>
              </article>
            ))}
          </div>
        </Card>

        <Card className="portal-glass-card stack">
          <div className="section-header-inline">
            <div>
              <span className="eyebrow">⚠️ Excepciones</span>
              <h3 className="section-title section-title-small">Incidencias por tipo</h3>
            </div>
          </div>
          <div className="bar-chart">
            {analytics.charts.incidents_by_type.length > 0 ? analytics.charts.incidents_by_type.map((item) => (
              <div className="bar-chart-row" key={item.label}>
                <div className="bar-chart-label">{item.label}</div>
                <div className="bar-chart-track portal-chart-track">
                  <div className="bar-chart-fill bar-chart-fill-danger" style={{ width: `${item.percentage ?? 0}%` }} />
                </div>
                <div className="bar-chart-value">{item.value}</div>
              </div>
            )) : <div className="table-secondary">No hay incidencias suficientes en este rango.</div>}
          </div>
        </Card>
      </section>

      <section className="portal-analytics-grid">
        <Card className="portal-glass-card stack">
          <div className="section-header-inline">
            <div>
              <span className="eyebrow">📈 Tendencia</span>
              <h3 className="section-title section-title-small">Pedidos por día</h3>
            </div>
          </div>
          <div className="bar-chart">
            {analytics.charts.orders_by_day.length > 0 ? analytics.charts.orders_by_day.map((point) => (
              <div className="bar-chart-row" key={point.date}>
                <div className="bar-chart-label">{point.date}</div>
                <div className="bar-chart-track portal-chart-track">
                  <div className="bar-chart-fill portal-chart-fill" style={{ width: `${(point.total / ordersByDayMax) * 100}%` }} />
                </div>
                <div className="bar-chart-value">{point.total}</div>
              </div>
            )) : <div className="table-secondary">Sin datos suficientes en el rango actual.</div>}
          </div>
        </Card>

        <Card className="portal-glass-card stack">
          <div className="section-header-inline">
            <div>
              <span className="eyebrow">🚛 Carriers</span>
              <h3 className="section-title section-title-small">Servicio por transportista</h3>
            </div>
          </div>
          <div className="bar-chart">
            {analytics.charts.carrier_performance.length > 0 ? analytics.charts.carrier_performance.map((item) => (
              <div className="bar-chart-row" key={item.label}>
                <div className="bar-chart-label">{item.label}</div>
                <div className="bar-chart-track portal-chart-track">
                  <div className="bar-chart-fill bar-chart-fill-soft portal-chart-fill-soft" style={{ width: `${(item.value / carrierMax) * 100}%` }} />
                </div>
                <div className="bar-chart-value">{item.value}</div>
              </div>
            )) : <div className="table-secondary">Todavía no hay carriers suficientes para comparar.</div>}
          </div>
        </Card>
      </section>

      <section className="portal-analytics-grid">
        <Card className="portal-glass-card stack">
          <div className="table-header">
            <div>
              <span className="eyebrow">📦 SKUs</span>
              <h3 className="section-title section-title-small">Qué más estás moviendo</h3>
            </div>
          </div>
          <div className="mini-table">
            {analytics.rankings.top_skus.slice(0, 6).map((item) => (
              <div className="mini-table-row" key={`${item.sku}-${item.name}`}>
                <div>
                  <div className="table-primary">{item.name}</div>
                  <div className="table-secondary">{item.sku}</div>
                </div>
                <div className="mini-table-metrics">
                  <span>{item.quantity} uds</span>
                  <span>{item.orders} pedidos</span>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="portal-glass-card stack">
          <div className="table-header">
            <div>
              <span className="eyebrow">🔔 Alertas</span>
              <h3 className="section-title section-title-small">Pedidos más retrasados</h3>
            </div>
          </div>
          <div className="mini-table">
            {analytics.rankings.delayed_orders.length > 0 ? analytics.rankings.delayed_orders.slice(0, 6).map((order) => (
              <Link className="mini-table-row mini-table-row-link" href={`/portal/orders/${order.order_id}`} key={order.order_id}>
                <div>
                  <div className="table-primary">{order.external_id}</div>
                  <div className="table-secondary">{order.customer_name}</div>
                  <div className="table-secondary">{order.reason}</div>
                </div>
                <div className="mini-table-metrics">
                  <span>{order.age_hours.toFixed(0)}h</span>
                  <span>{order.status}</span>
                </div>
              </Link>
            )) : <div className="table-secondary">No hay pedidos especialmente retrasados ahora mismo.</div>}
          </div>
        </Card>
      </section>
    </div>
  );
}
