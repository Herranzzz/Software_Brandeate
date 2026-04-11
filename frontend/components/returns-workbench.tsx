"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { useToast } from "@/components/toast";
import { bulkUpdateReturnStatus } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { Return, ReturnStatus } from "@/lib/types";


const STATUS_META: Record<string, { label: string; className: string }> = {
  requested: { label: "Solicitada", className: "badge badge-status badge-status-pending" },
  approved: { label: "Aprobada", className: "badge badge-status badge-status-in-progress" },
  in_transit: { label: "En tránsito", className: "badge badge-status badge-status-in-transit" },
  received: { label: "Recibida", className: "badge badge-status badge-status-delivered" },
  closed: { label: "Cerrada", className: "badge badge-status badge-status-delivered" },
  rejected: { label: "Rechazada", className: "badge badge-status badge-status-exception" },
};

const REASON_LABELS: Record<string, string> = {
  damaged: "Producto dañado",
  wrong_product: "Producto incorrecto",
  not_delivered: "No entregado",
  address_issue: "Problema de dirección",
  personalization_error: "Error de personalización",
  changed_mind: "Cambio de opinión",
  other: "Otro motivo",
};

const BULK_STATUS_OPTIONS: { value: ReturnStatus; label: string }[] = [
  { value: "approved", label: "Aprobar" },
  { value: "received", label: "Marcar recibida" },
  { value: "closed", label: "Cerrar" },
  { value: "rejected", label: "Rechazar" },
];

type Props = {
  returns: Return[];
  shopMap: Record<number, string>;
  statusFilter: string;
};

export function ReturnsWorkbench({ returns, shopMap, statusFilter }: Props) {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [localReturns, setLocalReturns] = useState(returns);
  const [isPending, startTransition] = useTransition();

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === localReturns.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(localReturns.map((r) => r.id)));
    }
  }

  function handleBulkStatus(newStatus: ReturnStatus) {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    startTransition(async () => {
      try {
        const result = await bulkUpdateReturnStatus(ids, newStatus);
        const label = STATUS_META[newStatus]?.label ?? newStatus;
        toast(`${result.updated.length} devoluciones marcadas como "${label}"`, "success");
        setLocalReturns((prev) =>
          prev.map((r) =>
            result.updated.includes(r.id) ? { ...r, status: newStatus as ReturnStatus } : r
          )
        );
        setSelected(new Set());
      } catch (err) {
        toast(err instanceof Error ? err.message : "Error al actualizar", "error");
      }
    });
  }

  const filteredReturns = statusFilter
    ? localReturns.filter((r) => r.status === statusFilter)
    : localReturns;

  return (
    <div>
      {/* Bulk toolbar */}
      {filteredReturns.length > 0 && (
        <div className="returns-bulk-toolbar">
          <label className="returns-bulk-check">
            <input
              checked={selected.size === filteredReturns.length && filteredReturns.length > 0}
              onChange={toggleAll}
              type="checkbox"
            />
            <span>{selected.size > 0 ? `${selected.size} seleccionadas` : "Seleccionar todas"}</span>
          </label>
          {selected.size > 0 && (
            <div className="returns-bulk-actions">
              {BULK_STATUS_OPTIONS.map((opt) => (
                <button
                  className="button button-secondary button-sm"
                  disabled={isPending}
                  key={opt.value}
                  onClick={() => handleBulkStatus(opt.value)}
                  type="button"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {filteredReturns.length === 0 ? (
        <div className="table-secondary" style={{ padding: "24px 0", textAlign: "center" }}>
          No hay devoluciones que coincidan con los filtros.
        </div>
      ) : (
        <div className="returns-admin-list">
          {filteredReturns.map((ret) => {
            const statusMeta = STATUS_META[ret.status] ?? { label: ret.status, className: "badge badge-status" };
            const shopName = shopMap[ret.shop_id] ?? `Tienda #${ret.shop_id}`;
            const isSelected = selected.has(ret.id);
            return (
              <article
                className={`returns-admin-case${isSelected ? " is-selected" : ""}`}
                key={ret.id}
              >
                <div className="returns-admin-case-top">
                  <label className="returns-case-check" onClick={(e) => e.stopPropagation()}>
                    <input
                      checked={isSelected}
                      onChange={() => toggleSelect(ret.id)}
                      type="checkbox"
                    />
                  </label>
                  <div className="returns-admin-case-head">
                    <div className="returns-admin-case-id">#{ret.id}</div>
                    <div>
                      {ret.order ? (
                        <Link className="table-link table-link-strong" href={`/orders/${ret.order.id}`}>
                          {ret.order.external_id}
                        </Link>
                      ) : (
                        <span className="table-primary">Pedido no vinculado</span>
                      )}
                      <div className="table-secondary">{shopName}</div>
                    </div>
                  </div>
                  <div className="returns-admin-case-statuses">
                    <span className={statusMeta.className}>{statusMeta.label}</span>
                    {ret.tracking_number ? (
                      <span className="badge badge-status badge-status-in-transit">Con tracking</span>
                    ) : (
                      <span className="badge badge-status badge-status-pending">Sin tracking</span>
                    )}
                  </div>
                </div>

                <div className="returns-admin-case-grid">
                  <div>
                    <span className="table-secondary">Cliente</span>
                    <strong>{ret.customer_name ?? ret.order?.customer_name ?? "—"}</strong>
                    <span className="table-secondary">{ret.customer_email ?? ret.order?.customer_email ?? "Sin email"}</span>
                  </div>
                  <div>
                    <span className="table-secondary">Motivo</span>
                    <strong>{REASON_LABELS[ret.reason] ?? ret.reason}</strong>
                    <span className="table-secondary">Actualizado {formatDateTime(ret.updated_at)}</span>
                  </div>
                  <div>
                    <span className="table-secondary">Tracking devolución</span>
                    <strong>{ret.tracking_number ?? "Pendiente"}</strong>
                    <span className="table-secondary">Creado {formatDateTime(ret.created_at)}</span>
                  </div>
                </div>

                {ret.notes ? <p className="returns-admin-case-notes">{ret.notes}</p> : null}
                {ret.inspection_notes ? (
                  <p className="returns-admin-case-inspection">
                    <strong>Inspección:</strong> {ret.inspection_notes}
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
