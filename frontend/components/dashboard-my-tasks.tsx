import Link from "next/link";

import type { Order } from "@/lib/types";
import { getProductionStatusMeta, getOrderPriorityMeta } from "@/lib/format";

type Props = {
  orders: Order[];
  employeeName: string;
};

const prodLabels: Record<string, string> = {
  pending_personalization: "Pendiente",
  in_production: "En producción",
  packed: "Empaquetado",
  completed: "Completado",
};

const priorityEmoji: Record<string, string> = {
  urgent: "🔴",
  high: "🟠",
  normal: "🟡",
  low: "⚪",
};

export function DashboardMyTasks({ orders, employeeName }: Props) {
  const firstName = employeeName.trim().split(/\s+/)[0] ?? "tú";

  if (orders.length === 0) {
    return (
      <div className="dash-mytasks">
        <div className="dash-mytasks-header">
          <span className="eyebrow">Mis tareas</span>
          <h3 className="dash-mytasks-title">Sin asignaciones, {firstName}</h3>
        </div>
        <p className="dash-mytasks-empty">
          No tienes pedidos asignados ahora mismo. Puedes asignarte pedidos directamente desde la tabla de pedidos.
        </p>
        <Link className="button-secondary dash-mytasks-cta" href="/orders">
          Ver pedidos
        </Link>
      </div>
    );
  }

  const urgentCount = orders.filter(
    (o) => o.priority === "urgent" || o.priority === "high",
  ).length;

  const notPreparedCount = orders.filter(
    (o) => o.production_status !== "packed" && o.production_status !== "completed",
  ).length;

  return (
    <div className="dash-mytasks">
      <div className="dash-mytasks-header">
        <div>
          <span className="eyebrow">Mis tareas</span>
          <h3 className="dash-mytasks-title">
            {orders.length} pedido{orders.length !== 1 ? "s" : ""} asignado{orders.length !== 1 ? "s" : ""}
          </h3>
        </div>
        <Link className="button-secondary" href="/orders?assigned_to_me=true" style={{ fontSize: "0.8rem" }}>
          Ver todos
        </Link>
      </div>

      {urgentCount > 0 ? (
        <div className="dash-mytasks-alert">
          🔴 {urgentCount} pedido{urgentCount !== 1 ? "s" : ""} urgente{urgentCount !== 1 ? "s" : ""} o de alta prioridad
        </div>
      ) : null}

      {notPreparedCount > 0 ? (
        <div className="dash-mytasks-hint">
          {notPreparedCount} aún sin preparar · {orders.length - notPreparedCount} preparado{orders.length - notPreparedCount !== 1 ? "s" : ""}
        </div>
      ) : null}

      <ul className="dash-mytasks-list">
        {orders.slice(0, 8).map((order) => {
          const prodMeta = getProductionStatusMeta(order.production_status);
          const prioMeta = getOrderPriorityMeta(order.priority);
          const isDone = order.production_status === "packed" || order.production_status === "completed";
          return (
            <li className={`dash-mytask-item ${isDone ? "dash-mytask-done" : ""}`} key={order.id}>
              <div className="dash-mytask-main">
                <span className="dash-mytask-priority" title={order.priority}>
                  {priorityEmoji[order.priority] ?? "⚪"}
                </span>
                <Link className="dash-mytask-id" href={`/orders/${order.id}`}>
                  {order.external_id}
                </Link>
                <span className="dash-mytask-customer">{order.customer_name}</span>
              </div>
              <div className="dash-mytask-badges">
                <span className={`${prodMeta.className} dash-mytask-prod`}>
                  {prodLabels[order.production_status] ?? order.production_status}
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      {orders.length > 8 ? (
        <p className="dash-mytasks-more">
          +{orders.length - 8} más —{" "}
          <Link className="table-link" href="/orders">
            ver todos los pedidos
          </Link>
        </p>
      ) : null}
    </div>
  );
}
