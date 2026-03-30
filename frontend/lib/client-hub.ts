import { sortTrackingEvents } from "@/lib/format";
import type { Order, TrackingEvent } from "@/lib/types";

export type ClientOrderStageKey =
  | "received"
  | "preparing"
  | "prepared"
  | "shipped"
  | "out_for_delivery"
  | "delivered"
  | "incident";

export type PortalOrderQuickFilter =
  | "all"
  | "personalized"
  | "standard"
  | "design_available"
  | "pending_asset"
  | "incident"
  | "not_prepared";

export const clientOrderStageMeta: Record<
  ClientOrderStageKey,
  {
    label: string;
    description: string;
    badgeClassName: string;
  }
> = {
  received: {
    label: "Pedido recibido",
    description: "acaba de entrar en la operativa",
    badgeClassName: "badge badge-status badge-status-pending",
  },
  preparing: {
    label: "En preparación",
    description: "preparándose en nuestro flujo interno",
    badgeClassName: "badge badge-status badge-status-in-progress",
  },
  prepared: {
    label: "Preparado",
    description: "listo para salir con transportista",
    badgeClassName: "badge badge-status badge-status-ready-to-ship",
  },
  shipped: {
    label: "Enviado",
    description: "ya en manos del carrier",
    badgeClassName: "badge badge-status badge-status-shipped",
  },
  out_for_delivery: {
    label: "En reparto",
    description: "última milla en curso",
    badgeClassName: "badge badge-status badge-status-out-for-delivery",
  },
  delivered: {
    label: "Entregado",
    description: "entrega confirmada",
    badgeClassName: "badge badge-status badge-status-delivered",
  },
  incident: {
    label: "Incidencia",
    description: "requiere atención o seguimiento",
    badgeClassName: "badge badge-status badge-status-exception",
  },
};

export function getLatestTrackingEvent(order: Order): TrackingEvent | null {
  if (!order.shipment?.events?.length) {
    return null;
  }

  return sortTrackingEvents(order.shipment.events)[0] ?? null;
}

export function getClientOrderStage(order: Order): ClientOrderStageKey {
  const latestEvent = getLatestTrackingEvent(order);
  const shipmentStatus = latestEvent?.status_norm ?? order.shipment?.shipping_status ?? null;

  if (order.has_open_incident || order.status === "exception" || shipmentStatus === "exception") {
    return "incident";
  }

  if (order.status === "delivered" || shipmentStatus === "delivered") {
    return "delivered";
  }

  if (shipmentStatus === "out_for_delivery") {
    return "out_for_delivery";
  }

  if (
    order.status === "shipped" ||
    shipmentStatus === "in_transit" ||
    shipmentStatus === "pickup_available" ||
    shipmentStatus === "label_created"
  ) {
    return "shipped";
  }

  if (
    order.status === "ready_to_ship" ||
    order.production_status === "packed" ||
    order.production_status === "completed"
  ) {
    return "prepared";
  }

  if (
    order.status === "in_progress" ||
    order.production_status === "in_production" ||
    order.production_status === "pending_personalization"
  ) {
    return "preparing";
  }

  return "received";
}

export function isOrderPrepared(order: Order) {
  return ["packed", "completed"].includes(order.production_status) || order.status === "ready_to_ship";
}

export function matchesPortalOrderQuickFilter(order: Order, filter: PortalOrderQuickFilter) {
  switch (filter) {
    case "all":
      return true;
    case "personalized":
      return order.is_personalized;
    case "standard":
      return !order.is_personalized;
    case "design_available":
      return order.items.some((item) => item.design_status === "design_available");
    case "pending_asset":
      return order.items.some(
        (item) => item.design_status === "pending_asset" || item.design_status === "missing_asset",
      );
    case "incident":
      return order.has_open_incident || getClientOrderStage(order) === "incident";
    case "not_prepared":
      return !isOrderPrepared(order);
    default:
      return true;
  }
}

export function matchesPortalOrderSearch(order: Order, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  const haystack = [
    order.external_id,
    order.customer_name,
    order.customer_email,
    order.shipment?.tracking_number,
    ...order.items.flatMap((item) => [item.title, item.name, item.variant_title, item.sku, item.design_link]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(normalizedQuery);
}
