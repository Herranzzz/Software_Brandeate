import Link from "next/link";

import { Card } from "@/components/card";
import { KpiCard } from "@/components/kpi-card";
import { PortalSyncButton } from "@/components/portal-sync-button";
import { PortalTenantControl } from "@/components/portal-tenant-control";
import { fetchAnalyticsOverview, fetchIncidents, fetchOrders, fetchShopifyIntegrations } from "@/lib/api";
import { fetchMyShops, requirePortalUser } from "@/lib/auth";
import { formatDateTime, sortTrackingEvents } from "@/lib/format";
import { getTenantBranding } from "@/lib/tenant-branding";
import { resolveTenantScope } from "@/lib/tenant-scope";
import type { AnalyticsOverview, Incident, Order, ShopIntegration, TrackingEvent } from "@/lib/types";

type PortalPageProps = {
  searchParams: Promise<{
    range?: string;
    shop_id?: string;
  }>;
};

type ShipmentStateKey =
  | "pending_preparation"
  | "label_created"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "exception";

type ActivityItem = {
  id: string;
  occurredAt: string;
  label: string;
  title: string;
  detail: string;
};

type AttentionItem = {
  id: string;
  orderLabel: string;
  reason: string;
  priority: string;
  href: string;
};

const shipmentStateMeta: Record<
  ShipmentStateKey,
  { label: string; tone: string; description: string }
> = {
  pending_preparation: {
    label: "Pendiente de preparación",
    tone: "slate",
    description: "sin shipment todavía",
  },
  label_created: {
    label: "Etiqueta creada",
    tone: "blue",
    description: "shipment listo para salir",
  },
  in_transit: {
    label: "En tránsito",
    tone: "indigo",
    description: "movimiento activo del carrier",
  },
  out_for_delivery: {
    label: "En reparto",
    tone: "sky",
    description: "última milla en curso",
  },
  delivered: {
    label: "Entregado",
    tone: "green",
    description: "cierre confirmado",
  },
  exception: {
    label: "Excepción",
    tone: "orange",
    description: "requiere seguimiento",
  },
};

function toDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatDayParam(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatPercent(value: number | null) {
  return value === null ? "n/d" : `${Math.round(value)}%`;
}

function formatHours(value: number | null) {
  return value === null ? "n/d" : `${value.toFixed(value >= 10 ? 0 : 1)}h`;
}

function getLatestTrackingEvent(order: Order): TrackingEvent | null {
  if (!order.shipment?.events?.length) {
    return null;
  }

  return sortTrackingEvents(order.shipment.events)[0] ?? null;
}

function getShipmentState(order: Order): ShipmentStateKey {
  const latestEvent = getLatestTrackingEvent(order);
  const status = latestEvent?.status_norm ?? order.shipment?.shipping_status ?? order.status;

  if (status === "delivered" || order.status === "delivered") {
    return "delivered";
  }
  if (status === "exception" || order.status === "exception") {
    return "exception";
  }
  if (status === "out_for_delivery") {
    return "out_for_delivery";
  }
  if (status === "in_transit" || status === "pickup_available") {
    return "in_transit";
  }
  if (order.shipment) {
    return "label_created";
  }
  return "pending_preparation";
}

function buildRecentShipments(orders: Order[]) {
  return orders
    .filter((order) => order.shipment)
    .sort((left, right) => {
      const leftDate = toDate(getLatestTrackingEvent(left)?.occurred_at ?? left.shipment?.created_at ?? left.created_at)?.getTime() ?? 0;
      const rightDate = toDate(getLatestTrackingEvent(right)?.occurred_at ?? right.shipment?.created_at ?? right.created_at)?.getTime() ?? 0;
      return rightDate - leftDate;
    })
    .slice(0, 8);
}

function buildActivityFeed(
  orders: Order[],
  incidents: Incident[],
  integration: ShopIntegration | null,
): ActivityItem[] {
  const activities: ActivityItem[] = [];

  if (integration?.last_synced_at) {
    activities.push({
      id: `sync-${integration.id}`,
      occurredAt: integration.last_synced_at,
      label: "Sync",
      title: integration.last_sync_status === "success" ? "Sincronización completada" : "Sincronización con aviso",
      detail: integration.shop_domain,
    });
  }

  orders.slice(0, 12).forEach((order) => {
    if (order.shipment?.created_at) {
      activities.push({
        id: `shipment-${order.id}`,
        occurredAt: order.shipment.created_at,
        label: "Shipment",
        title: `Shipment creado para ${order.external_id}`,
        detail: order.shipment.carrier || "Carrier pendiente",
      });
    }

    const latestEvent = getLatestTrackingEvent(order);
    if (latestEvent) {
      activities.push({
        id: `tracking-${order.id}-${latestEvent.id}`,
        occurredAt: latestEvent.occurred_at,
        label: "Tracking",
        title: `${order.external_id} · ${shipmentStateMeta[getShipmentState(order)].label}`,
        detail: latestEvent.status_raw ?? "Actualización automática del carrier",
      });
    }
  });

  incidents.slice(0, 8).forEach((incident) => {
    activities.push({
      id: `incident-${incident.id}`,
      occurredAt: incident.created_at,
      label: "Incidencia",
      title: incident.title,
      detail: incident.order.external_id,
    });
  });

  return activities
    .sort((left, right) => {
      const leftDate = toDate(left.occurredAt)?.getTime() ?? 0;
      const rightDate = toDate(right.occurredAt)?.getTime() ?? 0;
      return rightDate - leftDate;
    })
    .slice(0, 8);
}

function buildAttentionItems(
  analytics: AnalyticsOverview,
  orders: Order[],
  incidents: Incident[],
  selectedShopId: string,
) {
  const items: AttentionItem[] = [];
  const shopQuery = selectedShopId ? `?shop_id=${selectedShopId}` : "";

  analytics.rankings.delayed_orders.slice(0, 4).forEach((order) => {
    items.push({
      id: `delayed-${order.order_id}`,
      orderLabel: order.external_id,
      reason: order.reason,
      priority: order.age_hours >= 48 ? "Alta" : "Media",
      href: `/portal/orders/${order.order_id}${shopQuery}`,
    });
  });

  orders
    .filter((order) => !order.shipment || order.has_open_incident || order.items.some((item) => item.design_status === "pending_asset" || item.design_status === "missing_asset"))
    .slice(0, 6)
    .forEach((order) => {
      const reason = !order.shipment
        ? "Sin shipment creado"
        : order.has_open_incident
          ? "Incidencia abierta"
          : order.items.some((item) => item.design_status === "pending_asset")
            ? "Pendiente de asset"
            : "Sin diseño";

      if (!items.some((item) => item.orderLabel === order.external_id)) {
        items.push({
          id: `attention-${order.id}`,
          orderLabel: order.external_id,
          reason,
          priority: order.priority === "urgent" || order.priority === "high" ? "Alta" : "Normal",
          href: `/portal/orders/${order.id}${shopQuery}`,
        });
      }
    });

  incidents.slice(0, 4).forEach((incident) => {
    if (!items.some((item) => item.orderLabel === incident.order.external_id)) {
      items.push({
        id: `incident-${incident.id}`,
        orderLabel: incident.order.external_id,
        reason: incident.title,
        priority: incident.priority === "urgent" || incident.priority === "high" ? "Alta" : "Media",
        href: `/portal/orders/${incident.order.id}${shopQuery}`,
      });
    }
  });

  return items.slice(0, 8);
}

function getPrimaryItem(order: Order) {
  return order.items[0] ?? null;
}

export default async function PortalPage({ searchParams }: PortalPageProps) {
  await requirePortalUser();
  const params = await searchParams;
  const shops = await fetchMyShops();
  const tenantScope = resolveTenantScope(shops, params.shop_id);
  const branding = getTenantBranding(tenantScope.selectedShop ?? shops[0]);
  const range = params.range === "30d" ? "30d" : "7d";
  const now = new Date();
  const startDate = startOfDay(new Date(now.getTime() - (range === "30d" ? 29 : 6) * 86_400_000));
  const filters = {
    shop_id: tenantScope.selectedShopId,
    date_from: formatDayParam(startDate),
    date_to: formatDayParam(now),
  };

  const [orders, incidents, analytics, integrations] = await Promise.all([
    fetchOrders(tenantScope.selectedShopId ? { shop_id: tenantScope.selectedShopId } : undefined),
    fetchIncidents(tenantScope.selectedShopId ? { shop_id: tenantScope.selectedShopId } : undefined),
    fetchAnalyticsOverview(filters),
    fetchShopifyIntegrations(),
  ]);

  const filteredOrders = orders.filter((order) => {
    const createdAt = toDate(order.created_at);
    return createdAt ? createdAt >= startDate : false;
  });
  const filteredIncidents = incidents.filter((incident) => {
    const createdAt = toDate(incident.created_at);
    return createdAt ? createdAt >= startDate : false;
  });
  const activeIntegration = tenantScope.selectedShopId
    ? integrations.find((integration) => String(integration.shop_id) === tenantScope.selectedShopId) ?? null
    : integrations[0] ?? null;
  const recentShipments = buildRecentShipments(filteredOrders);
  const activity = buildActivityFeed(filteredOrders, filteredIncidents, activeIntegration);
  const attentionItems = buildAttentionItems(analytics, filteredOrders, filteredIncidents, tenantScope.selectedShopId);
  const shipmentCounts = {
    pending_preparation: filteredOrders.filter((order) => getShipmentState(order) === "pending_preparation").length,
    label_created: filteredOrders.filter((order) => getShipmentState(order) === "label_created").length,
    in_transit: filteredOrders.filter((order) => getShipmentState(order) === "in_transit").length,
    out_for_delivery: filteredOrders.filter((order) => getShipmentState(order) === "out_for_delivery").length,
    delivered: filteredOrders.filter((order) => getShipmentState(order) === "delivered").length,
    exception: filteredOrders.filter((order) => getShipmentState(order) === "exception").length,
  };
  const shipmentStateCards = Object.entries(shipmentCounts).map(([key, value]) => ({
    key: key as ShipmentStateKey,
    value,
    ...shipmentStateMeta[key as ShipmentStateKey],
  }));
  const primaryCarrier = analytics.shipping.carrier_performance[0]?.carrier ?? "CTT Express";
  const shopQuery = tenantScope.selectedShopId ? `?shop_id=${tenantScope.selectedShopId}` : "";
  const heroServiceSummary =
    analytics.kpis.open_incidents > 0
      ? `${analytics.kpis.open_incidents} incidencias abiertas que requieren seguimiento.`
      : analytics.shipping.in_transit_orders > 0
        ? `${analytics.shipping.in_transit_orders} envíos en movimiento y ${analytics.kpis.delivered_orders} entregados en el periodo.`
        : "Operativa estable y lista para revisar tus envíos, pedidos y tiempos de servicio.";
  const personalizationTotal = analytics.kpis.personalized_orders + analytics.kpis.standard_orders || 1;

  return (
    <div className="stack portal-dashboard">
      <Card className="portal-dashboard-hero portal-glass-card">
        <div className="portal-dashboard-hero-top">
          <div className="portal-dashboard-brand">
            {branding.logoUrl ? (
              <img alt={branding.displayName} className="portal-dashboard-logo" src={branding.logoUrl} />
            ) : (
              <div className="portal-dashboard-logo portal-dashboard-logo-fallback">{branding.logoMark}</div>
            )}
            <div className="portal-dashboard-brand-copy">
              <span className="eyebrow">Servicio activo</span>
              <h2 className="portal-dashboard-title">{branding.displayName}</h2>
              <p className="portal-dashboard-subtitle">{heroServiceSummary}</p>
            </div>
          </div>

          <div className="portal-dashboard-hero-meta">
            <div className="portal-dashboard-meta-card">
              <span className="portal-summary-label">Última sincronización</span>
              <strong>{activeIntegration?.last_synced_at ? formatDateTime(activeIntegration.last_synced_at) : "Sin sincronización"}</strong>
              <span className="table-secondary">
                {activeIntegration?.last_sync_status === "success" ? "Shopify al día" : activeIntegration?.last_sync_status ?? "Conecta Shopify"}
              </span>
            </div>
            <div className="portal-dashboard-meta-card">
              <span className="portal-summary-label">Carrier principal</span>
              <strong>{primaryCarrier}</strong>
              <span className="table-secondary">{analytics.shipping.carrier_performance[0]?.shipments ?? 0} envíos en el periodo</span>
            </div>
          </div>
        </div>

        <div className="portal-dashboard-hero-actions">
          <Link className="button" href={`/portal/orders${shopQuery}`}>Ver pedidos</Link>
          <Link className="button button-secondary" href={`/portal/operations${shopQuery}`}>Ver envíos</Link>
          <Link className="button button-secondary" href={`/portal/returns${shopQuery}`}>Ver devoluciones</Link>
          <Link className="button button-secondary" href={`/portal/reporting${shopQuery}`}>Ver reporting</Link>
          {tenantScope.selectedShop ? (
            activeIntegration ? <PortalSyncButton shopId={tenantScope.selectedShop.id} /> : <Link className="button button-secondary" href={`/portal/settings${shopQuery}`}>Conectar Shopify</Link>
          ) : null}
        </div>
      </Card>

      <PortalTenantControl
        action="/portal"
        hiddenFields={{ range }}
        selectedShopId={tenantScope.selectedShopId}
        shops={tenantScope.shops}
        submitLabel="Ver"
        title="Vista de tienda"
        description="El portal reutiliza la operativa del sistema, filtrada automáticamente a tu tienda o tiendas asignadas."
      />

      <section className="portal-dashboard-kpi-grid">
        <KpiCard label="Pedidos hoy" value={String(analytics.kpis.orders_today)} delta={`${analytics.kpis.total_orders} en el periodo`} tone="accent" />
        <KpiCard label="En producción" value={String(analytics.kpis.in_production_orders)} delta={`${analytics.operational.blocked_orders} bloqueados`} tone="warning" />
        <KpiCard label="En tránsito" value={String(analytics.shipping.in_transit_orders)} delta={`${shipmentCounts.out_for_delivery} en reparto`} tone="default" />
        <KpiCard label="Entregados" value={String(analytics.kpis.delivered_orders)} delta={`${shipmentCounts.delivered} cerrados`} tone="success" />
        <KpiCard label="Incidencias abiertas" value={String(analytics.kpis.open_incidents)} delta={`${analytics.shipping.exception_orders} de transporte`} tone="danger" />
        <KpiCard label="% entregado en SLA" value={formatPercent(analytics.operational.delivered_in_sla_rate)} delta={`${formatHours(analytics.operational.avg_shipping_to_delivery_hours)} envío medio`} tone="success" />
      </section>

      <section className="portal-dashboard-main-grid">
        <Card className="portal-dashboard-shipments portal-glass-card">
          <div className="portal-dashboard-section-head">
            <div>
              <span className="eyebrow">Estado de envíos</span>
              <h3 className="section-title section-title-small">Control del lote actual</h3>
              <p className="subtitle">Lectura rápida de dónde está cada pedido y qué necesita moverse ahora.</p>
            </div>

            <form className="portal-range-toggle" method="get">
              {tenantScope.selectedShopId ? <input name="shop_id" type="hidden" value={tenantScope.selectedShopId} /> : null}
              <button className={`portal-range-button ${range === "7d" ? "portal-range-button-active" : ""}`} name="range" type="submit" value="7d">7d</button>
              <button className={`portal-range-button ${range === "30d" ? "portal-range-button-active" : ""}`} name="range" type="submit" value="30d">30d</button>
            </form>
          </div>

          <div className="portal-dashboard-state-grid">
            {shipmentStateCards.map((item) => (
              <article className={`portal-shipment-state-card portal-shipment-tone-${item.tone}`} key={item.key}>
                <span className="portal-shipment-state-label">{item.label}</span>
                <strong>{item.value}</strong>
                <span className="table-secondary">{item.description}</span>
              </article>
            ))}
          </div>

          <div className="portal-recent-table-wrap">
            <table className="portal-recent-table">
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Carrier</th>
                  <th>Tracking</th>
                  <th>Estado</th>
                  <th>ETA</th>
                  <th>Última actualización</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {recentShipments.length > 0 ? recentShipments.map((order) => {
                  const latestEvent = getLatestTrackingEvent(order);
                  const shipmentState = shipmentStateMeta[getShipmentState(order)];
                  const eta = getShipmentState(order) === "out_for_delivery" ? "Hoy" : latestEvent?.status_norm === "in_transit" ? "En tránsito" : "n/d";
                  return (
                    <tr key={order.id}>
                      <td>
                        <div className="portal-recent-order">
                          <Link className="table-link table-link-strong" href={`/portal/orders/${order.id}${shopQuery}`}>{order.external_id}</Link>
                          <span className="table-secondary">{order.customer_name}</span>
                        </div>
                      </td>
                      <td>{order.shipment?.carrier ?? "Pendiente"}</td>
                      <td>
                        {order.shipment?.tracking_url ? (
                          <a className="table-link" href={order.shipment.tracking_url} rel="noreferrer" target="_blank">
                            {order.shipment?.tracking_number ?? "Pendiente"}
                          </a>
                        ) : (
                          order.shipment?.tracking_number ?? "Pendiente"
                        )}
                      </td>
                      <td><span className={`shipments-status-pill shipments-status-pill-${shipmentState.tone}`}>{shipmentState.label}</span></td>
                      <td>{eta}</td>
                      <td>{formatDateTime(latestEvent?.occurred_at ?? order.shipment?.created_at ?? order.created_at)}</td>
                      <td>
                        {order.shipment?.tracking_url ? (
                          <a className="table-link" href={order.shipment.tracking_url} rel="noreferrer" target="_blank">Ver tracking</a>
                        ) : (
                          <Link className="table-link" href={`/portal/orders/${order.id}${shopQuery}`}>Ver pedido</Link>
                        )}
                      </td>
                    </tr>
                  );
                }) : (
                  <tr>
                    <td className="table-secondary" colSpan={7}>Todavía no hay envíos recientes en este periodo.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="portal-dashboard-side">
          <Card className="portal-glass-card">
            <div className="portal-dashboard-section-head">
              <div>
                <span className="eyebrow">Riesgos</span>
                <h3 className="section-title section-title-small">Necesitan atención</h3>
              </div>
            </div>
            <div className="portal-risk-list">
              {attentionItems.length > 0 ? attentionItems.map((item) => (
                <Link className="portal-risk-row" href={item.href} key={item.id}>
                  <div>
                    <strong>{item.orderLabel}</strong>
                    <div className="table-secondary">{item.reason}</div>
                  </div>
                  <span className={`portal-soft-pill ${item.priority === "Alta" ? "portal-soft-pill-alert" : ""}`}>{item.priority}</span>
                </Link>
              )) : (
                <div className="table-secondary">Sin riesgos críticos en este momento.</div>
              )}
            </div>
          </Card>

          <Card className="portal-glass-card">
            <div className="portal-dashboard-section-head">
              <div>
                <span className="eyebrow">Acciones rápidas</span>
                <h3 className="section-title section-title-small">Siguiente paso</h3>
              </div>
            </div>
            <div className="portal-dashboard-action-grid">
              <Link className="button button-secondary" href={`/portal/orders${shopQuery}`}>Ver pedidos</Link>
              <Link className="button button-secondary" href={`/portal/operations${shopQuery}`}>Ver envíos</Link>
              <Link className="button button-secondary" href={`/portal/returns${shopQuery}`}>Gestionar devoluciones</Link>
              <Link className="button button-secondary" href={`/portal/reporting${shopQuery}`}>Ver reporte</Link>
              {tenantScope.selectedShop && activeIntegration ? <PortalSyncButton shopId={tenantScope.selectedShop.id} /> : null}
              <Link className="button button-secondary" href={`/portal/settings${shopQuery}`}>Ajustes de cuenta</Link>
            </div>
          </Card>
        </div>
      </section>

      <section className="portal-dashboard-secondary-grid">
        <Card className="portal-glass-card">
          <div className="portal-dashboard-section-head">
            <div>
              <span className="eyebrow">Actividad</span>
              <h3 className="section-title section-title-small">Timeline reciente</h3>
            </div>
          </div>
          <div className="portal-activity-timeline">
            {activity.length > 0 ? activity.map((item) => (
              <article className="portal-activity-row" key={item.id}>
                <div className="portal-activity-dot" />
                <div className="portal-activity-copy">
                  <div className="portal-activity-head">
                    <span className="portal-soft-pill">{item.label}</span>
                    <span className="table-secondary">{formatDateTime(item.occurredAt)}</span>
                  </div>
                  <strong>{item.title}</strong>
                  <div className="table-secondary">{item.detail}</div>
                </div>
              </article>
            )) : (
              <div className="table-secondary">Aún no hay actividad reciente para mostrar.</div>
            )}
          </div>
        </Card>

        <Card className="portal-glass-card">
          <div className="portal-dashboard-section-head">
            <div>
              <span className="eyebrow">Rendimiento</span>
              <h3 className="section-title section-title-small">Métricas del servicio</h3>
            </div>
          </div>
          <div className="portal-performance-grid">
            <div className="portal-performance-item">
              <span>Pedido → producción</span>
              <strong>{formatHours(analytics.operational.avg_order_to_production_hours)}</strong>
            </div>
            <div className="portal-performance-item">
              <span>Producción → envío</span>
              <strong>{formatHours(analytics.operational.avg_production_to_shipping_hours)}</strong>
            </div>
            <div className="portal-performance-item">
              <span>Envío → entrega</span>
              <strong>{formatHours(analytics.operational.avg_shipping_to_delivery_hours)}</strong>
            </div>
            <div className="portal-performance-item">
              <span>Tasa de incidencias</span>
              <strong>{formatPercent(analytics.operational.incident_rate)}</strong>
            </div>
            <div className="portal-performance-item">
              <span>Entregas a tiempo</span>
              <strong>{formatPercent(analytics.operational.delivered_in_sla_rate)}</strong>
            </div>
            <div className="portal-performance-item">
              <span>Tracking parado</span>
              <strong>{analytics.operational.stalled_tracking_orders}</strong>
            </div>
          </div>
          <div className="portal-performance-foot">
            <div>
              <span className="portal-summary-label">Top SKU</span>
              <strong>{analytics.rankings.top_skus[0]?.name ?? analytics.rankings.top_skus[0]?.sku ?? "Sin datos aún"}</strong>
            </div>
            <div>
              <span className="portal-summary-label">Top carrier</span>
              <strong>{analytics.shipping.carrier_performance[0]?.carrier ?? "Sin datos aún"}</strong>
            </div>
          </div>
        </Card>
      </section>

      <section className="portal-dashboard-charts-grid">
        <Card className="portal-glass-card">
          <div className="portal-dashboard-section-head">
            <div>
              <span className="eyebrow">Tendencia</span>
              <h3 className="section-title section-title-small">Pedidos por día</h3>
            </div>
          </div>
          <div className="portal-mini-bars">
            {analytics.charts.orders_by_day.map((point) => {
              const max = Math.max(...analytics.charts.orders_by_day.map((entry) => entry.total), 1);
              const height = Math.max(18, (point.total / max) * 140);
              return (
                <div className="portal-mini-bar-column" key={point.date}>
                  <div className="portal-mini-bar-wrap">
                    <div className="portal-mini-bar" style={{ height }} />
                  </div>
                  <strong>{point.total}</strong>
                  <span>{new Date(point.date).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}</span>
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="portal-glass-card">
          <div className="portal-dashboard-section-head">
            <div>
              <span className="eyebrow">Mix</span>
              <h3 className="section-title section-title-small">Personalizados vs estándar</h3>
            </div>
          </div>
          <div className="portal-mix-card">
            <div className="portal-mix-track">
              <div className="portal-mix-fill portal-mix-fill-personalized" style={{ width: `${(analytics.kpis.personalized_orders / personalizationTotal) * 100}%` }} />
              <div className="portal-mix-fill portal-mix-fill-standard" style={{ width: `${(analytics.kpis.standard_orders / personalizationTotal) * 100}%` }} />
            </div>
            <div className="portal-mix-stats">
              <div className="portal-mix-stat">
                <span className="portal-status-legend-dot portal-status-dot-personalized" />
                <div>
                  <strong>{analytics.kpis.personalized_orders}</strong>
                  <span>Personalizados</span>
                </div>
              </div>
              <div className="portal-mix-stat">
                <span className="portal-status-legend-dot portal-status-dot-standard" />
                <div>
                  <strong>{analytics.kpis.standard_orders}</strong>
                  <span>Estándar</span>
                </div>
              </div>
            </div>
          </div>
        </Card>

        <Card className="portal-glass-card">
          <div className="portal-dashboard-section-head">
            <div>
              <span className="eyebrow">Carrier</span>
              <h3 className="section-title section-title-small">Rendimiento por transportista</h3>
            </div>
          </div>
          <div className="portal-carrier-list">
            {analytics.shipping.carrier_performance.length > 0 ? analytics.shipping.carrier_performance.slice(0, 4).map((carrier) => {
              const maxShipments = Math.max(...analytics.shipping.carrier_performance.map((item) => item.shipments), 1);
              return (
                <article className="portal-carrier-row" key={carrier.carrier}>
                  <div className="portal-carrier-copy">
                    <strong>{carrier.carrier}</strong>
                    <span>{carrier.shipments} envíos · {formatHours(carrier.avg_delivery_hours)}</span>
                  </div>
                  <div className="portal-carrier-bar">
                    <div className="portal-carrier-bar-fill" style={{ width: `${(carrier.shipments / maxShipments) * 100}%` }} />
                  </div>
                </article>
              );
            }) : (
              <div className="table-secondary">Todavía no hay rendimiento de carrier en este periodo.</div>
            )}
          </div>
        </Card>
      </section>

      <Card className="portal-glass-card">
        <div className="portal-dashboard-section-head">
          <div>
            <span className="eyebrow">Necesita atención</span>
            <h3 className="section-title section-title-small">Pedidos y envíos con fricción</h3>
          </div>
        </div>
        <div className="portal-recent-table-wrap">
          <table className="portal-recent-table">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Motivo</th>
                <th>Prioridad</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {attentionItems.length > 0 ? attentionItems.map((item) => (
                <tr key={item.id}>
                  <td>{item.orderLabel}</td>
                  <td>{item.reason}</td>
                  <td>
                    <span className={`portal-soft-pill ${item.priority === "Alta" ? "portal-soft-pill-alert" : ""}`}>{item.priority}</span>
                  </td>
                  <td><Link className="table-link" href={item.href}>Abrir</Link></td>
                </tr>
              )) : (
                <tr>
                  <td className="table-secondary" colSpan={4}>Nada crítico que revisar ahora mismo.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
