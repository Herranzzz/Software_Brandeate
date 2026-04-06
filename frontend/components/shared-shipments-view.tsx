import Link from "next/link";
import type { ReactNode } from "react";

import { AutomationFlagBadge } from "@/components/automation-flag-badge";
import { Card } from "@/components/card";
import { EmptyState } from "@/components/empty-state";
import { ShipmentDonut } from "@/components/shipment-donut";
import { getOrderShipmentLabelUrl } from "@/lib/ctt";
import { formatDateTime, sortTrackingEvents } from "@/lib/format";
import type { AgingBuckets, AnalyticsOverview, Order, Shop, ShopIntegration } from "@/lib/types";

export type ShipmentQuickFilter =
  | "all"
  | "without_shipment"
  | "without_tracking"
  | "pending"
  | "in_transit"
  | "delivered"
  | "incident"
  | "stalled";

export type ShipmentPeriod = "7d" | "30d" | "ytd" | "custom";

type ShipmentStatusTone =
  | "slate"
  | "blue"
  | "indigo"
  | "sky"
  | "green"
  | "orange"
  | "red";

type SharedShipmentsViewProps = {
  basePath: string;
  detailBasePath: string;
  title: string;
  subtitle: string;
  heroEyebrow?: string;
  orders: Order[];
  shops: Shop[];
  integrations: ShopIntegration[];
  analytics: AnalyticsOverview;
  selectedShopId?: string;
  q: string;
  quick: ShipmentQuickFilter;
  period: ShipmentPeriod;
  dateFrom: string;
  dateTo: string;
  perPage: number;
  selected?: string;
  allowAllShops?: boolean;
  syncSlot?: ReactNode;
  syncHint?: string;
  shopFieldHelp?: string;
};

function toDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function getDefaultShipmentDateRange() {
  return getShipmentDateRange("7d");
}

export function getShipmentDateRange(period: ShipmentPeriod, today = new Date()) {
  const end = new Date(today);
  const start = new Date(today);
  if (period === "30d") {
    start.setDate(end.getDate() - 29);
  } else if (period === "ytd") {
    start.setMonth(0, 1);
  } else {
    start.setDate(end.getDate() - 6);
  }
  return {
    dateFrom: toDateInputValue(start),
    dateTo: toDateInputValue(end),
  };
}

function getRangeShortcuts(dateTo: string) {
  const end = new Date(`${dateTo}T23:59:59`);
  const yearStart = new Date(end);
  yearStart.setMonth(0, 1);
  return [
    { label: "7 días", value: "7d" as ShipmentPeriod, ...getShipmentDateRange("7d", end) },
    { label: "30 días", value: "30d" as ShipmentPeriod, ...getShipmentDateRange("30d", end) },
    { label: "Este año", value: "ytd" as ShipmentPeriod, dateFrom: toDateInputValue(yearStart), dateTo: toDateInputValue(end) },
    { label: "Personalizado", value: "custom" as ShipmentPeriod, dateFrom: "", dateTo: "" },
  ];
}

function getPrimaryItem(order: Order) {
  return order.items[0] ?? null;
}

function getShipmentEvents(order: Order) {
  return sortTrackingEvents(order.shipment?.events ?? []);
}

function getLatestTrackingEvent(order: Order) {
  return getShipmentEvents(order)[0] ?? null;
}

function normalizeCarrierName(carrier?: string | null) {
  if (!carrier) return "CTT Express";
  if (carrier.trim().toLowerCase().includes("ctt")) return "CTT Express";
  return carrier.trim();
}

function getShipmentStatus(order: Order) {
  const latest = getLatestTrackingEvent(order);
  const rawStatus = latest?.status_norm ?? order.shipment?.shipping_status ?? null;

  if (!order.shipment) {
    return {
      key: "without_shipment",
      label: "Sin shipment",
      tone: "slate" as ShipmentStatusTone,
      description: "Aún no se ha creado la expedición en CTT.",
    };
  }

  if (order.has_open_incident || rawStatus === "exception") {
    return {
      key: "exception",
      label: "Incidencia",
      tone: "red" as ShipmentStatusTone,
      description: "Hay una incidencia abierta o una excepción logística.",
    };
  }

  if (rawStatus === "delivered" || order.status === "delivered") {
    return {
      key: "delivered",
      label: "Entregado",
      tone: "green" as ShipmentStatusTone,
      description: "El carrier ya marcó la entrega como completada.",
    };
  }

  if (rawStatus === "pickup_available") {
    return {
      key: "pickup_available",
      label: "Disponible para recoger",
      tone: "orange" as ShipmentStatusTone,
      description: "El pedido está listo para recogida en punto CTT.",
    };
  }

  if (rawStatus === "out_for_delivery") {
    return {
      key: "out_for_delivery",
      label: "En reparto",
      tone: "sky" as ShipmentStatusTone,
      description: "Última milla activa.",
    };
  }

  if (rawStatus === "in_transit") {
    return {
      key: "in_transit",
      label: "En tr��nsito",
      tone: "blue" as ShipmentStatusTone,
      description: "La expedición ya está en movimiento dentro de CTT.",
    };
  }

  if (rawStatus === "label_created" || order.status === "shipped") {
    return {
      key: "label_created",
      label: "Etiqueta creada",
      tone: "indigo" as ShipmentStatusTone,
      description: "Shipment creado, pendiente de avance logístico.",
    };
  }

  return {
    key: "pending",
    label: "Pendiente",
    tone: "slate" as ShipmentStatusTone,
    description: "La expedición sigue esperando movimiento.",
  };
}

function getStatusBadgeClass(tone: ShipmentStatusTone) {
  return `shipments-status-pill shipments-status-pill-${tone}`;
}

function getOrderStateLabel(order: Order) {
  switch (order.status) {
    case "pending":
      return "Pedido recibido";
    case "in_progress":
      return "En preparación";
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
  if (!value) return null;
  return Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 36e5));
}

function daysBetween(start?: string | null, end?: string | null) {
  if (!start || !end) return null;
  const difference = new Date(end).getTime() - new Date(start).getTime();
  if (difference < 0) return null;
  return difference / 36e5 / 24;
}

function formatHoursAsShort(value: number | null) {
  if (value === null || Number.isNaN(value)) return "—";
  if (value >= 48) return `${Math.round(value / 24)}d`;
  return `${Math.round(value)}h`;
}

function formatDaysAsReadable(value: number | null) {
  if (value === null || Number.isNaN(value)) return "—";
  if (value < 1) return `${Math.round(value * 24)}h`;
  return `${value.toFixed(1).replace(".", ",")} días`;
}

function isWithinRange(value: string, dateFrom: string, dateTo: string) {
  const time = new Date(value).getTime();
  const from = new Date(`${dateFrom}T00:00:00`).getTime();
  const to = new Date(`${dateTo}T23:59:59`).getTime();
  return time >= from && time <= to;
}

function matchesSearch(order: Order, search: string) {
  if (!search) return true;
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

function getDeliveredAt(order: Order) {
  const deliveredEvent = getShipmentEvents(order).find((event) => event.status_norm === "delivered");
  return deliveredEvent?.occurred_at ?? null;
}

function isStalled(order: Order) {
  if (!order.shipment || order.has_open_incident) return false;
  const status = getShipmentStatus(order).key;
  if (status !== "in_transit" && status !== "label_created" && status !== "pending") return false;
  const latestEvent = getLatestTrackingEvent(order);
  const latestDate = latestEvent?.occurred_at ?? order.shipment.created_at;
  const age = hoursSince(latestDate);
  return age !== null && age >= 48;
}

function filterByQuick(order: Order, filter: ShipmentQuickFilter) {
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

function getAttentionReason(order: Order) {
  if (!order.shipment) return "Pedido sin expedición creada";
  if (!order.shipment.tracking_number) return "Shipment sin tracking CTT";
  if (order.has_open_incident) return "Incidencia abierta";
  if (getShipmentStatus(order).key === "pickup_available") return "Disponible para recoger";
  if (isStalled(order)) return "Tracking sin movimiento reciente";
  if (getShipmentStatus(order).key === "pending" || getShipmentStatus(order).key === "label_created") {
    const age = hoursSince(order.shipment.created_at);
    if (age !== null && age >= 24) return "Pendiente demasiado tiempo";
  }
  return null;
}

function formatTimelineLabel(statusNorm?: string | null) {
  switch (statusNorm) {
    case "label_created":
      return "Etiqueta creada";
    case "in_transit":
      return "En tránsito";
    case "out_for_delivery":
      return "En reparto";
    case "delivered":
      return "Entregado";
    case "exception":
      return "Incidencia";
    case "pickup_available":
      return "Disponible para recoger";
    default:
      return "Actualización";
  }
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

function buildShipmentRowAnchor(orderId: string | number) {
  return `shipment-row-${orderId}`;
}

const TONE_COLORS: Record<ShipmentStatusTone, string> = {
  slate: "#94a3b8",
  blue: "#2563eb",
  indigo: "#4f46e5",
  sky: "#0ea5e9",
  green: "#059669",
  orange: "#d97706",
  red: "#e53935",
};

export function SharedShipmentsView({
  basePath,
  detailBasePath,
  title,
  subtitle,
  heroEyebrow = "Expediciones",
  orders,
  shops,
  integrations,
  analytics,
  selectedShopId = "",
  q,
  quick,
  period,
  dateFrom,
  dateTo,
  perPage,
  selected,
  allowAllShops = false,
  syncSlot,
  syncHint = "Selecciona una tienda para sincronizar.",
  shopFieldHelp,
}: SharedShipmentsViewProps) {
  const canAccessLabels = !basePath.startsWith("/portal");
  const shopMap = new Map(shops.map((shop) => [shop.id, shop.name]));
  const integrationMap = new Map(integrations.map((integration) => [integration.shop_id, integration]));
  const filteredOrders = orders
    .filter((order) => isWithinRange(order.created_at, dateFrom, dateTo))
    .filter((order) => matchesSearch(order, q))
    .filter((order) => filterByQuick(order, quick));

  const selectedOrder =
    filteredOrders.find((order) => String(order.id) === selected) ??
    filteredOrders[0] ??
    null;

  // ── Status breakdown ──
  const statusBreakdown = [
    {
      key: "pending",
      label: "Pendiente",
      value: filteredOrders.filter((o) => {
        const k = getShipmentStatus(o).key;
        return k === "pending" || k === "label_created" || k === "without_shipment";
      }).length,
      tone: "slate" as ShipmentStatusTone,
    },
    { key: "in_transit", label: "En tránsito", value: filteredOrders.filter((o) => getShipmentStatus(o).key === "in_transit").length, tone: "blue" as ShipmentStatusTone },
    { key: "out_for_delivery", label: "En reparto", value: filteredOrders.filter((o) => getShipmentStatus(o).key === "out_for_delivery").length, tone: "sky" as ShipmentStatusTone },
    { key: "delivered", label: "Entregado", value: filteredOrders.filter((o) => getShipmentStatus(o).key === "delivered").length, tone: "green" as ShipmentStatusTone },
    { key: "exception", label: "Incidencia", value: filteredOrders.filter((o) => getShipmentStatus(o).key === "exception").length, tone: "red" as ShipmentStatusTone },
    { key: "pickup_available", label: "Recogida", value: filteredOrders.filter((o) => getShipmentStatus(o).key === "pickup_available").length, tone: "orange" as ShipmentStatusTone },
  ];
  const visibleStatusBreakdown = statusBreakdown.filter((s) => s.value > 0);
  const sortedStatusBreakdown = [...visibleStatusBreakdown].sort((a, b) => b.value - a.value);
  const total = Math.max(filteredOrders.length, 1);

  // ── KPI values ──
  const ordersToday = filteredOrders.filter((o) => isWithinRange(o.created_at, toDateInputValue(new Date()), toDateInputValue(new Date()))).length;
  const delivered = statusBreakdown.find((s) => s.key === "delivered")?.value ?? 0;
  const inTransit = (statusBreakdown.find((s) => s.key === "in_transit")?.value ?? 0) + (statusBreakdown.find((s) => s.key === "out_for_delivery")?.value ?? 0);
  const incidents = statusBreakdown.find((s) => s.key === "exception")?.value ?? 0;
  const withoutTracking = filteredOrders.filter((o) => o.shipment && !o.shipment.tracking_number).length;
  const stalledCount = filteredOrders.filter((o) => isStalled(o)).length;
  const onTimeDeliveryPct = analytics.operational.delivered_in_sla_rate;
  const exceptionRatePct = analytics.operational.incident_rate;

  const deliveredLeadTimes = filteredOrders
    .map((o) => daysBetween(o.created_at, getDeliveredAt(o)))
    .filter((v): v is number => v !== null);
  const avgDeliveryDays =
    deliveredLeadTimes.length > 0
      ? deliveredLeadTimes.reduce((sum, v) => sum + v, 0) / deliveredLeadTimes.length
      : analytics.operational.avg_shipping_to_delivery_hours !== null
        ? analytics.operational.avg_shipping_to_delivery_hours / 24
        : null;
  const avgTransitHours =
    analytics.flow.avg_label_to_transit_hours !== null && analytics.flow.avg_transit_to_delivery_hours !== null
      ? analytics.flow.avg_label_to_transit_hours + analytics.flow.avg_transit_to_delivery_hours
      : analytics.operational.avg_shipping_to_delivery_hours;

  const deliveredPct = Math.round((delivered / total) * 100);
  const inTransitPct = Math.round((inTransit / total) * 100);
  const exceptionPct = Math.round((incidents / total) * 100);

  // ── Attention ──
  const attentionOrders = filteredOrders
    .map((order) => ({ order, reason: getAttentionReason(order), latest: getLatestTrackingEvent(order) }))
    .filter((e) => e.reason)
    .sort((a, b) => {
      const aAge = hoursSince(a.latest?.occurred_at ?? a.order.shipment?.created_at ?? a.order.created_at) ?? 0;
      const bAge = hoursSince(b.latest?.occurred_at ?? b.order.shipment?.created_at ?? b.order.created_at) ?? 0;
      return bAge - aAge;
    });

  const attentionCategories = [
    { label: "Tracking parado", icon: "⏸️", iconTone: "is-danger", count: filteredOrders.filter((o) => isStalled(o)).length },
    { label: "Sin tracking", icon: "🔍", iconTone: "is-warning", count: filteredOrders.filter((o) => o.shipment && !o.shipment.tracking_number).length },
    { label: "Sin shipment", icon: "📦", iconTone: "is-muted", count: filteredOrders.filter((o) => !o.shipment).length },
    { label: "Pendiente +24h", icon: "⏰", iconTone: "is-warning", count: filteredOrders.filter((o) => {
      if (!o.shipment) return false;
      const k = getShipmentStatus(o).key;
      if (k !== "pending" && k !== "label_created") return false;
      const age = hoursSince(o.shipment.created_at);
      return age !== null && age >= 24;
    }).length },
    { label: "Incidencias", icon: "⚠️", iconTone: "is-danger", count: incidents },
    { label: "Excepción carrier", icon: "🚨", iconTone: "is-danger", count: filteredOrders.filter((o) => {
      const latest = getLatestTrackingEvent(o);
      return latest?.status_norm === "exception" && !o.has_open_incident;
    }).length },
  ];
  const totalAttention = attentionOrders.length;

  // ── Charts ──
  const chartDays = analytics.charts.orders_by_day.slice(-7);
  const maxDay = Math.max(...chartDays.map((d) => d.total), 1);
  const bars = chartDays.map((d) => ({
    ...d,
    height: Math.max(10, Math.round((d.total / maxDay) * 100)),
    deliveredHeight: Math.max(0, Math.round(((d.delivered ?? 0) / maxDay) * 100)),
    exceptionHeight: Math.max(0, Math.round(((d.exception ?? 0) / maxDay) * 100)),
    label: new Intl.DateTimeFormat("es-ES", { weekday: "short" }).format(new Date(d.date)),
  }));

  // ── Efficiency / flow ──
  const flow = analytics.flow;
  const aging: AgingBuckets = analytics.operational.aging_buckets ?? { bucket_0_24: 0, bucket_24_48: 0, bucket_48_72: 0, bucket_72_plus: 0 };
  const agingTotal = Math.max(aging.bucket_0_24 + aging.bucket_24_48 + aging.bucket_48_72 + aging.bucket_72_plus, 1);

  const selectedIntegration =
    (selectedShopId ? integrationMap.get(Number(selectedShopId)) : null) ??
    integrations
      .filter((i) => i.last_synced_at)
      .sort((a, b) => new Date(b.last_synced_at ?? 0).getTime() - new Date(a.last_synced_at ?? 0).getTime())[0] ??
    null;

  const rangeShortcuts = getRangeShortcuts(dateTo);
  const isCustomPeriod = period === "custom";

  const quickFilters: Array<{ value: ShipmentQuickFilter; label: string }> = [
    { value: "all", label: "Todos" },
    { value: "without_shipment", label: "Sin shipment" },
    { value: "without_tracking", label: "Sin tracking" },
    { value: "pending", label: "Pendientes" },
    { value: "in_transit", label: "En tránsito" },
    { value: "delivered", label: "Entregados" },
    { value: "incident", label: "Incidencia" },
    { value: "stalled", label: "Atascados" },
  ];

  const buildScopedOrderHref = (orderId: string | number) =>
    `${detailBasePath}/${orderId}${selectedShopId ? `?shop_id=${selectedShopId}` : ""}`;

  const buildSelectedShipmentHref = (orderId: string | number) =>
    `${basePath}${buildQuery({
      shop_id: selectedShopId,
      q,
      quick,
      period,
      date_from: dateFrom,
      date_to: dateTo,
      per_page: perPage,
      selected: orderId,
    })}#${buildShipmentRowAnchor(orderId)}`;

  const kpis = [
    { icon: "📦", label: "Creadas", value: String(filteredOrders.length), hint: `${ordersToday} hoy`, tone: "tone-accent" },
    { icon: "✅", label: "Entregadas", value: String(delivered), hint: `${deliveredPct}% del total`, tone: "tone-green" },
    { icon: "🚚", label: "En tránsito", value: String(inTransit), hint: `${inTransitPct}% activas`, tone: "tone-blue" },
    { icon: "⚠️", label: "Incidencias", value: String(incidents), hint: `${exceptionPct}% del total`, tone: "tone-red" },
    { icon: "🔍", label: "Sin tracking", value: String(withoutTracking), hint: "shipment sin número", tone: "tone-orange" },
    { icon: "⏸️", label: "Atascados", value: String(stalledCount), hint: "sin novedad 48h+", tone: "tone-slate" },
    { icon: "🎯", label: "On-time delivery", value: onTimeDeliveryPct !== null ? `${onTimeDeliveryPct}%` : "—", hint: "entregado en SLA", tone: "tone-green" },
    { icon: "🔴", label: "Exception rate", value: exceptionRatePct !== null ? `${exceptionRatePct}%` : "—", hint: "% con incidencia", tone: "tone-red" },
    { icon: "⏱️", label: "Transit time", value: formatHoursAsShort(avgTransitHours), hint: "etiqueta a entrega", tone: "tone-blue" },
    { icon: "🏁", label: "Pedido → entrega", value: formatDaysAsReadable(avgDeliveryDays), hint: "ciclo completo", tone: "tone-accent" },
  ];

  return (
    <div className="stack sct-page">
      {/* ═══ 1. OPERATIVE HEADER ═══ */}
      <Card className="stack sct-header">
        <div className="sct-header-top">
          <div className="sct-header-copy">
            <span className="eyebrow">{heroEyebrow}</span>
            <h1 className="sct-title">{title}</h1>
            <p className="sct-subtitle">{subtitle}</p>
          </div>
          <div className="sct-sync">
            <span className="sct-sync-label">Última sincronización</span>
            <strong>
              {selectedIntegration?.last_synced_at
                ? formatDateTime(selectedIntegration.last_synced_at)
                : "Sin sincronizar"}
            </strong>
            {syncSlot ?? <span className="table-secondary">{syncHint}</span>}
          </div>
        </div>

        <div className="sct-range-row">
          <span className="sct-range-label">Periodo</span>
          {rangeShortcuts.map((s) => {
            const href = buildQuery({ shop_id: selectedShopId, quick, q, period: s.value, date_from: s.dateFrom || undefined, date_to: s.dateTo || undefined, per_page: perPage });
            return (
              <Link className={`sct-range-pill${s.value === period ? " is-active" : ""}`} href={`${basePath}${href}`} key={s.label}>
                {s.label}
              </Link>
            );
          })}
        </div>

        <form action={basePath} className="sct-toolbar" method="get">
          <input name="period" type="hidden" value={period} />
          <input name="quick" type="hidden" value={quick} />
          <div className="field sct-search-field">
            <label htmlFor={`${basePath}-q`}>Buscar</label>
            <input defaultValue={q} id={`${basePath}-q`} name="q" placeholder="Pedido, cliente, tracking…" type="search" />
          </div>
          <div className="field">
            <label htmlFor={`${basePath}-shop_id`}>Tienda</label>
            <select defaultValue={selectedShopId} id={`${basePath}-shop_id`} name="shop_id">
              {allowAllShops ? <option value="">Todas</option> : null}
              {shops.map((shop) => (
                <option key={shop.id} value={shop.id}>{shop.name}</option>
              ))}
            </select>
          </div>
          {isCustomPeriod ? (
            <>
              <div className="field">
                <label htmlFor={`${basePath}-date_from`}>Desde</label>
                <input defaultValue={dateFrom} id={`${basePath}-date_from`} name="date_from" type="date" />
              </div>
              <div className="field">
                <label htmlFor={`${basePath}-date_to`}>Hasta</label>
                <input defaultValue={dateTo} id={`${basePath}-date_to`} name="date_to" type="date" />
              </div>
            </>
          ) : (
            <>
              <input name="date_from" type="hidden" value={dateFrom} />
              <input name="date_to" type="hidden" value={dateTo} />
            </>
          )}
          <div className="field">
            <label htmlFor={`${basePath}-per_page`}>Cargar</label>
            <select defaultValue={String(perPage)} id={`${basePath}-per_page`} name="per_page">
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="250">250</option>
              <option value="500">500</option>
            </select>
          </div>
          <button className="button" type="submit">{isCustomPeriod ? "Aplicar rango" : "Aplicar"}</button>
        </form>

        <div className="sct-quick-row">
          <span className="sct-range-label">Estado</span>
          {quickFilters.map((f) => {
            const href = buildQuery({ shop_id: selectedShopId, quick: f.value, q, period, date_from: dateFrom, date_to: dateTo, per_page: perPage });
            return (
              <Link className={`sct-quick-pill${quick === f.value ? " is-active" : ""}`} href={`${basePath}${href}`} key={f.value}>
                {f.label}
              </Link>
            );
          })}
        </div>
      </Card>

      {/* ═══ 2. DONUT HERO ═══ */}
      <Card className="sct-donut-hero">
        <div className="sct-donut-hero-header">
          <span className="eyebrow">📊 Estado actual</span>
          <h2 className="section-title">Distribución de expediciones</h2>
        </div>
        <div className="sct-donut-hero-grid">
          <div className="sct-donut-hero-chart">
            <ShipmentDonut segments={statusBreakdown} size={252} strokeWidth={18} radius={98} showLegend={false} showTotal={false} variant="hero" />
          </div>
          <div className="sct-donut-hero-side">
            <div className="sct-hero-summary-strip">
              <div className="sct-hero-total-card">
                <span>Total visible</span>
                <strong>{filteredOrders.length}</strong>
                <small>expediciones en el periodo</small>
              </div>
              <div className="sct-exec-summary">
                <div className="sct-exec-card">
                  <span>Entregado</span>
                  <strong>{deliveredPct}%</strong>
                  <small>{delivered} cierres confirmados</small>
                </div>
                <div className="sct-exec-card">
                  <span>En tránsito</span>
                  <strong>{inTransitPct}%</strong>
                  <small>{inTransit} expediciones activas</small>
                </div>
                <div className="sct-exec-card">
                  <span>Excepción</span>
                  <strong>{exceptionPct}%</strong>
                  <small>{incidents} con incidencia</small>
                </div>
              </div>
            </div>
            <div className="sct-legend-panel">
              <div className="sct-legend-panel-head">
                <span className="eyebrow">Breakdown por estado</span>
              </div>
              <div className="sct-legend-rows">
                {sortedStatusBreakdown.map((s) => {
                  const percentage = Math.round((s.value / total) * 100);
                  return (
                    <div className="sct-legend-row" key={s.key}>
                      <div className="sct-legend-row-main">
                        <div className="sct-legend-row-label">
                          <span className="sct-legend-dot" style={{ background: TONE_COLORS[s.tone] }} />
                          <strong>{s.label}</strong>
                        </div>
                        <div className="sct-legend-row-stats">
                          <span>{s.value}</span>
                          <span>{percentage}%</span>
                        </div>
                      </div>
                      <div className="sct-legend-row-bar">
                        <div
                          className="sct-legend-row-fill"
                          style={{ width: `${Math.max(6, percentage)}%`, background: TONE_COLORS[s.tone] }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* ═══ 3. SHIPPING PERFORMANCE KPIs ═══ */}
      <section className="sct-kpis">
        {kpis.map((k) => (
          <Card className={`sct-kpi ${k.tone}`} key={k.label}>
            <span className="sct-kpi-label"><span className="sct-kpi-icon">{k.icon}</span> {k.label}</span>
            <strong>{k.value}</strong>
            <span className="sct-kpi-hint">{k.hint}</span>
          </Card>
        ))}
      </section>

      {/* ═══ 4. NEEDS ATTENTION ═══ */}
      <Card className="sct-attention">
        <details className="sct-attention-details">
          <summary className="sct-attention-summary">
            <div className="sct-attention-header">
              <div>
                <span className="eyebrow">🚨 Necesita atención</span>
                <h2 className="section-title section-title-small">Expediciones en riesgo</h2>
                <p className="table-secondary">{totalAttention} {totalAttention === 1 ? "caso requiere" : "casos requieren"} revisión.</p>
              </div>
              <div className="sct-attention-badge">{totalAttention}</div>
            </div>

            <div className="sct-attention-cats">
              {attentionCategories.filter((c) => c.count > 0).map((c) => (
                <div className="sct-attention-cat" key={c.label}>
                  <div className={`sct-attention-cat-icon ${c.iconTone}`}>{c.icon}</div>
                  <div className="sct-attention-cat-copy">
                    <strong>{c.count}</strong>
                    <span>{c.label}</span>
                  </div>
                </div>
              ))}
              {attentionCategories.every((c) => c.count === 0) && (
                <p className="table-secondary">Sin expediciones en riesgo en este rango.</p>
              )}
            </div>
          </summary>

          {attentionOrders.length > 0 && (
            <div className="sct-attention-list">
              {attentionOrders.slice(0, 8).map(({ order, reason, latest }) => (
                <Link
                  className="sct-attention-row"
                  href={buildSelectedShipmentHref(order.id)}
                  key={order.id}
                >
                  <div>
                    <div className="table-primary">{order.external_id}</div>
                    <div className="table-secondary">{shopMap.get(order.shop_id) ?? `Shop #${order.shop_id}`}</div>
                  </div>
                  <div>
                    <div className="table-primary">{reason}</div>
                    <div className="table-secondary">
                      {latest?.occurred_at ? `Último evento ${formatDateTime(latest.occurred_at)}` : "Sin evento reciente"}
                    </div>
                  </div>
                  <div className="sct-attention-row-meta">
                    <strong>{formatHoursAsShort(hoursSince(latest?.occurred_at ?? order.shipment?.created_at ?? order.created_at))}</strong>
                    <span className="table-secondary">sin novedad</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </details>
      </Card>

      {/* ═══ 5. TEMPORAL EVOLUTION ═══ */}
      <section className="sct-evolution">
        <Card className="stack sct-chart-card">
          <div className="sct-chart-header">
            <div>
              <span className="eyebrow">📈 Evolución</span>
              <h3 className="section-title section-title-small">Expediciones por día</h3>
            </div>
          </div>
          <div className="sct-bar-chart">
            {bars.map((bar) => (
              <div className="sct-bar-group" key={bar.date}>
                <div className="sct-bar-track">
                  <div className="sct-bar-fill is-primary" style={{ height: `${bar.height}%` }} />
                </div>
                <span className="sct-bar-value">{bar.total}</span>
                <span className="sct-bar-label">{bar.label}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="stack sct-chart-card">
          <div className="sct-chart-header">
            <div>
              <span className="eyebrow">✅ Calidad operativa</span>
              <h3 className="section-title section-title-small">Entregadas vs incidencias</h3>
            </div>
          </div>
          <div className="sct-compare-rows">
            <div className="sct-compare-row">
              <span>Entregadas</span>
              <div className="sct-compare-track">
                <div className="sct-compare-fill is-green" style={{ width: `${Math.max(6, (delivered / Math.max(delivered + incidents, 1)) * 100)}%` }} />
              </div>
              <strong>{delivered}</strong>
            </div>
            <div className="sct-compare-row">
              <span>Incidencias</span>
              <div className="sct-compare-track">
                <div className="sct-compare-fill is-red" style={{ width: `${Math.max(6, (incidents / Math.max(delivered + incidents, 1)) * 100)}%` }} />
              </div>
              <strong>{incidents}</strong>
            </div>
          </div>
          {onTimeDeliveryPct !== null && (
            <div className="sct-compare-rows" style={{ marginTop: 10 }}>
              <div className="sct-compare-row">
                <span>On-time</span>
                <div className="sct-compare-track">
                  <div className="sct-compare-fill is-green" style={{ width: `${onTimeDeliveryPct}%` }} />
                </div>
                <strong>{onTimeDeliveryPct}%</strong>
              </div>
            </div>
          )}
        </Card>

        <Card className="stack sct-chart-card">
          <div className="sct-chart-header">
            <div>
              <span className="eyebrow">⏱️ Velocidad</span>
              <h3 className="section-title section-title-small">Tiempo de entrega</h3>
            </div>
          </div>
          <div className="sct-flow-metric">
            <div className="sct-flow-metric-hero">
              <strong>{formatDaysAsReadable(avgDeliveryDays)}</strong>
              <span>promedio pedido a entrega</span>
            </div>
            <div className="sct-flow-phases">
              <div className="sct-flow-phase">
                <span>Pedido → Etiqueta</span>
                <strong>{formatHoursAsShort(flow.avg_order_to_label_hours)}</strong>
              </div>
              <div className="sct-flow-phase">
                <span>Etiqueta → Tránsito</span>
                <strong>{formatHoursAsShort(flow.avg_label_to_transit_hours)}</strong>
              </div>
              <div className="sct-flow-phase">
                <span>Tránsito → Entrega</span>
                <strong>{formatHoursAsShort(flow.avg_transit_to_delivery_hours)}</strong>
              </div>
            </div>
          </div>
        </Card>
      </section>

      {/* ═══ 6. LOGISTICS EFFICIENCY ═══ */}
      <Card className="sct-efficiency">
        <div>
          <span className="eyebrow">⚡ Eficiencia logística</span>
          <h2 className="section-title section-title-small">Rendimiento de la cadena de envío</h2>
        </div>
        <div className="sct-efficiency-grid">
          <div>
            <div className="sct-sla-grid">
              <div className="sct-sla-card is-green">
                <strong>{analytics.operational.sent_in_sla_rate !== null ? `${analytics.operational.sent_in_sla_rate}%` : "—"}</strong>
                <span>Enviado en SLA (48h)</span>
              </div>
              <div className="sct-sla-card is-green">
                <strong>{onTimeDeliveryPct !== null ? `${onTimeDeliveryPct}%` : "—"}</strong>
                <span>Entregado en SLA (72h)</span>
              </div>
            </div>
            <div className="sct-efficiency-phases">
              <div className="sct-efficiency-phase">
                <span className="sct-efficiency-phase-label">Pedido → Etiqueta</span>
                <span className="sct-efficiency-phase-value">{formatHoursAsShort(flow.avg_order_to_label_hours)}</span>
              </div>
              <div className="sct-efficiency-phase">
                <span className="sct-efficiency-phase-label">Etiqueta → Tránsito</span>
                <span className="sct-efficiency-phase-value">{formatHoursAsShort(flow.avg_label_to_transit_hours)}</span>
              </div>
              <div className="sct-efficiency-phase">
                <span className="sct-efficiency-phase-label">Tránsito → Entrega</span>
                <span className="sct-efficiency-phase-value">{formatHoursAsShort(flow.avg_transit_to_delivery_hours)}</span>
              </div>
              <div className="sct-efficiency-phase">
                <span className="sct-efficiency-phase-label">Ciclo completo</span>
                <span className="sct-efficiency-phase-value">{formatHoursAsShort(flow.avg_total_hours)}</span>
              </div>
            </div>
          </div>
          <div>
            <div className="sct-aging-section">
              <h4>Aging de expediciones activas</h4>
              <div className="sct-aging-bar">
                {aging.bucket_0_24 > 0 && <div className="sct-aging-segment is-green" style={{ width: `${(aging.bucket_0_24 / agingTotal) * 100}%` }} />}
                {aging.bucket_24_48 > 0 && <div className="sct-aging-segment is-blue" style={{ width: `${(aging.bucket_24_48 / agingTotal) * 100}%` }} />}
                {aging.bucket_48_72 > 0 && <div className="sct-aging-segment is-orange" style={{ width: `${(aging.bucket_48_72 / agingTotal) * 100}%` }} />}
                {aging.bucket_72_plus > 0 && <div className="sct-aging-segment is-red" style={{ width: `${(aging.bucket_72_plus / agingTotal) * 100}%` }} />}
              </div>
              <div className="sct-aging-legend">
                <div className="sct-aging-legend-item">
                  <span className="sct-aging-legend-dot" style={{ background: "var(--success)" }} />
                  0–24h <strong>{aging.bucket_0_24}</strong>
                </div>
                <div className="sct-aging-legend-item">
                  <span className="sct-aging-legend-dot" style={{ background: "#2563eb" }} />
                  24–48h <strong>{aging.bucket_24_48}</strong>
                </div>
                <div className="sct-aging-legend-item">
                  <span className="sct-aging-legend-dot" style={{ background: "#d97706" }} />
                  48–72h <strong>{aging.bucket_48_72}</strong>
                </div>
                <div className="sct-aging-legend-item">
                  <span className="sct-aging-legend-dot" style={{ background: "var(--danger)" }} />
                  +72h <strong>{aging.bucket_72_plus}</strong>
                </div>
              </div>
            </div>

            <div className="sct-aging-section" style={{ marginTop: 20 }}>
              <h4>Resumen operativo</h4>
              <div className="sct-efficiency-phases">
                <div className="sct-efficiency-phase">
                  <span className="sct-efficiency-phase-label">Bloqueados</span>
                  <span className="sct-efficiency-phase-value">{analytics.operational.blocked_orders}</span>
                </div>
                <div className="sct-efficiency-phase">
                  <span className="sct-efficiency-phase-label">Sin shipment</span>
                  <span className="sct-efficiency-phase-value">{analytics.operational.orders_without_shipment}</span>
                </div>
                <div className="sct-efficiency-phase">
                  <span className="sct-efficiency-phase-label">Tracking parado</span>
                  <span className="sct-efficiency-phase-value">{analytics.operational.stalled_tracking_orders}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* ═══ 7. OPERATIVE TABLE ═══ */}
      <section className="sct-table-section">
        <div className="sct-workbench">
          <Card className="stack table-card sct-table-card">
            <div className="table-header">
              <div>
                <span className="eyebrow">📋 Expediciones</span>
                <h3 className="section-title section-title-small">Mesa de seguimiento</h3>
              </div>
              <div className="muted">Mostrando {filteredOrders.length} pedidos</div>
            </div>

            {filteredOrders.length === 0 ? (
              <EmptyState title="Sin expediciones en esta vista" description="Ajusta rango, búsqueda o filtros para revisar otro bloque de pedidos." />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Pedido</th>
                      <th>Tienda</th>
                      <th>Cliente</th>
                      <th>Tracking</th>
                      <th>Estado envío</th>
                      <th>Último evento</th>
                      <th>Sin novedad</th>
                      <th>Riesgo</th>
                      <th>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOrders.map((order) => {
                      const latest = getLatestTrackingEvent(order);
                      const shipmentStatus = getShipmentStatus(order);
                      const latestAt = latest?.occurred_at ?? order.shipment?.created_at ?? order.created_at;
                      const trackingLink = order.shipment?.tracking_url;
                      const risk = getAttentionReason(order);
                      return (
                        <tr className="table-row" id={buildShipmentRowAnchor(order.id)} key={order.id}>
                          <td className="table-primary">{order.external_id}</td>
                          <td>{shopMap.get(order.shop_id) ?? `Shop #${order.shop_id}`}</td>
                          <td>
                            <div className="table-primary">{order.customer_name}</div>
                            <div className="table-secondary">{order.customer_email}</div>
                          </td>
                          <td>
                            {order.shipment?.tracking_number ? (
                              <div>
                                {trackingLink ? (
                                  <a className="table-link" href={trackingLink} rel="noreferrer" target="_blank">{order.shipment.tracking_number}</a>
                                ) : (
                                  <span className="table-primary">{order.shipment.tracking_number}</span>
                                )}
                                <div className="table-secondary">{normalizeCarrierName(order.shipment?.carrier)}</div>
                              </div>
                            ) : (
                              <div>
                                <span className="table-primary">Pendiente</span>
                                <div className="table-secondary">{order.shipment ? "Sin tracking" : "Sin shipment"}</div>
                              </div>
                            )}
                          </td>
                          <td>
                            <div className="orders-status-stack">
                              <span className={getStatusBadgeClass(shipmentStatus.tone)}>{shipmentStatus.label}</span>
                              {order.automation_flags.length > 0 ? (
                                <div className="automation-flag-row">
                                  {order.automation_flags.slice(0, 2).map((flag) => (
                                    <AutomationFlagBadge flag={flag} key={`${order.id}-${flag.key}`} />
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          </td>
                          <td>
                            <div className="table-primary">{latest ? formatTimelineLabel(latest.status_norm) : shipmentStatus.label}</div>
                            <div className="table-secondary">{formatDateTime(latestAt)}</div>
                          </td>
                          <td>{formatHoursAsShort(hoursSince(latestAt))}</td>
                          <td>
                            {risk ? (
                              <span className={`sct-risk-badge ${risk.includes("Incidencia") || risk.includes("Tracking") ? "is-danger" : "is-warning"}`}>
                                {risk}
                              </span>
                            ) : (
                              <span className="sct-risk-badge is-ok">OK</span>
                            )}
                          </td>
                          <td>
                            <Link
                              className="button-secondary table-action"
                              href={buildSelectedShipmentHref(order.id)}
                            >
                              Ver
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

          <Card className="stack sct-drawer">
            {selectedOrder ? (
              <>
                <div className="table-header">
                  <div>
                    <span className="eyebrow">Detalle</span>
                    <h3 className="section-title section-title-small">{selectedOrder.external_id}</h3>
                  </div>
                  <Link className="button-secondary table-action" href={buildScopedOrderHref(selectedOrder.id)}>
                    Ver pedido
                  </Link>
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <span className="sct-sync-label">Tracking CTT</span>
                    <strong>{selectedOrder.shipment?.tracking_number || "Pendiente"}</strong>
                  </div>
                  <span className={getStatusBadgeClass(getShipmentStatus(selectedOrder).tone)}>
                    {getShipmentStatus(selectedOrder).label}
                  </span>
                </div>

                {selectedOrder.automation_flags.length > 0 ? (
                  <div className="automation-flag-row">
                    {selectedOrder.automation_flags.map((flag) => (
                      <AutomationFlagBadge flag={flag} key={`${selectedOrder.id}-${flag.key}`} />
                    ))}
                  </div>
                ) : null}

                {selectedOrder.shipment?.tracking_url ? (
                  <a className="table-link" href={selectedOrder.shipment.tracking_url} rel="noreferrer" target="_blank">
                    Abrir seguimiento oficial de CTT
                  </a>
                ) : (
                  <span className="table-secondary">Aún no hay enlace oficial de seguimiento.</span>
                )}
                {canAccessLabels && getOrderShipmentLabelUrl(selectedOrder) ? (
                  <div className="orders-drawer-inline-links">
                    <a className="table-link" href={getOrderShipmentLabelUrl(selectedOrder) ?? "#"} rel="noreferrer" target="_blank">
                      Ver etiqueta PDF
                    </a>
                    <a className="table-link" download href={getOrderShipmentLabelUrl(selectedOrder, { download: true }) ?? "#"} rel="noreferrer" target="_blank">
                      Descargar
                    </a>
                  </div>
                ) : null}

                <div className="status-summary-list">
                  <div className="status-summary-row">
                    <span>Carrier</span>
                    <strong>{normalizeCarrierName(selectedOrder.shipment?.carrier)}</strong>
                  </div>
                  <div className="status-summary-row">
                    <span>Última actualización</span>
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
                  <div className="status-summary-row">
                    <span>Sync Shopify</span>
                    <strong>
                      {selectedOrder.shipment?.shopify_sync_status === "synced"
                        ? `Sincronizado${selectedOrder.shipment.shopify_synced_at ? ` · ${formatDateTime(selectedOrder.shipment.shopify_synced_at)}` : ""}`
                        : selectedOrder.shipment?.shopify_sync_status || "Pendiente"}
                    </strong>
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
                            <div className="table-secondary">
                              {formatDateTime(event.occurred_at)}
                              {event.location ? ` · ${event.location}` : ""}
                              {event.source ? ` · ${String(event.source).toUpperCase()}` : ""}
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="table-secondary">Shipment creado pero sin eventos sincronizados.</div>
                    )
                  ) : (
                    <div className="table-secondary">Este pedido aún no tiene expedición creada.</div>
                  )}
                </div>
              </>
            ) : (
              <EmptyState title="Selecciona una expedición" description="Abre una fila de la mesa para ver tracking, timeline y detalle." />
            )}
          </Card>
        </div>
      </section>
    </div>
  );
}
