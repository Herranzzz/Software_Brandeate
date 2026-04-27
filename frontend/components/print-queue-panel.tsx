"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";

import { BulkLabelModal } from "@/components/bulk-label-modal";
import { Card } from "@/components/card";
import { EmployeesTabNav } from "@/components/employees-tab-nav";
import { PageHeader } from "@/components/page-header";
import { useToast } from "@/components/toast";
import { fetchOrders } from "@/lib/api";
import { useOrderRealtimeRefresh } from "@/lib/use-order-realtime";
import { printLabelsMerged, type PrintLabelFailure } from "@/lib/print-utils";
import type { Order, Shop } from "@/lib/types";


type PreparerSelection = "me" | "all" | number;
type PrintQueueTimeFilter = "all" | "session" | "30m" | "1h" | "today";

type PreparerOption = { id: number; name: string };

const TIME_FILTER_OPTIONS: Array<{ value: PrintQueueTimeFilter; label: string }> = [
  { value: "all", label: "Toda la cola" },
  { value: "session", label: "Esta sesión" },
  { value: "30m", label: "Últimos 30 min" },
  { value: "1h", label: "Última hora" },
  { value: "today", label: "Hoy" },
];

// ─── Kiosk-printing setup card ───────────────────────────────────────────────


function detectOS(): "windows" | "mac" | "other" {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("win")) return "windows";
  if (ua.includes("mac")) return "mac";
  return "other";
}

function KioskSetupCard({ onDismiss }: { onDismiss: () => void }) {
  const os = detectOS();

  function download() {
    const osParam = os === "mac" ? "mac" : "windows";
    window.location.href = `/api/kiosk-script?os=${osParam}`;
  }

  return (
    <div className="kiosk-setup-card">
      <div className="kiosk-setup-icon">🖨️</div>
      <div className="kiosk-setup-body">
        <strong>Configura impresión directa en esta máquina</strong>
        <p className="muted">
          Descarga el acceso directo y úsalo para abrir la app. Con él, al pulsar
          "Imprimir" las etiquetas van directo a la impresora sin ningún diálogo.
        </p>
        <div className="kiosk-setup-actions">
          <button className="button" onClick={download} type="button">
            {os === "windows"
              ? "⬇ Descargar acceso directo (Windows)"
              : os === "mac"
                ? "⬇ Descargar acceso directo (Mac)"
                : "⬇ Descargar acceso directo"}
          </button>
          <button className="button-link muted" onClick={onDismiss} type="button">
            Ya está configurado · ocultar
          </button>
        </div>
      </div>
    </div>
  );
}

type PrintQueuePanelProps = {
  initialOrders: Order[];
  initialTotal: number;
  shops: Shop[];
  activeShopId: string;
  currentUserId: number;
  currentUserName: string;
  preparerSelection: PreparerSelection;
  preparers: PreparerOption[];
};

/**
 * Format a timestamp as a Spanish relative label ("hace 3 min", "hace 2 h").
 * Falls back to a short date string for anything over 24 h.
 */
function formatRelative(value: string | null | undefined): string {
  if (!value) return "—";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "—";
  const diffMs = Date.now() - then;
  const diffMin = Math.max(0, Math.round(diffMs / 60000));
  if (diffMin < 1) return "hace unos segundos";
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `hace ${diffHours} h`;
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function summarizeAddress(order: Order): string {
  const parts = [order.shipping_town, order.shipping_postal_code, order.shipping_country_code]
    .filter((v): v is string => Boolean(v && v.trim()))
    .map((v) => v.trim());
  return parts.length ? parts.join(" · ") : "Dirección pendiente";
}

function getTrackingCode(order: Order): string | null {
  const code = order.shipment?.tracking_number?.trim();
  return code ? code : null;
}


export function PrintQueuePanel({
  initialOrders,
  initialTotal,
  shops,
  activeShopId,
  currentUserId,
  currentUserName,
  preparerSelection,
  preparers,
}: PrintQueuePanelProps) {
  // Resolve the active preparer into the id we send to the API. "all" → no
  // filter; "me" → currentUserId; numeric → that user's id. Centralised here
  // so the rest of the component doesn't have to branch on the union type.
  const activePreparerId: number | undefined =
    preparerSelection === "all"
      ? undefined
      : preparerSelection === "me"
        ? currentUserId
        : preparerSelection;
  const isViewingOwn = preparerSelection === "me";
  const isViewingAll = preparerSelection === "all";
  const viewingPreparerName = !isViewingAll && !isViewingOwn
    ? preparers.find((p) => p.id === preparerSelection)?.name ?? "compañero"
    : null;
  const router = useRouter();
  const { toast } = useToast();
  const [, startTransition] = useTransition();

  const [orders, setOrders] = useState<Order[]>(initialOrders);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [showBulkLabelModal, setShowBulkLabelModal] = useState(false);
  const [modalOrders, setModalOrders] = useState<Order[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRemoving, setIsRemoving] = useState<number | null>(null);
  const [isBulkRemoving, setIsBulkRemoving] = useState(false);
  const [printProgress, setPrintProgress] = useState<{ done: number; total: number; phase: "downloading" | "printing" } | null>(null);
  const [lastPrintFailures, setLastPrintFailures] = useState<PrintLabelFailure[]>([]);
  const [showSetupCard, setShowSetupCard] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("kiosk_setup_dismissed") !== "1";
  });

  // Track which order IDs were in the queue at page load (the "pre-session"
  // set). Any order that arrives after that is considered "this session".
  const [sessionBaseIds] = useState<Set<number>>(
    () => new Set(initialOrders.map((o) => o.id)),
  );

  // Default to "today" so residual pedidos preparados hace días que nunca se
  // completaron (impresora caída, navegador cerrado, etc.) no se mezclen con
  // la tanda actual al pulsar "Imprimir todas". Quien quiera verlos cambia el
  // filtro a "Toda la cola".
  const [timeFilter, setTimeFilter] = useState<PrintQueueTimeFilter>("today");

  function dismissSetupCard() {
    localStorage.setItem("kiosk_setup_dismissed", "1");
    setShowSetupCard(false);
  }

  // Keep local list in sync when the server component re-renders after navigation
  // or refresh() — otherwise freshly prepared orders pushed by a teammate wouldn't
  // show up until full page reload.
  useEffect(() => {
    setOrders(initialOrders);
  }, [initialOrders]);

  const refreshFromServer = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const { orders: fresh } = await fetchOrders({
        is_prepared: true,
        production_status: "packed",
        shop_id: activeShopId || undefined,
        prepared_by_employee_id: activePreparerId,
        sort_by: "prepared_asc",
        per_page: 250,
      });
      setOrders(fresh);
      // Prune any stale selections that no longer apply.
      setSelectedIds((prev) => {
        const next = new Set<number>();
        for (const o of fresh) {
          if (prev.has(o.id)) next.add(o.id);
        }
        return next;
      });
    } catch {
      toast("No se pudo refrescar la cola", "error");
    } finally {
      setIsRefreshing(false);
    }
  }, [activeShopId, toast, activePreparerId]);

  // Realtime: re-fetch immediately when a teammate mutates an order.
  // Debounced inside the hook so bulk "preparar" of N orders → 1 refetch.
  useOrderRealtimeRefresh(() => {
    void refreshFromServer();
  });

  // Safety-net poll in case the SSE stream is disconnected (tab backgrounded,
  // server restart mid-flight). 60 s is loose — realtime does the heavy lifting.
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void refreshFromServer();
    }, 60000);
    return () => window.clearInterval(intervalId);
  }, [refreshFromServer]);

  // El filtro por empleado lo aplica el servidor (`prepared_by_employee_id`),
  // así que aquí solo recortamos por tiempo. Esto evita la trampa anterior
  // donde el desplegable de empleado solo veía a la gente cuyas órdenes ya
  // estaban cargadas en cliente.
  const visibleOrders = useMemo(() => {
    const now = Date.now();
    const THIRTY_MIN = 30 * 60 * 1000;
    const ONE_HOUR = 60 * 60 * 1000;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTodayMs = startOfToday.getTime();

    return orders.filter((o) => {
      if (timeFilter === "all") return true;
      if (timeFilter === "session") return !sessionBaseIds.has(o.id);

      const preparedMs = o.prepared_at ? new Date(o.prepared_at).getTime() : NaN;
      if (Number.isNaN(preparedMs)) return false;
      if (timeFilter === "30m") return now - preparedMs <= THIRTY_MIN;
      if (timeFilter === "1h") return now - preparedMs <= ONE_HOUR;
      if (timeFilter === "today") return preparedMs >= startOfTodayMs;
      return true;
    });
  }, [orders, timeFilter, sessionBaseIds]);

  const totalCount = orders.length;
  const filteredCount = visibleOrders.length;
  const isFiltered = timeFilter !== "all";
  const selectedCount = selectedIds.size;
  const hasSelection = selectedCount > 0;

  // Pedidos con prepared_at de hace más de 24 h. Suelen ser residuos: se
  // prepararon, no se imprimieron (printer caída / pestaña cerrada) y se
  // quedaron bloqueando la cola. Los exponemos como aviso para que el
  // operador decida si los recupera o los descarta.
  const staleOrderIds = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return new Set(
      orders
        .filter((o) => {
          const ms = o.prepared_at ? new Date(o.prepared_at).getTime() : NaN;
          return !Number.isNaN(ms) && ms < cutoff;
        })
        .map((o) => o.id),
    );
  }, [orders]);
  const staleCount = staleOrderIds.size;

  // Orders that arrived after the page load (new this session).
  const sessionOrderIds = useMemo(
    () => new Set(orders.filter((o) => !sessionBaseIds.has(o.id)).map((o) => o.id)),
    [orders, sessionBaseIds],
  );
  const sessionCount = sessionOrderIds.size;

  // How many orders in the queue already have a label ready vs still need one
  // created. Drives the "listos para imprimir" stat.
  const readyCount = useMemo(
    () => orders.filter((o) => getTrackingCode(o) !== null).length,
    [orders],
  );
  const needsLabelCount = totalCount - readyCount;

  // Preparer breakdown — only relevant when viewing the whole team.
  const preparerStats = useMemo(() => {
    const map = new Map<string, number>();
    for (const order of orders) {
      const key = order.prepared_by_employee_name || "Sin asignar";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [orders]);

  function toggleOne(orderId: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }

  function toggleAll() {
    if (selectedCount === visibleOrders.length && visibleOrders.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visibleOrders.map((o) => o.id)));
    }
  }

  function selectSession() {
    if (sessionCount === 0) return;
    // If all session orders are already selected, deselect them. Otherwise select them.
    const allSelected = [...sessionOrderIds].every((id) => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of sessionOrderIds) next.delete(id);
        return next;
      });
    } else {
      setSelectedIds((prev) => new Set([...prev, ...sessionOrderIds]));
    }
  }

  async function removeSelected() {
    if (isBulkRemoving || selectedCount === 0) return;
    const idsToRemove = [...selectedIds];
    setIsBulkRemoving(true);
    try {
      const results = await Promise.allSettled(
        idsToRemove.map((id) =>
          fetch(`/api/orders/${id}/production-status`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ production_status: "in_production" }),
          }).then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return id;
          }),
        ),
      );
      const removed = results
        .filter((r): r is PromiseFulfilledResult<number> => r.status === "fulfilled")
        .map((r) => r.value);
      const failed = results.filter((r) => r.status === "rejected").length;

      if (removed.length > 0) {
        setOrders((prev) => prev.filter((o) => !removed.includes(o.id)));
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (const id of removed) next.delete(id);
          return next;
        });
      }
      if (failed > 0) {
        toast(`${removed.length} quitados · ${failed} con error`, "warning");
      } else {
        toast(`${removed.length} pedido${removed.length !== 1 ? "s" : ""} devuelto${removed.length !== 1 ? "s" : ""} a producción`, "success");
      }
    } catch {
      toast("Error al quitar los pedidos seleccionados", "error");
    } finally {
      setIsBulkRemoving(false);
    }
  }

  /**
   * Mark a set of orders as completed on the backend so they drop out of the
   * queue right after we've sent their labels to the printer. Best-effort —
   * if it fails we keep the print result visible and just log a toast.
   */
  async function markOrdersCompleted(orderIds: number[]): Promise<number[]> {
    const completed: number[] = [];
    await Promise.all(
      orderIds.map(async (id) => {
        try {
          const res = await fetch(`/api/orders/${id}/production-status`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ production_status: "completed" }),
          });
          if (res.ok) completed.push(id);
        } catch {
          // Swallow — we'll just leave the row visible so the user can retry.
        }
      }),
    );
    return completed;
  }

  /**
   * Print the existing CTT labels for the given orders directly, without
   * going through the "create shipment" modal. Orders without a tracking
   * code are split off and handed to the BulkLabelModal so they can get
   * their labels created on the spot.
   */
  async function printExistingLabels(targets: Order[]) {
    const ready = targets.filter((o) => getTrackingCode(o) !== null);
    const pending = targets.filter((o) => getTrackingCode(o) === null);

    if (ready.length === 0 && pending.length === 0) {
      toast("No hay pedidos para imprimir", "info");
      return;
    }

    // Si la tanda incluye etiquetas viejas (preparadas hace >24h), pedimos
    // confirmación. Es la causa típica de "salen etiquetas que no
    // recuerdo": residuos de sesiones anteriores que se cuelan en la pila.
    const staleInBatch = ready.filter((o) => staleOrderIds.has(o.id));
    if (staleInBatch.length > 0) {
      const proceed = window.confirm(
        `${staleInBatch.length} de ${ready.length} etiqueta${ready.length !== 1 ? "s" : ""} ` +
          `${staleInBatch.length === 1 ? "fue preparada" : "fueron preparadas"} hace más de 24 h. ` +
          "¿Quieres imprimirlas igual? (Pulsa Cancelar para revisarlas en la cola.)",
      );
      if (!proceed) return;
    }

    setLastPrintFailures([]);

    if (ready.length > 0) {
      setPrintProgress({ done: 0, total: ready.length, phase: "downloading" });
      const trackingCodes = ready.map((o) => getTrackingCode(o)!);
      try {
        const failures = await printLabelsMerged(
          trackingCodes,
          { format: "PDF" },
          (done, total) => {
            // Once all are fetched the merge+print step starts.
            const phase = done < total ? "downloading" : "printing";
            setPrintProgress({ done, total, phase });
          },
        );
        setLastPrintFailures(failures);

        const failedCodes = new Set(failures.map((f) => f.trackingCode));
        const printedOrders = ready.filter((o) => {
          const code = getTrackingCode(o);
          return code !== null && !failedCodes.has(code);
        });

        if (printedOrders.length > 0) {
          const completedIds = await markOrdersCompleted(printedOrders.map((o) => o.id));
          if (completedIds.length > 0) {
            setOrders((prev) => prev.filter((o) => !completedIds.includes(o.id)));
            setSelectedIds((prev) => {
              const next = new Set(prev);
              completedIds.forEach((id) => next.delete(id));
              return next;
            });
          }
        }

        if (failures.length === 0) {
          toast(`${printedOrders.length} etiquetas enviadas a la impresora`, "success");
        } else if (printedOrders.length === 0) {
          toast("Ninguna etiqueta se pudo imprimir", "error");
        } else {
          toast(
            `${printedOrders.length} impresas · ${failures.length} con error`,
            "warning",
          );
        }
      } finally {
        setPrintProgress(null);
      }
    }

    // Orders in the queue that were bulk-marked prepared but never had a CTT
    // label created. Send them through the familiar BulkLabelModal so the
    // user can pick the service/weight and push them through.
    if (pending.length > 0) {
      setModalOrders(pending);
      setShowBulkLabelModal(true);
      if (ready.length > 0) {
        toast(
          `${pending.length} pedidos sin etiqueta — abriendo creación rápida`,
          "info",
        );
      }
    }
  }

  function printAll() {
    void printExistingLabels(visibleOrders);
  }

  function printSelected() {
    const subset = visibleOrders.filter((o) => selectedIds.has(o.id));
    void printExistingLabels(subset);
  }

  function printSingle(order: Order) {
    void printExistingLabels([order]);
  }

  async function removeFromQueue(order: Order) {
    if (isRemoving !== null) return;
    setIsRemoving(order.id);
    try {
      const res = await fetch(`/api/orders/${order.id}/production-status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ production_status: "in_production" }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(body?.detail ?? "No se pudo quitar de la cola");
      }
      setOrders((prev) => prev.filter((o) => o.id !== order.id));
      setSelectedIds((prev) => {
        if (!prev.has(order.id)) return prev;
        const next = new Set(prev);
        next.delete(order.id);
        return next;
      });
      toast(`Pedido ${order.external_id ?? `#${order.id}`} devuelto a producción`, "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Error al quitar de la cola", "error");
    } finally {
      setIsRemoving(null);
    }
  }

  function updateQueryParams(next: { shop_id?: string; preparer?: PreparerSelection }) {
    const params = new URLSearchParams();
    const shopId = next.shop_id ?? activeShopId;
    const nextPreparer = next.preparer ?? preparerSelection;
    if (shopId) params.set("shop_id", shopId);
    // Default is "me" — only serialise cuando se cambia a otra cosa, así
    // las URLs limpias siguen significando "mis pedidos".
    if (nextPreparer === "all") params.set("preparer", "all");
    else if (typeof nextPreparer === "number") params.set("preparer", String(nextPreparer));
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `/employees/print-queue?${qs}` : "/employees/print-queue");
    });
  }

  function onShopFilterChange(nextShopId: string) {
    updateQueryParams({ shop_id: nextShopId });
  }

  function onPreparerChange(value: string) {
    if (value === "all") return updateQueryParams({ preparer: "all" });
    if (value === "me") return updateQueryParams({ preparer: "me" });
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) updateQueryParams({ preparer: parsed });
  }

  const headerTitle = isViewingOwn
    ? `Etiquetas de ${currentUserName}`
    : isViewingAll
      ? "Etiquetas de todo el equipo"
      : `Etiquetas de ${viewingPreparerName}`;
  const isPrinting = printProgress !== null;
  const preparerSelectValue: string =
    typeof preparerSelection === "number" ? String(preparerSelection) : preparerSelection;

  function printProgressLabel(progress: { done: number; total: number; phase: "downloading" | "printing" }) {
    if (progress.phase === "printing") return "Abriendo PDF...";
    return `Descargando ${progress.done}/${progress.total}...`;
  }

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Equipo"
        title={headerTitle}
        description={
          isViewingOwn
            ? "Pedidos que ya has preparado con etiqueta lista. Imprímelos en lote — los impresos desaparecen de la cola automáticamente."
            : isViewingAll
              ? "Pedidos preparados por todo el equipo, ordenados por orden de preparación (FIFO). Imprime el lote para liberar el turno."
              : `Pedidos preparados por ${viewingPreparerName}, ordenados por orden de preparación. Imprímelos cuando ${viewingPreparerName} no esté para hacerlo.`
        }
        actions={
          <div className="print-queue-header-actions">
            <button
              className="button-secondary"
              disabled={isRefreshing || isPrinting}
              onClick={() => void refreshFromServer()}
              type="button"
            >
              {isRefreshing ? "Actualizando..." : "Actualizar"}
            </button>
            <button
              className="button button-primary print-queue-print-all"
              disabled={filteredCount === 0 || isPrinting}
              onClick={printAll}
              type="button"
            >
              {isPrinting && printProgress
                ? printProgressLabel(printProgress)
                : isFiltered
                  ? `Imprimir filtradas (${filteredCount})`
                  : `Imprimir todas (${filteredCount})`}
            </button>
          </div>
        }
      />

      <EmployeesTabNav />
      {showSetupCard ? <KioskSetupCard onDismiss={dismissSetupCard} /> : null}

      <div className="print-queue-stats">
        <div className="print-queue-stat print-queue-stat-primary">
          <span className="eyebrow">En cola</span>
          <strong className="print-queue-stat-value">
            {isFiltered ? `${filteredCount}/${totalCount}` : totalCount}
          </strong>
          <span className="muted">
            {isFiltered
              ? "filtradas · total de la cola"
              : isViewingOwn
                ? `preparadas por ${currentUserName}`
                : isViewingAll
                  ? "de todo el equipo"
                  : `preparadas por ${viewingPreparerName}`}
          </span>
        </div>
        <div className="print-queue-stat">
          <span className="eyebrow">Listas para imprimir</span>
          <strong className="print-queue-stat-value">{readyCount}</strong>
          <span className="muted">
            {needsLabelCount > 0
              ? `${needsLabelCount} sin etiqueta todavía`
              : "Todas con etiqueta creada"}
          </span>
        </div>
        <div className="print-queue-stat">
          <span className="eyebrow">Esta sesión</span>
          <strong className="print-queue-stat-value">{sessionCount}</strong>
          <span className="muted">
            {sessionCount > 0
              ? "nuevas desde que abriste la página"
              : "sin pedidos nuevos aún"}
          </span>
        </div>
        <div className="print-queue-stat">
          <span className="eyebrow">Selección</span>
          <strong className="print-queue-stat-value">{selectedCount}</strong>
          <span className="muted">
            {hasSelection
              ? "Toca Imprimir seleccionadas"
              : "Elige pedidos o imprime todo"}
          </span>
        </div>
      </div>

      <Card className="stack">
        <div className="orders-inline-tools print-queue-toolbar">
          <div className="field orders-inline-shop">
            <label htmlFor="print-queue-preparer-filter">Preparados por</label>
            <select
              id="print-queue-preparer-filter"
              onChange={(e) => onPreparerChange(e.target.value)}
              value={preparerSelectValue}
            >
              <option value="me">Yo ({currentUserName})</option>
              <option value="all">Todo el equipo</option>
              {preparers.length > 0 ? (
                <optgroup label="Compañeros">
                  {preparers
                    .filter((p) => p.id !== currentUserId)
                    .map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        {p.name}
                      </option>
                    ))}
                </optgroup>
              ) : null}
            </select>
          </div>
          <div className="field orders-inline-shop">
            <label htmlFor="print-queue-shop-filter">Tienda</label>
            <select
              id="print-queue-shop-filter"
              onChange={(e) => onShopFilterChange(e.target.value)}
              value={activeShopId}
            >
              <option value="">Todas</option>
              {shops.map((shop) => (
                <option key={shop.id} value={String(shop.id)}>
                  {shop.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field orders-inline-shop">
            <label htmlFor="print-queue-time-filter">Tiempo</label>
            <select
              id="print-queue-time-filter"
              onChange={(e) => setTimeFilter(e.target.value as PrintQueueTimeFilter)}
              value={timeFilter}
            >
              {TIME_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          {isFiltered ? (
            <button
              className="button-link muted"
              onClick={() => setTimeFilter("all")}
              type="button"
            >
              Limpiar filtros
            </button>
          ) : null}
          {staleCount > 0 && timeFilter !== "all" ? (
            <button
              className="button-link muted"
              onClick={() => setTimeFilter("all")}
              title="Pedidos preparados hace más de 24 h, ocultos por el filtro de tiempo"
              type="button"
            >
              Ver {staleCount} antiguo{staleCount !== 1 ? "s" : ""}
            </button>
          ) : null}
          <div className="print-queue-selection-tools">
            {sessionCount > 0 && (
              <button
                className="button-secondary"
                onClick={selectSession}
                title="Seleccionar los pedidos que han llegado a la cola durante esta sesión"
                type="button"
              >
                Esta sesión ({sessionCount})
              </button>
            )}
            {hasSelection ? (
              <>
                <span className="muted">{selectedCount} seleccionadas</span>
                <button
                  className="button-secondary"
                  disabled={isBulkRemoving || isPrinting}
                  onClick={() => void removeSelected()}
                  title="Devolver a producción todos los seleccionados"
                  type="button"
                >
                  {isBulkRemoving ? "Quitando..." : `Quitar selección (${selectedCount})`}
                </button>
                <button className="button-link muted" onClick={() => setSelectedIds(new Set())} type="button">
                  Limpiar
                </button>
                <button
                  className="button"
                  disabled={isPrinting || isBulkRemoving}
                  onClick={printSelected}
                  type="button"
                >
                  {isPrinting && printProgress
                    ? printProgressLabel(printProgress)
                    : `Imprimir seleccionadas (${selectedCount})`}
                </button>
              </>
            ) : null}
          </div>
        </div>

        {isViewingAll && preparerStats.length > 0 ? (
          <div className="print-queue-preparers muted">
            Reparto:{" "}
            {preparerStats.map(([name, count], idx) => (
              <span key={name}>
                {idx > 0 ? " · " : ""}
                {name} · {count}
              </span>
            ))}
          </div>
        ) : null}

        {lastPrintFailures.length > 0 ? (
          <div className="feedback feedback-warning">
            <strong>{lastPrintFailures.length} etiquetas no se pudieron imprimir.</strong>
            <ul className="stack-xs" style={{ marginTop: "0.4rem" }}>
              {lastPrintFailures.map((failure) => (
                <li key={failure.trackingCode}>
                  <code>{failure.trackingCode}</code> · {failure.error.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {visibleOrders.length === 0 ? (
          <div className="print-queue-empty">
            <strong>{isFiltered ? "Sin resultados con estos filtros" : "¡Todo impreso!"}</strong>
            <p className="muted">
              {isFiltered
                ? "Prueba a ampliar el rango de tiempo o cambiar el filtro de Preparados por."
                : isViewingOwn
                  ? `No tienes pedidos en cola, ${currentUserName}. Cuando prepares un pedido, aparecerá aquí listo para imprimir.`
                  : isViewingAll
                    ? "No hay pedidos preparados esperando impresión. Cuando el equipo prepare pedidos, aparecerán aquí."
                    : `${viewingPreparerName} no tiene pedidos preparados esperando impresión.`}
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: "40px" }}>
                    <input
                      aria-label="Seleccionar todas"
                      checked={selectedCount === visibleOrders.length && visibleOrders.length > 0}
                      onChange={toggleAll}
                      type="checkbox"
                    />
                  </th>
                  <th>Pedido</th>
                  <th>Destino</th>
                  <th>Preparado</th>
                  <th>Etiqueta</th>
                  <th style={{ width: "220px" }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {visibleOrders.map((order) => {
                  const selected = selectedIds.has(order.id);
                  const trackingCode = getTrackingCode(order);
                  const labelReady = trackingCode !== null;
                  return (
                    <tr
                      className={`table-row ${selected ? "table-row-selected" : ""}`}
                      key={order.id}
                    >
                      <td>
                        <input
                          aria-label={`Seleccionar pedido ${order.external_id ?? order.id}`}
                          checked={selected}
                          onChange={() => toggleOne(order.id)}
                          type="checkbox"
                        />
                      </td>
                      <td>
                        <div className="table-primary">
                          <Link className="link" href={`/orders/${order.id}`}>
                            {order.external_id ?? `#${order.id}`}
                          </Link>
                        </div>
                        <div className="table-secondary">{order.customer_name || "Sin cliente"}</div>
                      </td>
                      <td>
                        <div className="table-primary">{summarizeAddress(order)}</div>
                        {order.shipping_address_line1 ? (
                          <div className="table-secondary">{order.shipping_address_line1}</div>
                        ) : null}
                      </td>
                      <td>
                        <div className="table-primary">{formatRelative(order.prepared_at)}</div>
                        <div className="table-secondary">
                          {order.prepared_by_employee_name ?? "Sin asignar"}
                        </div>
                      </td>
                      <td>
                        {labelReady ? (
                          <div className="table-primary">
                            <code>{trackingCode}</code>
                          </div>
                        ) : (
                          <span className="badge badge-warning">Sin etiqueta</span>
                        )}
                      </td>
                      <td>
                        <div className="print-queue-row-actions">
                          <button
                            className="button-small button"
                            disabled={isPrinting}
                            onClick={() => printSingle(order)}
                            type="button"
                          >
                            {labelReady ? "Imprimir" : "Crear etiqueta"}
                          </button>
                          <button
                            className="button-small button-secondary"
                            disabled={isRemoving === order.id || isPrinting}
                            onClick={() => void removeFromQueue(order)}
                            title="Devolver a producción (no está preparado todavía)"
                            type="button"
                          >
                            {isRemoving === order.id ? "Quitando..." : "Quitar"}
                          </button>
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

      {showBulkLabelModal ? (
        <BulkLabelModal
          orders={modalOrders}
          shop={shops.find((s) => String(s.id) === activeShopId) ?? shops[0] ?? null}
          onClose={() => {
            setShowBulkLabelModal(false);
            setModalOrders([]);
          }}
          onComplete={() => {
            // Orders that got labeled in this batch now have shipments. They
            // stay visible in the queue (since production_status is still
            // packed) but their row will switch from "Sin etiqueta" to
            // "Imprimir" on the next refresh.
            setShowBulkLabelModal(false);
            setModalOrders([]);
            void refreshFromServer();
          }}
        />
      ) : null}
    </div>
  );
}
