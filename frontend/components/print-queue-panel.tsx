"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";

import { BulkLabelModal } from "@/components/bulk-label-modal";
import { Card } from "@/components/card";
import { PageHeader } from "@/components/page-header";
import { useToast } from "@/components/toast";
import { fetchOrders } from "@/lib/api";
import type { Order, Shop } from "@/lib/types";


type PrintQueuePanelProps = {
  initialOrders: Order[];
  initialTotal: number;
  shops: Shop[];
  activeShopId: string;
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


export function PrintQueuePanel({
  initialOrders,
  initialTotal,
  shops,
  activeShopId,
}: PrintQueuePanelProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [, startTransition] = useTransition();

  const [orders, setOrders] = useState<Order[]>(initialOrders);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [showBulkLabelModal, setShowBulkLabelModal] = useState(false);
  const [modalOrders, setModalOrders] = useState<Order[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRemoving, setIsRemoving] = useState<number | null>(null);

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
        has_shipment: false,
        shop_id: activeShopId || undefined,
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
  }, [activeShopId, toast]);

  // Background poll so the queue updates when teammates prepare new orders
  // without the current user having to mash refresh. 30 s keeps load low and
  // still feels "live" for a warehouse floor.
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void refreshFromServer();
    }, 30000);
    return () => window.clearInterval(intervalId);
  }, [refreshFromServer]);

  const visibleOrders = orders;
  const totalCount = orders.length;
  const selectedCount = selectedIds.size;
  const hasSelection = selectedCount > 0;

  // Preparer breakdown — a quick "who prepared what" readout under the header.
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

  function openModalWith(targets: Order[]) {
    if (targets.length === 0) {
      toast("No hay pedidos para imprimir", "info");
      return;
    }
    setModalOrders(targets);
    setShowBulkLabelModal(true);
  }

  function printAll() {
    openModalWith(visibleOrders);
  }

  function printSelected() {
    const subset = visibleOrders.filter((o) => selectedIds.has(o.id));
    openModalWith(subset);
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

  function onShopFilterChange(nextShopId: string) {
    const params = new URLSearchParams();
    if (nextShopId) params.set("shop_id", nextShopId);
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `/employees/print-queue?${qs}` : "/employees/print-queue");
    });
  }

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Cola de impresión"
        title="Etiquetas pendientes de imprimir"
        description="Pedidos que el equipo ya ha preparado y están esperando a que alguien los mande a la impresora de etiquetas. Imprime todo el lote del tirón para liberar el turno."
        actions={
          <div className="print-queue-header-actions">
            <button
              className="button-secondary"
              disabled={isRefreshing}
              onClick={() => void refreshFromServer()}
              type="button"
            >
              {isRefreshing ? "Actualizando..." : "Actualizar"}
            </button>
            <button
              className="button button-primary print-queue-print-all"
              disabled={totalCount === 0}
              onClick={printAll}
              type="button"
            >
              Imprimir todas ({totalCount})
            </button>
          </div>
        }
      />

      <div className="print-queue-stats">
        <div className="print-queue-stat print-queue-stat-primary">
          <span className="eyebrow">Pendientes</span>
          <strong className="print-queue-stat-value">{totalCount}</strong>
          <span className="muted">
            {initialTotal !== totalCount ? `${initialTotal} al cargar la página` : "Actualizado en vivo"}
          </span>
        </div>
        <div className="print-queue-stat">
          <span className="eyebrow">Selección</span>
          <strong className="print-queue-stat-value">{selectedCount}</strong>
          <span className="muted">
            {hasSelection ? "Listas para imprimir" : "Toca un pedido o Seleccionar todas"}
          </span>
        </div>
        <div className="print-queue-stat">
          <span className="eyebrow">Equipo</span>
          <strong className="print-queue-stat-value">{preparerStats.length}</strong>
          <span className="muted">
            {preparerStats.length > 0
              ? preparerStats.map(([name, count]) => `${name} · ${count}`).join(" · ")
              : "Nadie ha preparado pedidos todavía"}
          </span>
        </div>
      </div>

      <Card className="stack">
        <div className="orders-inline-tools">
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
          {hasSelection ? (
            <div className="print-queue-selection-tools">
              <span className="muted">{selectedCount} seleccionadas</span>
              <button className="button-secondary" onClick={() => setSelectedIds(new Set())} type="button">
                Limpiar selección
              </button>
              <button className="button" onClick={printSelected} type="button">
                Imprimir seleccionadas ({selectedCount})
              </button>
            </div>
          ) : null}
        </div>

        {visibleOrders.length === 0 ? (
          <div className="print-queue-empty">
            <strong>¡Todo impreso!</strong>
            <p className="muted">
              No hay pedidos preparados esperando etiqueta. Cuando el equipo marque pedidos como preparados, aparecerán aquí
              automáticamente.
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
                  <th style={{ width: "200px" }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {visibleOrders.map((order) => {
                  const selected = selectedIds.has(order.id);
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
                        <div className="print-queue-row-actions">
                          <button
                            className="button-small button"
                            onClick={() => openModalWith([order])}
                            type="button"
                          >
                            Imprimir ahora
                          </button>
                          <button
                            className="button-small button-secondary"
                            disabled={isRemoving === order.id}
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
          onComplete={(updatedIds) => {
            // Orders that got labeled in this batch now have shipments and should
            // vanish from the queue without waiting for the next poll.
            if (updatedIds.length > 0) {
              setOrders((prev) => prev.filter((o) => !updatedIds.includes(o.id)));
              setSelectedIds((prev) => {
                const next = new Set(prev);
                updatedIds.forEach((id) => next.delete(id));
                return next;
              });
            }
            setShowBulkLabelModal(false);
            setModalOrders([]);
            // Fire a background re-fetch so any changes we didn't catch sync up.
            void refreshFromServer();
          }}
        />
      ) : null}
    </div>
  );
}
