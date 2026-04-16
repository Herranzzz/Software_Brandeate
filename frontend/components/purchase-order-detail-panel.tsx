"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { AppModal } from "@/components/app-modal";
import { Card } from "@/components/card";
import { PO_STATUS_META } from "@/components/purchase-orders-panel";
import { useToast } from "@/components/toast";
import {
  receivePurchaseOrderClient,
  transitionPurchaseOrderStatusClient,
} from "@/lib/api-client";
import type {
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderStatus,
  Shop,
  Supplier,
} from "@/lib/types";

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

function fmt(value: string | number, currency = "EUR") {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (!Number.isFinite(num)) return "—";
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency,
  }).format(num);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ─── Receive modal ───────────────────────────────────────────────────────── */

type ReceiveDraft = Record<number, string>; // line_id -> qty string

function ReceiveModal({
  po,
  onClose,
  onReceived,
}: {
  po: PurchaseOrder;
  onClose: () => void;
  onReceived: (updated: PurchaseOrder) => void;
}) {
  const [draft, setDraft] = useState<ReceiveDraft>(() => {
    const m: ReceiveDraft = {};
    for (const line of po.lines) {
      const outstanding =
        line.quantity_ordered -
        line.quantity_received -
        line.quantity_cancelled;
      m[line.id] = String(Math.max(0, outstanding));
    }
    return m;
  });
  const [notes, setNotes] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleReceive() {
    const payloadLines = po.lines
      .map((line) => ({
        line_id: line.id,
        quantity_received: Number(draft[line.id] ?? 0),
        outstanding:
          line.quantity_ordered -
          line.quantity_received -
          line.quantity_cancelled,
      }))
      .filter((l) => l.quantity_received > 0);

    if (payloadLines.length === 0) {
      setError("No hay cantidades para recibir.");
      return;
    }
    const overshoot = payloadLines.find(
      (l) => l.quantity_received > l.outstanding,
    );
    if (overshoot) {
      setError(
        "Hay líneas con cantidad superior a lo pendiente. Ajusta las cantidades.",
      );
      return;
    }
    setError(null);

    startTransition(async () => {
      try {
        const updated = await receivePurchaseOrderClient(po.id, {
          lines: payloadLines.map((l) => ({
            line_id: l.line_id,
            quantity_received: l.quantity_received,
          })),
          notes: notes.trim() || null,
        });
        onReceived(updated);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al recibir");
      }
    });
  }

  return (
    <AppModal onClose={onClose} open title={`Recibir ${po.po_number}`} width="wide">
      <div className="stack" style={{ gap: 16 }}>
        <p className="subtitle" style={{ margin: 0 }}>
          Confirma las cantidades recibidas. El stock se actualizará
          automáticamente.
        </p>

        <div className="sga-table-wrap">
          <table className="sga-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th className="num">Pedido</th>
                <th className="num">Ya recibido</th>
                <th className="num">Pendiente</th>
                <th className="num">Recibir ahora</th>
              </tr>
            </thead>
            <tbody>
              {po.lines.map((line) => {
                const outstanding =
                  line.quantity_ordered -
                  line.quantity_received -
                  line.quantity_cancelled;
                return (
                  <tr key={line.id}>
                    <td>
                      <strong>{line.sku}</strong>
                      {line.name && (
                        <div className="table-secondary">{line.name}</div>
                      )}
                    </td>
                    <td className="num">{line.quantity_ordered}</td>
                    <td className="num">{line.quantity_received}</td>
                    <td className="num">{outstanding}</td>
                    <td className="num">
                      <input
                        className="form-input"
                        max={outstanding}
                        min={0}
                        onChange={(e) =>
                          setDraft((prev) => ({
                            ...prev,
                            [line.id]: e.target.value,
                          }))
                        }
                        style={{ maxWidth: 100, textAlign: "right" }}
                        type="number"
                        value={draft[line.id] ?? "0"}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="form-field">
          <label className="form-label">Notas de recepción</label>
          <textarea
            className="form-input"
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            value={notes}
          />
        </div>

        {error && <p className="form-error">{error}</p>}

        <div className="modal-actions">
          <button className="button-secondary" onClick={onClose} type="button">
            Cancelar
          </button>
          <button
            className="button-primary"
            disabled={isPending}
            onClick={handleReceive}
            type="button"
          >
            {isPending ? "Recibiendo…" : "Confirmar recepción"}
          </button>
        </div>
      </div>
    </AppModal>
  );
}

/* ─── Main panel ──────────────────────────────────────────────────────────── */

type PurchaseOrderDetailPanelProps = {
  initialPO: PurchaseOrder;
  shop: Shop | null;
  supplier: Supplier | null;
};

export function PurchaseOrderDetailPanel({
  initialPO,
  shop,
  supplier,
}: PurchaseOrderDetailPanelProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [po, setPO] = useState<PurchaseOrder>(initialPO);
  const [showReceive, setShowReceive] = useState(false);
  const [isPending, startTransition] = useTransition();

  const statusMeta = PO_STATUS_META[po.status];
  const isTerminal = po.status === "received" || po.status === "cancelled";
  const canReceive =
    po.status === "sent" ||
    po.status === "confirmed" ||
    po.status === "partially_received";

  function transition(next: PurchaseOrderStatus, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    startTransition(async () => {
      try {
        const updated = await transitionPurchaseOrderStatusClient(po.id, next);
        setPO(updated);
        toast(`Estado: ${PO_STATUS_META[updated.status].label}`, "success");
        router.refresh();
      } catch (e) {
        toast(e instanceof Error ? e.message : "Error", "error");
      }
    });
  }

  function handleReceived(updated: PurchaseOrder) {
    setPO(updated);
    setShowReceive(false);
    toast("Recepción registrada", "success");
    router.refresh();
  }

  const outstandingLines = po.lines.filter(
    (l) =>
      l.quantity_ordered - l.quantity_received - l.quantity_cancelled > 0,
  );

  return (
    <>
      {/* Status + actions bar */}
      <Card className="stack" style={{ gap: 12 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span className={statusMeta.className}>{statusMeta.label}</span>
            {po.auto_generated && (
              <span className="invoice-badge invoice-badge-draft">
                Generada auto.
              </span>
            )}
            <span className="table-secondary">
              Creada el {formatDateTime(po.created_at)}
            </span>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {po.status === "draft" && (
              <>
                <button
                  className="button-primary"
                  disabled={isPending}
                  onClick={() => transition("sent")}
                  type="button"
                >
                  Enviar al proveedor
                </button>
                <button
                  className="button-ghost"
                  disabled={isPending}
                  onClick={() =>
                    transition("cancelled", "¿Cancelar esta orden?")
                  }
                  type="button"
                >
                  Cancelar
                </button>
              </>
            )}
            {po.status === "sent" && (
              <>
                <button
                  className="button-primary"
                  disabled={isPending}
                  onClick={() => transition("confirmed")}
                  type="button"
                >
                  Marcar confirmada
                </button>
                <button
                  className="button-secondary"
                  disabled={isPending}
                  onClick={() => setShowReceive(true)}
                  type="button"
                >
                  Recibir mercancía
                </button>
                <button
                  className="button-ghost"
                  disabled={isPending}
                  onClick={() =>
                    transition("cancelled", "¿Cancelar esta orden?")
                  }
                  type="button"
                >
                  Cancelar
                </button>
              </>
            )}
            {(po.status === "confirmed" ||
              po.status === "partially_received") && (
              <>
                <button
                  className="button-primary"
                  disabled={isPending}
                  onClick={() => setShowReceive(true)}
                  type="button"
                >
                  Recibir mercancía
                </button>
                <button
                  className="button-ghost"
                  disabled={isPending}
                  onClick={() =>
                    transition("cancelled", "¿Cancelar esta orden?")
                  }
                  type="button"
                >
                  Cancelar
                </button>
              </>
            )}
            {isTerminal && (
              <span className="table-secondary">Orden cerrada</span>
            )}
          </div>
        </div>

        {canReceive && outstandingLines.length > 0 && (
          <div className="sga-reorder-banner">
            <strong>
              {outstandingLines.length} líneas pendientes de recibir
            </strong>
            <span
              style={{ fontSize: 13, color: "var(--muted)", marginLeft: 8 }}
            >
              Ejecuta &ldquo;Recibir mercancía&rdquo; cuando llegue.
            </span>
          </div>
        )}
      </Card>

      {/* Meta grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 16,
        }}
      >
        <Card>
          <span className="eyebrow">Proveedor</span>
          <p className="table-primary" style={{ margin: "6px 0 2px" }}>
            {supplier?.name ?? po.supplier_name ?? `#${po.supplier_id}`}
          </p>
          {supplier?.email && (
            <p className="table-secondary" style={{ margin: 0 }}>
              {supplier.email}
            </p>
          )}
          {supplier?.phone && (
            <p className="table-secondary" style={{ margin: 0 }}>
              {supplier.phone}
            </p>
          )}
        </Card>

        <Card>
          <span className="eyebrow">Cliente</span>
          <p className="table-primary" style={{ margin: "6px 0 2px" }}>
            {shop?.name ?? `#${po.shop_id}`}
          </p>
        </Card>

        <Card>
          <span className="eyebrow">Llegada prevista</span>
          <p className="table-primary" style={{ margin: "6px 0 2px" }}>
            {formatDate(po.expected_arrival_date)}
          </p>
          {po.sent_at && (
            <p className="table-secondary" style={{ margin: 0 }}>
              Enviada: {formatDateTime(po.sent_at)}
            </p>
          )}
          {po.first_received_at && (
            <p className="table-secondary" style={{ margin: 0 }}>
              Primera recepción: {formatDateTime(po.first_received_at)}
            </p>
          )}
          {po.fully_received_at && (
            <p className="table-secondary" style={{ margin: 0 }}>
              Recibida: {formatDateTime(po.fully_received_at)}
            </p>
          )}
        </Card>

        <Card>
          <span className="eyebrow">Totales</span>
          <p className="table-primary" style={{ margin: "6px 0 2px" }}>
            {fmt(po.total, po.currency)}
          </p>
          <p className="table-secondary" style={{ margin: 0 }}>
            Subtotal: {fmt(po.subtotal, po.currency)}
          </p>
          {parseFloat(po.tax_amount) > 0 && (
            <p className="table-secondary" style={{ margin: 0 }}>
              Impuestos: {fmt(po.tax_amount, po.currency)}
            </p>
          )}
          {parseFloat(po.shipping_cost) > 0 && (
            <p className="table-secondary" style={{ margin: 0 }}>
              Envío: {fmt(po.shipping_cost, po.currency)}
            </p>
          )}
        </Card>
      </div>

      {/* Lines */}
      <Card className="stack table-card">
        <div className="table-header">
          <span className="eyebrow">Líneas</span>
          <span className="table-count">
            {po.total_quantity_received}/{po.total_quantity_ordered} uds.
            recibidas
          </span>
        </div>
        <div className="sga-table-wrap">
          <table className="sga-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th className="num">Cant.</th>
                <th className="num">Recibido</th>
                <th className="num">Pendiente</th>
                <th className="num">Coste uds.</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {po.lines.map((line: PurchaseOrderLine) => {
                const outstanding =
                  line.quantity_ordered -
                  line.quantity_received -
                  line.quantity_cancelled;
                return (
                  <tr key={line.id}>
                    <td>
                      <strong>{line.sku}</strong>
                      {line.name && (
                        <div className="table-secondary">{line.name}</div>
                      )}
                      {line.supplier_sku && (
                        <div className="table-secondary">
                          Proveedor: {line.supplier_sku}
                        </div>
                      )}
                    </td>
                    <td className="num">{line.quantity_ordered}</td>
                    <td className="num">{line.quantity_received}</td>
                    <td className="num">{outstanding}</td>
                    <td className="num">
                      {fmt(line.unit_cost, po.currency)}
                    </td>
                    <td className="num">
                      {fmt(line.total_cost, po.currency)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {po.notes && (
        <Card>
          <span className="eyebrow">Notas</span>
          <p style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{po.notes}</p>
        </Card>
      )}

      {po.inbound_shipment_id && (
        <Card>
          <span className="eyebrow">Entrada vinculada</span>
          <p style={{ marginTop: 6 }}>
            Esta orden tiene asociada una entrada de almacén #
            {po.inbound_shipment_id}. Verás la recepción reflejada en el SGA.
          </p>
        </Card>
      )}

      {showReceive && (
        <ReceiveModal
          onClose={() => setShowReceive(false)}
          onReceived={handleReceived}
          po={po}
        />
      )}
    </>
  );
}
