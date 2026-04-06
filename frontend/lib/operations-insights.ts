import type { Incident, Order, ShopIntegration, TrackingEvent } from "@/lib/types";
import { sortTrackingEvents } from "@/lib/format";

export type ShipmentStateKey =
  | "pending_preparation"
  | "label_created"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "exception";

export const shipmentStateMeta: Record<ShipmentStateKey, { label: string; tone: string; description: string }> = {
  pending_preparation: { label: "Pendiente de preparación", tone: "slate", description: "sin shipment todavía" },
  label_created: { label: "Etiqueta creada", tone: "blue", description: "shipment listo para salir" },
  in_transit: { label: "En tránsito", tone: "indigo", description: "movimiento activo del carrier" },
  out_for_delivery: { label: "En reparto", tone: "sky", description: "última milla en curso" },
  delivered: { label: "Entregado", tone: "green", description: "cierre confirmado" },
  exception: { label: "Excepción", tone: "orange", description: "requiere seguimiento" },
};

export type ActivityItem = {
  id: string;
  occurredAt: string;
  label: string;
  title: string;
  detail: string;
};

export type AttentionItem = {
  id: string;
  orderLabel: string;
  reason: string;
  priority: string;
  href: string;
};

export function toDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function formatDayParam(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function formatPercent(value: number | null) {
  return value === null ? "n/d" : `${Math.round(value)}%`;
}

export function formatHours(value: number | null) {
  return value === null ? "n/d" : `${value.toFixed(value >= 10 ? 0 : 1)}h`;
}

export function formatDays(value: number | null) {
  if (value === null || Number.isNaN(value)) return "n/d";
  if (value < 1) return `${Math.round(value * 24)}h`;
  return `${value.toFixed(1).replace(".", ",")} d`;
}

export function formatNumber(value: number | null) {
  return value === null ? "n/d" : new Intl.NumberFormat("es-ES").format(value);
}

export function withinRange(value: string, dateFrom: string, dateTo: string) {
  const time = new Date(value).getTime();
  const from = new Date(`${dateFrom}T00:00:00`).getTime();
  const to = new Date(`${dateTo}T23:59:59`).getTime();
  return time >= from && time <= to;
}

export function getLatestTrackingEvent(order: Order): TrackingEvent | null {
  if (!order.shipment?.events?.length) return null;
  return sortTrackingEvents(order.shipment.events)[0] ?? null;
}

export function getShipmentState(order: Order): ShipmentStateKey {
  const latestEvent = getLatestTrackingEvent(order);
  const status = latestEvent?.status_norm ?? order.shipment?.shipping_status ?? order.status;
  if (status === "delivered" || order.status === "delivered") return "delivered";
  if (status === "exception" || order.status === "exception" || order.has_open_incident) return "exception";
  if (status === "out_for_delivery") return "out_for_delivery";
  if (status === "in_transit" || status === "pickup_available") return "in_transit";
  if (order.shipment) return "label_created";
  return "pending_preparation";
}

export function buildRecentShipments(orders: Order[]) {
  return orders
    .filter((order) => order.shipment)
    .sort((left, right) => {
      const leftDate = toDate(getLatestTrackingEvent(left)?.occurred_at ?? left.shipment?.created_at ?? left.created_at)?.getTime() ?? 0;
      const rightDate = toDate(getLatestTrackingEvent(right)?.occurred_at ?? right.shipment?.created_at ?? right.created_at)?.getTime() ?? 0;
      return rightDate - leftDate;
    })
    .slice(0, 8);
}

export function buildActivityFeed(
  orders: Order[],
  incidents: Incident[],
  integration: Pick<ShopIntegration, "id" | "last_synced_at" | "last_sync_status" | "shop_domain"> | null,
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

  incidents.slice(0, 10).forEach((incident) => {
    activities.push({
      id: `incident-${incident.id}`,
      occurredAt: incident.updated_at,
      label: "Incidencia",
      title: incident.title,
      detail: `${incident.order.external_id} · ${incident.order.customer_name}`,
    });
  });

  return activities
    .sort((left, right) => (toDate(right.occurredAt)?.getTime() ?? 0) - (toDate(left.occurredAt)?.getTime() ?? 0))
    .slice(0, 8);
}

export function buildAttentionItems(
  analytics: { rankings: { delayed_orders: Array<{ order_id: number; external_id: string; reason: string; age_hours: number }> } },
  orders: Order[],
  incidents: Incident[],
  basePath: string,
  selectedShopId?: string,
) {
  const items: AttentionItem[] = [];
  const shopQuery = selectedShopId ? `?shop_id=${selectedShopId}` : "";

  analytics.rankings.delayed_orders.slice(0, 4).forEach((order) => {
    items.push({
      id: `delayed-${order.order_id}`,
      orderLabel: order.external_id,
      reason: order.reason,
      priority: order.age_hours >= 48 ? "Alta" : "Media",
      href: `${basePath}/${order.order_id}${shopQuery}`,
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
          href: `${basePath}/${order.id}${shopQuery}`,
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
        href: `${basePath}/${incident.order.id}${shopQuery}`,
      });
    }
  });

  return items.slice(0, 8);
}
