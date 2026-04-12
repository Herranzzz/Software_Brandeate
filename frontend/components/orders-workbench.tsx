"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { AutomationFlagBadge } from "@/components/automation-flag-badge";
import { saveOrderNavList } from "@/components/order-nav";
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
  orderPriorityOptions,
  productionStatusOptions,
  sortTrackingEvents,
} from "@/lib/format";
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
  ProductionStatus,
  Shop,
} from "@/lib/types";


type OrdersWorkbenchProps = {
  initialOrders: Order[];
  batches: PickBatch[];
  shops: Shop[];
  initialShopId: string;
  initialTotalCount: number;
  initialPage: number;
  initialPerPage: number;
  initialQuery: string;
  initialQuickFilter: string;
  initialView: "queue" | "batches";
};

type QuickFilterKey =
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

function matchesQuickFilter(order: Order, filter: QuickFilterKey) {
  switch (filter) {
    case "has_incident":
      return order.has_open_incident;

    case "not_prepared":
      // No shipment and not yet shipped/delivered
      return (
        !order.shipment &&
        order.status !== "shipped" &&
        order.status !== "ready_to_ship" &&
        order.status !== "delivered"
      );

    case "prepared":
      // Prepared and waiting for carrier pickup (ready_to_ship or production completed)
      return (
        order.status === "ready_to_ship" ||
        (order.production_status === "completed" &&
          order.status !== "shipped" &&
          order.status !== "delivered")
      );

    case "label_no_update":
      // Has a tracking number but carrier hasn't scanned it yet (only label_created events or none)
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
      return getShipmentState(order) === "out_for_delivery";

    case "shipping_exception":
      return (
        getShipmentState(order) === "exception" ||
        order.shipment?.shipping_status === "exception"
      );

    case "not_downloaded":
      // Has no shipment and design hasn't been downloaded (production_status still at initial state)
      return (
        !order.shipment &&
        order.status !== "shipped" &&
        order.status !== "delivered" &&
        (order.production_status === "pending_personalization" || !order.production_status)
      );

    case "in_production":
      // Design downloaded, currently being printed (not yet packed/shipped)
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
  const [orders, setOrders] = useState(initialOrders);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [detailOrder, setDetailOrder] = useState<Order | null>(null);
  const [detailIncidents, setDetailIncidents] = useState<Incident[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [showBulkLabelModal, setShowBulkLabelModal] = useState(false);
  const [showBulkDesignModal, setShowBulkDesignModal] = useState(false);
  const [query, setQuery] = useState(initialQuery);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectedShopId, setSelectedShopId] = useState<string>(initialShopId);
  const [totalCount, setTotalCount] = useState(initialTotalCount);
  const [page, setPage] = useState(initialPage);
  const [perPage, setPerPage] = useState(initialPerPage);
  const [activeFilters, setActiveFilters] = useState<QuickFilterKey[]>(
    quickFilterMeta.some((filter) => filter.key === initialQuickFilter) ? [initialQuickFilter as QuickFilterKey] : [],
  );
  const [view, setView] = useState<"queue" | "batches">(initialView);
  const [isPending, startTransition] = useTransition();

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
    setSelectedIds([]);
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
    const normalized = query.trim().toLowerCase();
    return orders.filter((order) => {
      if (selectedShopId && String(order.shop_id) !== selectedShopId) {
        return false;
      }

      if (normalized) {
        const fields = [
          order.external_id,
          order.customer_name,
          order.customer_email,
          order.shipment?.tracking_number ?? "",
          ...getOrderItemsSearchTerms(order),
        ];
        if (!fields.some((field) => field.toLowerCase().includes(normalized))) {
          return false;
        }
      }

      return activeFilters.every((filter) => matchesQuickFilter(order, filter));
    });
  }, [activeFilters, orders, query, selectedShopId]);

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

  function handleBulkProductionStatus(productionStatus: ProductionStatus) {
    if (selectedCount === 0) {
      return;
    }
    runBulkAction<Order[]>("/api/orders/bulk/production-status", {
      order_ids: selectedIds,
      production_status: productionStatus,
    }, (updated) => {
      updateOrdersFromBulk(updated);
      toast(`Producción actualizada (${updated.length})`, "success");
    });
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
              <label htmlFor="orders-live-search">Buscar</label>
              <input
                id="orders-live-search"
                onChange={(event) => {
                  const value = event.target.value;
                  setQuery(value);
                  if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
                  searchDebounceRef.current = setTimeout(() => {
                    setPage(1);
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
            {visibleOrders.length === 0 ? (
              <EmptyState
                title="Sin pedidos para esta vista"
                description="Ajusta filtros, cambia el lote cargado o prueba con otra combinación de tienda y estado."
              />
            ) : (
              <div className="table-wrap">
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
                  <tbody>
                    {visibleOrders.map((order, idx) => {
                      const latestEvent = sortTrackingEvents(order.shipment?.events ?? [])[0] ?? null;
                      const operationalStatus = getOperationalStatusMeta(order);
                      const deliveredAt = getDeliveredAt(order);
                      const age = formatElapsedHours(order.created_at, deliveredAt);
                      const displayItems = getDisplayedOrderItems(order);
                      const additionalItemsCount = getAdditionalItemsCount(order);
                      const fichaHref = `/orders/${order.id}`;

                      return (
                        <tr
                          className={`table-row ${selectedOrderId === order.id ? "orders-ops-row-active" : ""}`}
                          data-status={operationalStatus.rowStatus}
                          key={order.id}
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
                              {displayItems.map((displayItem, index) => (
                                <div className="orders-cell-line" key={`${order.id}-title-${displayItem.id ?? index}`}>
                                  <div className="orders-cell-line-top">
                                    <div className="table-primary">{displayItem?.title ?? displayItem?.name ?? "Sin item"}</div>
                                    {getOrderItemQuantityLabel(displayItem) ? (
                                      <span className="badge badge-quantity">{getOrderItemQuantityLabel(displayItem)}</span>
                                    ) : null}
                                  </div>
                                  {displayItem.design_link ? (
                                    <a className="table-link" href={displayItem.design_link} rel="noreferrer" target="_blank">
                                      Abrir diseño
                                    </a>
                                  ) : (
                                    <div className="table-secondary">Sin design link</div>
                                  )}
                                  {hasRepeatedQuantity(displayItem) ? (
                                    <div className="table-secondary">Misma línea de Shopify · misma personalización</div>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                            {additionalItemsCount > 0 ? (
                              <div className="table-secondary">{getOrderItems(order).length} líneas de producto en el pedido</div>
                            ) : null}
                          </td>
                          <td>
                            <div className="orders-cell-stack">
                              {displayItems.map((displayItem, index) => (
                                <div className="orders-cell-line" key={`${order.id}-variant-${displayItem.id ?? index}`}>
                                  <div className="orders-cell-line-top">
                                    <div className="table-primary">{getVariantLabel(displayItem)}</div>
                                    {getOrderItemQuantityLabel(displayItem) ? (
                                      <span className="badge badge-quantity">{getOrderItemQuantityLabel(displayItem)}</span>
                                    ) : null}
                                  </div>
                                </div>
                              ))}
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
                              {order.prepared_by_employee_name ? (
                                <span className="badge badge-preparer" title={`Preparado por ${order.prepared_by_employee_name}`}>
                                  {order.prepared_by_employee_name.split(" ")[0]}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td>
                            <div className="table-primary">{age}</div>
                            <div className="table-secondary">
                              {deliveredAt
                                ? `Entregado en ${formatDateTime(deliveredAt)}`
                                : `Desde ${formatDateTime(order.created_at)}`}
                            </div>
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
                            <Link
                              className="button-secondary table-action"
                              href={fichaHref}
                              onClick={() => saveOrderNavList(visibleOrders.map(o => o.id))}
                            >
                              Ver ficha
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
    </div>
  );
}
