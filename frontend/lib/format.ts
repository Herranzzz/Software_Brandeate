import type { DesignStatus, Order, OrderPriority, OrderStatus, ProductionStatus } from "@/lib/types";


export const orderStatusOptions: OrderStatus[] = [
  "pending",
  "in_progress",
  "ready_to_ship",
  "shipped",
  "delivered",
  "exception",
];

export const productionStatusOptions: ProductionStatus[] = [
  "pending_personalization",
  "in_production",
  "packed",
  "completed",
];

export const orderPriorityOptions: OrderPriority[] = [
  "low",
  "normal",
  "high",
  "urgent",
];


const orderStatusMeta: Record<OrderStatus, { className: string; label: string }> = {
  pending: { className: "badge badge-status badge-status-pending", label: "Pending" },
  in_progress: { className: "badge badge-status badge-status-in-progress", label: "In progress" },
  ready_to_ship: {
    className: "badge badge-status badge-status-ready-to-ship",
    label: "Ready to ship",
  },
  shipped: { className: "badge badge-status badge-status-shipped", label: "Shipped" },
  delivered: { className: "badge badge-status badge-status-delivered", label: "Delivered" },
  exception: { className: "badge badge-status badge-status-exception", label: "Exception" },
};


const productionStatusMeta: Record<ProductionStatus, { className: string; label: string }> = {
  pending_personalization: {
    className: "badge badge-production badge-production-pending",
    label: "Pending personalization",
  },
  in_production: {
    className: "badge badge-production badge-production-in-production",
    label: "In production",
  },
  packed: { className: "badge badge-production badge-production-packed", label: "Packed" },
  completed: {
    className: "badge badge-production badge-production-completed",
    label: "Completed",
  },
};

const designStatusMeta: Record<DesignStatus, { className: string; label: string }> = {
  design_available: {
    className: "badge badge-design badge-design-ready",
    label: "Diseño disponible",
  },
  pending_asset: {
    className: "badge badge-design badge-design-pending",
    label: "Pendiente de asset",
  },
  missing_asset: {
    className: "badge badge-design badge-design-missing",
    label: "Sin diseño",
  },
};

const orderPriorityMeta: Record<OrderPriority, { className: string; label: string }> = {
  low: { className: "badge badge-priority badge-priority-low", label: "Low" },
  normal: { className: "badge badge-priority badge-priority-normal", label: "Normal" },
  high: { className: "badge badge-priority badge-priority-high", label: "High" },
  urgent: { className: "badge badge-priority badge-priority-urgent", label: "Urgent" },
};


export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}


export function getOrderStatusMeta(status: OrderStatus) {
  return orderStatusMeta[status];
}


export function getProductionStatusMeta(status: ProductionStatus) {
  return productionStatusMeta[status];
}


export function getDesignStatusLabel(status: DesignStatus) {
  return designStatusMeta[status].label;
}


export function getDesignStatusStyles(status: DesignStatus) {
  return designStatusMeta[status];
}


export function getOrderPriorityMeta(priority: OrderPriority) {
  return orderPriorityMeta[priority];
}


export function getOrderDesignStatus(order: Order): DesignStatus | null {
  const statuses = order.items
    .map((item) => item.design_status)
    .filter((status): status is DesignStatus => status !== null);

  if (statuses.length === 0) {
    return null;
  }
  if (statuses.includes("missing_asset")) {
    return "missing_asset";
  }
  if (statuses.includes("pending_asset")) {
    return "pending_asset";
  }
  return "design_available";
}


export function getTrackingHeadline(status: OrderStatus, latestEventStatus?: string | null) {
  const current = latestEventStatus ?? status;

  if (status === "delivered" || current === "delivered") {
    return {
      title: "Pedido entregado",
      description: "El envio ya fue entregado. Si algo no coincide, revisa el historial debajo.",
    };
  }

  if (status === "exception" || current === "exception") {
    return {
      title: "Incidencia en el envio",
      description: "El carrier reporto una excepcion. Conviene revisar el ultimo evento y contactar soporte si hace falta.",
    };
  }

  if (
    status === "shipped" ||
    current === "label_created" ||
    current === "picked_up" ||
    current === "in_transit" ||
    current === "out_for_delivery" ||
    current === "pickup_available"
  ) {
    return {
      title: "Envio en movimiento",
      description: "El pedido ya salio del flujo interno y esta siendo gestionado por el carrier.",
    };
  }

  return {
    title: "Pedido en preparacion",
    description: "El pedido sigue en proceso interno. Veras novedades aqui cuando pase a expedicion.",
  };
}


export function getOrderLastUpdate(createdAt: string, trackingEventDate?: string | null) {
  return trackingEventDate ?? createdAt;
}


type SortableTrackingEvent = {
  id: number;
  occurred_at: string;
};


export function sortTrackingEvents<T extends SortableTrackingEvent>(events: T[]) {
  return [...events].sort((left, right) => {
    const dateDifference =
      new Date(right.occurred_at).getTime() - new Date(left.occurred_at).getTime();

    if (dateDifference !== 0) {
      return dateDifference;
    }

    return right.id - left.id;
  });
}
