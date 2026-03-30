import Link from "next/link";

import { Card } from "@/components/card";
import { PageHeader } from "@/components/page-header";
import { PortalSyncButton } from "@/components/portal-sync-button";
import { PortalTenantControl } from "@/components/portal-tenant-control";
import { fetchAnalyticsOverview, fetchIncidents, fetchOrders, fetchShopifyIntegrations } from "@/lib/api";
import { fetchMyShops, requirePortalUser } from "@/lib/auth";
import { getLatestTrackingEvent } from "@/lib/client-hub";
import { formatDateTime, sortTrackingEvents } from "@/lib/format";
import { resolveTenantScope } from "@/lib/tenant-scope";
import type { Incident, Order } from "@/lib/types";


type PortalReportingPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type ActivityItem = {
  id: string;
  occurredAt: string;
  label: string;
  title: string;
  detail: string;
};

function readValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatPercent(value: number | null) {
  return value === null ? "n/d" : `${Math.round(value)}%`;
}

function formatHours(value: number | null) {
  return value === null ? "n/d" : `${value.toFixed(value >= 10 ? 0 : 1)}h`;
}

function formatDays(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return "n/d";
  }
  if (value < 1) {
    return `${Math.round(value * 24)}h`;
  }
  return `${value.toFixed(1).replace(".", ",")} d`;
}

function formatNumber(value: number | null) {
  return value === null ? "n/d" : new Intl.NumberFormat("es-ES").format(value);
}

function toDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function getDefaultDateRange() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - 29);
  return {
    from: toDateInputValue(start),
    to: toDateInputValue(end),
  };
}

function getDatePresets() {
  const today = new Date();
  const todayValue = toDateInputValue(today);

  const last7 = new Date(today);
  last7.setDate(today.getDate() - 6);

  const last30 = new Date(today);
  last30.setDate(today.getDate() - 29);

  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const previousMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const previousMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);

  return [
    { id: "today", label: "Hoy", from: todayValue, to: todayValue },
    { id: "last_7d", label: "Ultimos 7 dias", from: toDateInputValue(last7), to: todayValue },
    { id: "last_30d", label: "Ultimos 30 dias", from: toDateInputValue(last30), to: todayValue },
    { id: "this_month", label: "Este mes", from: toDateInputValue(monthStart), to: todayValue },
    { id: "last_month", label: "Mes pasado", from: toDateInputValue(previousMonthStart), to: toDateInputValue(previousMonthEnd) },
  ] as const;
}

function withinRange(value: string, dateFrom: string, dateTo: string) {
  const time = new Date(value).getTime();
  const from = new Date(`${dateFrom}T00:00:00`).getTime();
  const to = new Date(`${dateTo}T23:59:59`).getTime();
  return time >= from && time <= to;
}

function maxValue(items: Array<{ value: number }>) {
  return items.reduce((max, item) => Math.max(max, item.value), 0) || 1;
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

function getShipmentSignal(order: Order) {
  const latestEvent = getLatestTrackingEvent(order);
  const shipmentStatus = latestEvent?.status_norm ?? order.shipment?.shipping_status ?? null;

  if (order.has_open_incident || order.status === "exception" || shipmentStatus === "exception") {
    return "exception";
  }
  if (order.status === "delivered" || shipmentStatus === "delivered") {
    return "delivered";
  }
  if (shipmentStatus === "out_for_delivery") {
    return "out_for_delivery";
  }
  if (shipmentStatus === "in_transit" || shipmentStatus === "pickup_available") {
    return "in_transit";
  }
  if (order.shipment?.tracking_number) {
    return "label_created";
  }
  if (order.shipment) {
    return "without_tracking";
  }
  return "without_shipment";
}

function getDeliveredAt(order: Order) {
  const deliveredEvent = sortTrackingEvents(order.shipment?.events ?? []).find((event) => event.status_norm === "delivered");
  return deliveredEvent?.occurred_at ?? null;
}

function hoursBetween(start?: string | null, end?: string | null) {
  if (!start || !end) {
    return null;
  }
  const diff = new Date(end).getTime() - new Date(start).getTime();
  if (diff < 0) {
    return null;
  }
  return diff / 36e5;
}

function buildActivityFeed(orders: Order[], incidents: Incident[], integration: { id: number; last_synced_at: string | null; last_sync_status: string | null; shop_domain: string } | null) {
  const activities: ActivityItem[] = [];

  if (integration?.last_synced_at) {
    activities.push({
      id: `sync-${integration.id}`,
      occurredAt: integration.last_synced_at,
      label: "Sync",
      title: integration.last_sync_status === "success" ? "Sincronizacion completada" : "Sincronizacion con aviso",
      detail: integration.shop_domain,
    });
  }

  orders.slice(0, 20).forEach((order) => {
    if (order.shipment?.created_at) {
      activities.push({
        id: `shipment-${order.id}`,
        occurredAt: order.shipment.created_at,
        label: "Shipment",
        title: `Expedicion creada para ${order.external_id}`,
        detail: order.shipment.carrier || "Carrier pendiente",
      });
    }

    const latestEvent = getLatestTrackingEvent(order);
    if (latestEvent) {
      activities.push({
        id: `tracking-${order.id}-${latestEvent.id}`,
        occurredAt: latestEvent.occurred_at,
        label: "Tracking",
        title: `${order.external_id} · ${latestEvent.status_norm}`,
        detail: latestEvent.status_raw ?? "Actualizacion automatica del carrier",
      });
    }

    if (order.status === "delivered") {
      activities.push({
        id: `delivered-${order.id}`,
        occurredAt: getDeliveredAt(order) ?? order.created_at,
        label: "Entrega",
        title: `${order.external_id} entregado`,
        detail: order.customer_name,
      });
    }
  });

  incidents.slice(0, 10).forEach((incident) => {
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
    .slice(0, 10);
}

export default async function PortalReportingPage({ searchParams }: PortalReportingPageProps) {
  await requirePortalUser();

  const shops = await fetchMyShops();
  const params = (await searchParams) ?? {};
  const requestedRange = readValue(params.range);
  const presets = getDatePresets();
  const matchedPreset = requestedRange ? presets.find((preset) => preset.id === requestedRange) : null;
  const defaultRange = matchedPreset ?? { id: "last_30d", label: "Ultimos 30 dias", ...getDefaultDateRange() };
  const tenantScope = resolveTenantScope(shops, readValue(params.shop_id));
  const customDateFrom = readValue(params.date_from);
  const customDateTo = readValue(params.date_to);
  const activeRange = matchedPreset ? matchedPreset.id : customDateFrom && customDateTo ? "custom" : defaultRange.id;
  const dateFrom = matchedPreset ? matchedPreset.from : customDateFrom ?? defaultRange.from;
  const dateTo = matchedPreset ? matchedPreset.to : customDateTo ?? defaultRange.to;

  const [analytics, orders, incidents, integrations] = await Promise.all([
    fetchAnalyticsOverview({
      shop_id: tenantScope.selectedShopId,
      date_from: dateFrom,
      date_to: dateTo,
    }),
    fetchOrders(tenantScope.selectedShopId ? { shop_id: tenantScope.selectedShopId, per_page: 500 } : { per_page: 500 }),
    fetchIncidents(tenantScope.selectedShopId ? { shop_id: tenantScope.selectedShopId } : undefined),
    fetchShopifyIntegrations(),
  ]);

  const selectedIntegration =
    (tenantScope.selectedShopId
      ? integrations.find((integration) => String(integration.shop_id) === tenantScope.selectedShopId)
      : integrations[0]) ?? null;

  const rangedOrders = orders.filter((order) => withinRange(order.created_at, dateFrom, dateTo));
  const rangedIncidents = incidents.filter((incident) => withinRange(incident.created_at, dateFrom, dateTo));

  const shipmentSignals = {
    inProduction: rangedOrders.filter((order) => ["in_production", "pending_personalization"].includes(order.production_status)).length,
    pendingShipment: rangedOrders.filter((order) => {
      const signal = getShipmentSignal(order);
      return signal === "without_shipment" || signal === "without_tracking" || signal === "label_created";
    }).length,
    inTransit: rangedOrders.filter((order) => getShipmentSignal(order) === "in_transit").length,
    outForDelivery: rangedOrders.filter((order) => getShipmentSignal(order) === "out_for_delivery").length,
    delivered: rangedOrders.filter((order) => getShipmentSignal(order) === "delivered").length,
    exceptions: rangedOrders.filter((order) => getShipmentSignal(order) === "exception").length,
    withoutTracking: rangedOrders.filter((order) => getShipmentSignal(order) === "without_tracking").length,
    stalled: rangedOrders.filter((order) => {
      if (!order.shipment || order.status === "delivered") {
        return false;
      }
      const latestAt = getLatestTrackingEvent(order)?.occurred_at ?? order.shipment.created_at;
      const age = hoursBetween(latestAt, new Date().toISOString());
      return age !== null && age >= 48;
    }).length,
  };

  const deliveryHours = rangedOrders
    .map((order) => hoursBetween(order.created_at, getDeliveredAt(order)))
    .filter((value): value is number => value !== null);
  const averageOrderToDelivery =
    deliveryHours.length > 0
      ? deliveryHours.reduce((sum, value) => sum + value, 0) / deliveryHours.length
      : null;

  const onTimeDeliveries = deliveryHours.filter((hours) => hours <= 72).length;
  const lateDeliveries = Math.max(deliveryHours.length - onTimeDeliveries, 0);
  const averageTransitHours =
    rangedOrders
      .map((order) => hoursBetween(order.shipment?.created_at ?? null, getDeliveredAt(order)))
      .filter((value): value is number => value !== null)
      .reduce((sum, value, _, array) => sum + value / array.length, 0) || null;

  const personalizedTrend = analytics.charts.orders_by_day.map((point) => ({
    date: point.date,
    personalized: point.personalized,
    standard: point.standard,
  }));
  const personalizedTrendMax = Math.max(
    ...personalizedTrend.map((point) => Math.max(point.personalized, point.standard)),
    1,
  );

  const incidentTypeCounts = analytics.charts.incidents_by_type;
  const orderStatusDistribution = [
    { label: "Pendientes / preparacion", value: shipmentSignals.pendingShipment, tone: "slate" },
    { label: "En transito", value: shipmentSignals.inTransit, tone: "blue" },
    { label: "En reparto", value: shipmentSignals.outForDelivery, tone: "sky" },
    { label: "Entregados", value: shipmentSignals.delivered, tone: "green" },
    { label: "Excepciones", value: shipmentSignals.exceptions, tone: "orange" },
  ].filter((item) => item.value > 0);
  const fulfillmentMix = [
    { label: "Pendientes", value: shipmentSignals.pendingShipment, color: "#94A3B8" },
    { label: "En transito", value: shipmentSignals.inTransit, color: "#2563EB" },
    { label: "En reparto", value: shipmentSignals.outForDelivery, color: "#0EA5E9" },
    { label: "Entregados", value: shipmentSignals.delivered, color: "#22C55E" },
    { label: "Excepciones", value: shipmentSignals.exceptions, color: "#F97316" },
  ].filter((item) => item.value > 0);
  const fulfillmentRadius = 56;
  const fulfillmentCircumference = 2 * Math.PI * fulfillmentRadius;
  const fulfillmentSegments = buildDonutSegments(fulfillmentMix, fulfillmentRadius, fulfillmentCircumference);
  const shipmentTrendPoints = analytics.charts.orders_by_day;
  const sampledShipmentTrend =
    shipmentTrendPoints.length <= 8
      ? shipmentTrendPoints
      : Array.from({ length: 8 }, (_, index) => {
          const pointIndex = Math.round((index * (shipmentTrendPoints.length - 1)) / 7);
          return shipmentTrendPoints[pointIndex];
        }).filter((point, index, array) => index === 0 || point.date !== array[index - 1].date);
  const shipmentTrendMax = maxValue(sampledShipmentTrend.map((point) => ({ value: point.total })));

  const topVariantMap = rangedOrders
    .flatMap((order) =>
      order.items.map((item) => ({
        key: `${item.title ?? item.name}__${item.variant_title ?? "Sin variante"}`,
        label: item.variant_title ?? "Sin variante",
        title: item.title ?? item.name,
        quantity: item.quantity,
      })),
    )
    .reduce<Record<string, { label: string; title: string; quantity: number }>>((accumulator, item) => {
      if (!accumulator[item.key]) {
        accumulator[item.key] = { label: item.label, title: item.title, quantity: 0 };
      }
      accumulator[item.key].quantity += item.quantity;
      return accumulator;
    }, {});

  const topVariants = Object.values(topVariantMap)
    .sort((left, right) => right.quantity - left.quantity)
    .slice(0, 6);

  const topPersonalizedProducts = rangedOrders
    .flatMap((order) => order.items.map((item) => ({ item, isPersonalized: order.is_personalized })))
    .filter((entry) => entry.isPersonalized)
    .reduce<Record<string, { name: string; quantity: number }>>((accumulator, entry) => {
      const key = entry.item.title ?? entry.item.name;
      if (!key) {
        return accumulator;
      }
      if (!accumulator[key]) {
        accumulator[key] = { name: key, quantity: 0 };
      }
      accumulator[key].quantity += entry.item.quantity;
      return accumulator;
    }, {});

  const topPersonalized = Object.values(topPersonalizedProducts)
    .sort((left, right) => right.quantity - left.quantity)
    .slice(0, 6);

  const incidentProducts = rangedIncidents.reduce<Record<string, { title: string; count: number }>>((accumulator, incident) => {
    const relatedOrder = rangedOrders.find((order) => order.id === incident.order.id);
    const title = relatedOrder?.items[0]?.title ?? relatedOrder?.items[0]?.name ?? incident.order.external_id;
    if (!accumulator[title]) {
      accumulator[title] = { title, count: 0 };
    }
    accumulator[title].count += 1;
    return accumulator;
  }, {});

  const topIncidentProducts = Object.values(incidentProducts)
    .sort((left, right) => right.count - left.count)
    .slice(0, 6);

  const feed = buildActivityFeed(rangedOrders, rangedIncidents, selectedIntegration);
  const needsAttention = [
    ...analytics.rankings.delayed_orders.slice(0, 4).map((order) => ({
      id: `delayed-${order.order_id}`,
      label: order.external_id,
      reason: order.reason,
      priority: order.age_hours >= 48 ? "Alta" : "Media",
      updatedAt: `${Math.round(order.age_hours)}h abiertas`,
      href: `/portal/orders/${order.order_id}?shop_id=${tenantScope.selectedShopId}`,
    })),
    ...rangedIncidents.slice(0, 4).map((incident) => ({
      id: `incident-${incident.id}`,
      label: incident.order.external_id,
      reason: incident.title,
      priority: incident.priority === "urgent" ? "Alta" : incident.priority === "high" ? "Alta" : "Media",
      updatedAt: formatDateTime(incident.updated_at),
      href: `/portal/returns?shop_id=${tenantScope.selectedShopId}`,
    })),
  ].slice(0, 8);

  const shopQuery = tenantScope.selectedShopId ? `?shop_id=${tenantScope.selectedShopId}` : "";
  const baseQuery = tenantScope.selectedShopId ? `shop_id=${tenantScope.selectedShopId}&` : "";
  const dateQuery = activeRange === "custom"
    ? `${baseQuery}range=custom&date_from=${dateFrom}&date_to=${dateTo}`
    : `${baseQuery}range=${activeRange}`;
  const primaryKpis = [
    { label: "Pedidos totales", value: analytics.kpis.total_orders, meta: `${analytics.kpis.orders_today} hoy` },
    { label: "Entregados", value: analytics.kpis.delivered_orders, meta: `${shipmentSignals.delivered} cierres` },
    { label: "Incidencias abiertas", value: analytics.kpis.open_incidents, meta: `${shipmentSignals.exceptions} excepciones logisticas` },
    { label: "% entregado a tiempo", value: formatPercent(analytics.operational.delivered_in_sla_rate), meta: "dentro de SLA" },
  ];
  const secondaryKpis = [
    { label: "Personalizados", value: analytics.kpis.personalized_orders, meta: `${formatPercent(analytics.personalization.personalized_share)} del mix` },
    { label: "Estandar", value: analytics.kpis.standard_orders, meta: `${formatPercent(analytics.personalization.standard_share)} del mix` },
    { label: "Enviados", value: analytics.kpis.shipped_orders, meta: `${shipmentSignals.inTransit} en transito` },
    { label: "Pedido -> entrega", value: formatHours(averageOrderToDelivery), meta: formatDays(averageOrderToDelivery !== null ? averageOrderToDelivery / 24 : null) },
  ];

  return (
    <div className="stack portal-reporting-page">
      <PageHeader
        eyebrow="Reporting"
        title="Control y rendimiento de tu operativa"
        description="Una lectura ejecutiva de pedidos, envíos y riesgo en una sola vista."
        actions={
          <div className="analytics-header-meta">
            <span className="analytics-generated">
              Ultima sync {selectedIntegration?.last_synced_at ? formatDateTime(selectedIntegration.last_synced_at) : "sin sincronizar"}
            </span>
          </div>
        }
      />

      <Card className="portal-glass-card portal-reporting-hero">
        <div className="portal-reporting-hero-top">
          <div className="portal-reporting-hero-copy">
            <span className="eyebrow">Visibilidad logistica</span>
            <h3 className="section-title section-title-small">Estado del negocio en un vistazo</h3>
            <p className="subtitle">Resumen rápido para entender volumen, cumplimiento y señales de riesgo.</p>
          </div>

          <div className="portal-reporting-hero-actions">
            <Link className="button button-secondary" href={`/portal/reporting?${dateQuery}`}>
              Actualizar
            </Link>
            <button className="button button-secondary" type="button">
              Exportar
            </button>
            {tenantScope.selectedShopId ? <PortalSyncButton shopId={Number(tenantScope.selectedShopId)} /> : null}
          </div>
        </div>

        <div className="portal-reporting-controls">
          <PortalTenantControl
            action="/portal/reporting"
            hiddenFields={{ range: activeRange, date_from: dateFrom, date_to: dateTo }}
            selectedShopId={tenantScope.selectedShopId}
            shops={tenantScope.shops}
            submitLabel="Ver"
            title="Tienda visible"
            description="Reporting filtrado automaticamente a la tienda o tiendas que tienes asignadas."
          />
        </div>

        <div className="portal-reporting-range-block">
          <div className="portal-reporting-range-head">
            <div>
              <span className="eyebrow">Rango</span>
              <h3 className="section-title section-title-small">Seleccion de fechas</h3>
            </div>
            <span className="table-secondary">Se aplica a toda la vista.</span>
          </div>

          <div className="operations-chip-row">
            {presets.map((preset) => (
              <Link
                className={`operations-chip ${activeRange === preset.id ? "operations-chip-active" : ""}`}
                href={`/portal/reporting?${tenantScope.selectedShopId ? `shop_id=${tenantScope.selectedShopId}&` : ""}range=${preset.id}`}
                key={preset.id}
              >
                {preset.label}
              </Link>
            ))}
            <Link
              className={`operations-chip ${activeRange === "custom" ? "operations-chip-active" : ""}`}
              href={`/portal/reporting?${tenantScope.selectedShopId ? `shop_id=${tenantScope.selectedShopId}&` : ""}range=custom&date_from=${dateFrom}&date_to=${dateTo}`}
            >
              Personalizado
            </Link>
          </div>

          {activeRange === "custom" ? (
            <form action="/portal/reporting" className="portal-reporting-range-form" method="get">
              {tenantScope.selectedShopId ? <input name="shop_id" type="hidden" value={tenantScope.selectedShopId} /> : null}
              <input name="range" type="hidden" value="custom" />
              <div className="portal-analytics-date-field">
                <label className="portal-analytics-date-label" htmlFor="portal-reporting-date-from">
                  Desde
                </label>
                <input
                  className="portal-inline-select"
                  defaultValue={dateFrom}
                  id="portal-reporting-date-from"
                  name="date_from"
                  type="date"
                />
              </div>
              <div className="portal-analytics-date-field">
                <label className="portal-analytics-date-label" htmlFor="portal-reporting-date-to">
                  Hasta
                </label>
                <input
                  className="portal-inline-select"
                  defaultValue={dateTo}
                  id="portal-reporting-date-to"
                  name="date_to"
                  type="date"
                />
              </div>
              <button className="button button-secondary" type="submit">
                Aplicar rango
              </button>
            </form>
          ) : null}
        </div>

        <section className="portal-reporting-summary">
          <div className="portal-reporting-summary-head">
            <div>
              <span className="eyebrow">Resumen ejecutivo</span>
              <h3 className="section-title section-title-small">Los datos que importan primero</h3>
            </div>
            <p className="subtitle">Lectura rápida del periodo activo.</p>
          </div>

          <div className="portal-reporting-kpi-grid is-primary">
            {primaryKpis.map((item) => (
              <article className="portal-reporting-kpi is-primary" key={item.label}>
                <span className="portal-analytics-highlight-label">{item.label}</span>
                <strong className="portal-analytics-highlight-value">{typeof item.value === "number" ? formatNumber(item.value) : item.value}</strong>
                <span className="portal-analytics-highlight-meta">{item.meta}</span>
              </article>
            ))}
          </div>

          <div className="portal-reporting-kpi-grid">
            {secondaryKpis.map((item) => (
              <article className="portal-reporting-kpi" key={item.label}>
                <span className="portal-analytics-highlight-label">{item.label}</span>
                <strong className="portal-analytics-highlight-value">{typeof item.value === "number" ? formatNumber(item.value) : item.value}</strong>
                <span className="portal-analytics-highlight-meta">{item.meta}</span>
              </article>
            ))}
          </div>
        </section>
      </Card>

      <section className="portal-reporting-block">
        <div className="portal-reporting-block-head">
          <div>
            <span className="eyebrow">Fulfillment / envios</span>
            <h3 className="section-title section-title-small">Seguimiento del flujo logistico</h3>
          </div>
          <p className="subtitle">Estado, tránsito y entregas.</p>
        </div>
        <Card className="portal-glass-card stack portal-reporting-shipment-card">
          <div className="section-header-inline">
            <div>
              <h3 className="section-title section-title-small">Estado de expediciones</h3>
              <p className="subtitle">Foto rápida del estado actual.</p>
            </div>
          </div>

          <div className="portal-reporting-shipment-top">
            <div className="portal-reporting-shipment-main">
              <div className="portal-reporting-state-grid portal-reporting-state-grid-compact">
                {[
                  { label: "Pendientes", value: shipmentSignals.pendingShipment },
                  { label: "En transito", value: shipmentSignals.inTransit },
                  { label: "Entregados", value: shipmentSignals.delivered },
                  { label: "Excepciones", value: shipmentSignals.exceptions },
                ].map((item) => (
                  <div className="portal-reporting-state-tile" key={item.label}>
                    <span className="portal-analytics-stat-label">{item.label}</span>
                    <strong className="portal-analytics-stat-value">{formatNumber(item.value)}</strong>
                  </div>
                ))}
              </div>

              <div className="portal-analytics-status-legend">
                {fulfillmentMix.map((item) => (
                  <div className="portal-analytics-status-row" key={item.label}>
                    <span className="portal-analytics-status-dot" style={{ background: item.color }} />
                    <span className="portal-analytics-status-label">{item.label}</span>
                    <span className="portal-analytics-status-value">{formatNumber(item.value)}</span>
                  </div>
                ))}
                <div className="portal-analytics-status-row">
                  <span className="portal-analytics-status-dot" style={{ background: "#CBD5E1" }} />
                  <span className="portal-analytics-status-label">Sin tracking</span>
                  <span className="portal-analytics-status-value">{formatNumber(shipmentSignals.withoutTracking)}</span>
                </div>
                <div className="portal-analytics-status-row">
                  <span className="portal-analytics-status-dot" style={{ background: "#FDBA74" }} />
                  <span className="portal-analytics-status-label">Atascados</span>
                  <span className="portal-analytics-status-value">{formatNumber(shipmentSignals.stalled)}</span>
                </div>
              </div>
            </div>

            <div className="portal-reporting-shipment-visual">
              <div className="portal-analytics-donut-wrap">
              <svg aria-hidden="true" className="portal-analytics-donut" viewBox="0 0 160 160">
                <circle className="portal-analytics-donut-track" cx="80" cy="80" r={fulfillmentRadius} />
                {fulfillmentSegments.map((segment) => (
                  <circle
                    className="portal-analytics-donut-segment"
                    cx="80"
                    cy="80"
                    key={`${segment.label}-${segment.value}`}
                    r={segment.radius}
                    stroke={segment.color}
                    strokeDasharray={`${segment.dash} ${fulfillmentCircumference - segment.dash}`}
                    strokeDashoffset={-segment.offset}
                  />
                ))}
              </svg>
              <div className="portal-analytics-donut-center">
                <strong>{formatNumber(rangedOrders.length)}</strong>
                <span>pedidos</span>
              </div>
            </div>
              <div className="portal-reporting-inline-metric">
                <span>Tiempo medio</span>
                <strong>{formatHours(averageTransitHours)}</strong>
              </div>
              <div className="portal-reporting-inline-metric">
                <span>Atascados</span>
                <strong>{formatNumber(shipmentSignals.stalled)}</strong>
              </div>
            </div>
          </div>

          <div className="portal-reporting-chart-grid portal-reporting-chart-grid-tight">
            <div className="bar-chart">
              {orderStatusDistribution.length > 0 ? orderStatusDistribution.map((item) => (
                <div className="bar-chart-row" key={item.label}>
                  <div className="bar-chart-label">{item.label}</div>
                  <div className="bar-chart-track portal-chart-track">
                    <div className={`bar-chart-fill portal-chart-fill-${item.tone}`} style={{ width: `${(item.value / maxValue(orderStatusDistribution)) * 100}%` }} />
                  </div>
                  <div className="bar-chart-value">{item.value}</div>
                </div>
              )) : <div className="table-secondary">Sin envios suficientes en el rango seleccionado.</div>}
            </div>

            <div className="portal-reporting-trend-card">
              <div className="portal-reporting-trend-card-head">
                <span className="table-primary">Actividad por dias clave</span>
                <span className="table-secondary">Muestra resumida del periodo</span>
              </div>
              {sampledShipmentTrend.length > 0 ? (
                <div className="portal-mini-bars">
                  {sampledShipmentTrend.map((point) => (
                    <div className="portal-mini-bar-column" key={point.date}>
                      <div className="portal-mini-bar-wrap">
                        <div className="portal-mini-bar" style={{ height: `${Math.max(18, (point.total / shipmentTrendMax) * 100)}%` }} />
                      </div>
                      <strong>{point.total}</strong>
                      <span className="table-secondary">{point.date.slice(5)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="table-secondary">Sin datos por dias todavia.</div>
              )}
            </div>
          </div>
        </Card>
      </section>

      <section className="portal-reporting-block">
        <div className="portal-reporting-block-head">
          <div>
            <span className="eyebrow">Incidencias y riesgo</span>
            <h3 className="section-title section-title-small">Señales que requieren atencion</h3>
          </div>
          <p className="subtitle">Riesgo y casos activos.</p>
        </div>
        <div className="portal-reporting-section-grid">
        <Card className="portal-glass-card stack">
          <div className="section-header-inline">
            <div>
              <h3 className="section-title section-title-small">Riesgo operativo</h3>
              <p className="subtitle">Bloqueos, tracking parado y excepciones.</p>
            </div>
          </div>

          <div className="portal-reporting-risk-grid">
            {[
              { label: "Incidencias abiertas", value: analytics.kpis.open_incidents },
              { label: "Pedidos bloqueados", value: analytics.operational.blocked_orders },
              { label: "Envios con excepcion", value: analytics.shipping.exception_orders },
              { label: "Pedidos sin shipment", value: analytics.operational.orders_without_shipment },
              { label: "Tracking sin actualizar", value: analytics.operational.stalled_tracking_orders },
            ].map((item) => (
              <div className="portal-reporting-risk-tile" key={item.label}>
                <span className="portal-analytics-stat-label">{item.label}</span>
                <strong className="portal-analytics-stat-value">{formatNumber(item.value)}</strong>
              </div>
            ))}
          </div>

          <div className="portal-reporting-risk-layout">
            <div className="bar-chart">
              {incidentTypeCounts.length > 0 ? incidentTypeCounts.map((item) => (
                <div className="bar-chart-row" key={item.label}>
                  <div className="bar-chart-label">{item.label}</div>
                  <div className="bar-chart-track portal-chart-track">
                    <div className="bar-chart-fill bar-chart-fill-danger" style={{ width: `${item.percentage ?? 0}%` }} />
                  </div>
                  <div className="bar-chart-value">{item.value}</div>
                </div>
              )) : <div className="table-secondary">Sin incidencias suficientes para clasificar por tipo.</div>}
            </div>

            <div className="mini-table portal-reporting-attention-table">
              <div className="table-primary">Necesita atencion</div>
            {needsAttention.length > 0 ? needsAttention.map((item) => (
              <Link className="mini-table-row mini-table-row-link" href={item.href} key={item.id}>
                <div>
                  <div className="table-primary">{item.label}</div>
                  <div className="table-secondary">{item.reason}</div>
                </div>
                <div className="mini-table-metrics">
                  <span>{item.priority}</span>
                  <span>{item.updatedAt}</span>
                </div>
              </Link>
            )) : <div className="table-secondary">No hay pedidos que requieran atencion inmediata ahora mismo.</div>}
            </div>
          </div>
        </Card>

        <Card className="portal-glass-card stack">
          <div className="section-header-inline">
            <div>
              <h3 className="section-title section-title-small">Productos</h3>
              <p className="subtitle">Ranking limpio por SKU, variantes, personalizados e incidencias.</p>
            </div>
          </div>

          <div className="portal-reporting-product-grid">
            <div className="mini-table">
              <div className="table-primary">Top SKUs</div>
              {analytics.rankings.top_skus.slice(0, 5).map((item) => (
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

            <div className="mini-table">
              <div className="table-primary">Top variantes</div>
              {topVariants.length > 0 ? topVariants.map((item) => (
                <div className="mini-table-row" key={`${item.title}-${item.label}`}>
                  <div>
                    <div className="table-primary">{item.label}</div>
                    <div className="table-secondary">{item.title}</div>
                  </div>
                  <div className="mini-table-metrics">
                    <span>{item.quantity} uds</span>
                  </div>
                </div>
              )) : <div className="table-secondary">Sin variantes suficientes en este rango.</div>}
            </div>

            <div className="mini-table">
              <div className="table-primary">Personalizados top</div>
              {topPersonalized.length > 0 ? topPersonalized.map((item) => (
                <div className="mini-table-row" key={item.name}>
                  <div className="table-primary">{item.name}</div>
                  <div className="mini-table-metrics">
                    <span>{item.quantity} uds</span>
                  </div>
                </div>
              )) : <div className="table-secondary">Sin suficiente volumen personalizado.</div>}
            </div>

            <div className="mini-table">
              <div className="table-primary">Productos con mas incidencias</div>
              {topIncidentProducts.length > 0 ? topIncidentProducts.map((item) => (
                <div className="mini-table-row" key={item.title}>
                  <div className="table-primary">{item.title}</div>
                  <div className="mini-table-metrics">
                    <span>{item.count} casos</span>
                  </div>
                </div>
              )) : <div className="table-secondary">No hay suficiente historial de incidencias por producto.</div>}
            </div>
          </div>
        </Card>
        </div>
      </section>

      <section className="portal-reporting-block">
        <div className="portal-reporting-block-head">
          <div>
            <span className="eyebrow">SLA y actividad</span>
            <h3 className="section-title section-title-small">Rendimiento reciente y contexto operativo</h3>
          </div>
          <p className="subtitle">Tiempos y últimas novedades.</p>
        </div>
        <div className="portal-reporting-section-grid">
        <Card className="portal-glass-card stack">
          <div className="section-header-inline">
            <div>
              <h3 className="section-title section-title-small">Tiempos operativos</h3>
              <p className="subtitle">Secuencia completa del pedido.</p>
            </div>
          </div>

          <div className="portal-performance-grid">
            <div className="portal-performance-item">
              <span>Pedido a produccion</span>
              <strong>{formatHours(analytics.operational.avg_order_to_production_hours)}</strong>
            </div>
            <div className="portal-performance-item">
              <span>Produccion a envio</span>
              <strong>{formatHours(analytics.operational.avg_production_to_shipping_hours)}</strong>
            </div>
            <div className="portal-performance-item">
              <span>Envio a entrega</span>
              <strong>{formatHours(analytics.operational.avg_shipping_to_delivery_hours)}</strong>
            </div>
          </div>

          <div className="portal-performance-foot">
            <div>
              <span>% dentro de SLA</span>
              <strong>{formatPercent(analytics.operational.delivered_in_sla_rate)}</strong>
            </div>
            <div>
              <span>% fuera de SLA</span>
              <strong>{deliveryHours.length > 0 ? `${Math.round((lateDeliveries / deliveryHours.length) * 100)}%` : "n/d"}</strong>
            </div>
            <div>
              <span>Pedidos en riesgo</span>
              <strong>{analytics.rankings.delayed_orders.length}</strong>
            </div>
            <div>
              <span>Tasa de incidencias</span>
              <strong>{formatPercent(analytics.operational.incident_rate)}</strong>
            </div>
          </div>
        </Card>

        <Card className="portal-glass-card stack">
          <div className="section-header-inline">
            <div>
              <h3 className="section-title section-title-small">Lo ultimo que ha pasado</h3>
              <p className="subtitle">Eventos recientes.</p>
            </div>
          </div>
          <div className="portal-activity-timeline">
            {feed.length > 0 ? feed.map((item) => (
              <div className="portal-activity-row" key={item.id}>
                <span className="portal-activity-dot" />
                <div className="portal-activity-copy">
                  <div className="portal-activity-head">
                    <strong>{item.title}</strong>
                    <span className="table-secondary">{formatDateTime(item.occurredAt)}</span>
                  </div>
                  <div className="table-secondary">{item.label} · {item.detail}</div>
                </div>
              </div>
            )) : <div className="table-secondary">Sin actividad reciente visible en este rango.</div>}
          </div>
        </Card>
        </div>
      </section>

      <Card className="portal-glass-card stack">
        <div className="section-header-inline">
          <div>
            <span className="eyebrow">Acciones</span>
            <h3 className="section-title section-title-small">Siguientes pasos</h3>
          </div>
        </div>
        <div className="portal-dashboard-action-grid">
          <Link className="button button-secondary" href={`/portal/orders${shopQuery}`}>Ver pedidos</Link>
          <Link className="button button-secondary" href={`/portal/shipments${shopQuery}`}>Ver envios</Link>
          <button className="button button-secondary" type="button">Descargar reporte</button>
          {tenantScope.selectedShopId ? <PortalSyncButton shopId={Number(tenantScope.selectedShopId)} /> : <span className="table-secondary">Sin tienda seleccionada para sincronizar.</span>}
          <Link className="button button-secondary" href={`/portal/returns${shopQuery}`}>Abrir incidencias</Link>
          <Link className="button button-secondary" href={`/portal/help${shopQuery}`}>Contactar soporte</Link>
        </div>
      </Card>
    </div>
  );
}
