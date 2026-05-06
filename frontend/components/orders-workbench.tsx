"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { AutomationFlagBadge } from "@/components/automation-flag-badge";
import { saveOrderNavList } from "@/components/order-nav";
import { useOrderRealtimeRefresh } from "@/lib/use-order-realtime";
import { BulkDesignDownloadModal } from "@/components/bulk-design-download-modal";
import { BulkLabelModal } from "@/components/bulk-label-modal";
import { Card } from "@/components/card";
import { CttLabelCell } from "@/components/ctt-label-cell";
import { DesignAvailabilityBadge } from "@/components/design-availability-badge";
import { EmptyState } from "@/components/empty-state";
import { PriorityBadge } from "@/components/priority-badge";
import { DesignPreviewWithValidation } from "@/components/design-preview-with-validation";
import { StatusBadge } from "@/components/status-badge";
import { useToast } from "@/components/toast";
import { getOrderShipmentLabelUrl } from "@/lib/ctt";
import {
  formatDateTime,
  getOrderLastUpdate,
  getTrackingHeadline,
  sortTrackingEvents,
} from "@/lib/format";
import {
  parseLastOpenedOrderId,
  useLastOpenedPreview,
} from "@/lib/last-opened-preview";
import {
  getItemPrimaryAsset,
  getPrimaryDesignPreview,
  getVisibleAssets,
  isImageAsset,
} from "@/lib/personalization";
import type {
  Incident,
  Order,
  OrderPriority,
  PickBatch,
  Shop,
} from "@/lib/types";


type Employee = { id: number; name: string };

type InlineDropdown = { type: "assign"; orderId: number; top: number; right: number };

type OrdersWorkbenchProps = {
  initialOrders: Order[];
  batches: PickBatch[];
  shops: Shop[];
  employees?: Employee[];
  initialShopId: string;
  initialTotalCount: number;
  initialPage: number;
  initialPerPage: number;
  initialQuery: string;
  initialQuickFilter: string;
  initialView: "queue" | "batches";
};

type QuickFilterKey =
  | "sla_risk"
  | "has_incident"
  | "not_downloaded"
  | "in_production"
  | "not_prepared"
  | "prepared"
  | "label_no_update"
  | "shipping_in_transit"
  | "shipping_out_for_delivery"
  | "shipping_exception"
  | "delivered";

const quickFilterMeta: Array<{ key: QuickFilterKey; label: string }> = [
  { key: "sla_risk",                  label: "🚨 SLA en riesgo" },
  { key: "not_downloaded",            label: "⬇ No descargados" },
  { key: "in_production",             label: "🖨 En producción" },
  { key: "not_prepared",              label: "🔧 No preparados" },
  { key: "prepared",                  label: "✅ Listo para enviar" },
  { key: "label_no_update",           label: "📦 Etiqueta sin avances" },
  { key: "shipping_in_transit",       label: "🚚 En tránsito" },
  { key: "shipping_out_for_delivery", label: "🚛 En reparto" },
  { key: "shipping_exception",        label: "🚨 Excepción carrier" },
  { key: "has_incident",              label: "⚠️ Con incidencia" },
  { key: "delivered",                 label: "✓ Entregado" },
];


function getPrimaryItem(order: Order) {
  return order.items[0] ?? null;
}

function getOrderItems(order: Order) {
  return order.items ?? [];
}

function getAutomationFlags(order: Pick<Order, "automation_flags"> | null | undefined) {
  return Array.isArray(order?.automation_flags) ? order.automation_flags : [];
}

function getAdditionalItemsCount(order: Order) {
  return Math.max(getOrderItems(order).length - 1, 0);
}

function getDisplayedOrderItems(order: Order) {
  return getOrderItems(order);
}

function hasRepeatedQuantity(orderItem: Order["items"][number]) {
  return (orderItem.quantity ?? 0) > 1;
}

function getRefundedQuantity(orderItem: Order["items"][number]) {
  return Math.max(orderItem.refunded_quantity ?? 0, 0);
}

function isItemFullyRefunded(orderItem: Order["items"][number]) {
  const qty = orderItem.quantity ?? 0;
  return qty > 0 && getRefundedQuantity(orderItem) >= qty;
}

function isOrderCancelled(order: Order) {
  return order.status === "cancelled" || Boolean(order.cancelled_at);
}

function getOrderItemsLabel(order: Order) {
  const items = getOrderItems(order);
  if (items.length === 0) {
    return "Sin item";
  }

  const primaryLabel = items[0]?.title ?? items[0]?.name ?? "Sin item";
  const additionalItems = items.length - 1;
  if (additionalItems <= 0) {
    return primaryLabel;
  }

  return `${primaryLabel} + ${additionalItems} más`;
}

function getOrderVariantLabel(order: Order) {
  const items = getOrderItems(order);
  if (items.length === 0) {
    return "Sin variante";
  }

  const primaryVariant = getVariantLabel(items[0]);
  return items.length > 1 ? `${primaryVariant} + ${items.length - 1}` : primaryVariant;
}

function getOrderItemQuantityLabel(orderItem: Order["items"][number]) {
  if (!hasRepeatedQuantity(orderItem)) {
    return null;
  }

  return `x${orderItem.quantity}`;
}




function getOrderItemsSearchTerms(order: Order) {
  return getOrderItems(order).flatMap((item) => [
    item?.sku ?? "",
    item?.variant_title ?? "",
    getVariantLabel(item),
    item?.title ?? item?.name ?? "",
  ]);
}


function getVariantLabel(item: Order["items"][number] | null | undefined) {
  const explicit = item?.variant_title?.trim();
  if (explicit) {
    return explicit;
  }
  return "Sin variante";
}


function getShipmentState(order: Order) {
  const latestEvent = sortTrackingEvents(order.shipment?.events ?? [])[0];
  return latestEvent?.status_norm ?? order.shipment?.shipping_status ?? "sin shipment";
}

function isPrepared(order: Order) {
  return order.production_status === "packed" || order.production_status === "completed";
}

function getOperationalStatusMeta(order: Order) {
  const shipmentState = getShipmentState(order);

  // Incidencia — siempre tiene prioridad visual sobre el estado logístico
  if (order.has_open_incident) {
    return {
      label: "Incidencia",
      className: "badge badge-status badge-status-incident",
      rowStatus: "incident",
    };
  }

  if (order.status === "delivered" || shipmentState === "delivered") {
    return {
      label: "Entregado",
      className: "badge badge-status badge-status-delivered",
      rowStatus: "delivered",
    };
  }

  if (shipmentState === "out_for_delivery") {
    return {
      label: "En reparto",
      className: "badge badge-status badge-status-out-for-delivery",
      rowStatus: "transit",
    };
  }

  if (shipmentState === "picked_up") {
    return {
      label: "Recogido",
      className: "badge badge-status badge-status-transit",
      rowStatus: "transit",
    };
  }

  if (shipmentState === "pickup_available") {
    return {
      label: "Listo para recoger",
      className: "badge badge-status badge-status-pickup",
      rowStatus: "transit",
    };
  }

  if (
    shipmentState === "in_transit" ||
    shipmentState === "pickup_available" ||
    shipmentState === "attempted_delivery"
  ) {
    return {
      label: "En tránsito",
      className: "badge badge-status badge-status-transit",
      rowStatus: "transit",
    };
  }

  if (order.shipment || order.status === "shipped" || order.status === "ready_to_ship") {
    return {
      label: "Listo para enviar",
      className: "badge badge-status badge-status-ready-to-ship",
      rowStatus: "ready",
    };
  }

  if (order.production_status === "in_production") {
    return {
      label: "En producción",
      className: "badge badge-status badge-status-in-production",
      rowStatus: "printed",
    };
  }

  return {
    label: "Sin preparar",
    className: "badge badge-status badge-status-pending",
    rowStatus: "pending",
  };
}

function hasRealCarrierEvent(order: Order): boolean {
  const events = order.shipment?.events ?? [];
  // A "real" carrier event is anything beyond label_created (i.e., carrier has actually scanned the parcel)
  return events.some(
    (e) => e.status_norm && e.status_norm !== "label_created" && e.status_norm !== "",
  );
}

// ─── SLA Urgency ──────────────────────────────────────────────────────────────
// Mirrors the logic used by Logiwa / Hopstack: every active order has a countdown.
// Default SLA window is 48 h from order creation; override per shop if needed.

const SLA_HOURS_DEFAULT = 48;

type SlaRisk = "safe" | "warning" | "critical" | "breached";
type SlaInfo = { risk: SlaRisk; hoursRemaining: number; label: string };

function getSlaInfo(order: Order, slaHours = SLA_HOURS_DEFAULT): SlaInfo | null {
  // Not relevant once the carrier has scanned the parcel or the order is done.
  if (
    order.status === "cancelled" ||
    order.status === "delivered" ||
    hasRealCarrierEvent(order)
  ) return null;

  const deadline = new Date(order.created_at).getTime() + slaHours * 3_600_000;
  const hoursRemaining = (deadline - Date.now()) / 3_600_000;
  const h = Math.floor(Math.abs(hoursRemaining));

  if (hoursRemaining < 0)
    return { risk: "breached",  hoursRemaining, label: `Vencido · ${h}h tarde` };
  if (hoursRemaining < 4)
    return { risk: "critical",  hoursRemaining, label: `${h}h restantes` };
  if (hoursRemaining < slaHours * 0.35)
    return { risk: "warning",   hoursRemaining, label: `${h}h restantes` };
  return   { risk: "safe",     hoursRemaining, label: `${h}h restantes` };
}

function matchesQuickFilter(order: Order, filter: QuickFilterKey) {
  // This client-side matcher is a safety net on top of the server filters.
  // It MUST be at least as permissive as the backend — if it rejects rows the
  // backend accepts, the list will appear empty even when the server returned
  // matching orders. Keep these branches aligned with
  // `_build_order_filters` + `quickFilterToApiParams`.
  switch (filter) {
    case "sla_risk": {
      const sla = getSlaInfo(order);
      return sla !== null && (sla.risk === "critical" || sla.risk === "breached");
    }
    case "has_incident":
      return order.has_open_incident;

    case "not_prepared":
      // Backend: is_prepared=false → NOT (packed|completed|ready_to_ship).
      return !(
        order.production_status === "packed" ||
        order.production_status === "completed" ||
        order.status === "ready_to_ship"
      );

    case "prepared":
      // Backend: is_prepared=true → packed|completed|ready_to_ship.
      // Previously this excluded "packed", which caused the pill to render an
      // empty list even when the backend had returned dozens of packed orders.
      return (
        order.production_status === "packed" ||
        order.production_status === "completed" ||
        order.status === "ready_to_ship"
      );

    case "label_no_update":
      // Client-only filter (no backend equivalent). Has a tracking number but
      // carrier hasn't scanned it yet — only label_created events or none.
      return (
        Boolean(order.shipment?.tracking_number?.trim()) &&
        order.status !== "delivered" &&
        order.shipment?.shipping_status !== "delivered" &&
        !hasRealCarrierEvent(order)
      );

    case "shipping_in_transit": {
      const state = getShipmentState(order);
      return (
        state === "in_transit" ||
        state === "picked_up" ||
        state === "pickup_available" ||
        state === "attempted_delivery"
      );
    }

    case "shipping_out_for_delivery":
      return (
        getShipmentState(order) === "out_for_delivery" ||
        order.shipment?.shipping_status === "out_for_delivery"
      );

    case "shipping_exception":
      return (
        getShipmentState(order) === "exception" ||
        order.shipment?.shipping_status === "exception"
      );

    case "not_downloaded":
      // Backend: production_status=pending_personalization + has_shipment=false.
      return (
        !order.shipment &&
        (order.production_status === "pending_personalization" || !order.production_status)
      );

    case "in_production":
      return order.production_status === "in_production";

    case "delivered":
      return (
        order.status === "delivered" ||
        order.shipment?.shipping_status === "delivered" ||
        getShipmentState(order) === "delivered"
      );

    default:
      return true;
  }
}


function formatElapsedHours(createdAt: string, completedAt?: string | null) {
  const endTime = completedAt ? new Date(completedAt).getTime() : Date.now();
  const diff = endTime - new Date(createdAt).getTime();
  const hours = Math.max(Math.floor(diff / (1000 * 60 * 60)), 0);
  if (hours < 24) {
    return `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function getDeliveredAt(order: Order) {
  const deliveredEvent = sortTrackingEvents(order.shipment?.events ?? []).find(
    (event) => event.status_norm === "delivered",
  );
  return deliveredEvent?.occurred_at ?? null;
}


function downloadCsv(rows: Order[]) {
  const headers = [
    "pedido",
    "tienda",
    "cliente",
    "email",
    "producto",
    "variante",
    "sku",
    "personalizado",
    "design_status",
    "production_status",
    "priority",
    "carrier",
    "tracking",
  ];

  const lines = rows.map((order) => {
    return [
      order.external_id,
      order.shop_id,
      order.customer_name,
      order.customer_email,
      getOrderItemsLabel(order),
      getOrderVariantLabel(order),
      getOrderItems(order).map((item) => item.sku ?? "").join(" | "),
      order.is_personalized ? "yes" : "no",
      getPrimaryItem(order)?.design_status ?? "",
      order.production_status,
      order.priority,
      order.shipment?.carrier ?? "",
      order.shipment?.tracking_number ?? "",
    ]
      .map((value) => `"${String(value).replaceAll('"', '""')}"`)
      .join(",");
  });

  const csv = [headers.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "orders-selection.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}


export function OrdersWorkbench({
  initialOrders,
  batches,
  shops,
  employees = [],
  initialShopId,
  initialTotalCount,
  initialPage,
  initialPerPage,
  initialQuery,
  initialQuickFilter,
  initialView,
}: OrdersWorkbenchProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  useOrderRealtimeRefresh(() => router.refresh());
  const lastOpenedPreviewTrackId = useLastOpenedPreview();
  const lastOpenedOrderId = parseLastOpenedOrderId(lastOpenedPreviewTrackId);
  const [orders, setOrders] = useState(initialOrders);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  // Keyboard navigation: -1 = none focused
  const [focusedRowIdx, setFocusedRowIdx] = useState<number>(-1);
  const tableBodyRef = useRef<HTMLTableSectionElement | null>(null);
  const [detailOrder, setDetailOrder] = useState<Order | null>(null);
  const [detailIncidents, setDetailIncidents] = useState<Incident[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [showBulkLabelModal, setShowBulkLabelModal] = useState(false);
  const [showBulkDesignModal, setShowBulkDesignModal] = useState(false);
  const [query, setQuery] = useState(initialQuery);
  const [isSearching, setIsSearching] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragRef = useRef<{ active: boolean; startIdx: number; mode: "add" | "remove" }>({
    active: false,
    startIdx: -1,
    mode: "add",
  });
  const [selectedShopId, setSelectedShopId] = useState<string>(initialShopId);
  const [totalCount, setTotalCount] = useState(initialTotalCount);
  const [page, setPage] = useState(initialPage);
  const [perPage, setPerPage] = useState(initialPerPage);
  const [activeFilters, setActiveFilters] = useState<QuickFilterKey[]>(
    quickFilterMeta.some((filter) => filter.key === initialQuickFilter) ? [initialQuickFilter as QuickFilterKey] : [],
  );
  const [view, setView] = useState<"queue" | "batches">(initialView);
  const [isPending, startTransition] = useTransition();

  // ── Bulk assign ────────────────────────────────────────────────────────────
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const bulkAssignRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!bulkAssignOpen) return;
    function handleOutside(e: MouseEvent) {
      if (bulkAssignRef.current && !bulkAssignRef.current.contains(e.target as Node)) {
        setBulkAssignOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [bulkAssignOpen]);

  function handleBulkAssign(employeeId: number | null) {
    if (selectedCount === 0) return;
    setBulkAssignOpen(false);
    const empName = employees.find((e) => e.id === employeeId)?.name;
    runBulkAction<Order[]>("/api/orders/bulk/assign", {
      order_ids: selectedIds,
      employee_id: employeeId,
    }, (updated) => {
      updateOrdersFromBulk(updated);
      toast(
        employeeId ? `${updated.length} pedidos asignados a ${empName ?? "empleado"}` : `${updated.length} pedidos desasignados`,
        "success",
      );
    });
  }

  // ── Inline row actions ─────────────────────────────────────────────────────
  const [openInline, setOpenInline] = useState<InlineDropdown | null>(null);
  const [inlineLoading, setInlineLoading] = useState<number | null>(null); // orderId being updated
  const inlineRef = useRef<HTMLDivElement | null>(null);

  // Close inline dropdown on outside click.
  // NOTE: we intentionally do NOT close on scroll — the dropdown is
  // position:fixed so it stays in the viewport when the table scrolls,
  // and closing on scroll prevented operators from scrolling to a row
  // before clicking the assign button.
  useEffect(() => {
    if (!openInline) return;
    function handleOutsideClick(e: MouseEvent) {
      if (inlineRef.current && !inlineRef.current.contains(e.target as Node)) {
        setOpenInline(null);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [openInline]);

  function openAssignDropdown(e: React.MouseEvent<HTMLButtonElement>, orderId: number) {
    e.stopPropagation();
    if (openInline?.orderId === orderId) { setOpenInline(null); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    setOpenInline({ type: "assign", orderId, top: rect.bottom + 4, right: window.innerWidth - rect.right });
  }

  async function handleInlineAssign(orderId: number, employeeId: number | null) {
    setOpenInline(null);
    setInlineLoading(orderId);
    const previous = orders.find((o) => o.id === orderId);
    const emp = employees.find((e) => e.id === employeeId) ?? null;
    setOrders((current) =>
      current.map((o) =>
        o.id === orderId
          ? { ...o, assigned_to_employee_id: employeeId, assigned_to_employee_name: emp?.name ?? null }
          : o,
      ),
    );
    try {
      const res = await fetch(`/api/orders/${orderId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employee_id: employeeId }),
      });
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try { const err = await res.json(); detail = err?.detail ?? JSON.stringify(err); } catch { /* ignore */ }
        throw new Error(detail);
      }
      const updated: Order = await res.json();
      setOrders((current) => current.map((o) => (o.id === orderId ? updated : o)));
      toast(employeeId ? `Asignado a ${emp?.name ?? "empleado"}` : "Asignación eliminada", "success");
    } catch (err) {
      if (previous) {
        setOrders((current) => current.map((o) => (o.id === orderId ? previous : o)));
      }
      const msg = err instanceof Error ? err.message : "Error desconocido";
      toast(`No se pudo asignar: ${msg}`, "error");
    } finally {
      setInlineLoading(null);
    }
  }

  async function handleInlineResolveIncident(orderId: number) {
    setInlineLoading(orderId);
    try {
      const res = await fetch(`/api/orders/${orderId}/incidents`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      const incidents: Array<{ id: number; status: string }> = await res.json();
      const open = incidents.filter((i) => i.status !== "resolved");
      if (open.length === 0) {
        toast("No hay incidencias abiertas", "info");
        return;
      }
      await Promise.all(
        open.map((inc) =>
          fetch(`/api/incidents/${inc.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "resolved" }),
          }),
        ),
      );
      setOrders((current) =>
        current.map((o) =>
          o.id === orderId ? { ...o, has_open_incident: false, open_incidents_count: 0 } : o,
        ),
      );
      toast("Incidencia resuelta ✓", "success");
    } catch {
      toast("Error al resolver la incidencia", "error");
    } finally {
      setInlineLoading(null);
    }
  }

  // ── One-click production status advance ──────────────────────────────────────
  const PROD_STATUS_FLOW: Record<string, { next: string; label: string; icon: string }> = {
    pending_personalization: { next: "in_production", label: "En producción", icon: "🖨" },
    in_production:           { next: "packed",        label: "Preparado",     icon: "📦" },
    packed:                  { next: "completed",     label: "Completar",     icon: "✅" },
  };

  async function handleAdvanceProductionStatus(orderId: number) {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;
    const step = PROD_STATUS_FLOW[order.production_status ?? ""];
    if (!step) return;

    setInlineLoading(orderId);
    const previousStatus = order.production_status;

    // Optimistic update
    setOrders((current) =>
      current.map((o) => o.id === orderId ? { ...o, production_status: step.next as typeof o.production_status } : o),
    );

    try {
      const res = await fetch(`/api/orders/${orderId}/production-status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ production_status: step.next }),
      });
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try { const err = await res.json(); detail = err?.detail ?? JSON.stringify(err); } catch { /* ignore */ }
        throw new Error(detail);
      }
      const updated: Order = await res.json();
      setOrders((current) => current.map((o) => o.id === orderId ? updated : o));
      toast(`${step.icon} ${step.label} ✓`, "success");
    } catch (err) {
      // Rollback
      setOrders((current) =>
        current.map((o) => o.id === orderId ? { ...o, production_status: previousStatus } : o),
      );
      const msg = err instanceof Error ? err.message : "Error desconocido";
      toast(`No se pudo actualizar el estado: ${msg}`, "error");
    } finally {
      setInlineLoading(null);
    }
  }

  function buildParams(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }
    return params.toString();
  }

  function replaceParams(updates: Record<string, string | null>) {
    const queryString = buildParams(updates);
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
  }

  useEffect(() => {
    setOrders(initialOrders);
    setIsSearching(false);
    // Preserve selections that are still valid in the new result set
    const newIdSet = new Set(initialOrders.map((o) => o.id));
    setSelectedIds((current) => current.filter((id) => newIdSet.has(id)));
  }, [initialOrders]);

  useEffect(() => {
    setTotalCount(initialTotalCount);
  }, [initialTotalCount]);

  useEffect(() => {
    setView(initialView);
  }, [initialView]);

  useEffect(() => {
    setSelectedShopId(initialShopId);
  }, [initialShopId]);

  useEffect(() => {
    setPage(initialPage);
  }, [initialPage]);

  useEffect(() => {
    setPerPage(initialPerPage);
  }, [initialPerPage]);

  useEffect(() => {
    setActiveFilters(
      quickFilterMeta.some((filter) => filter.key === initialQuickFilter)
        ? [initialQuickFilter as QuickFilterKey]
        : [],
    );
  }, [initialQuickFilter]);

  useEffect(() => {
    if (!selectedOrderId) {
      setDetailOrder(null);
      setDetailIncidents([]);
      return;
    }

    let isCancelled = false;
    setDetailLoading(true);

    Promise.all([
      fetch(`/api/orders/${selectedOrderId}`, { cache: "no-store" }).then((response) => response.json()),
      fetch(`/api/orders/${selectedOrderId}/incidents`, { cache: "no-store" }).then((response) => response.json()),
    ])
      .then(([order, incidents]) => {
        if (isCancelled) {
          return;
        }
        setDetailOrder(order);
        setDetailIncidents(incidents);
      })
      .catch(() => {
        if (!isCancelled) {
          setFeedback("No pudimos cargar el detalle rápido del pedido.");
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setDetailLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [selectedOrderId]);

  const shopMap = useMemo(() => new Map(shops.map((shop) => [shop.id, shop.name])), [shops]);

  const visibleOrders = useMemo(() => {
    return orders.filter((order) => {
      // Shop filter: immediate client-side feedback while server refetches
      if (selectedShopId && String(order.shop_id) !== selectedShopId) {
        return false;
      }
      // Quick filters: purely client-side (matchesQuickFilter)
      return activeFilters.every((filter) => matchesQuickFilter(order, filter));
    });
    // NOTE: query filtering is intentionally NOT done here.
    // The server handles text search via URL params. Filtering locally on top
    // of server results causes double-filtering with stale intermediate states.
  }, [activeFilters, orders, selectedShopId]);

  // ── Keyboard row navigation ───────────────────────────────────────────────────
  // ↑↓ navigate rows, Enter opens detail panel, Escape closes it.
  // Placed after visibleOrders so the closure captures the latest array.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      // Skip when typing in an input/select/textarea
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      ) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedRowIdx((prev) => Math.min(prev + 1, visibleOrders.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedRowIdx((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter" && focusedRowIdx >= 0) {
        e.preventDefault();
        const order = visibleOrders[focusedRowIdx];
        if (order) setSelectedOrderId(order.id);
      } else if (e.key === "Escape") {
        setFocusedRowIdx(-1);
        setSelectedOrderId(null);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [focusedRowIdx, visibleOrders]);

  // Auto-scroll focused row into view
  useEffect(() => {
    if (focusedRowIdx < 0 || !tableBodyRef.current) return;
    const rows = tableBodyRef.current.querySelectorAll("tr");
    const row = rows[focusedRowIdx] as HTMLElement | undefined;
    row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusedRowIdx]);

  function toggleQuickFilter(filter: QuickFilterKey | "all") {
    if (filter === "all") {
      setActiveFilters([]);
      replaceParams({ quick: null, page: "1", per_page: null });
      return;
    }

    const isActive = activeFilters.includes(filter);
    if (isActive) {
      // Deselect: remove from local state and clear from URL
      setActiveFilters((current) => current.filter((entry) => entry !== filter));
      replaceParams({ quick: null, page: "1", per_page: null });
    } else {
      // Select: fetch up to 250 so all matching orders are visible
      setActiveFilters([filter]);
      replaceParams({ quick: filter, page: "1", per_page: "250" });
    }
  }

  const selectedOrders = useMemo(
    () => visibleOrders.filter((order) => selectedIds.includes(order.id)),
    [selectedIds, visibleOrders],
  );

  const selectedCount = selectedOrders.length;

  // ── KPI snapshot ────────────────────────────────────────────────────────────
  // Computed client-side from the loaded orders page. Quick pulse for the
  // operator: how many orders still need labels, how many are burning SLA time.
  const kpiStats = useMemo(() => {
    const active = orders.filter((o) => o.status !== "cancelled");
    const withoutLabel = active.filter((o) => !o.shipment?.tracking_number);
    const slaRiskCount = withoutLabel.filter((o) => {
      const sla = getSlaInfo(o);
      return sla && (sla.risk === "critical" || sla.risk === "breached");
    }).length;
    const incidentCount = active.filter((o) => o.has_open_incident).length;
    // Count orders prepared today (prepared_at >= today 00:00 local time)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const preparedToday = orders.filter(
      (o) => o.prepared_at && new Date(o.prepared_at) >= todayStart,
    ).length;
    return { total: active.length, withoutLabel: withoutLabel.length, slaRiskCount, incidentCount, preparedToday };
  }, [orders]);

  const showingFrom = orders.length === 0 ? 0 : (page - 1) * perPage + 1;
  const showingTo = (page - 1) * perPage + orders.length;
  const canGoNext = showingTo < totalCount;

  function toggleSelected(orderId: number) {
    setSelectedIds((current) =>
      current.includes(orderId) ? current.filter((id) => id !== orderId) : [...current, orderId],
    );
  }

  function toggleAll() {
    if (selectedIds.length === visibleOrders.length) {
      setSelectedIds([]);
      return;
    }
    setSelectedIds(visibleOrders.map((order) => order.id));
  }

  // ── Drag-to-select ────────────────────────────────────────────────────────
  const handleRowMouseDown = useCallback(
    (orderId: number, orderIdx: number, event: React.MouseEvent) => {
      // Let native controls (checkbox, button, link) handle their own events
      if ((event.target as HTMLElement).closest("input, button, a")) return;
      event.preventDefault(); // prevent text selection while dragging
      const mode = selectedIds.includes(orderId) ? "remove" : "add";
      dragRef.current = { active: true, startIdx: orderIdx, mode };
      setSelectedIds((current) =>
        mode === "add"
          ? current.includes(orderId) ? current : [...current, orderId]
          : current.filter((id) => id !== orderId),
      );
    },
    [selectedIds],
  );

  const handleRowMouseEnter = useCallback(
    (orderIdx: number) => {
      if (!dragRef.current.active) return;
      const lo = Math.min(dragRef.current.startIdx, orderIdx);
      const hi = Math.max(dragRef.current.startIdx, orderIdx);
      const rangeIds = visibleOrders.slice(lo, hi + 1).map((o) => o.id);
      setSelectedIds((current) => {
        if (dragRef.current.mode === "add") {
          const next = new Set(current);
          rangeIds.forEach((id) => next.add(id));
          return Array.from(next);
        }
        const remove = new Set(rangeIds);
        return current.filter((id) => !remove.has(id));
      });
    },
    [visibleOrders],
  );

  useEffect(() => {
    function onMouseUp() {
      dragRef.current.active = false;
    }
    document.addEventListener("mouseup", onMouseUp);
    return () => document.removeEventListener("mouseup", onMouseUp);
  }, []);

  async function runBulkAction<T>(path: string, payload: Record<string, unknown>, onSuccess?: (payload: T) => void) {
    setFeedback(null);
    startTransition(async () => {
      try {
        const response = await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || "No pudimos completar la acción.");
        }

        const result = (await response.json()) as T;
        onSuccess?.(result);
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "No pudimos completar la acción.");
      }
    });
  }

  function updateOrdersFromBulk(updated: Order[]) {
    const byId = new Map(updated.map((order) => [order.id, order]));
    setOrders((current) => current.map((order) => byId.get(order.id) ?? order));
  }

  function handleOrderUpdated(updatedOrder: Order) {
    setOrders((current) => current.map((order) => (order.id === updatedOrder.id ? updatedOrder : order)));
    if (selectedOrderId === updatedOrder.id) {
      setDetailOrder(updatedOrder);
    }
  }

  function handleBulkPriority(priority: OrderPriority) {
    if (selectedCount === 0) {
      return;
    }
    runBulkAction<Order[]>("/api/orders/bulk/priority", {
      order_ids: selectedIds,
      priority,
    }, (updated) => {
      updateOrdersFromBulk(updated);
      toast(`Prioridad actualizada (${updated.length})`, "success");
    });
  }

  function handleBulkIncident() {
    if (selectedCount === 0) {
      return;
    }
    runBulkAction<Incident[]>("/api/orders/bulk/incidents", {
      order_ids: selectedIds,
      type: "production_blocked",
      priority: "high",
      title: "Bloqueo operativo detectado",
      description: "Incidencia generada desde la cola operativa para revisar el lote seleccionado.",
    }, () => {
      setOrders((current) =>
        current.map((order) =>
          selectedIds.includes(order.id)
            ? { ...order, has_open_incident: true, open_incidents_count: order.open_incidents_count + 1 }
            : order,
        ),
      );
    });
  }

  // ── Bulk production status advance ────────────────────────────────────────────
  // Advances each selected order to its next production_status in parallel.
  async function handleBulkAdvanceProductionStatus() {
    const toUpdate = selectedOrders
      .map((o) => {
        const step = PROD_STATUS_FLOW[o.production_status ?? ""];
        return step ? { id: o.id, nextStatus: step.next, icon: step.icon } : null;
      })
      .filter((x): x is { id: number; nextStatus: string; icon: string } => x !== null);

    if (toUpdate.length === 0) {
      toast("Los pedidos seleccionados no tienen estado avanzable", "info");
      return;
    }

    // Optimistic update
    setOrders((current) =>
      current.map((o) => {
        const update = toUpdate.find((u) => u.id === o.id);
        return update ? { ...o, production_status: update.nextStatus as typeof o.production_status } : o;
      }),
    );

    const results = await Promise.allSettled(
      toUpdate.map(({ id, nextStatus }) =>
        fetch(`/api/orders/${id}/production-status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ production_status: nextStatus }),
        }).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json() as Promise<Order>;
        }),
      ),
    );

    const successOrders = results
      .filter((r): r is PromiseFulfilledResult<Order> => r.status === "fulfilled")
      .map((r) => r.value);

    if (successOrders.length > 0) {
      setOrders((current) =>
        current.map((o) => successOrders.find((u) => u.id === o.id) ?? o),
      );
    }

    const failCount = results.filter((r) => r.status === "rejected").length;
    if (failCount > 0) {
      toast(`${successOrders.length} avanzados, ${failCount} con error`, "error");
    } else {
      toast(`${successOrders.length} pedidos avanzados ✓`, "success");
    }
  }

  function handleCreateBatch() {
    if (selectedCount === 0) {
      return;
    }
    runBulkAction<PickBatch>("/api/orders/batches", {
      order_ids: selectedIds,
      notes: `Lote creado desde /orders con ${selectedCount} pedidos`,
      status: "draft",
    }, (createdBatch) => {
      window.location.search = `?view=batches`;
      setFeedback(`Lote #${createdBatch.id} creado con ${createdBatch.orders_count} pedidos.`);
    });
  }

  const quickDetail = detailOrder ?? (selectedOrderId ? orders.find((order) => order.id === selectedOrderId) ?? null : null);
  const quickItem = quickDetail ? getPrimaryItem(quickDetail) : null;
  const quickHeadline = quickDetail ? getTrackingHeadline(quickDetail.status, getShipmentState(quickDetail)) : null;

  return (
    <div className={`orders-workbench ${quickDetail ? "orders-workbench-with-drawer" : ""}`}>
      <div className="orders-workbench-main">
        {feedback ? <div className="admin-dashboard-empty">{feedback}</div> : null}

        <Card className="stack orders-toolbar-card">
          <div className="orders-inline-tools">
            <div className="field field-search orders-inline-search">
              <label htmlFor="orders-live-search">
                Buscar{isSearching ? " …" : ""}
              </label>
              <input
                id="orders-live-search"
                onChange={(event) => {
                  const value = event.target.value;
                  setQuery(value);
                  // Reset page immediately so the counter doesn't show stale state
                  setPage(1);
                  if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
                  setIsSearching(true);
                  searchDebounceRef.current = setTimeout(() => {
                    // per_page: 250 when searching, reset to default when clearing
                    replaceParams({ q: value || null, page: "1", per_page: value ? "250" : null });
                  }, 400);
                }}
                placeholder="Pedido, cliente, SKU, variante, tracking"
                type="search"
                value={query}
              />
            </div>

            <div className="field orders-inline-shop">
              <label htmlFor="orders-shop-filter">Tienda</label>
              <select
                id="orders-shop-filter"
                onChange={(event) => {
                  const nextShopId = event.target.value;
                  setSelectedShopId(nextShopId);
                  setPage(1);
                  replaceParams({
                    shop_id: nextShopId || null,
                    page: "1",
                  });
                }}
                value={selectedShopId}
              >
                <option value="">Todas</option>
                {shops.map((shop) => (
                  <option key={shop.id} value={String(shop.id)}>
                    {shop.name}
                  </option>
                ))}
              </select>
            </div>

          </div>

          {view === "queue" ? (
            <div className="orders-kpi-bar">
              <div className="orders-kpi-stat">
                <span className="orders-kpi-value">{kpiStats.total}</span>
                <span className="orders-kpi-label">En cola</span>
              </div>
              <div className={`orders-kpi-stat${kpiStats.withoutLabel > 0 ? " orders-kpi-stat-neutral" : ""}`}>
                <span className="orders-kpi-value">{kpiStats.withoutLabel}</span>
                <span className="orders-kpi-label">Sin etiqueta</span>
              </div>
              {kpiStats.slaRiskCount > 0 ? (
                <button
                  className="orders-kpi-stat orders-kpi-stat-alert orders-kpi-btn"
                  onClick={() => toggleQuickFilter("sla_risk")}
                  title="Filtrar por SLA en riesgo"
                  type="button"
                >
                  <span className="orders-kpi-value">🚨 {kpiStats.slaRiskCount}</span>
                  <span className="orders-kpi-label">SLA en riesgo</span>
                </button>
              ) : (
                <div className="orders-kpi-stat orders-kpi-stat-ok">
                  <span className="orders-kpi-value">✓</span>
                  <span className="orders-kpi-label">SLA al día</span>
                </div>
              )}
              {kpiStats.incidentCount > 0 ? (
                <button
                  className="orders-kpi-stat orders-kpi-stat-warning orders-kpi-btn"
                  onClick={() => toggleQuickFilter("has_incident")}
                  title="Filtrar por incidencias abiertas"
                  type="button"
                >
                  <span className="orders-kpi-value">⚠ {kpiStats.incidentCount}</span>
                  <span className="orders-kpi-label">Con incidencia</span>
                </button>
              ) : null}
              {/* Separator */}
              <div className="orders-kpi-sep" />
              {/* Today's throughput */}
              <div className={`orders-kpi-stat${kpiStats.preparedToday > 0 ? " orders-kpi-stat-today" : ""}`}>
                <span className="orders-kpi-value">{kpiStats.preparedToday > 0 ? `🎯 ${kpiStats.preparedToday}` : "—"}</span>
                <span className="orders-kpi-label">Preparados hoy</span>
              </div>
              {/* Keyboard shortcut hint */}
              <div className="orders-kpi-sep" />
              <div className="orders-kpi-kbd-hint">
                <span>↑↓ navegar</span>
                <span>↵ abrir</span>
                <span>Esc cerrar</span>
              </div>
            </div>
          ) : null}

          {view === "queue" ? (
            <div className="orders-filter-pills">
              <button
                className={`orders-filter-pill ${activeFilters.length === 0 ? "orders-filter-pill-active" : ""}`}
                onClick={() => toggleQuickFilter("all")}
                type="button"
              >
                Todos
              </button>
              {quickFilterMeta.map((filter) => (
                <button
                  className={`orders-filter-pill ${activeFilters.includes(filter.key) ? "orders-filter-pill-active" : ""}`}
                  key={filter.key}
                  onClick={() => toggleQuickFilter(filter.key)}
                  type="button"
                >
                  {filter.label}
                </button>
              ))}
            </div>
          ) : null}
        </Card>

        {selectedCount > 0 && view === "queue" ? (
          <Card className="stack orders-bulk-bar">
            <div className="orders-bulk-summary">
              <strong>{selectedCount} pedidos seleccionados</strong>
              <span>Aplica acciones por lote sin salir de la cola.</span>
            </div>
            <div className="orders-bulk-actions">
              {/* Bulk assign */}
              {employees.length > 0 ? (
                <div className="inline-ctrl-wrap" ref={bulkAssignRef}>
                  <button
                    className="button-secondary"
                    disabled={isPending}
                    onClick={() => setBulkAssignOpen((v) => !v)}
                    type="button"
                  >
                    👤 Asignar a… ▾
                  </button>
                  {bulkAssignOpen ? (
                    <div className="inline-dropdown">
                      <button
                        className="inline-dropdown-item"
                        onClick={() => handleBulkAssign(null)}
                        type="button"
                      >
                        Sin asignar
                      </button>
                      {employees.map((emp) => (
                        <button
                          className="inline-dropdown-item"
                          key={emp.id}
                          onClick={() => handleBulkAssign(emp.id)}
                          type="button"
                        >
                          {emp.name}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <button
                className="button-secondary"
                disabled={isPending}
                onClick={() => void handleBulkAdvanceProductionStatus()}
                title={`Avanzar estado de producción en ${selectedCount} pedidos seleccionados`}
                type="button"
              >
                ▶ Avanzar estado
              </button>
              <button className="button-secondary" disabled={isPending} onClick={handleBulkIncident} type="button">
                Crear incidencia
              </button>
              <button className="button-secondary" disabled={isPending} onClick={() => downloadCsv(selectedOrders)} type="button">
                Exportar lista
              </button>
              <button
                className="button-secondary"
                disabled={isPending}
                onClick={() => setShowBulkDesignModal(true)}
                title={`Descargar diseños de ${selectedCount} pedidos seleccionados`}
                type="button"
              >
                Descargar diseños
              </button>
              <button
                className="button bulk-label-button"
                disabled={isPending}
                onClick={() => setShowBulkLabelModal(true)}
                title={`Crear etiquetas CTT para ${selectedCount} pedidos seleccionados`}
                type="button"
              >
                Crear etiquetas
              </button>
            </div>
          </Card>
        ) : null}

        {showBulkDesignModal ? (
          <BulkDesignDownloadModal
            orders={selectedOrders}
            onClose={() => setShowBulkDesignModal(false)}
          />
        ) : null}

        {showBulkLabelModal ? (
          <BulkLabelModal
            orders={selectedOrders}
            shop={shops.find((s) => String(s.id) === selectedShopId) ?? shops[0] ?? null}
            onClose={() => setShowBulkLabelModal(false)}
            onComplete={(updatedIds) => {
              setShowBulkLabelModal(false);
              setFeedback(`Etiquetas creadas para ${updatedIds.length} pedido${updatedIds.length !== 1 ? "s" : ""}. Recarga para ver el estado actualizado.`);
            }}
          />
        ) : null}

        {view === "queue" ? (
          <Card className="stack table-card">
            <div className="orders-table-toolbar">
              <div className="orders-table-summary">
                <strong>
                  Mostrando {showingFrom}-{showingTo || 0}
                </strong>
                <span>{totalCount > 0 ? `${totalCount} pedidos en total` : "del lote cargado en esta vista"}</span>
              </div>
              <div className="orders-table-pagination-tools">
                <label className="orders-table-per-page" htmlFor="orders-per-page">
                  <span>Por página</span>
                  <select
                    id="orders-per-page"
                    onChange={(event) => {
                      const nextPerPage = Number(event.target.value);
                      setPerPage(nextPerPage);
                      setPage(1);
                      replaceParams({
                        per_page: String(nextPerPage),
                        page: "1",
                      });
                    }}
                    value={perPage}
                  >
                    {[50, 100, 250, 500].map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="orders-pagination-buttons">
                  <button
                    className="button-secondary"
                    disabled={page <= 1}
                    onClick={() => {
                      const nextPage = Math.max(page - 1, 1);
                      setPage(nextPage);
                      replaceParams({ page: String(nextPage) });
                    }}
                    type="button"
                  >
                    Anterior
                  </button>
                  <span className="orders-page-indicator">Página {page}</span>
                  <button
                    className="button-secondary"
                    disabled={!canGoNext}
                    onClick={() => {
                      const nextPage = page + 1;
                      setPage(nextPage);
                      replaceParams({ page: String(nextPage) });
                    }}
                    type="button"
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            </div>
            {isSearching ? (
              <div className="admin-dashboard-empty" style={{ padding: "32px 0", opacity: 0.6 }}>
                Buscando…
              </div>
            ) : visibleOrders.length === 0 ? (
              <EmptyState
                title="Sin pedidos para esta vista"
                description="Ajusta filtros, cambia el lote cargado o prueba con otra combinación de tienda y estado."
              />
            ) : (
              <div className="table-wrap" style={{ opacity: isSearching ? 0.5 : 1, transition: "opacity 0.15s" }}>
                <table className="table orders-ops-table">
                  <thead>
                    <tr>
                      <th>
                        <input
                          aria-label="Seleccionar todo"
                          checked={visibleOrders.length > 0 && selectedIds.length === visibleOrders.length}
                          onChange={toggleAll}
                          type="checkbox"
                        />
                      </th>
                      <th>Pedido</th>
                      <th>Tienda</th>
                      <th>Item principal</th>
                      <th>Variante</th>
                      <th>Imagen</th>
                      <th>Estado</th>
                      <th>Riesgo SLA</th>
                      <th>Tracking</th>
                      <th>CTT</th>
                      <th>Acción</th>
                    </tr>
                  </thead>
                  <tbody ref={tableBodyRef}>
                    {visibleOrders.map((order, idx) => {
                      const latestEvent = sortTrackingEvents(order.shipment?.events ?? [])[0] ?? null;
                      const operationalStatus = getOperationalStatusMeta(order);
                      const deliveredAt = getDeliveredAt(order);
                      const age = formatElapsedHours(order.created_at, deliveredAt);
                      const displayItems = getDisplayedOrderItems(order);
                      const additionalItemsCount = getAdditionalItemsCount(order);
                      const fichaHref = `/orders/${order.id}`;

                      const orderCancelled = isOrderCancelled(order);
                      const isLastOpenedRow = lastOpenedOrderId === order.id;
                      const isRowLoading = inlineLoading === order.id;

                      return (
                        <tr
                          className={`table-row ${selectedOrderId === order.id ? "orders-ops-row-active" : ""} ${selectedIds.includes(order.id) ? "orders-ops-row-selected" : ""} ${orderCancelled ? "order-row--cancelled" : ""} ${isLastOpenedRow ? "order-row--last-opened" : ""} ${isRowLoading ? "order-row--loading" : ""} ${focusedRowIdx === idx ? "order-row--kbd-focused" : ""}`}
                          data-status={operationalStatus.rowStatus}
                          key={order.id}
                          onMouseDown={(e) => handleRowMouseDown(order.id, idx, e)}
                          onMouseEnter={() => handleRowMouseEnter(idx)}
                          style={{ userSelect: "none", cursor: "default" }}
                        >
                          <td>
                            <input
                              aria-label={`Seleccionar pedido ${order.external_id}`}
                              checked={selectedIds.includes(order.id)}
                              onChange={() => toggleSelected(order.id)}
                              type="checkbox"
                            />
                          </td>
                          <td>
                            <button className="orders-row-link" onClick={() => setSelectedOrderId(order.id)} type="button">
                              <strong>{order.external_id}</strong>
                            </button>
                          </td>
                          <td>{shopMap.get(order.shop_id) ?? `Shop #${order.shop_id}`}</td>
                          <td>
                            <div className="orders-cell-stack">
                              {displayItems.map((displayItem, index) => {
                                const refundedQty = getRefundedQuantity(displayItem);
                                const fullyRefunded = isItemFullyRefunded(displayItem);
                                return (
                                <div className={`orders-cell-line ${fullyRefunded ? "order-item--refunded" : ""}`} key={`${order.id}-title-${displayItem.id ?? index}`}>
                                  <div className="orders-cell-line-top">
                                    <div className="table-primary order-item__name">{displayItem?.title ?? displayItem?.name ?? "Sin item"}</div>
                                    {getOrderItemQuantityLabel(displayItem) ? (
                                      <span className="badge badge-quantity">{getOrderItemQuantityLabel(displayItem)}</span>
                                    ) : null}
                                    {refundedQty > 0 ? (
                                      <span className="badge-refunded" title={fullyRefunded ? "Artículo reembolsado" : `${refundedQty} de ${displayItem.quantity} reembolsado`}>
                                        {fullyRefunded ? "Reembolsado" : `Reembolso ${refundedQty}/${displayItem.quantity}`}
                                      </span>
                                    ) : null}
                                  </div>
                                  {displayItem.design_link && !orderCancelled ? (
                                    <a className="table-link" href={displayItem.design_link} rel="noreferrer" target="_blank">
                                      Abrir diseño
                                    </a>
                                  ) : !orderCancelled ? (
                                    <div className="table-secondary">Sin design link</div>
                                  ) : null}
                                  {hasRepeatedQuantity(displayItem) ? (
                                    <div className="table-secondary">Misma línea de Shopify · misma personalización</div>
                                  ) : null}
                                </div>
                                );
                              })}
                            </div>
                            {additionalItemsCount > 0 ? (
                              <div className="table-secondary">{getOrderItems(order).length} líneas de producto en el pedido</div>
                            ) : null}
                          </td>
                          <td>
                            <div className="orders-cell-stack">
                              {displayItems.map((displayItem, index) => {
                                const fullyRefunded = isItemFullyRefunded(displayItem);
                                return (
                                <div className={`orders-cell-line ${fullyRefunded ? "order-item--refunded" : ""}`} key={`${order.id}-variant-${displayItem.id ?? index}`}>
                                  <div className="orders-cell-line-top">
                                    <div className="table-primary">{getVariantLabel(displayItem)}</div>
                                    {getOrderItemQuantityLabel(displayItem) ? (
                                      <span className="badge badge-quantity">{getOrderItemQuantityLabel(displayItem)}</span>
                                    ) : null}
                                  </div>
                                </div>
                                );
                              })}
                            </div>
                          </td>
                          <td>
                            <div className="orders-preview-stack">
                              {displayItems.map((displayItem, index) => {
                                const previewAsset = getItemPrimaryAsset(displayItem);
                                return previewAsset ? (
                                  <div className="orders-preview-cell" key={`${order.id}-preview-${displayItem.id ?? index}`}>
                                    <DesignPreviewWithValidation alt={`Preview ${order.external_id}`} src={previewAsset.url} orderId={order.id} itemId={displayItem.id} />
                                  </div>
                                ) : (
                                  <div className="orders-preview-empty" key={`${order.id}-preview-empty-${displayItem.id ?? index}`}>Sin preview</div>
                                );
                              })}
                            </div>
                          </td>
                          <td>
                            <div className="orders-status-stack">
                              <span className={operationalStatus.className}>{operationalStatus.label}</span>
                              {getAutomationFlags(order).filter((f) => f.key !== "design_ready" && f.key !== "ready_idle").slice(0, 2).map((flag) => (
                                <AutomationFlagBadge flag={flag} key={`${order.id}-${flag.key}`} />
                              ))}
                              {order.assigned_to_employee_name ? (
                                <span className="badge badge-assigned" title={`Asignado a ${order.assigned_to_employee_name}`}>
                                  👤 {order.assigned_to_employee_name.split(" ")[0]}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td>
                            {(() => {
                              const sla = getSlaInfo(order);
                              if (!sla) {
                                // Delivered or cancelled — just show the age
                                return (
                                  <>
                                    <div className="table-primary">{age}</div>
                                    <div className="table-secondary">
                                      {deliveredAt
                                        ? `Entregado en ${formatDateTime(deliveredAt)}`
                                        : `Desde ${formatDateTime(order.created_at)}`}
                                    </div>
                                  </>
                                );
                              }
                              return (
                                <>
                                  <span className={`sla-badge sla-badge-${sla.risk}`}>
                                    {sla.risk === "breached" ? "🔴" : sla.risk === "critical" ? "🟠" : sla.risk === "warning" ? "🟡" : "🟢"}
                                    {" "}{sla.label}
                                  </span>
                                  <div className="table-secondary">
                                    {`Desde ${formatDateTime(order.created_at)}`}
                                  </div>
                                </>
                              );
                            })()}
                          </td>
                          <td>
                            {order.shipment?.tracking_number ? (
                              <>
                                {order.shipment.tracking_url ? (
                                  <a
                                    className="table-link table-primary"
                                    href={order.shipment.tracking_url}
                                    rel="noreferrer"
                                    target="_blank"
                                  >
                                    {order.shipment.tracking_number}
                                  </a>
                                ) : (
                                  <div className="table-primary">{order.shipment.tracking_number}</div>
                                )}
                                <div className="table-secondary">
                                  {order.shipment?.carrier ?? "Carrier no disponible"}
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="table-primary">Pendiente</div>
                                <div className="table-secondary">Sin tracking todavía</div>
                              </>
                            )}
                          </td>
                          <td>
                            <CttLabelCell
                              onOrderUpdated={handleOrderUpdated}
                              order={order}
                            />
                          </td>
                          <td>
                            <div className="orders-row-actions">
                              {orderCancelled ? (
                                /* Cancelled orders: read-only badge + ficha link only */
                                <span className="badge badge-status-cancelled">Cancelado</span>
                              ) : (
                                <>
                                  {/* Resolve incident quick action */}
                                  {order.has_open_incident ? (
                                    <button
                                      className="button-ghost orders-resolve-btn"
                                      disabled={isRowLoading}
                                      onClick={(e) => { e.stopPropagation(); handleInlineResolveIncident(order.id); }}
                                      title="Resolver incidencia abierta"
                                      type="button"
                                    >
                                      ✓ Resolver
                                    </button>
                                  ) : null}

                                  {/* One-click production status advance */}
                                  {(() => {
                                    const step = PROD_STATUS_FLOW[order.production_status ?? ""];
                                    if (!step) return null;
                                    return (
                                      <button
                                        className="button-ghost orders-advance-btn"
                                        disabled={isRowLoading}
                                        onClick={(e) => { e.stopPropagation(); void handleAdvanceProductionStatus(order.id); }}
                                        title={`Avanzar estado a: ${step.label}`}
                                        type="button"
                                      >
                                        {step.icon} {step.label}
                                      </button>
                                    );
                                  })()}

                                  {/* Assign employee */}
                                  {employees.length > 0 ? (
                                    <button
                                      className={`button-ghost orders-assign-btn ${order.assigned_to_employee_id ? "orders-assign-btn-active" : ""}`}
                                      disabled={isRowLoading}
                                      onClick={(e) => openAssignDropdown(e, order.id)}
                                      title={order.assigned_to_employee_name ? `Asignado: ${order.assigned_to_employee_name}` : "Asignar empleado"}
                                      type="button"
                                    >
                                      {order.assigned_to_employee_name
                                        ? `👤 ${order.assigned_to_employee_name.split(" ")[0]}`
                                        : "👤"}
                                    </button>
                                  ) : null}
                                </>
                              )}

                              <Link
                                className="button-secondary table-action"
                                href={fichaHref}
                                onClick={() => saveOrderNavList(visibleOrders.map(o => o.id))}
                              >
                                Ver ficha
                              </Link>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        ) : (
          <Card className="stack table-card">
            <div className="table-header">
              <div>
                <span className="eyebrow">Lotes</span>
                <h3 className="section-title section-title-small">Pick jobs recientes</h3>
              </div>
              <div className="muted">{batches.length} lotes creados</div>
            </div>

            {batches.length === 0 ? (
              <EmptyState
                title="Todavía no hay lotes"
                description="Selecciona pedidos desde la cola y crea tu primer lote operativo."
              />
            ) : (
              <div className="orders-batch-list">
                {batches.map((batch) => (
                  <article className="orders-batch-card" key={batch.id}>
                    <div className="orders-batch-head">
                      <div>
                        <div className="table-primary">Lote #{batch.id}</div>
                        <div className="table-secondary">
                          {batch.shop_id ? shopMap.get(batch.shop_id) ?? `Shop #${batch.shop_id}` : "Multi-tienda"} · {formatDateTime(batch.created_at)}
                        </div>
                      </div>
                      <span className="badge">{batch.status}</span>
                    </div>
                    <div className="orders-batch-metrics">
                      <div className="orders-batch-metric">
                        <span>Pedidos</span>
                        <strong>{batch.orders_count}</strong>
                      </div>
                      <div className="orders-batch-metric">
                        <span>Notas</span>
                        <strong>{batch.notes ?? "Sin notas"}</strong>
                      </div>
                    </div>
                    <div className="table-secondary">
                      Incluye {batch.orders.slice(0, 6).map((entry) => `#${entry.order_id}`).join(", ")}
                      {batch.orders.length > 6 ? "..." : ""}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>

      {quickDetail ? (
      <aside className="orders-drawer">
        <Card className="stack orders-drawer-card">
          <div className="orders-drawer-head">
            <div>
              <span className="eyebrow">Detalle rápido</span>
              <h3 className="section-title section-title-small">
                {quickDetail ? quickDetail.external_id : "Selecciona un pedido"}
              </h3>
            </div>
            <div className="orders-drawer-head-actions">
              <button className="button-secondary" onClick={() => setSelectedOrderId(null)} type="button">
                Cerrar
              </button>
              <Link className="button-secondary" href={`/orders/${quickDetail.id}`}>
                Abrir ficha
              </Link>
            </div>
          </div>

          {detailLoading ? (
            <div className="admin-dashboard-empty">Cargando detalle…</div>
          ) : (
            <>
              <div className="orders-drawer-summary">
                <div>
                  <div className="table-primary">{quickDetail.customer_name}</div>
                  <div className="table-secondary">{quickDetail.customer_email}</div>
                </div>
                <div className="orders-drawer-badges">
                  <StatusBadge status={quickDetail.status} />
                  <PriorityBadge priority={quickDetail.priority} />
                  <DesignAvailabilityBadge order={quickDetail} />
                </div>
              </div>

              <div className="orders-drawer-section">
                <span className="eyebrow">Contenido del pedido</span>
                <strong>{getOrderItemsLabel(quickDetail)}</strong>
                <div className="table-secondary">
                  {getOrderVariantLabel(quickDetail)}
                </div>
                <div className="orders-drawer-metrics">
                  <div className="orders-drawer-metric">
                    <span>Unidades</span>
                    <strong>{getOrderItems(quickDetail).reduce((sum, item) => sum + (item.quantity ?? 0), 0)}</strong>
                  </div>
                  <div className="orders-drawer-metric">
                    <span>Tipo</span>
                    <strong>{quickDetail.is_personalized ? "Personalizado" : "Estándar"}</strong>
                  </div>
                  <div className="orders-drawer-metric">
                    <span>Assets</span>
                    <strong>{quickItem ? getVisibleAssets(quickItem).length : 0}</strong>
                  </div>
                </div>
                {getAdditionalItemsCount(quickDetail) > 0 ? (
                  <div className="table-secondary">
                    También incluye {getOrderItems(quickDetail)
                      .slice(1, 4)
                      .map((item) => item.title ?? item.name ?? "Item")
                      .join(", ")}
                    {getOrderItems(quickDetail).length > 4 ? "..." : ""}
                  </div>
                ) : null}
                {quickItem?.design_link ? (
                  <a className="button-secondary orders-drawer-link" href={quickItem.design_link} rel="noreferrer" target="_blank">
                    Abrir diseño
                  </a>
                ) : null}
              </div>

              <div className="orders-drawer-section">
                <span className="eyebrow">Shipment</span>
                <strong>{quickHeadline?.title ?? "Sin envío"}</strong>
                <div className="table-secondary">{quickHeadline?.description ?? "Este pedido todavía no tiene tracking operativo."}</div>
                <div className="orders-drawer-kv">
                  <div><span>Carrier</span><strong>{quickDetail.shipment?.carrier ?? "Pendiente"}</strong></div>
                  <div><span>Tracking</span><strong>{quickDetail.shipment?.tracking_number ?? "Pendiente"}</strong></div>
                  <div><span>Estado</span><strong>{getShipmentState(quickDetail)}</strong></div>
                </div>
                {quickDetail.shipment?.tracking_url ? (
                  <a className="table-link" href={quickDetail.shipment.tracking_url} rel="noreferrer" target="_blank">
                    Abrir tracking
                  </a>
                ) : null}
                {getOrderShipmentLabelUrl(quickDetail) ? (
                  <div className="orders-drawer-inline-links">
                    <a className="table-link" href={getOrderShipmentLabelUrl(quickDetail) ?? "#"} rel="noreferrer" target="_blank">
                      Ver etiqueta PDF
                    </a>
                    <a
                      className="table-link"
                      download
                      href={getOrderShipmentLabelUrl(quickDetail, { download: true }) ?? "#"}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Descargar
                    </a>
                  </div>
                ) : null}
              </div>

              {quickDetail.prepared_by_employee_name ? (
                <div className="orders-drawer-section">
                  <span className="eyebrow">Preparación</span>
                  <div className="orders-drawer-kv">
                    <div><span>Preparado por</span><strong>{quickDetail.prepared_by_employee_name}</strong></div>
                    {quickDetail.prepared_at ? (
                      <div><span>Fecha</span><strong>{new Date(quickDetail.prepared_at).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</strong></div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className="orders-drawer-section">
                <span className="eyebrow">Automatizaciones</span>
                {getAutomationFlags(quickDetail).length > 0 ? (
                  <div className="automation-flag-row">
                    {getAutomationFlags(quickDetail).map((flag) => (
                      <AutomationFlagBadge flag={flag} key={`${quickDetail.id}-${flag.key}`} />
                    ))}
                  </div>
                ) : (
                  <div className="table-secondary">Sin alertas automáticas activas ahora mismo.</div>
                )}
              </div>

              <div className="orders-drawer-section">
                <span className="eyebrow">Incidencias</span>
                {detailIncidents.length > 0 ? (
                  <div className="orders-drawer-incidents">
                    {detailIncidents.map((incident) => (
                      <article className="orders-drawer-incident" key={incident.id}>
                        <div className="table-primary">{incident.title}</div>
                        <div className="table-secondary">
                          {incident.type} · {incident.priority} · {incident.status}
                          {incident.is_automated ? " · automática" : ""}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="table-secondary">Sin incidencias activas ni históricas.</div>
                )}
              </div>
            </>
          )}
        </Card>
      </aside>
      ) : null}

      {/* ── Assign dropdown — rendered fixed to escape overflow clipping ── */}
      {openInline ? (() => {
        const order = orders.find((o) => o.id === openInline.orderId);
        if (!order) return null;
        return (
          <div
            className="inline-dropdown"
            ref={inlineRef}
            style={{ position: "fixed", top: openInline.top, right: openInline.right, left: "auto", zIndex: 99999 }}
          >
            <button
              className={`inline-dropdown-item ${!order.assigned_to_employee_id ? "inline-dropdown-item-active" : ""}`}
              onClick={() => handleInlineAssign(order.id, null)}
              type="button"
            >
              Sin asignar
            </button>
            {employees.map((emp) => (
              <button
                className={`inline-dropdown-item ${order.assigned_to_employee_id === emp.id ? "inline-dropdown-item-active" : ""}`}
                key={emp.id}
                onClick={() => handleInlineAssign(order.id, emp.id)}
                type="button"
              >
                {emp.name}
              </button>
            ))}
          </div>
        );
      })() : null}
    </div>
  );
}
