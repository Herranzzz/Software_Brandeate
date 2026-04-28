"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useOrderRealtimeRefresh } from "@/lib/use-order-realtime";
import { useToast } from "@/components/toast";
import { getOrderPriorityMeta } from "@/lib/format";
import type { Order, ProductionStatus } from "@/lib/types";

type Props = {
  initialOrders: Order[];
};

type Column = {
  status: ProductionStatus;
  title: string;
  emoji: string;
  color: string;
};

const COLUMNS: Column[] = [
  { status: "pending_personalization", title: "Pendiente",      emoji: "📋", color: "#6366f1" },
  { status: "in_production",           title: "En producción",  emoji: "🖨",  color: "#0ea5e9" },
  { status: "packed",                  title: "Empaquetado",    emoji: "📦", color: "#f59e0b" },
  { status: "completed",               title: "Completado",     emoji: "✅", color: "#22c55e" },
];

const PRIORITY_EMOJI: Record<string, string> = {
  urgent: "🔴",
  high:   "🟠",
  normal: "🟡",
  low:    "⚪",
};

function getPrimaryDesignUrl(order: Order): string | null {
  for (const item of order.items) {
    const raw = item.personalization_assets_json;
    if (Array.isArray(raw) && raw.length > 0) {
      const first = raw[0];
      if (typeof first === "string") return first;
      if (first && typeof first === "object" && "url" in first && typeof (first as { url?: unknown }).url === "string") {
        return (first as { url: string }).url;
      }
    }
  }
  return null;
}

export function ProductionKanban({ initialOrders }: Props) {
  const router = useRouter();
  const { toast } = useToast();

  useOrderRealtimeRefresh(() => router.refresh());

  const [orders, setOrders] = useState<Order[]>(initialOrders);
  const [loadingId, setLoadingId] = useState<number | null>(null);

  // Drag state
  const dragData = useRef<{ orderId: number; fromStatus: ProductionStatus } | null>(null);
  const [dragOverCol, setDragOverCol] = useState<ProductionStatus | null>(null);

  const handleDragStart = useCallback(
    (e: React.DragEvent, order: Order) => {
      dragData.current = { orderId: order.id, fromStatus: order.production_status };
      e.dataTransfer.effectAllowed = "move";
    },
    [],
  );

  const handleDragOver = useCallback((e: React.DragEvent, col: ProductionStatus) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverCol(col);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverCol(null);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent, targetStatus: ProductionStatus) => {
      e.preventDefault();
      setDragOverCol(null);

      const data = dragData.current;
      dragData.current = null;
      if (!data) return;
      if (data.fromStatus === targetStatus) return;

      const { orderId } = data;
      const previous = orders.find((o) => o.id === orderId);

      // Optimistic update
      setOrders((current) =>
        current.map((o) =>
          o.id === orderId ? { ...o, production_status: targetStatus } : o,
        ),
      );
      setLoadingId(orderId);

      try {
        const res = await fetch(`/api/orders/${orderId}/production-status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ production_status: targetStatus }),
        });
        if (!res.ok) throw new Error("Error al actualizar estado");
        const updated: Order = await res.json();
        setOrders((current) => current.map((o) => (o.id === orderId ? updated : o)));
        const col = COLUMNS.find((c) => c.status === targetStatus);
        toast(`Movido a "${col?.title}"`, "success");
      } catch {
        if (previous) {
          setOrders((current) => current.map((o) => (o.id === orderId ? previous : o)));
        }
        toast("No se pudo mover el pedido", "error");
      } finally {
        setLoadingId(null);
      }
    },
    [orders, toast],
  );

  const ordersByStatus = new Map<ProductionStatus, Order[]>();
  for (const col of COLUMNS) {
    ordersByStatus.set(
      col.status,
      orders.filter((o) => o.production_status === col.status),
    );
  }

  return (
    <div className="kanban-board">
      {COLUMNS.map((col) => {
        const colOrders = ordersByStatus.get(col.status) ?? [];
        const isDropTarget = dragOverCol === col.status;

        return (
          <div
            className={`kanban-col ${isDropTarget ? "kanban-col-drop-active" : ""}`}
            key={col.status}
            onDragLeave={handleDragLeave}
            onDragOver={(e) => handleDragOver(e, col.status)}
            onDrop={(e) => handleDrop(e, col.status)}
            style={{ "--kanban-col-accent": col.color } as React.CSSProperties}
          >
            <div className="kanban-col-header">
              <div className="kanban-col-title">
                <span className="kanban-col-emoji">{col.emoji}</span>
                <span>{col.title}</span>
              </div>
              <span className="kanban-col-count">{colOrders.length}</span>
            </div>

            <div className="kanban-cards">
              {colOrders.length === 0 ? (
                <div className="kanban-empty">
                  {isDropTarget ? "Soltar aquí" : "Sin pedidos"}
                </div>
              ) : (
                colOrders.map((order) => {
                  const isLoading = loadingId === order.id;
                  const designUrl = getPrimaryDesignUrl(order);
                  const priorityMeta = getOrderPriorityMeta(order.priority);

                  return (
                    <div
                      className={`kanban-card ${isLoading ? "kanban-card-loading" : ""} ${order.has_open_incident ? "kanban-card-incident" : ""}`}
                      draggable
                      key={order.id}
                      onDragStart={(e) => handleDragStart(e, order)}
                      title={`Arrastra para cambiar estado de producción`}
                    >
                      <div className="kanban-card-top">
                        <div className="kanban-card-id-row">
                          <span className="kanban-card-priority">{PRIORITY_EMOJI[order.priority] ?? "⚪"}</span>
                          <Link className="kanban-card-id" href={`/orders/${order.id}`}>
                            {order.external_id}
                          </Link>
                          {order.has_open_incident ? (
                            <span className="kanban-card-incident-badge" title="Con incidencia">⚠️</span>
                          ) : null}
                        </div>
                        <div className="kanban-card-customer">{order.customer_name}</div>
                      </div>

                      {designUrl ? (
                        <div className="kanban-card-preview">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            alt=""
                            className="kanban-card-preview-img"
                            loading="lazy"
                            src={designUrl}
                          />
                        </div>
                      ) : order.items.length > 0 ? (
                        <div className="kanban-card-item-name">
                          {order.items[0].title ?? order.items[0].name ?? "Sin producto"}
                        </div>
                      ) : null}

                      <div className="kanban-card-footer">
                        <span className={`${priorityMeta.className} kanban-badge`}>
                          {order.priority}
                        </span>
                        {order.assigned_to_employee_name ? (
                          <span className="kanban-assignee" title={`Asignado: ${order.assigned_to_employee_name}`}>
                            👤 {order.assigned_to_employee_name.split(" ")[0]}
                          </span>
                        ) : null}
                        {order.items.length > 1 ? (
                          <span className="kanban-multi">+{order.items.length - 1}</span>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
