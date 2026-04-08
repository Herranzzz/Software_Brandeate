import { DashboardEmployeeMetrics } from "@/components/dashboard-employee-metrics";
import Link from "next/link";

import { SharedDashboardView } from "@/components/shared-dashboard-view";
import type { ShipmentSegment } from "@/components/shipment-donut";
import { fetchEmployeeAnalytics, fetchIncidents, fetchOrders, fetchShops } from "@/lib/api";
import { requireAdminUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import type { EmployeeMetricsPeriod, Order } from "@/lib/types";

type DashboardPageProps = {
  searchParams: Promise<{
    employee_period?: string;
    shop_id?: string;
    range?: string;
  }>;
};

type RangePreset = "today" | "7d" | "30d" | "90d";

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
  // Add the "no shipment" segment separately
  const noShipment = orders.length - withShipment.length;
  if (noShipment > 0) {
    segments.unshift({ key: "without_shipment", label: "❌ Sin shipment", value: noShipment, tone: "slate" });
  }
  return segments.filter((s) => s.value > 0);
}

function resolveEmployeePeriod(value?: string): EmployeeMetricsPeriod {
  return value === "day" ? "day" : "week";
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

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const params = await searchParams;
  const range = resolveRangePreset(params.range);
  const employeePeriod = resolveEmployeePeriod(params.employee_period);
  const rangeDays = getRangeDays(range);
  const [userResult, shopsResult, ordersResultSettled, incidentsResult, employeeAnalyticsResult] = await Promise.allSettled([
    requireAdminUser(),
    fetchShops(),
    fetchOrders({ shop_id: params.shop_id }),
    fetchIncidents({ shop_id: params.shop_id }),
    fetchEmployeeAnalytics({ period: employeePeriod, shop_id: params.shop_id }),
  ]);
  // requireAdminUser redirects on failure — re-throw to trigger it
  if (userResult.status === "rejected") throw userResult.reason;

  const shops = shopsResult.status === "fulfilled" ? shopsResult.value : [];
  const ordersResult =
    ordersResultSettled.status === "fulfilled"
      ? ordersResultSettled.value
      : { orders: [], totalCount: 0 };
  const incidents = incidentsResult.status === "fulfilled" ? incidentsResult.value : [];
  const employeeAnalytics =
    employeeAnalyticsResult.status === "fulfilled" ? employeeAnalyticsResult.value.employees : [];

  const orders = ordersResult.orders.filter((order) => isWithinLastDays(order.created_at, rangeDays));
  const incidentsInRange = incidents.filter((incident) => isWithinLastDays(incident.updated_at, rangeDays));
  const activeShop = shops.find((shop) => String(shop.id) === params.shop_id);
  const chart = buildChart(orders, rangeDays);
  const donutSegments = buildDonutSegments(orders);
  const timeFilters = buildTimeFilters(range, params.shop_id, employeePeriod);

  const pendingOrders     = orders.filter((o) => o.status === "pending").length;
  const inProgressOrders  = orders.filter((o) => o.status === "in_progress").length;
  const readyToShipOrders = orders.filter((o) => o.status === "ready_to_ship").length;
  const shippedOrders     = orders.filter((o) => o.status === "shipped").length;
  const deliveredOrders   = orders.filter((o) => o.status === "delivered").length;
  const withShipment      = orders.filter((o) => o.shipment).length;
  const openIncidents     = incidentsInRange.filter((i) => i.status !== "resolved").length;
  const urgentIncidents   = incidentsInRange.filter((i) => i.priority === "urgent" || i.priority === "high").length;

  return (
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
        { label: "🔧 En producción", value: inProgressOrders, hint: "flujo activo" },
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
      incidents={incidentsInRange.map((incident) => ({
        id: incident.id,
        title: incident.title,
        priority: incident.priority,
        secondary: `${incident.order.external_id} · ${incident.order.customer_name}`,
        status: incident.status,
        updatedAt: formatDateTime(incident.updated_at),
      }))}
      incidentsEmptyMessage="No hay incidencias abiertas ahora mismo."
      incidentsLinkHref="/incidencias"
      incidentsLinkLabel="Ver incidencias"
      incidentsTitle="Incidencias recientes"
      kpis={[
        { label: "Pendientes",           value: String(pendingOrders),     delta: "esperando revisión",              tone: "accent"  },
        { label: "En producción",        value: String(inProgressOrders),  delta: "flujo activo",                    tone: "default" },
        { label: "Listos para enviar",   value: String(readyToShipOrders), delta: "esperando recogida",              tone: "warning" },
        { label: "Enviados",             value: String(shippedOrders),     delta: `${withShipment} con tracking`,    tone: "default" },
        { label: "Entregados",           value: String(deliveredOrders),   delta: "ciclo cerrado",                   tone: "success" },
        { label: "Incidencias abiertas", value: String(openIncidents),     delta: `${urgentIncidents} prioritarias`, tone: "danger"  },
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
      title={activeShop ? `Control de ${activeShop.name}` : "Bienvenido de nuevo"}
    />
  );
}
