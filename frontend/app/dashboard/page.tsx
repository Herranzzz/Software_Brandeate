import { DashboardEmployeeMetrics } from "@/components/dashboard-employee-metrics";
import Link from "next/link";
import { SlaAlertsBanner } from "@/components/sla-alerts-banner";

import { SharedDashboardView } from "@/components/shared-dashboard-view";
import type { ShipmentSegment } from "@/components/shipment-donut";
import { fetchAnalyticsOverview, fetchEmployeeAnalytics, fetchIncidents, fetchOrders, fetchShops } from "@/lib/api";
import { requireAdminUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import type { AnalyticsOverview, EmployeeMetricsPeriod, Order } from "@/lib/types";

type DashboardPageProps = {
  searchParams: Promise<{
    employee_period?: string;
    shop_id?: string;
    range?: string;
  }>;
};

type RangePreset = "today" | "7d" | "30d" | "90d";
const INCIDENTS_SYNC_PERIOD_DAYS = 14;
const BUSINESS_TZ = "Europe/Madrid";

/** Returns YYYY-MM-DD in Spain's local timezone for any Date object. */
function toBusinessDateString(d: Date): string {
  return d.toLocaleDateString("sv-SE", { timeZone: BUSINESS_TZ });
}

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
  const now = new Date();
  const todayStr = toBusinessDateString(now);
  const from = new Date(now);
  from.setDate(from.getDate() - (days - 1));
  const fromStr = toBusinessDateString(from);
  const valueStr = toBusinessDateString(new Date(value));
  return valueStr >= fromStr && valueStr <= todayStr;
}

function buildTimeFilters(range: RangePreset, shopId?: string, employeePeriod?: EmployeeMetricsPeriod) {
  const base = "/dashboard";
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
    if (employeePeriod) searchParams.set("employee_period", employeePeriod);
    return {
      label: filter.label,
      href: `${base}?${searchParams.toString()}`,
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
    if (raw === "picked_up" || raw === "pickup_available") return "picked_up";
    return "label_created";
  };
  const countKey = (key: string) => withShipment.filter((o) => getKey(o) === key).length;
  const segments: ShipmentSegment[] = [
    { key: "label_created", label: "🏷️ Etiqueta creada", value: countKey("label_created"), tone: "indigo" },
    { key: "picked_up", label: "🚚 Recogido", value: countKey("picked_up"), tone: "blue" },
    { key: "in_transit", label: "🚚 En tránsito", value: countKey("in_transit"), tone: "blue" },
    { key: "out_for_delivery", label: "🚛 En reparto", value: countKey("out_for_delivery"), tone: "sky" },
    { key: "delivered", label: "✅ Entregado", value: countKey("delivered"), tone: "green" },
    { key: "exception", label: "🚨 Incidencia", value: countKey("exception"), tone: "red" },
  ];
  // Add the "no shipment" segment separately
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

function resolveEmployeePeriod(value?: string): EmployeeMetricsPeriod {
  return value === "day" ? "day" : "week";
}

function buildChart(orders: Awaited<ReturnType<typeof fetchOrders>>["orders"], days: number) {
  const today = new Date();
  const visibleDays = Math.min(days, 30);
  const points = Array.from({ length: visibleDays }).map((_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - ((visibleDays - 1) - index));
    const dayKey = toBusinessDateString(date);

    return {
      dayKey,
      day: date.toLocaleDateString("es-ES", { weekday: "short", timeZone: BUSINESS_TZ }),
      value: orders.filter((order) => toBusinessDateString(new Date(order.created_at)) === dayKey).length,
    };
  });

  return points;
}

function resolveRangeDates(days: number) {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - (days - 1));
  return {
    dateFrom: toBusinessDateString(from),
    dateTo: toBusinessDateString(now),
  };
}

function buildChartFromAnalytics(analytics: AnalyticsOverview, days: number) {
  const visibleDays = Math.min(days, 30);
  const rows = (analytics.charts.orders_by_day ?? []).slice(-visibleDays);
  return rows.map((point) => {
    // Parse as Spain local noon to get the correct weekday label regardless of
    // where the Next.js server is deployed.
    const date = new Date(`${point.date}T12:00:00`);
    return {
      dayKey: point.date,
      day: date.toLocaleDateString("es-ES", { weekday: "short", timeZone: BUSINESS_TZ }),
      value: point.total,
    };
  });
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const params = await searchParams;
  const range = resolveRangePreset(params.range);
  const employeePeriod = resolveEmployeePeriod(params.employee_period);
  const rangeDays = getRangeDays(range);
  const { dateFrom, dateTo } = resolveRangeDates(rangeDays);
  const incidentsLinkParams = new URLSearchParams({
    status: "open",
    period: "14d",
  });
  if (params.shop_id) {
    incidentsLinkParams.set("shop_id", params.shop_id);
  }
  const incidentsLinkHref = `/incidencias?${incidentsLinkParams.toString()}`;
  const [userResult, shopsResult, recentOrdersResult, incidentsResult, employeeAnalyticsResult, analyticsResult] = await Promise.allSettled([
    requireAdminUser(),
    fetchShops(),
    fetchOrders({ shop_id: params.shop_id, page: 1, per_page: 30 }, { cacheSeconds: 30 }),
    fetchIncidents({
      shop_id: params.shop_id,
      status: "open",
      recent_days: INCIDENTS_SYNC_PERIOD_DAYS,
      include_historical: false,
    }),
    fetchEmployeeAnalytics({ period: employeePeriod, shop_id: params.shop_id }),
    fetchAnalyticsOverview({
      shop_id: params.shop_id,
      date_from: dateFrom,
      date_to: dateTo,
    }),
  ]);
  // requireAdminUser redirects on failure — re-throw to trigger it
  if (userResult.status === "rejected") throw userResult.reason;
  const currentUser = userResult.value;
  const firstName = currentUser.name.trim().split(/\s+/)[0] ?? "equipo";

  const shops = shopsResult.status === "fulfilled" ? shopsResult.value : [];
  const recentOrdersPayload =
    recentOrdersResult.status === "fulfilled"
      ? recentOrdersResult.value
      : { orders: [], totalCount: 0 };
  const incidents = incidentsResult.status === "fulfilled" ? incidentsResult.value : [];
  const employeeAnalytics =
    employeeAnalyticsResult.status === "fulfilled" ? employeeAnalyticsResult.value.employees : [];
  const analytics = analyticsResult.status === "fulfilled" ? analyticsResult.value : null;
  const hasPartialDataError =
    shopsResult.status === "rejected" ||
    recentOrdersResult.status === "rejected" ||
    incidentsResult.status === "rejected" ||
    employeeAnalyticsResult.status === "rejected" ||
    analyticsResult.status === "rejected";

  const orders = recentOrdersPayload.orders.filter((order) => isWithinLastDays(order.created_at, rangeDays));
  const openIncidentsList = incidents;
  const activeShop = shops.find((shop) => String(shop.id) === params.shop_id);
  const chart = analytics ? buildChartFromAnalytics(analytics, rangeDays) : buildChart(orders, rangeDays);
  const donutSegments = analytics ? buildDonutSegmentsFromAnalytics(analytics) : buildDonutSegments(orders);
  const timeFilters = buildTimeFilters(range, params.shop_id, employeePeriod);

  const pendingOrders = analytics
    ? (analytics.shipping.pending_orders ?? 0)
    : orders.filter((o) => o.status === "pending").length;
  const readyToShipOrders = analytics
    ? (analytics.flow.orders_prepared ?? 0)
    : orders.filter((o) => o.status === "ready_to_ship").length;
  const shippedOrders = analytics
    ? analytics.kpis.shipped_orders
    : orders.filter((o) => o.status === "shipped").length;
  const deliveredOrders = analytics
    ? analytics.kpis.delivered_orders
    : orders.filter((o) => o.status === "delivered").length;
  const withShipment = analytics
    ? Math.max(analytics.kpis.total_orders - analytics.operational.orders_without_shipment, 0)
    : orders.filter((o) => o.shipment).length;
  const openIncidents = analytics ? analytics.kpis.open_incidents : openIncidentsList.length;
  const urgentIncidents   = openIncidentsList.filter((i) => i.priority === "urgent" || i.priority === "high").length;
  const blockedOrders = analytics ? (analytics.operational.blocked_orders ?? 0) : 0;
  const overdueSlaOrders = analytics ? (analytics.operational.overdue_sla_orders ?? 0) : 0;

  return (
    <div className="stack">
      {hasPartialDataError ? (
        <div className="feedback feedback-info">
          Parte de los datos no se pudieron cargar. Mostramos la información disponible.
        </div>
      ) : null}
      <SlaAlertsBanner basePath="/orders" />
      <SharedDashboardView
      chart={chart}
      donutSegments={donutSegments}
      chartLinkHref="/orders"
      chartLinkLabel="Ir a pedidos"
      timeFilters={timeFilters}
      controls={
        <form className="admin-dashboard-filter" method="get">
          <label className="admin-dashboard-filter-label" htmlFor="shop_id">
            Tienda
          </label>
          <select defaultValue={params.shop_id ?? ""} id="shop_id" name="shop_id">
            <option value="">Todas las tiendas</option>
            {shops.map((shop) => (
              <option key={shop.id} value={shop.id}>
                {shop.name}
              </option>
            ))}
          </select>
          <input name="range" type="hidden" value={range} />
          <input name="employee_period" type="hidden" value={employeePeriod} />
          <button className="button button-secondary" type="submit">
            Aplicar
          </button>
        </form>
      }
      eyebrow="Brandeate operations"
      healthItems={[
        { label: "⏳ Pendientes", value: pendingOrders, hint: "esperando revisión" },
        { label: "📦 Con envío", value: withShipment, hint: "ya etiquetados" },
        { label: "✅ Entregados", value: deliveredOrders, hint: "cerrados correctamente" },
      ]}
      healthTitle="Estado de la cuenta"
      heroAction={
        activeShop ? (
          <Link className="button" href={`/tenant/${activeShop.id}/dashboard/overview`}>
            Ver portal cliente
          </Link>
        ) : (
          <Link className="button" href="/orders">
            Ver pedidos
          </Link>
        )
      }
      incidents={openIncidentsList.map((incident) => ({
        id: incident.id,
        title: incident.title,
        priority: incident.priority,
        secondary: `${incident.order.external_id} · ${incident.order.customer_name}`,
        status: incident.status,
        updatedAt: formatDateTime(incident.updated_at),
      }))}
      incidentsEmptyMessage="No hay incidencias abiertas en la ventana operativa."
      incidentsLinkHref={incidentsLinkHref}
      incidentsLinkLabel="Ver incidencias"
      incidentsTitle="Incidencias recientes"
      kpis={[
        { label: "Pendientes",           value: String(pendingOrders),     delta: "esperando revisión",              tone: "accent"  },
        { label: "Listos para enviar",   value: String(readyToShipOrders), delta: "esperando recogida",              tone: "warning" },
        { label: "Enviados",             value: String(shippedOrders),     delta: `${withShipment} con tracking`,    tone: "blue"    },
        { label: "Entregados",           value: String(deliveredOrders),   delta: "ciclo cerrado",                   tone: "success" },
        { label: "Incidencias abiertas", value: String(openIncidents),     delta: `${urgentIncidents} prioritarias`, tone: "danger"  },
        ...(blockedOrders > 0 ? [{ label: "Bloqueados",      value: String(blockedOrders),     delta: "pedidos retenidos",               tone: "danger" as const }] : []),
      ]}
      noteActions={
        <>
          <Link className="button button-secondary" href="/shipments">
            Ver expediciones
          </Link>
          <Link className="button button-secondary" href="/orders">
            Ver pedidos
          </Link>
        </>
      }
      noteBody="Usa este panel como centro de control de Brandeate: revisa pedidos nuevos, detecta bloqueos antes de packing y salta rápido al portal del cliente cuando necesites validar cómo lo está viendo la tienda."
      noteTitle="Empuja la operativa"
      supplementaryContent={
        <DashboardEmployeeMetrics
          employees={employeeAnalytics}
          period={employeePeriod}
          range={range}
          shopId={params.shop_id}
        />
      }
      recentOrders={orders.slice(0, 6).map((order) => ({
        id: order.id,
        label: order.external_id,
        secondary: `${order.customer_name} · ${order.customer_email}`,
        status: order.status,
        time: formatDateTime(order.created_at),
      }))}
      recentOrdersLinkHref="/orders"
      recentOrdersLinkLabel="Ver todos"
      recentOrdersTitle="Últimos pedidos"
      subtitle="Sigue el volumen de pedidos, el estado operativo y los puntos de atención más urgentes desde una sola vista."
      title={activeShop ? `Hola, ${firstName} · ${activeShop.name}` : `Hola, ${firstName}`}
      />
    </div>
  );
}
