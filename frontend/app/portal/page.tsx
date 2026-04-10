import Link from "next/link";

import { EmployeePortalWorkspace } from "@/components/employee-portal-workspace";
import { PortalSyncButton } from "@/components/portal-sync-button";
import { PortalTenantControl } from "@/components/portal-tenant-control";
import { SharedDashboardView } from "@/components/shared-dashboard-view";
import type { ShipmentSegment } from "@/components/shipment-donut";
import { fetchAnalyticsOverview, fetchEmployeeWorkspace, fetchIncidents, fetchOrders, fetchShopifyIntegrations } from "@/lib/api";
import { fetchMyShops, requirePortalUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { getTenantBranding } from "@/lib/tenant-branding";
import { resolveTenantScope } from "@/lib/tenant-scope";
import type { AnalyticsOverview, Order } from "@/lib/types";

type PortalPageProps = {
  searchParams: Promise<{
    shop_id?: string;
    range?: string;
  }>;
};

type RangePreset = "today" | "7d" | "30d" | "90d";
const INCIDENTS_SYNC_PERIOD_DAYS = 14;

function resolveRangePreset(value?: string): RangePreset {
  if (value === "today" || value === "30d" || value === "90d") return value;
  return "7d";
}

function getRangeDays(range: RangePreset) {
  switch (range) {
    case "today":
      return 1;
    case "30d":
      return 30;
    case "90d":
      return 90;
    default:
      return 7;
  }
}

function isWithinLastDays(value: string, days: number) {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setDate(end.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);
  const time = new Date(value).getTime();
  return time >= start.getTime() && time <= end.getTime();
}

function buildTimeFilters(range: RangePreset, shopId?: string) {
  const filters: Array<{ label: string; value: RangePreset }> = [
    { label: "Hoy", value: "today" },
    { label: "7 días", value: "7d" },
    { label: "30 días", value: "30d" },
    { label: "90 días", value: "90d" },
  ];

  return filters.map((filter) => {
    const searchParams = new URLSearchParams();
    searchParams.set("range", filter.value);
    if (shopId) searchParams.set("shop_id", shopId);
    return {
      label: filter.label,
      href: `/portal?${searchParams.toString()}`,
      active: filter.value === range,
    };
  });
}

function buildDonutSegments(orders: Order[]): ShipmentSegment[] {
  const withShipment = orders.filter((o) => o.shipment);
  const getKey = (o: Order) => {
    const s = o.shipment;
    if (!s) return null;
    const raw = s.shipping_status ?? null;
    if (o.has_open_incident || raw === "exception") return "exception";
    if (raw === "delivered" || o.status === "delivered") return "delivered";
    if (raw === "out_for_delivery") return "out_for_delivery";
    if (raw === "in_transit") return "in_transit";
    if (raw === "pickup_available") return "pickup_available";
    return "label_created";
  };
  const countKey = (key: string) => withShipment.filter((o) => getKey(o) === key).length;
  const segments: ShipmentSegment[] = [
    { key: "label_created", label: "🏷️ Etiqueta creada", value: countKey("label_created"), tone: "indigo" },
    { key: "in_transit", label: "🚚 En tránsito", value: countKey("in_transit"), tone: "blue" },
    { key: "out_for_delivery", label: "🚛 En reparto", value: countKey("out_for_delivery"), tone: "sky" },
    { key: "pickup_available", label: "📍 Disponible recogida", value: countKey("pickup_available"), tone: "orange" },
    { key: "delivered", label: "✅ Entregado", value: countKey("delivered"), tone: "green" },
    { key: "exception", label: "🚨 Incidencia", value: countKey("exception"), tone: "red" },
  ];
  const noShipment = orders.length - withShipment.length;
  if (noShipment > 0) {
    segments.unshift({ key: "without_shipment", label: "❌ Sin shipment", value: noShipment, tone: "slate" });
  }
  return segments.filter((s) => s.value > 0);
}

function buildDonutSegmentsFromAnalytics(analytics: AnalyticsOverview): ShipmentSegment[] {
  const toneByLabel: Record<string, ShipmentSegment["tone"]> = {
    pending: "slate",
    prepared: "indigo",
    picked_up: "blue",
    in_transit: "sky",
    out_for_delivery: "orange",
    delivered: "green",
    exception: "red",
    stalled: "slate",
  };
  const labelByKey: Record<string, string> = {
    pending: "❌ Sin shipment",
    prepared: "🏷️ Etiqueta creada",
    picked_up: "🚚 Recogido",
    in_transit: "🚚 En tránsito",
    out_for_delivery: "🚛 En reparto",
    delivered: "✅ Entregado",
    exception: "🚨 Incidencia",
    stalled: "💤 Atascado",
  };

  return (analytics.shipping_status_distribution ?? [])
    .filter((item) => item.value > 0)
    .map((item) => ({
      key: item.label,
      label: labelByKey[item.label] ?? `📦 ${item.label.replace(/_/g, " ")}`,
      value: item.value,
      tone: toneByLabel[item.label] ?? "slate",
    }));
}

function buildChart(orders: Awaited<ReturnType<typeof fetchOrders>>["orders"], days: number) {
  const today = new Date();
  const visibleDays = Math.min(days, 7);
  const points = Array.from({ length: visibleDays }).map((_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - ((visibleDays - 1) - index));
    const dayKey = date.toISOString().slice(0, 10);

    return {
      dayKey,
      day: date.toLocaleDateString("es-ES", { weekday: "short" }),
      value: orders.filter((order) => order.created_at.slice(0, 10) === dayKey).length,
    };
  });

  return points;
}

function resolveRangeDates(days: number) {
  const to = new Date();
  const from = new Date(to);
  from.setDate(to.getDate() - (days - 1));
  return {
    dateFrom: from.toISOString().slice(0, 10),
    dateTo: to.toISOString().slice(0, 10),
  };
}

function buildChartFromAnalytics(analytics: AnalyticsOverview, days: number) {
  const visibleDays = Math.min(days, 7);
  const rows = (analytics.charts.orders_by_day ?? []).slice(-visibleDays);
  return rows.map((point) => {
    const date = new Date(`${point.date}T12:00:00`);
    return {
      dayKey: point.date,
      day: date.toLocaleDateString("es-ES", { weekday: "short" }),
      value: point.total,
    };
  });
}

export default async function PortalPage({ searchParams }: PortalPageProps) {
  const [userResult, shopsResult] = await Promise.allSettled([requirePortalUser(), fetchMyShops()]);
  if (userResult.status === "rejected") throw userResult.reason;
  const currentUser = userResult.value;
  const shops = shopsResult.status === "fulfilled" ? shopsResult.value : [];
  const params = await searchParams;
  const range = resolveRangePreset(params.range);
  const rangeDays = getRangeDays(range);
  const { dateFrom, dateTo } = resolveRangeDates(rangeDays);
  const tenantScope = resolveTenantScope(shops, params.shop_id);
  const branding = getTenantBranding(tenantScope.selectedShop ?? shops[0]);

  const [ordersResultSettled, incidentsResult, integrationsResult, workspaceResult, analyticsResult] = await Promise.allSettled([
    fetchOrders(
      tenantScope.selectedShopId ? { shop_id: tenantScope.selectedShopId, page: 1, per_page: 30 } : { page: 1, per_page: 30 },
      { cacheSeconds: 30 },
    ),
    fetchIncidents({
      status: "open",
      ...(tenantScope.selectedShopId ? { shop_id: tenantScope.selectedShopId } : {}),
      recent_days: INCIDENTS_SYNC_PERIOD_DAYS,
      include_historical: false,
    }),
    fetchShopifyIntegrations(),
    fetchEmployeeWorkspace(),
    fetchAnalyticsOverview({
      ...(tenantScope.selectedShopId ? { shop_id: tenantScope.selectedShopId } : {}),
      date_from: dateFrom,
      date_to: dateTo,
    }),
  ]);

  const ordersResult =
    ordersResultSettled.status === "fulfilled"
      ? ordersResultSettled.value
      : { orders: [], totalCount: 0 };
  const incidents = incidentsResult.status === "fulfilled" ? incidentsResult.value : [];
  const integrations = integrationsResult.status === "fulfilled" ? integrationsResult.value : [];
  const workspace = workspaceResult.status === "fulfilled" ? workspaceResult.value : null;
  const analytics = analyticsResult.status === "fulfilled" ? analyticsResult.value : null;
  const hasPartialDataError =
    ordersResultSettled.status === "rejected" ||
    incidentsResult.status === "rejected" ||
    integrationsResult.status === "rejected" ||
    workspaceResult.status === "rejected" ||
    analyticsResult.status === "rejected";

  const orders = ordersResult.orders.filter((order) => isWithinLastDays(order.created_at, rangeDays));
  const openIncidentsList = incidents;
  const chart = analytics ? buildChartFromAnalytics(analytics, rangeDays) : buildChart(orders, rangeDays);
  const donutSegments = analytics ? buildDonutSegmentsFromAnalytics(analytics) : buildDonutSegments(orders);
  const timeFilters = buildTimeFilters(range, tenantScope.selectedShopId);
  const activeIntegration = tenantScope.selectedShopId
    ? integrations.find((integration) => String(integration.shop_id) === tenantScope.selectedShopId) ?? null
    : integrations[0] ?? null;
  const shopQuery = tenantScope.selectedShopId ? `?shop_id=${tenantScope.selectedShopId}` : "";
  const incidentsLinkParams = new URLSearchParams({
    view: "incidents",
    incident_status: "open",
    incident_period: "14d",
  });
  if (tenantScope.selectedShopId) {
    incidentsLinkParams.set("shop_id", tenantScope.selectedShopId);
  }
  const incidentsLinkHref = `/portal/operations?${incidentsLinkParams.toString()}`;
  const pendingOrders = analytics ? (analytics.shipping.pending_orders ?? 0) : orders.filter((order) => order.status === "pending").length;
  const inProductionOrders = analytics ? analytics.kpis.in_production_orders : orders.filter((order) => order.production_status === "in_production").length;
  const shippedOrders = analytics ? analytics.kpis.shipped_orders : orders.filter((order) => order.status === "shipped").length;
  const deliveredOrders = analytics ? analytics.kpis.delivered_orders : orders.filter((order) => order.status === "delivered").length;
  const withShipment = analytics ? Math.max(analytics.kpis.total_orders - analytics.operational.orders_without_shipment, 0) : orders.filter((order) => order.shipment).length;
  const openIncidents = analytics ? analytics.kpis.open_incidents : openIncidentsList.length;
  const urgentIncidents = openIncidentsList.filter((incident) => incident.priority === "urgent" || incident.priority === "high").length;

  return (
    <div className="stack">
      {hasPartialDataError ? (
        <div className="feedback feedback-info">
          Parte de los datos no se pudieron cargar. Mostramos la información disponible para seguir operando.
        </div>
      ) : null}
      <SharedDashboardView
      chart={chart}
      chartLinkHref={`/portal/orders${shopQuery}`}
      chartLinkLabel="Ir a pedidos"
      donutSegments={donutSegments}
      timeFilters={timeFilters}
      eyebrow="Operativa viva"
      healthItems={[
        { label: "⏳ Pendientes", value: pendingOrders, hint: "esperando revisión" },
        { label: "🔧 En producción", value: inProductionOrders, hint: "flujo activo" },
        { label: "📦 Con envío", value: withShipment, hint: "ya etiquetados" },
        { label: "✅ Entregados", value: deliveredOrders, hint: "cerrados correctamente" },
      ]}
      healthTitle="Estado de la cuenta"
      heroAction={
        <div className="admin-dashboard-note-actions">
          <Link className="button" href={`/portal/orders${shopQuery}`}>
            Ver pedidos
          </Link>
          <Link className="button button-secondary" href={`/portal/shipments${shopQuery}`}>
            Ver expediciones
          </Link>
          {tenantScope.selectedShop && activeIntegration ? <PortalSyncButton shopId={tenantScope.selectedShop.id} /> : null}
        </div>
      }
      incidents={openIncidentsList.map((incident) => ({
        id: incident.id,
        title: incident.title,
        priority: incident.priority,
        secondary: `${incident.order.external_id} · ${incident.order.customer_name}`,
        status: incident.status,
        updatedAt: formatDateTime(incident.updated_at),
      }))}
      incidentsEmptyMessage="No hay incidencias abiertas en tu cuenta ahora mismo."
      incidentsLinkHref={incidentsLinkHref}
      incidentsLinkLabel="Ver incidencias"
      incidentsTitle="Incidencias recientes"
      kpis={[
        { label: "📦 Pedidos entrantes", value: String(analytics?.kpis.total_orders ?? orders.length), delta: `${pendingOrders} pendientes`, tone: "accent" },
        { label: "⚠️ Incidencias abiertas", value: String(openIncidents), delta: `${urgentIncidents} prioritarias`, tone: "danger" },
        { label: "🚚 Enviados", value: String(shippedOrders), delta: `${withShipment} con tracking`, tone: "default" },
        { label: "🏪 Tiendas activas", value: String(tenantScope.shops.length), delta: tenantScope.shops.length > 1 ? "alcance de tu cuenta" : "cuenta actual", tone: "success" },
      ]}
      noteActions={
        <>
          <Link className="button button-secondary" href={`/portal/shipments${shopQuery}`}>
            Ver expediciones
          </Link>
          <Link className="button button-secondary" href={`/portal/orders${shopQuery}`}>
            Ver pedidos
          </Link>
        </>
      }
      noteBody="Usa este panel como centro de control de tu cuenta: revisa pedidos nuevos, detecta bloqueos antes del packing y entra rápido a expediciones cuando necesites validar tracking y salidas."
      noteTitle="Empuja la operativa"
      recentOrders={orders.slice(0, 6).map((order) => ({
        id: order.id,
        label: order.external_id,
        secondary: `${order.customer_name} · ${order.customer_email}`,
        status: order.status,
        time: formatDateTime(order.created_at),
      }))}
      recentOrdersLinkHref={`/portal/orders${shopQuery}`}
      recentOrdersLinkLabel="Ver todos"
      recentOrdersTitle="Últimos pedidos"
      subtitle="Misma base visual que admin, pero afinada para que tu jornada arranque con foco, contexto y atajos útiles."
      title={`Centro de control · ${branding.displayName}`}
      topContent={
        <>
          <PortalTenantControl
            action="/portal"
            hiddenFields={{ range }}
            selectedShopId={tenantScope.selectedShopId}
            shops={tenantScope.shops}
            submitLabel="Cambiar"
            title="Espacio activo"
            description="Trabaja siempre sobre la tienda visible y entra directo a lo que toca mover hoy."
            trailingActions={
              activeIntegration?.last_synced_at ? (
                <span className="portal-soft-pill">Sync {formatDateTime(activeIntegration.last_synced_at)}</span>
              ) : null
            }
          />
          {workspace ? (
            <EmployeePortalWorkspace
              selectedShopId={tenantScope.selectedShopId}
              user={currentUser}
              workspace={workspace}
            />
          ) : null}
        </>
      }
      />
    </div>
  );
}
