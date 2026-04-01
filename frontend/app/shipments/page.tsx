import Link from "next/link";

import { Card } from "@/components/card";
import { EmptyState } from "@/components/empty-state";
import { PortalSyncButton } from "@/components/portal-sync-button";
import { fetchAnalyticsOverview, fetchOrders, fetchShopifyIntegrations, fetchShops } from "@/lib/api";
import { requireAdminUser } from "@/lib/auth";
import { formatDateTime, sortTrackingEvents } from "@/lib/format";
import type { Order } from "@/lib/types";


type ShipmentsPageProps = {
  searchParams: Promise<{
    shop_id?: string;
    per_page?: string;
    q?: string;
    quick?: string;
    date_from?: string;
    date_to?: string;
    selected?: string;
  }>;
};

type ShipmentQuickFilter =
  | "all"
  | "without_shipment"
  | "without_tracking"
  | "pending"
  | "in_transit"
  | "delivered"
  | "incident"
  | "stalled";

type ShipmentOrder = Order;

type ShipmentStatusTone =
  | "slate"
  | "blue"
  | "indigo"
  | "sky"
  | "green"
  | "orange"
  | "red";

function toDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function getDefaultDateRange() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - 13);
  return {
    dateFrom: toDateInputValue(start),
    dateTo: toDateInputValue(end),
  };
}

function getPrimaryItem(order: ShipmentOrder) {
  return order.items[0] ?? null;
}

function getShipmentEvents(order: ShipmentOrder) {
  return sortTrackingEvents(order.shipment?.events ?? []);
}

function getLatestTrackingEvent(order: ShipmentOrder) {
  return getShipmentEvents(order)[0] ?? null;
}

function normalizeCarrierName(carrier?: string | null) {
  if (!carrier) {
    return "CTT Express";
  }
  if (carrier.trim().toLowerCase().includes("ctt")) {
    return "CTT Express";
  }
  return carrier.trim();
}

function getShipmentStatus(order: ShipmentOrder) {
  const latest = getLatestTrackingEvent(order);
  const rawStatus = latest?.status_norm ?? order.shipment?.shipping_status ?? null;

  if (!order.shipment) {
    return {
      key: "without_shipment",
      label: "Sin shipment",
      tone: "slate" as ShipmentStatusTone,
      description: "Aun no se ha creado la expedicion en CTT.",
    };
  }

  if (order.has_open_incident || rawStatus === "exception") {
    return {
      key: "exception",
      label: "Incidencia",
      tone: "red" as ShipmentStatusTone,
      description: "Hay una incidencia abierta o una excepcion logistica.",
    };
  }

  if (rawStatus === "delivered" || order.status === "delivered") {
    return {
      key: "delivered",
      label: "Entregado",
      tone: "green" as ShipmentStatusTone,
      description: "El carrier ya marco la entrega como completada.",
    };
  }

  if (rawStatus === "pickup_available") {
    return {
      key: "pickup_available",
      label: "Disponible para recoger",
      tone: "orange" as ShipmentStatusTone,
      description: "El pedido esta listo para recogida en punto CTT.",
    };
  }

  if (rawStatus === "out_for_delivery") {
    return {
      key: "out_for_delivery",
      label: "En reparto",
      tone: "sky" as ShipmentStatusTone,
      description: "Ultima milla activa.",
    };
  }

  if (rawStatus === "in_transit") {
    return {
      key: "in_transit",
      label: "En transito",
      tone: "blue" as ShipmentStatusTone,
      description: "La expedicion ya esta en movimiento dentro de CTT.",
    };
  }

  if (rawStatus === "label_created" || order.status === "shipped") {
    return {
      key: "label_created",
      label: "Etiqueta creada",
      tone: "indigo" as ShipmentStatusTone,
      description: "Shipment creado, pendiente de avance logistico.",
    };
  }

  return {
    key: "pending",
    label: "Pendiente",
    tone: "slate" as ShipmentStatusTone,
    description: "La expedicion sigue esperando movimiento.",
  };
}

function getStatusBadgeClass(tone: ShipmentStatusTone) {
  return `shipments-control-badge shipments-control-badge-${tone}`;
}

function getOrderStateLabel(order: ShipmentOrder) {
  switch (order.status) {
    case "pending":
      return "Pedido recibido";
    case "in_progress":
      return "En preparacion";
    case "ready_to_ship":
      return "Preparado";
    case "shipped":
      return "Enviado";
    case "delivered":
      return "Entregado";
    case "exception":
      return "Incidencia";
    default:
      return "Pedido";
  }
}

function hoursSince(value?: string | null) {
  if (!value) {
    return null;
  }
  return Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 36e5));
}

function daysBetween(start?: string | null, end?: string | null) {
  if (!start || !end) {
    return null;
  }
  const difference = new Date(end).getTime() - new Date(start).getTime();
  if (difference < 0) {
    return null;
  }
  return difference / 36e5 / 24;
}

function formatHoursAsShort(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return "Sin dato";
  }
  if (value >= 48) {
    return `${Math.round(value / 24)}d`;
  }
  return `${Math.round(value)}h`;
}

function formatDaysAsReadable(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return "Sin dato";
  }
  if (value < 1) {
    return `${Math.round(value * 24)}h`;
  }
  return `${value.toFixed(1).replace(".", ",")} dias`;
}

function isWithinRange(value: string, dateFrom: string, dateTo: string) {
  const time = new Date(value).getTime();
  const from = new Date(`${dateFrom}T00:00:00`).getTime();
  const to = new Date(`${dateTo}T23:59:59`).getTime();
  return time >= from && time <= to;
}

function matchesSearch(order: ShipmentOrder, search: string) {
  if (!search) {
    return true;
  }
  const normalized = search.trim().toLowerCase();
  const latest = getLatestTrackingEvent(order);
  const primaryItem = getPrimaryItem(order);
  const haystack = [
    order.external_id,
    order.customer_name,
    order.customer_email,
    primaryItem?.title,
    primaryItem?.name,
    primaryItem?.variant_title,
    primaryItem?.sku,
    order.shipment?.tracking_number,
    latest?.status_raw,
    latest?.status_norm,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(normalized);
}

function getDeliveredAt(order: ShipmentOrder) {
  const deliveredEvent = getShipmentEvents(order).find((event) => event.status_norm === "delivered");
  return deliveredEvent?.occurred_at ?? null;
}

function isStalled(order: ShipmentOrder) {
  if (!order.shipment || order.has_open_incident) {
    return false;
  }
  const status = getShipmentStatus(order).key;
  if (status !== "in_transit" && status !== "label_created" && status !== "pending") {
    return false;
  }
  const latestEvent = getLatestTrackingEvent(order);
  const latestDate = latestEvent?.occurred_at ?? order.shipment.created_at;
  const age = hoursSince(latestDate);
  return age !== null && age >= 48;
}

function filterByQuick(order: ShipmentOrder, filter: ShipmentQuickFilter) {
  const shipmentStatus = getShipmentStatus(order).key;
  switch (filter) {
    case "without_shipment":
      return !order.shipment;
    case "without_tracking":
      return !order.shipment?.tracking_number;
    case "pending":
      return shipmentStatus === "pending" || shipmentStatus === "label_created";
    case "in_transit":
      return shipmentStatus === "in_transit" || shipmentStatus === "out_for_delivery";
    case "delivered":
      return shipmentStatus === "delivered";
    case "incident":
      return order.has_open_incident || shipmentStatus === "exception";
    case "stalled":
      return isStalled(order);
    default:
      return true;
  }
}

function getAttentionReason(order: ShipmentOrder) {
  if (!order.shipment) {
    return "Pedido sin expedicion creada";
  }
  if (!order.shipment.tracking_number) {
    return "Shipment sin tracking CTT";
  }
  if (order.has_open_incident) {
    return "Incidencia abierta";
  }
  if (getShipmentStatus(order).key === "pickup_available") {
    return "Disponible para recoger";
  }
  if (isStalled(order)) {
    return "Tracking sin movimiento reciente";
  }
  if (getShipmentStatus(order).key === "pending" || getShipmentStatus(order).key === "label_created") {
    const age = hoursSince(order.shipment.created_at);
    if (age !== null && age >= 24) {
      return "Pendiente demasiado tiempo";
    }
  }
  return null;
}

function formatTimelineLabel(statusNorm?: string | null) {
  switch (statusNorm) {
    case "label_created":
      return "Etiqueta creada";
    case "in_transit":
      return "En transito";
    case "out_for_delivery":
      return "En reparto";
    case "delivered":
      return "Entregado";
    case "exception":
      return "Incidencia";
    case "pickup_available":
      return "Disponible para recoger";
    default:
      return "Actualizacion";
  }
}

function getChartBars(ordersByDay: Awaited<ReturnType<typeof fetchAnalyticsOverview>>["charts"]["orders_by_day"]) {
  const maxTotal = Math.max(...ordersByDay.map((point) => point.total), 1);
  return ordersByDay.slice(-7).map((point) => ({
    ...point,
    height: Math.max(14, Math.round((point.total / maxTotal) * 100)),
    label: new Intl.DateTimeFormat("es-ES", { weekday: "short" }).format(new Date(point.date)),
  }));
}

function buildQuery(params: Record<string, string | number | null | undefined>) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      searchParams.set(key, String(value));
    }
  });
  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

export default async function ShipmentsPage({ searchParams }: ShipmentsPageProps) {
  await requireAdminUser();
  const params = await searchParams;
  const defaultRange = getDefaultDateRange();
  const dateFrom = params.date_from ?? defaultRange.dateFrom;
  const dateTo = params.date_to ?? defaultRange.dateTo;
  const q = params.q?.trim() ?? "";
  const quick = (params.quick as ShipmentQuickFilter | undefined) ?? "all";
  const perPage = Math.min(Math.max(Number(params.per_page ?? "100") || 100, 1), 500);

  const [orders, shops, integrations, analytics] = await Promise.all([
    fetchOrders({
      shop_id: params.shop_id,
      per_page: perPage,
    }).then(({ orders }) => orders),
    fetchShops(),
    fetchShopifyIntegrations(),
    fetchAnalyticsOverview({
      shop_id: params.shop_id,
      date_from: dateFrom,
      date_to: dateTo,
    }),
  ]);

  const shopMap = new Map(shops.map((shop) => [shop.id, shop.name]));
  const integrationMap = new Map(integrations.map((integration) => [integration.shop_id, integration]));

  const filteredOrders = orders
    .filter((order) => isWithinRange(order.created_at, dateFrom, dateTo))
    .filter((order) => matchesSearch(order, q))
    .filter((order) => filterByQuick(order, quick));

  const selectedOrder =
    filteredOrders.find((order) => String(order.id) === params.selected) ??
    filteredOrders[0] ??
    null;

  const ordersToday = filteredOrders.filter((order) => isWithinRange(order.created_at, toDateInputValue(new Date()), toDateInputValue(new Date()))).length;
  const pendingShipment = filteredOrders.filter((order) => !order.shipment || getShipmentStatus(order).key === "pending" || getShipmentStatus(order).key === "label_created").length;
  const inTransit = filteredOrders.filter((order) => {
    const key = getShipmentStatus(order).key;
    return key === "in_transit" || key === "out_for_delivery";
  }).length;
  const delivered = filteredOrders.filter((order) => getShipmentStatus(order).key === "delivered").length;
  const incidents = filteredOrders.filter((order) => getAttentionReason(order) === "Incidencia abierta" || getShipmentStatus(order).key === "exception").length;
  const withoutTracking = filteredOrders.filter((order) => order.shipment && !order.shipment.tracking_number).length;
  const stuckOrders = filteredOrders.filter((order) => Boolean(getAttentionReason(order)) && getAttentionReason(order) !== "Incidencia abierta").length;

  const deliveredLeadTimes = filteredOrders
    .map((order) => daysBetween(order.created_at, getDeliveredAt(order)))
    .filter((value): value is number => value !== null);
  const averageDeliveryDays =
    deliveredLeadTimes.length > 0
      ? deliveredLeadTimes.reduce((sum, value) => sum + value, 0) / deliveredLeadTimes.length
      : analytics.operational.avg_shipping_to_delivery_hours !== null
        ? analytics.operational.avg_shipping_to_delivery_hours / 24
        : null;

  const statusBreakdown = [
    {
      key: "pending",
      label: "Pendiente",
      value: filteredOrders.filter((order) => {
        const key = getShipmentStatus(order).key;
        return key === "pending" || key === "label_created" || key === "without_shipment";
      }).length,
      tone: "slate" as ShipmentStatusTone,
    },
    {
      key: "in_transit",
      label: "En transito",
      value: filteredOrders.filter((order) => getShipmentStatus(order).key === "in_transit").length,
      tone: "blue" as ShipmentStatusTone,
    },
    {
      key: "out_for_delivery",
      label: "En reparto",
      value: filteredOrders.filter((order) => getShipmentStatus(order).key === "out_for_delivery").length,
      tone: "sky" as ShipmentStatusTone,
    },
    {
      key: "delivered",
      label: "Entregado",
      value: filteredOrders.filter((order) => getShipmentStatus(order).key === "delivered").length,
      tone: "green" as ShipmentStatusTone,
    },
    {
      key: "exception",
      label: "Incidencia",
      value: filteredOrders.filter((order) => {
        const key = getShipmentStatus(order).key;
        return key === "exception" || order.has_open_incident;
      }).length,
      tone: "red" as ShipmentStatusTone,
    },
    {
      key: "pickup_available",
      label: "Recogida",
      value: filteredOrders.filter((order) => getShipmentStatus(order).key === "pickup_available").length,
      tone: "orange" as ShipmentStatusTone,
    },
  ];

  const attentionOrders = filteredOrders
    .map((order) => ({
      order,
      reason: getAttentionReason(order),
      latest: getLatestTrackingEvent(order),
    }))
    .filter((entry) => entry.reason)
    .sort((left, right) => {
      const leftAge = hoursSince(left.latest?.occurred_at ?? left.order.shipment?.created_at ?? left.order.created_at) ?? 0;
      const rightAge = hoursSince(right.latest?.occurred_at ?? right.order.shipment?.created_at ?? right.order.created_at) ?? 0;
      return rightAge - leftAge;
    })
    .slice(0, 8);

  const bars = getChartBars(analytics.charts.orders_by_day);
  const selectedIntegration =
    (params.shop_id ? integrationMap.get(Number(params.shop_id)) : null) ??
    integrations
      .filter((integration) => integration.last_synced_at)
      .sort((left, right) => new Date(right.last_synced_at ?? 0).getTime() - new Date(left.last_synced_at ?? 0).getTime())[0] ??
    null;

  const quickFilters: Array<{ value: ShipmentQuickFilter; label: string }> = [
    { value: "all", label: "Todos" },
    { value: "without_shipment", label: "Sin shipment" },
    { value: "without_tracking", label: "Sin tracking" },
    { value: "pending", label: "Pendientes" },
    { value: "in_transit", label: "En transito" },
    { value: "delivered", label: "Entregados" },
    { value: "incident", label: "Incidencia" },
    { value: "stalled", label: "Atascados" },
  ];

  return (
    <div className="stack shipments-control-page">
      <Card className="stack shipments-control-hero">
        <div className="shipments-control-hero-top">
          <div>
            <span className="eyebrow">Expediciones</span>
            <h1 className="shipments-control-title">Torre de control CTT</h1>
            <p className="shipments-control-subtitle">
              Seguimiento, atencion y control de expediciones centrado en CTT Express, sin ruido de multi-carrier.
            </p>
          </div>

          <div className="shipments-control-sync">
            <div className="shipments-control-sync-copy">
              <span className="shipments-control-sync-label">Ultima sincronizacion</span>
              <strong>
                {selectedIntegration?.last_synced_at
                  ? formatDateTime(selectedIntegration.last_synced_at)
                  : "Sin sincronizar"}
              </strong>
            </div>
            {params.shop_id ? <PortalSyncButton shopId={Number(params.shop_id)} /> : <span className="table-secondary">Selecciona una tienda para sincronizar.</span>}
          </div>
        </div>

        <form className="shipments-control-toolbar" method="get">
          <div className="field shipments-control-search">
            <label htmlFor="q">Buscar</label>
            <input
              defaultValue={q}
              id="q"
              name="q"
              placeholder="Pedido, cliente, tracking o ultimo estado"
              type="search"
            />
          </div>

          <div className="field">
            <label htmlFor="shop_id">Tienda</label>
            <select defaultValue={params.shop_id ?? ""} id="shop_id" name="shop_id">
              <option value="">Todas</option>
              {shops.map((shop) => (
                <option key={shop.id} value={shop.id}>
                  {shop.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="date_from">Desde</label>
            <input defaultValue={dateFrom} id="date_from" name="date_from" type="date" />
          </div>

          <div className="field">
            <label htmlFor="date_to">Hasta</label>
            <input defaultValue={dateTo} id="date_to" name="date_to" type="date" />
          </div>

          <div className="field">
            <label htmlFor="per_page">Cargar</label>
            <select defaultValue={String(perPage)} id="per_page" name="per_page">
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="250">250</option>
              <option value="500">500</option>
            </select>
          </div>

          <button className="button" type="submit">
            Aplicar
          </button>
        </form>

        <div className="shipments-control-pills">
          {quickFilters.map((filter) => {
            const href = buildQuery({
              ...params,
              quick: filter.value,
              q,
              date_from: dateFrom,
              date_to: dateTo,
              per_page: perPage,
              selected: undefined,
            });
            return (
              <Link
                className={`shipments-control-pill ${quick === filter.value ? "is-active" : ""}`}
                href={`/shipments${href}`}
                key={filter.value}
              >
                {filter.label}
              </Link>
            );
          })}
        </div>
      </Card>

      <section className="shipments-control-kpis">
        <Card className="shipments-control-kpi">
          <span className="shipments-control-kpi-label">Creadas hoy</span>
          <strong>{ordersToday}</strong>
          <span className="table-secondary">expediciones o pedidos visibles en el rango</span>
        </Card>
        <Card className="shipments-control-kpi">
          <span className="shipments-control-kpi-label">Pendientes de envio</span>
          <strong>{pendingShipment}</strong>
          <span className="table-secondary">sin cierre logistico todavia</span>
        </Card>
        <Card className="shipments-control-kpi">
          <span className="shipments-control-kpi-label">En transito</span>
          <strong>{inTransit}</strong>
          <span className="table-secondary">incluye reparto activo</span>
        </Card>
        <Card className="shipments-control-kpi">
          <span className="shipments-control-kpi-label">Entregadas</span>
          <strong>{delivered}</strong>
          <span className="table-secondary">cierres confirmados por CTT</span>
        </Card>
        <Card className="shipments-control-kpi">
          <span className="shipments-control-kpi-label">Incidencias</span>
          <strong>{incidents}</strong>
          <span className="table-secondary">pedidos con excepcion o caso abierto</span>
        </Card>
        <Card className="shipments-control-kpi">
          <span className="shipments-control-kpi-label">Sin tracking</span>
          <strong>{withoutTracking}</strong>
          <span className="table-secondary">shipment sin numero de seguimiento</span>
        </Card>
        <Card className="shipments-control-kpi">
          <span className="shipments-control-kpi-label">Tiempo medio de entrega</span>
          <strong>{formatDaysAsReadable(averageDeliveryDays)}</strong>
          <span className="table-secondary">% SLA {analytics.operational.delivered_in_sla_rate ?? 0}%</span>
        </Card>
        <Card className="shipments-control-kpi">
          <span className="shipments-control-kpi-label">Pedidos atascados</span>
          <strong>{stuckOrders}</strong>
          <span className="table-secondary">sin movimiento o pendientes demasiado tiempo</span>
        </Card>
      </section>

      <section className="shipments-control-analytics">
        <Card className="stack shipments-control-visual">
          <div className="table-header">
            <div>
              <span className="eyebrow">Estado CTT</span>
              <h3 className="section-title section-title-small">Distribucion actual del envio</h3>
            </div>
          </div>

          <div className="shipments-control-statusbar">
            {statusBreakdown
              .filter((item) => item.value > 0)
              .map((item) => (
                <span
                  className={`shipments-control-status-segment tone-${item.tone}`}
                  key={item.key}
                  style={{ width: `${Math.max(8, (item.value / Math.max(filteredOrders.length, 1)) * 100)}%` }}
                />
              ))}
          </div>

          <div className="shipments-control-status-grid">
            {statusBreakdown.map((item) => (
              <div className="shipments-control-status-card" key={item.key}>
                <span className={`shipments-control-dot tone-${item.tone}`} />
                <div>
                  <div className="table-primary">{item.label}</div>
                  <div className="table-secondary">{item.value} expediciones</div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="stack shipments-control-chart">
          <div className="table-header">
            <div>
              <span className="eyebrow">Tendencia</span>
              <h3 className="section-title section-title-small">Expediciones por dia</h3>
            </div>
          </div>

          <div className="shipments-control-bar-chart">
            {bars.map((bar) => (
              <div className="shipments-control-bar" key={bar.date}>
                <div className="shipments-control-bar-track">
                  <div className="shipments-control-bar-fill" style={{ height: `${bar.height}%` }} />
                </div>
                <strong>{bar.total}</strong>
                <span>{bar.label}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="stack shipments-control-chart">
          <div className="table-header">
            <div>
              <span className="eyebrow">Servicio</span>
              <h3 className="section-title section-title-small">Entregadas vs incidencias</h3>
            </div>
          </div>

          <div className="shipments-control-compare">
            <div className="shipments-control-compare-row">
              <span>Entregadas</span>
              <div className="shipments-control-compare-bar">
                <div
                  className="shipments-control-compare-fill is-green"
                  style={{ width: `${Math.max(6, (delivered / Math.max(delivered + incidents, 1)) * 100)}%` }}
                />
              </div>
              <strong>{delivered}</strong>
            </div>
            <div className="shipments-control-compare-row">
              <span>Incidencias</span>
              <div className="shipments-control-compare-bar">
                <div
                  className="shipments-control-compare-fill is-red"
                  style={{ width: `${Math.max(6, (incidents / Math.max(delivered + incidents, 1)) * 100)}%` }}
                />
              </div>
              <strong>{incidents}</strong>
            </div>
          </div>
        </Card>

        <Card className="stack shipments-control-chart">
          <div className="table-header">
            <div>
              <span className="eyebrow">Velocidad</span>
              <h3 className="section-title section-title-small">Tiempo medio de entrega</h3>
            </div>
          </div>

          <div className="shipments-control-metric">
            <strong>{formatDaysAsReadable(averageDeliveryDays)}</strong>
            <span className="table-secondary">promedio pedido a entrega</span>
          </div>
          <div className="status-summary-list">
            <div className="status-summary-row">
              <span>Pedido a produccion</span>
              <strong>{formatHoursAsShort(analytics.operational.avg_order_to_production_hours)}</strong>
            </div>
            <div className="status-summary-row">
              <span>Produccion a envio</span>
              <strong>{formatHoursAsShort(analytics.operational.avg_production_to_shipping_hours)}</strong>
            </div>
            <div className="status-summary-row">
              <span>Envio a entrega</span>
              <strong>{formatHoursAsShort(analytics.operational.avg_shipping_to_delivery_hours)}</strong>
            </div>
          </div>
        </Card>
      </section>

      <section className="shipments-control-main">
        <Card className="stack table-card">
          <div className="table-header">
            <div>
              <span className="eyebrow">Necesita atencion</span>
              <h3 className="section-title section-title-small">Pedidos y expediciones que conviene revisar ahora</h3>
            </div>
            <div className="muted">{attentionOrders.length} casos</div>
          </div>

          {attentionOrders.length === 0 ? (
            <EmptyState
              title="Nada critico en esta vista"
              description="No hay expediciones sin shipment, sin tracking o claramente atascadas en el rango actual."
            />
          ) : (
            <div className="shipments-control-attention-list">
              {attentionOrders.map(({ order, reason, latest }) => (
                <Link
                  className="shipments-control-attention-row"
                  href={`/shipments${buildQuery({
                    ...params,
                    q,
                    quick,
                    date_from: dateFrom,
                    date_to: dateTo,
                    per_page: perPage,
                    selected: order.id,
                  })}`}
                  key={order.id}
                >
                  <div>
                    <div className="table-primary">{order.external_id}</div>
                    <div className="table-secondary">{shopMap.get(order.shop_id) ?? `Shop #${order.shop_id}`}</div>
                  </div>
                  <div>
                    <div className="table-primary">{reason}</div>
                    <div className="table-secondary">
                      {latest?.occurred_at
                        ? `Ultimo evento ${formatDateTime(latest.occurred_at)}`
                        : "Sin evento reciente"}
                    </div>
                  </div>
                  <div className="shipments-control-attention-meta">
                    <strong>{formatHoursAsShort(hoursSince(latest?.occurred_at ?? order.shipment?.created_at ?? order.created_at))}</strong>
                    <span className="table-secondary">sin novedad</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <div className="shipments-control-workbench">
          <Card className="stack table-card">
            <div className="table-header">
              <div>
                <span className="eyebrow">Expediciones</span>
                <h3 className="section-title section-title-small">Mesa principal de seguimiento CTT</h3>
              </div>
              <div className="muted">Mostrando {filteredOrders.length} pedidos</div>
            </div>

            {filteredOrders.length === 0 ? (
              <EmptyState
                title="Sin expediciones en esta vista"
                description="Ajusta rango, búsqueda o pills para revisar otro bloque de pedidos."
              />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Pedido</th>
                      <th>Tienda</th>
                      <th>Cliente</th>
                      <th>Tracking CTT</th>
                      <th>Estado envio</th>
                      <th>Ultimo evento</th>
                      <th>Sin novedad</th>
                      <th>Estado pedido</th>
                      <th>Incidencia</th>
                      <th>Accion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOrders.map((order) => {
                      const latest = getLatestTrackingEvent(order);
                      const shipmentStatus = getShipmentStatus(order);
                      const latestAt = latest?.occurred_at ?? order.shipment?.created_at ?? order.created_at;
                      const trackingLink = order.shipment?.tracking_url;
                      return (
                        <tr className="table-row" key={order.id}>
                          <td className="table-primary">{order.external_id}</td>
                          <td>{shopMap.get(order.shop_id) ?? `Shop #${order.shop_id}`}</td>
                          <td>
                            <div className="table-primary">{order.customer_name}</div>
                            <div className="table-secondary">{order.customer_email}</div>
                          </td>
                          <td>
                            {order.shipment?.tracking_number ? (
                              <div className="shipments-control-tracking">
                                {trackingLink ? (
                                  <a className="table-link" href={trackingLink} rel="noreferrer" target="_blank">
                                    {order.shipment.tracking_number}
                                  </a>
                                ) : (
                                  <span className="table-primary">{order.shipment.tracking_number}</span>
                                )}
                                <span className="table-secondary">{normalizeCarrierName(order.shipment?.carrier)}</span>
                              </div>
                            ) : (
                              <div className="shipments-control-tracking">
                                <span className="table-primary">Pendiente</span>
                                <span className="table-secondary">{order.shipment ? "Sin tracking" : "Sin shipment"}</span>
                              </div>
                            )}
                          </td>
                          <td>
                            <span className={getStatusBadgeClass(shipmentStatus.tone)}>{shipmentStatus.label}</span>
                          </td>
                          <td>
                            <div className="table-primary">
                              {latest ? formatTimelineLabel(latest.status_norm) : shipmentStatus.label}
                            </div>
                            <div className="table-secondary">{formatDateTime(latestAt)}</div>
                          </td>
                          <td>{formatHoursAsShort(hoursSince(latestAt))}</td>
                          <td>
                            <span className="badge">{getOrderStateLabel(order)}</span>
                          </td>
                          <td>{order.has_open_incident ? <span className="badge badge-status badge-status-exception">Abierta</span> : <span className="table-secondary">Sin incidencia</span>}</td>
                          <td>
                            <Link
                              className="button-secondary table-action"
                              href={`/shipments${buildQuery({
                                ...params,
                                q,
                                quick,
                                date_from: dateFrom,
                                date_to: dateTo,
                                per_page: perPage,
                                selected: order.id,
                              })}`}
                            >
                              Ver detalle
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card className="stack shipments-control-drawer">
            {selectedOrder ? (
              <>
                <div className="table-header">
                  <div>
                    <span className="eyebrow">Detalle</span>
                    <h3 className="section-title section-title-small">{selectedOrder.external_id}</h3>
                  </div>
                  <Link className="button-secondary table-action" href={`/orders/${selectedOrder.id}`}>
                    Ver pedido
                  </Link>
                </div>

                <div className="shipments-control-detail-top">
                  <div>
                    <span className="shipments-control-sync-label">Tracking CTT</span>
                    <strong>
                      {selectedOrder.shipment?.tracking_number || "Pendiente de tracking"}
                    </strong>
                  </div>
                  <span className={getStatusBadgeClass(getShipmentStatus(selectedOrder).tone)}>
                    {getShipmentStatus(selectedOrder).label}
                  </span>
                </div>

                {selectedOrder.shipment?.tracking_url ? (
                  <a className="table-link" href={selectedOrder.shipment.tracking_url} rel="noreferrer" target="_blank">
                    Abrir seguimiento oficial de CTT
                  </a>
                ) : (
                  <span className="table-secondary">Aun no hay enlace oficial de seguimiento.</span>
                )}

                <div className="status-summary-list">
                  <div className="status-summary-row">
                    <span>Carrier</span>
                    <strong>{normalizeCarrierName(selectedOrder.shipment?.carrier)}</strong>
                  </div>
                  <div className="status-summary-row">
                    <span>Ultima actualizacion</span>
                    <strong>{formatDateTime(getLatestTrackingEvent(selectedOrder)?.occurred_at ?? selectedOrder.shipment?.created_at ?? selectedOrder.created_at)}</strong>
                  </div>
                  <div className="status-summary-row">
                    <span>Estado pedido</span>
                    <strong>{getOrderStateLabel(selectedOrder)}</strong>
                  </div>
                  <div className="status-summary-row">
                    <span>Incidencia</span>
                    <strong>{selectedOrder.has_open_incident ? "Abierta" : "Sin incidencia"}</strong>
                  </div>
                </div>

                <div className="shipments-control-timeline">
                  {selectedOrder.shipment ? (
                    getShipmentEvents(selectedOrder).length > 0 ? (
                      getShipmentEvents(selectedOrder).map((event) => (
                        <div className="shipments-control-timeline-row" key={event.id}>
                          <span className="shipments-control-timeline-dot" />
                          <div>
                            <div className="table-primary">{formatTimelineLabel(event.status_norm)}</div>
                            <div className="table-secondary">{formatDateTime(event.occurred_at)}</div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="table-secondary">Shipment creado pero sin eventos sincronizados todavia.</div>
                    )
                  ) : (
                    <div className="table-secondary">Este pedido aun no tiene expedicion creada en CTT.</div>
                  )}
                </div>
              </>
            ) : (
              <EmptyState
                title="Selecciona una expedicion"
                description="Abre una fila de la mesa para ver tracking, timeline y detalle del shipment."
              />
            )}
          </Card>
        </div>
      </section>
    </div>
  );
}
