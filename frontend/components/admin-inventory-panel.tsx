"use client";

import { useState, useCallback, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  adjustInventoryStock,
  generateReplenishmentPOsClient,
  receiveInboundShipment,
  syncInventoryFromCatalog,
  syncInventoryFromShopify,
  updateInboundShipment,
  updateInventoryItemClient,
  type CatalogSyncResult,
  type ShopifyInventorySyncResult,
} from "@/lib/api-client";
import type {
  InventoryItem,
  InboundShipment,
  InboundShipmentLine,
  ReplenishmentRecommendation,
  StockMovement,
  StockMovementType,
  Supplier,
} from "@/lib/types";
import { ReplenishmentTab } from "@/components/replenishment-tab";
import { useToast } from "@/components/toast";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = "resumen" | "skus" | "reposicion" | "entradas" | "movimientos";

type SyncStatusEntry = {
  shop_id: number;
  shop_name: string;
  last_synced_at: string | null;
  last_sync_status: string | null;
  last_sync_summary: Record<string, unknown> | null;
  last_error_message: string | null;
};

type AdminInventoryPanelProps = {
  items: InventoryItem[];
  inboundShipments: InboundShipment[];
  movements: StockMovement[];
  alerts: InventoryItem[];
  isAdmin: boolean;
  /** When set, "Sincronizar desde catálogo" uses this shop_id */
  shopId?: number;
  syncStatus?: SyncStatusEntry[];
  recommendations?: ReplenishmentRecommendation[];
  suppliers?: Supplier[];
  hasMultipleShops?: boolean;
};

type AdjustState = {
  itemId: number;
  sign: 1 | -1;
  qty: string;
  movementType: string;
  notes: string;
};

type ReceiveLineState = {
  line_id: number;
  qty_received: string;
  qty_accepted: string;
  qty_rejected: string;
  rejection_reason: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRelative(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `hace ${days}d`;
  return new Date(dateStr).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
  });
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function isToday(dateStr: string): boolean {
  const d = new Date(dateStr);
  const now = new Date();
  return (
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  );
}

const MOVEMENT_LABELS: Record<StockMovementType, string> = {
  inbound_receipt: "Entrada almacén",
  outbound_fulfillment: "Salida pedido",
  adjustment_add: "Ajuste +",
  adjustment_remove: "Ajuste −",
  return_receipt: "Devolución",
  cycle_count: "Recuento",
  damage_write_off: "Baja/Daño",
};

const ADJUST_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "adjustment_add", label: "Entrada manual" },
  { value: "adjustment_remove", label: "Salida manual" },
  { value: "damage_write_off", label: "Baja por daño" },
  { value: "cycle_count", label: "Recuento de inventario" },
  { value: "return_receipt", label: "Recepción de devolución" },
];

const STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  sent: "Enviado",
  in_transit: "En tránsito",
  received: "Recibido",
  closed: "Cerrado",
};

const STATUS_FLOW: Record<string, string> = {
  draft: "sent",
  sent: "in_transit",
};

// ── Stock cell ────────────────────────────────────────────────────────────────

function StockCell({ item }: { item: InventoryItem }) {
  const maxStock = item.reorder_point != null ? item.reorder_point * 4 : 100;
  const pct = Math.min((item.stock_on_hand / Math.max(maxStock, 1)) * 100, 100);

  let modifier = "is-ok";
  if (item.reorder_point != null) {
    if (item.stock_on_hand <= item.reorder_point) modifier = "is-critical";
    else if (item.stock_on_hand <= item.reorder_point * 2) modifier = "is-low";
  }

  return (
    <div className="sga-stock-cell">
      <span>{item.stock_on_hand}</span>
      <div className={`sga-stock-bar ${modifier}`}>
        <div style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`sga-badge sga-badge-${status}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

// ── Inline adjust form ────────────────────────────────────────────────────────

function AdjustForm({
  item,
  onDone,
}: {
  item: InventoryItem;
  onDone: (updated: InventoryItem) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<AdjustState>({
    itemId: item.id,
    sign: 1,
    qty: "1",
    movementType: "adjustment_add",
    notes: "",
  });
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const qty = parseInt(state.qty, 10);
    if (isNaN(qty) || qty <= 0) {
      setError("Introduce una cantidad válida mayor a 0.");
      return;
    }
    const delta = state.sign * qty;
    setError(null);

    startTransition(async () => {
      try {
        const updated = await adjustInventoryStock(item.id, {
          qty_delta: delta,
          movement_type: state.movementType,
          notes: state.notes || null,
        });
        onDone(updated);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al ajustar stock.");
      }
    });
  }

  return (
    <form className="sga-adjust-controls" onSubmit={handleSubmit}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>
          Stock actual: <strong>{item.stock_on_hand}</strong>
        </span>

        <button
          className={`sga-sign-btn${state.sign === 1 ? " active" : ""}`}
          onClick={() => setState((s) => ({ ...s, sign: 1, movementType: "adjustment_add" }))}
          type="button"
        >
          +
        </button>
        <button
          className={`sga-sign-btn${state.sign === -1 ? " active" : ""}`}
          onClick={() => setState((s) => ({ ...s, sign: -1, movementType: "adjustment_remove" }))}
          type="button"
        >
          −
        </button>

        <input
          className="sga-input sga-input-sm"
          min={1}
          onChange={(e) => setState((s) => ({ ...s, qty: e.target.value }))}
          placeholder="Cant."
          style={{ width: 72 }}
          type="number"
          value={state.qty}
        />

        <select
          className="sga-input sga-input-sm"
          onChange={(e) =>
            setState((s) => ({
              ...s,
              movementType: e.target.value,
              sign: e.target.value === "adjustment_remove" || e.target.value === "damage_write_off"
                ? -1
                : 1,
            }))
          }
          value={state.movementType}
        >
          {ADJUST_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <textarea
        className="sga-input"
        onChange={(e) => setState((s) => ({ ...s, notes: e.target.value }))}
        placeholder="Notas opcionales…"
        rows={2}
        style={{ width: "100%", marginTop: 6 }}
        value={state.notes}
      />

      {error && (
        <p style={{ color: "var(--danger, #e53e3e)", fontSize: 12, margin: "4px 0" }}>
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button className="button" disabled={isPending} type="submit">
          {isPending ? "Aplicando…" : "Aplicar"}
        </button>
        <button
          className="button-secondary"
          onClick={() => onDone(item)}
          type="button"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

// ── SKU Config Form (replenishment) ─────────────────────────────────────────

function ConfigForm({
  item,
  suppliers,
  onDone,
}: {
  item: InventoryItem;
  suppliers: Supplier[];
  onDone: (updated: InventoryItem | null) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [primarySupplierId, setPrimarySupplierId] = useState<string>(
    item.primary_supplier_id != null ? String(item.primary_supplier_id) : "",
  );
  const [costPrice, setCostPrice] = useState<string>(item.cost_price ?? "");
  const [leadTimeDays, setLeadTimeDays] = useState<string>(
    item.lead_time_days != null ? String(item.lead_time_days) : "",
  );
  const [reorderPoint, setReorderPoint] = useState<string>(
    item.reorder_point != null ? String(item.reorder_point) : "",
  );
  const [reorderQty, setReorderQty] = useState<string>(
    item.reorder_qty != null ? String(item.reorder_qty) : "",
  );
  const [targetDays, setTargetDays] = useState<string>(
    String(item.target_days_of_cover ?? 30),
  );
  const [safetyStockDays, setSafetyStockDays] = useState<string>(
    String(item.safety_stock_days ?? 7),
  );
  const [lookbackDays, setLookbackDays] = useState<string>(
    String(item.consumption_lookback_days ?? 60),
  );
  const [autoEnabled, setAutoEnabled] = useState<boolean>(
    item.replenishment_auto_enabled,
  );

  const itemShopSuppliers = suppliers.filter((s) => s.shop_id === item.shop_id);

  function handleSave() {
    setError(null);
    startTransition(async () => {
      try {
        const payload = {
          primary_supplier_id: primarySupplierId
            ? Number(primarySupplierId)
            : null,
          cost_price: costPrice.trim() || null,
          lead_time_days: leadTimeDays.trim()
            ? Number(leadTimeDays)
            : null,
          reorder_point: reorderPoint.trim()
            ? Number(reorderPoint)
            : null,
          reorder_qty: reorderQty.trim() ? Number(reorderQty) : null,
          target_days_of_cover: Number(targetDays) || 30,
          safety_stock_days: Number(safetyStockDays) || 7,
          consumption_lookback_days: Number(lookbackDays) || 60,
          replenishment_auto_enabled: autoEnabled,
        };
        const updated = await updateInventoryItemClient(item.id, payload);
        onDone(updated);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al guardar");
      }
    });
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="invoice-form-grid">
        <div className="form-field">
          <label className="form-label">Proveedor principal</label>
          <select
            className="form-input form-select"
            onChange={(e) => setPrimarySupplierId(e.target.value)}
            value={primarySupplierId}
          >
            <option value="">— Sin proveedor —</option>
            {itemShopSuppliers.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label className="form-label">Precio de compra</label>
          <input
            className="form-input"
            min="0"
            onChange={(e) => setCostPrice(e.target.value)}
            step="0.01"
            type="number"
            value={costPrice}
          />
        </div>
        <div className="form-field">
          <label className="form-label">Plazo de entrega (días)</label>
          <input
            className="form-input"
            min="0"
            onChange={(e) => setLeadTimeDays(e.target.value)}
            placeholder="Usa el del proveedor si vacío"
            type="number"
            value={leadTimeDays}
          />
        </div>
        <div className="form-field">
          <label className="form-label">Punto de reposición</label>
          <input
            className="form-input"
            min="0"
            onChange={(e) => setReorderPoint(e.target.value)}
            placeholder="Auto si vacío"
            type="number"
            value={reorderPoint}
          />
        </div>
        <div className="form-field">
          <label className="form-label">Cant. de reposición</label>
          <input
            className="form-input"
            min="0"
            onChange={(e) => setReorderQty(e.target.value)}
            type="number"
            value={reorderQty}
          />
        </div>
        <div className="form-field">
          <label className="form-label">Días de cobertura objetivo</label>
          <input
            className="form-input"
            min="1"
            onChange={(e) => setTargetDays(e.target.value)}
            type="number"
            value={targetDays}
          />
        </div>
        <div className="form-field">
          <label className="form-label">Stock de seguridad (días)</label>
          <input
            className="form-input"
            min="0"
            onChange={(e) => setSafetyStockDays(e.target.value)}
            type="number"
            value={safetyStockDays}
          />
        </div>
        <div className="form-field">
          <label className="form-label">Ventana de consumo (días)</label>
          <input
            className="form-input"
            min="7"
            onChange={(e) => setLookbackDays(e.target.value)}
            type="number"
            value={lookbackDays}
          />
        </div>
        <div className="form-field invoice-form-full">
          <label
            className="form-label"
            style={{ display: "flex", alignItems: "center", gap: 8 }}
          >
            <input
              checked={autoEnabled}
              onChange={(e) => setAutoEnabled(e.target.checked)}
              type="checkbox"
            />
            <span>Generar órdenes de compra automáticamente</span>
          </label>
        </div>
      </div>

      {error && (
        <p className="form-error" style={{ margin: 0 }}>
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          className="button-primary"
          disabled={isPending}
          onClick={handleSave}
          type="button"
        >
          {isPending ? "Guardando…" : "Guardar configuración"}
        </button>
        <button
          className="button-secondary"
          onClick={() => onDone(null)}
          type="button"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

// ── Receive Modal ─────────────────────────────────────────────────────────────

function ReceiveModal({
  shipment,
  onClose,
  onReceived,
}: {
  shipment: InboundShipment;
  onClose: () => void;
  onReceived: (s: InboundShipment) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [notes, setNotes] = useState(shipment.notes ?? "");
  const [lines, setLines] = useState<ReceiveLineState[]>(
    shipment.lines.map((l) => ({
      line_id: l.id,
      qty_received: String(l.qty_expected),
      qty_accepted: String(l.qty_expected),
      qty_rejected: "0",
      rejection_reason: "",
    }))
  );
  const [error, setError] = useState<string | null>(null);

  function updateLine(
    idx: number,
    field: keyof ReceiveLineState,
    value: string
  ) {
    setLines((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };

      // Auto-compute qty_rejected when qty_received or qty_accepted change
      if (field === "qty_received" || field === "qty_accepted") {
        const rec = parseInt(field === "qty_received" ? value : next[idx].qty_received, 10) || 0;
        const acc = parseInt(field === "qty_accepted" ? value : next[idx].qty_accepted, 10) || 0;
        next[idx].qty_rejected = String(Math.max(0, rec - acc));
      }

      return next;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const payload = {
      lines: lines.map((l) => ({
        line_id: l.line_id,
        qty_received: parseInt(l.qty_received, 10) || 0,
        qty_accepted: parseInt(l.qty_accepted, 10) || 0,
        qty_rejected: parseInt(l.qty_rejected, 10) || 0,
        rejection_reason: l.rejection_reason || null,
      })),
      notes: notes || null,
    };

    startTransition(async () => {
      try {
        const updated = await receiveInboundShipment(shipment.id, payload);
        onReceived(updated);
        router.refresh();
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al recibir mercancía.");
      }
    });
  }

  return (
    <div
      className="rwiz-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="sga-receive-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sga-receive-modal-head">
          <div>
            <div className="sga-receive-modal-title">
              Recibir entrada #{shipment.reference}
            </div>
            <div className="sga-receive-modal-sub">
              {shipment.lines.length} líneas · {shipment.total_expected} uds. esperadas
            </div>
          </div>
          <button className="rwiz-close" onClick={onClose} type="button">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="sga-lines-wrap" style={{ overflowX: "auto" }}>
            <table className="sga-table sga-lines-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Producto</th>
                  <th>Esperado</th>
                  <th>Recibido</th>
                  <th>Aceptado</th>
                  <th>Rechazado</th>
                  <th>Motivo rechazo</th>
                </tr>
              </thead>
              <tbody>
                {shipment.lines.map((line, i) => (
                  <tr key={line.id}>
                    <td>
                      <code>{line.sku}</code>
                    </td>
                    <td>{line.name ?? "—"}</td>
                    <td>{line.qty_expected}</td>
                    <td>
                      <input
                        className="sga-input sga-input-sm"
                        min={0}
                        onChange={(e) => updateLine(i, "qty_received", e.target.value)}
                        style={{ width: 64 }}
                        type="number"
                        value={lines[i]?.qty_received ?? ""}
                      />
                    </td>
                    <td>
                      <input
                        className="sga-input sga-input-sm"
                        min={0}
                        onChange={(e) => updateLine(i, "qty_accepted", e.target.value)}
                        style={{ width: 64 }}
                        type="number"
                        value={lines[i]?.qty_accepted ?? ""}
                      />
                    </td>
                    <td>
                      <input
                        className="sga-input sga-input-sm"
                        min={0}
                        onChange={(e) => updateLine(i, "qty_rejected", e.target.value)}
                        style={{ width: 64 }}
                        type="number"
                        value={lines[i]?.qty_rejected ?? ""}
                      />
                    </td>
                    <td>
                      {parseInt(lines[i]?.qty_rejected ?? "0", 10) > 0 ? (
                        <input
                          className="sga-input sga-input-sm"
                          onChange={(e) => updateLine(i, "rejection_reason", e.target.value)}
                          placeholder="Motivo…"
                          style={{ width: 120 }}
                          type="text"
                          value={lines[i]?.rejection_reason ?? ""}
                        />
                      ) : (
                        <span style={{ color: "var(--muted)", fontSize: 13 }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="sga-field" style={{ marginTop: 16 }}>
            <label className="sga-label">Notas de recepción</label>
            <textarea
              className="sga-input"
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Observaciones opcionales…"
              rows={3}
              style={{ width: "100%" }}
              value={notes}
            />
          </div>

          {error && (
            <p style={{ color: "var(--danger, #e53e3e)", fontSize: 13, margin: "8px 0" }}>
              {error}
            </p>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button className="button" disabled={isPending} type="submit">
              {isPending ? "Confirmando…" : "Confirmar recepción"}
            </button>
            <button
              className="button-secondary"
              onClick={onClose}
              type="button"
            >
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Shipment Card ─────────────────────────────────────────────────────────────

function ShipmentCard({
  shipment: initialShipment,
  isAdmin,
  onReceived,
}: {
  shipment: InboundShipment;
  isAdmin: boolean;
  onReceived: (s: InboundShipment) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [shipment, setShipment] = useState(initialShipment);
  const [expanded, setExpanded] = useState(false);
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);

  const canReceive = isAdmin && (shipment.status === "sent" || shipment.status === "in_transit");
  const nextStatus = STATUS_FLOW[shipment.status];

  function handleStatusChange() {
    if (!nextStatus) return;
    startTransition(async () => {
      try {
        const updated = await updateInboundShipment(shipment.id, { status: nextStatus });
        setShipment(updated);
        router.refresh();
      } catch {
        // ignore — user sees no change
      } finally {
        setChangingStatus(false);
      }
    });
  }

  function handleReceived(updated: InboundShipment) {
    setShipment(updated);
    onReceived(updated);
    setShowReceiveModal(false);
  }

  return (
    <>
      <div className="sga-shipment-card">
        <div className="sga-shipment-head">
          <div className="sga-shipment-ref">#{shipment.reference}</div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <StatusBadge status={shipment.status} />

            {isAdmin && nextStatus && (
              changingStatus ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>
                    → {STATUS_LABELS[nextStatus]}?
                  </span>
                  <button
                    className="button"
                    disabled={isPending}
                    onClick={handleStatusChange}
                    style={{ fontSize: 12, padding: "2px 10px" }}
                    type="button"
                  >
                    {isPending ? "…" : "Confirmar"}
                  </button>
                  <button
                    className="button-secondary"
                    onClick={() => setChangingStatus(false)}
                    style={{ fontSize: 12, padding: "2px 8px" }}
                    type="button"
                  >
                    Cancelar
                  </button>
                </div>
              ) : (
                <button
                  className="button-secondary"
                  onClick={() => setChangingStatus(true)}
                  style={{ fontSize: 12, padding: "2px 10px" }}
                  type="button"
                >
                  Avanzar estado
                </button>
              )
            )}
          </div>
        </div>

        <div className="sga-shipment-meta">
          <span className="sga-shipment-meta-item">
            <strong>Llegada:</strong> {formatDate(shipment.expected_arrival)}
          </span>
          {shipment.carrier && (
            <span className="sga-shipment-meta-item">
              <strong>Transportista:</strong> {shipment.carrier}
            </span>
          )}
          {shipment.tracking_number && (
            <span className="sga-shipment-meta-item">
              <strong>Tracking:</strong> {shipment.tracking_number}
            </span>
          )}
          <span className="sga-shipment-meta-item">
            <strong>Líneas:</strong> {shipment.lines.length}
          </span>
          <span className="sga-shipment-meta-item">
            <strong>Uds. esperadas:</strong> {shipment.total_expected}
          </span>
          {shipment.total_received > 0 && (
            <span className="sga-shipment-meta-item">
              <strong>Uds. recibidas:</strong> {shipment.total_received}
            </span>
          )}
          <span className="sga-shipment-meta-item" style={{ color: "var(--muted)", fontSize: 12 }}>
            Creado {formatRelative(shipment.created_at)}
          </span>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <button
            className="button-secondary"
            onClick={() => setExpanded((v) => !v)}
            style={{ fontSize: 13 }}
            type="button"
          >
            {expanded ? "Ocultar líneas" : `Ver líneas (${shipment.lines.length})`}
          </button>

          {canReceive && (
            <button
              className="button"
              onClick={() => setShowReceiveModal(true)}
              style={{ fontSize: 13 }}
              type="button"
            >
              Recibir mercancía
            </button>
          )}
        </div>

        {expanded && shipment.lines.length > 0 && (
          <div className="sga-table-wrap" style={{ marginTop: 12 }}>
            <table className="sga-table sga-lines-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Producto</th>
                  <th>Esperado</th>
                  <th>Recibido</th>
                  <th>Aceptado</th>
                  <th>Rechazado</th>
                </tr>
              </thead>
              <tbody>
                {shipment.lines.map((line) => (
                  <tr key={line.id}>
                    <td>
                      <code>{line.sku}</code>
                    </td>
                    <td>{line.name ?? "—"}</td>
                    <td>{line.qty_expected}</td>
                    <td>{line.qty_received}</td>
                    <td>{line.qty_accepted}</td>
                    <td>
                      {line.qty_rejected > 0 ? (
                        <span style={{ color: "var(--danger, #e53e3e)" }}>
                          {line.qty_rejected}
                          {line.rejection_reason ? ` — ${line.rejection_reason}` : ""}
                        </span>
                      ) : (
                        "0"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showReceiveModal && (
        <ReceiveModal
          onClose={() => setShowReceiveModal(false)}
          onReceived={handleReceived}
          shipment={shipment}
        />
      )}
    </>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function AdminInventoryPanel({
  items: initialItems,
  inboundShipments: initialShipments,
  movements,
  alerts,
  isAdmin,
  shopId,
  syncStatus = [],
  recommendations = [],
  suppliers = [],
  hasMultipleShops = false,
}: AdminInventoryPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>("resumen");
  const [items, setItems] = useState<InventoryItem[]>(initialItems);
  const [shipments, setShipments] = useState<InboundShipment[]>(initialShipments);
  const [skuSearch, setSkuSearch] = useState("");
  const [adjustingId, setAdjustingId] = useState<number | null>(null);
  const [configingId, setConfigingId] = useState<number | null>(null);
  const [catalogSyncResult, setCatalogSyncResult] = useState<CatalogSyncResult | null>(null);
  const [isSyncingCatalog, startCatalogSync] = useTransition();
  const [shopifySyncResult, setShopifySyncResult] = useState<ShopifyInventorySyncResult | null>(null);
  const [isSyncingShopify, startShopifySync] = useTransition();
  const [isBulkEnabling, startBulkEnable] = useTransition();
  const [isAutoGenerating, startAutoGenerate] = useTransition();
  const router = useRouter();
  const { toast } = useToast();

  // ── KPI computations ────────────────────────────────────────────────────────

  const criticalCount = items.filter(
    (i) => i.reorder_point != null && i.stock_on_hand <= i.reorder_point
  ).length;

  const pendingInboundCount = shipments.filter(
    (s) => s.status === "sent" || s.status === "in_transit"
  ).length;

  const todayMovementsCount = movements.filter((m) => isToday(m.created_at)).length;

  // ── Automation metrics ──────────────────────────────────────────────────────

  const autoMetrics = useMemo(() => {
    const eligible = items.filter(
      (i) =>
        i.is_active &&
        i.primary_supplier_id != null &&
        i.reorder_point != null &&
        i.cost_price != null &&
        Number(i.cost_price) > 0,
    );
    const enabled = eligible.filter((i) => i.replenishment_auto_enabled);
    const eligibleNotEnabled = eligible.filter((i) => !i.replenishment_auto_enabled);
    const missingConfig = items.filter(
      (i) =>
        i.is_active &&
        (i.primary_supplier_id == null || i.reorder_point == null || i.cost_price == null),
    );
    const pct = eligible.length === 0
      ? 0
      : Math.round((enabled.length / eligible.length) * 100);
    return { eligible, enabled, eligibleNotEnabled, missingConfig, pct };
  }, [items]);

  async function handleBulkEnableAuto() {
    if (autoMetrics.eligibleNotEnabled.length === 0) return;
    startBulkEnable(async () => {
      const results = await Promise.allSettled(
        autoMetrics.eligibleNotEnabled.map((it) =>
          updateInventoryItemClient(it.id, { replenishment_auto_enabled: true }),
        ),
      );
      const updated = results
        .filter((r): r is PromiseFulfilledResult<InventoryItem> => r.status === "fulfilled")
        .map((r) => r.value);
      if (updated.length > 0) {
        setItems((prev) => {
          const byId = new Map(updated.map((u) => [u.id, u]));
          return prev.map((i) => byId.get(i.id) ?? i);
        });
      }
      const failed = results.length - updated.length;
      toast(
        failed === 0
          ? `Auto-reposición activada en ${updated.length} SKU${updated.length === 1 ? "" : "s"}`
          : `${updated.length} activados, ${failed} fallaron`,
        failed === 0 ? "success" : "warning",
      );
      router.refresh();
    });
  }

  async function handleAutoGenerateFromCriticals() {
    if (!shopId || recommendations.length === 0) return;
    startAutoGenerate(async () => {
      try {
        const result = await generateReplenishmentPOsClient(shopId);
        toast(
          `Generadas ${result.purchase_orders_created} orden${result.purchase_orders_created === 1 ? "" : "es"} de compra`,
          result.purchase_orders_created > 0 ? "success" : "info",
        );
        router.refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : "Error al generar POs", "error");
      }
    });
  }

  // ── SKU tab ──────────────────────────────────────────────────────────────────

  const filteredItems = skuSearch.trim()
    ? items.filter(
        (i) =>
          i.sku.toLowerCase().includes(skuSearch.toLowerCase()) ||
          i.name.toLowerCase().includes(skuSearch.toLowerCase())
      )
    : items;

  const handleAdjustDone = useCallback((updated: InventoryItem) => {
    setItems((prev) =>
      prev.map((it) => (it.id === updated.id ? updated : it))
    );
    setAdjustingId(null);
  }, []);

  const handleConfigDone = useCallback((updated: InventoryItem | null) => {
    if (updated) {
      setItems((prev) =>
        prev.map((it) => (it.id === updated.id ? updated : it))
      );
    }
    setConfigingId(null);
  }, []);

  // ── Entradas tab ─────────────────────────────────────────────────────────────

  const handleShipmentReceived = useCallback((updated: InboundShipment) => {
    setShipments((prev) =>
      prev.map((s) => (s.id === updated.id ? updated : s))
    );
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="stack">
      {/* Tabs */}
      <div className="sga-tabs" role="tablist">
        {(
          [
            { id: "resumen", label: "Resumen" },
            { id: "skus", label: "SKUs" },
            {
              id: "reposicion",
              label:
                recommendations.length > 0
                  ? `Reposición (${recommendations.length})`
                  : "Reposición",
            },
            { id: "entradas", label: "Entradas" },
            { id: "movimientos", label: "Movimientos" },
          ] as { id: Tab; label: string }[]
        ).map((t) => (
          <button
            aria-selected={activeTab === t.id}
            className={`sga-tab${activeTab === t.id ? " active" : ""}`}
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            role="tab"
            type="button"
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Resumen ──────────────────────────────────────────────────────── */}
      {activeTab === "resumen" && (
        <div className="stack" style={{ gap: 20 }}>
          {/* Automation hero */}
          <div className="sga-hero">
            <div className="sga-hero-icon" aria-hidden>🤖</div>
            <div className="sga-hero-body">
              <p className="sga-hero-title">
                {autoMetrics.eligible.length === 0
                  ? "Configura tu primera reposición automática"
                  : autoMetrics.pct === 100
                    ? "Tu almacén se repone solo"
                    : `Reposición automática — ${autoMetrics.pct}% cubierta`}
              </p>
              <div className="sga-hero-meta">
                {autoMetrics.eligible.length === 0 ? (
                  <span>
                    Asigna un proveedor principal y coste a tus SKUs para que Brandeate
                    genere POs cuando el stock baje del punto de reposición.
                  </span>
                ) : (
                  <>
                    <span className="sga-hero-progress">
                      <span className={`sga-pulse-dot${autoMetrics.pct < 100 ? " is-warning" : ""}`} />
                      {autoMetrics.enabled.length}
                      <span style={{ color: "var(--muted)", fontWeight: 400 }}>
                        /{autoMetrics.eligible.length} SKUs
                      </span>
                    </span>
                    <span className="sga-hero-progress-bar" aria-hidden>
                      <span
                        className="sga-hero-progress-fill"
                        style={{ width: `${autoMetrics.pct}%` }}
                      />
                    </span>
                    {autoMetrics.missingConfig.length > 0 && (
                      <span>
                        · <strong>{autoMetrics.missingConfig.length}</strong> sin configurar
                      </span>
                    )}
                    {recommendations.length > 0 && (
                      <span>
                        · <strong>{recommendations.length}</strong> recomendaci{recommendations.length === 1 ? "ón" : "ones"} activas
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>
            {autoMetrics.eligibleNotEnabled.length > 0 ? (
              <button
                className="sga-hero-cta"
                disabled={isBulkEnabling}
                onClick={handleBulkEnableAuto}
                type="button"
              >
                {isBulkEnabling
                  ? "Activando…"
                  : `Activar en ${autoMetrics.eligibleNotEnabled.length} elegibles`}
              </button>
            ) : recommendations.length > 0 && shopId ? (
              <button
                className="sga-hero-cta"
                disabled={isAutoGenerating}
                onClick={handleAutoGenerateFromCriticals}
                type="button"
              >
                {isAutoGenerating ? "Generando…" : `Generar ${recommendations.length} PO${recommendations.length === 1 ? "" : "s"}`}
              </button>
            ) : (
              <button
                className="sga-hero-cta"
                onClick={() => setActiveTab("skus")}
                type="button"
              >
                Configurar SKUs
              </button>
            )}
          </div>

          {/* KPI cards */}
          <div className="sga-kpi-grid">
            <div className="sga-kpi-card">
              <div className="sga-kpi-card-head">
                <span className="sga-kpi-card-icon" aria-hidden>📦</span>
                <span className="sga-kpi-card-label">SKUs activos</span>
              </div>
              <div className="sga-kpi-card-value">{items.length}</div>
              <div className="sga-kpi-card-foot">
                {autoMetrics.enabled.length} con auto-reposición
              </div>
            </div>

            <div className={`sga-kpi-card${criticalCount > 0 ? " is-critical" : " is-success"}`}>
              <div className="sga-kpi-card-head">
                <span className="sga-kpi-card-icon" aria-hidden>{criticalCount > 0 ? "⚠️" : "✓"}</span>
                <span className="sga-kpi-card-label">Stock crítico</span>
              </div>
              <div className="sga-kpi-card-value">{criticalCount}</div>
              <div className="sga-kpi-card-foot">
                {criticalCount === 0 ? "Todo en rango" : "igual o bajo punto de reposición"}
              </div>
            </div>

            <div className={`sga-kpi-card${pendingInboundCount > 0 ? " is-warning" : ""}`}>
              <div className="sga-kpi-card-head">
                <span className="sga-kpi-card-icon" aria-hidden>🚚</span>
                <span className="sga-kpi-card-label">Entradas pendientes</span>
              </div>
              <div className="sga-kpi-card-value">{pendingInboundCount}</div>
              <div className="sga-kpi-card-foot">
                {pendingInboundCount === 0 ? "Sin envíos en tránsito" : "enviadas o en tránsito"}
              </div>
            </div>

            <div className="sga-kpi-card">
              <div className="sga-kpi-card-head">
                <span className="sga-kpi-card-icon" aria-hidden>⚡</span>
                <span className="sga-kpi-card-label">Actividad hoy</span>
              </div>
              <div className="sga-kpi-card-value">{todayMovementsCount}</div>
              <div className="sga-kpi-card-foot">
                movimientos registrados
              </div>
            </div>
          </div>

          {/* Actionable recommendations */}
          {alerts.length > 0 && (
            <div className="sga-action-card is-critical">
              <div className="sga-action-card-icon" aria-hidden>⚠</div>
              <div className="sga-action-card-body">
                <div className="sga-action-card-title">
                  {alerts.length} SKU{alerts.length === 1 ? "" : "s"} necesita{alerts.length === 1 ? "" : "n"} reposición
                </div>
                <div className="sga-action-card-meta">
                  Stock igual o inferior al punto de reposición configurado.
                </div>
              </div>
              <button
                className="sga-hero-cta"
                onClick={() => setActiveTab(recommendations.length > 0 ? "reposicion" : "skus")}
                type="button"
              >
                {recommendations.length > 0 ? "Ver recomendaciones →" : "Ver SKUs →"}
              </button>
            </div>
          )}

          {/* Dos columnas: Últimas entradas + Actividad */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16 }}>
            <div className="sga-surface">
              <div className="sga-surface-head">
                <span className="sga-surface-title">Últimas entradas</span>
                <button
                  className="sga-surface-link"
                  onClick={() => setActiveTab("entradas")}
                  type="button"
                >
                  Ver todas →
                </button>
              </div>
              {shipments.length === 0 ? (
                <p className="sga-empty" style={{ margin: 0 }}>Sin entradas registradas.</p>
              ) : (
                <div className="sga-timeline">
                  {shipments.slice(0, 5).map((s) => (
                    <div
                      key={s.id}
                      className="sga-timeline-row"
                      onClick={() => setActiveTab("entradas")}
                      role="button"
                      style={{ cursor: "pointer" }}
                    >
                      <div
                        className={`sga-timeline-dot${s.status === "received" || s.status === "closed" ? " is-in" : ""}`}
                      />
                      <div className="sga-timeline-body">
                        <div className="sga-timeline-title">#{s.reference}</div>
                        <div className="sga-timeline-meta">
                          {s.lines.length} líneas · llega {formatDate(s.expected_arrival)}
                        </div>
                      </div>
                      <StatusBadge status={s.status} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="sga-surface">
              <div className="sga-surface-head">
                <span className="sga-surface-title">Actividad reciente</span>
                <button
                  className="sga-surface-link"
                  onClick={() => setActiveTab("movimientos")}
                  type="button"
                >
                  Ver todo →
                </button>
              </div>
              {movements.length === 0 ? (
                <p className="sga-empty" style={{ margin: 0 }}>Sin movimientos registrados.</p>
              ) : (
                <div className="sga-timeline">
                  {movements.slice(0, 8).map((m) => {
                    const tone = m.qty_delta > 0 ? "is-in" : m.qty_delta < 0 ? "is-out" : "is-adj";
                    return (
                      <div key={m.id} className="sga-timeline-row">
                        <div className={`sga-timeline-dot ${tone}`} />
                        <div className="sga-timeline-body">
                          <div className="sga-timeline-title">
                            <code style={{ fontSize: 12.5, opacity: .85 }}>{m.sku}</code>
                            <span style={{ color: "var(--muted)", marginLeft: 6 }}>
                              · {MOVEMENT_LABELS[m.movement_type] ?? m.movement_type}
                            </span>
                          </div>
                          <div className="sga-timeline-meta">
                            {formatRelative(m.created_at)} · saldo {m.qty_after}
                          </div>
                        </div>
                        <span className={`sga-timeline-delta ${m.qty_delta >= 0 ? "is-pos" : "is-neg"}`}>
                          {m.qty_delta >= 0 ? `+${m.qty_delta}` : m.qty_delta}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: SKUs ────────────────────────────────────────────────────────── */}
      {activeTab === "skus" && (
        <div className="stack">
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <input
                className="sga-input"
                onChange={(e) => setSkuSearch(e.target.value)}
                placeholder="Buscar por SKU o nombre…"
                style={{ width: "100%" }}
                type="search"
                value={skuSearch}
              />
            </div>
            {shopId && (
              <button
                className="button-secondary"
                disabled={isSyncingCatalog}
                onClick={() => {
                  startCatalogSync(async () => {
                    try {
                      const result = await syncInventoryFromCatalog(shopId);
                      setCatalogSyncResult(result);
                      router.refresh();
                    } catch (e) {
                      alert(`Error al sincronizar: ${e instanceof Error ? e.message : String(e)}`);
                    }
                  });
                }}
                type="button"
              >
                {isSyncingCatalog ? "Sincronizando…" : "↙ Importar SKUs de Shopify"}
              </button>
            )}
            {shopId && (
              <button
                className="button-secondary"
                disabled={isSyncingShopify}
                onClick={() => {
                  setShopifySyncResult(null);
                  startShopifySync(async () => {
                    try {
                      const result = await syncInventoryFromShopify(shopId);
                      setShopifySyncResult(result);
                      router.refresh();
                    } catch (e) {
                      alert(`Error al sincronizar stock: ${e instanceof Error ? e.message : String(e)}`);
                    }
                  });
                }}
                type="button"
              >
                {isSyncingShopify ? "Sincronizando stock…" : "↻ Sync desde Shopify"}
              </button>
            )}
          </div>

          {catalogSyncResult && (
            <div className="info-banner" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span>✅</span>
              <span>
                Sincronización completa — <strong>{catalogSyncResult.created}</strong> SKUs nuevos importados,{" "}
                <strong>{catalogSyncResult.already_existed}</strong> ya existían.{" "}
                {catalogSyncResult.skipped_no_sku > 0 && (
                  <span>({catalogSyncResult.skipped_no_sku} variantes sin SKU ignoradas)</span>
                )}
              </span>
              <button
                onClick={() => setCatalogSyncResult(null)}
                style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "var(--muted)" }}
                type="button"
              >✕</button>
            </div>
          )}

          {shopifySyncResult && (
            <div
              className="info-banner"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                borderColor: shopifySyncResult.sync_status === "failed"
                  ? "var(--danger, #e53e3e)"
                  : shopifySyncResult.sync_status === "partial"
                  ? "var(--warning, #d69e2e)"
                  : undefined,
              }}
            >
              <span>
                {shopifySyncResult.sync_status === "failed"
                  ? "❌"
                  : shopifySyncResult.sync_status === "partial"
                  ? "⚠️"
                  : "✅"}
              </span>
              <span>
                Sync Shopify —{" "}
                <strong>{shopifySyncResult.synced}</strong> actualizados,{" "}
                <strong>{shopifySyncResult.created}</strong> creados,{" "}
                <strong>{shopifySyncResult.skipped}</strong> sin cambios.{" "}
                {shopifySyncResult.errors > 0 && (
                  <span style={{ color: "var(--danger, #e53e3e)" }}>
                    {shopifySyncResult.errors} error(es).
                  </span>
                )}
              </span>
              <button
                onClick={() => setShopifySyncResult(null)}
                style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "var(--muted)" }}
                type="button"
              >✕</button>
            </div>
          )}

          {/* Sync status summary */}
          {syncStatus.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
              {syncStatus.map((entry) => {
                const statusIcon = entry.last_sync_status === "success" ? "✅"
                  : entry.last_sync_status === "partial" ? "⚠️"
                  : entry.last_sync_status === "failed" ? "❌"
                  : "⏳";
                const summary = entry.last_sync_summary;
                const lastSynced = entry.last_synced_at
                  ? new Date(entry.last_synced_at).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })
                  : null;
                return (
                  <div
                    key={entry.shop_id}
                    style={{
                      background: "var(--bg)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      padding: "8px 12px",
                      fontSize: 12,
                      display: "flex",
                      flexDirection: "column",
                      gap: 3,
                      minWidth: 180,
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      Sync inventario · {entry.shop_name}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span>{statusIcon}</span>
                      <span style={{ fontWeight: 600 }}>
                        {entry.last_sync_status ?? "Nunca sincronizado"}
                      </span>
                      {lastSynced && (
                        <span style={{ color: "var(--muted)", fontSize: 11 }}>· {lastSynced}</span>
                      )}
                    </div>
                    {summary && (
                      <div style={{ color: "var(--muted)", fontSize: 11 }}>
                        {typeof summary.synced === "number" && <span>{summary.synced} actualizados · </span>}
                        {typeof summary.created === "number" && <span>{summary.created} creados · </span>}
                        {typeof summary.skipped === "number" && <span>{summary.skipped} sin cambio</span>}
                      </div>
                    )}
                    {entry.last_error_message && (
                      <div style={{ color: "var(--danger, #e53e3e)", fontSize: 11, marginTop: 2 }}>
                        {entry.last_error_message}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {filteredItems.length === 0 ? (
            <div className="sga-empty">
              {skuSearch ? "Sin resultados para esa búsqueda." : "Sin SKUs registrados."}
            </div>
          ) : (
            <div className="sga-table-wrap">
              <table className="sga-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Nombre</th>
                    <th>Ubicación</th>
                    <th>Stock</th>
                    <th>Reservado</th>
                    <th>Disponible</th>
                    <th>Pto. repos.</th>
                    <th>Estado</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => {
                    const isCritical =
                      item.reorder_point != null &&
                      item.stock_on_hand <= item.reorder_point;
                    const isAdjusting = adjustingId === item.id;
                    const isConfiging = configingId === item.id;

                    return (
                      <>
                        <tr key={item.id}>
                          <td>
                            <code>{item.sku}</code>
                          </td>
                          <td>
                            <span>{item.name}</span>
                            {item.replenishment_auto_enabled && (
                              <span className="sga-auto-pill" title="Auto-reposición activa">
                                Auto
                              </span>
                            )}
                          </td>
                          <td style={{ color: "var(--muted)" }}>
                            {item.location ?? "—"}
                          </td>
                          <td>
                            <StockCell item={item} />
                          </td>
                          <td>{item.stock_reserved}</td>
                          <td
                            style={{
                              color:
                                item.stock_available > 0
                                  ? "var(--success, #38a169)"
                                  : "var(--danger, #e53e3e)",
                              fontWeight: 600,
                            }}
                          >
                            {item.stock_available}
                          </td>
                          <td style={{ color: "var(--muted)" }}>
                            {item.reorder_point ?? "—"}
                          </td>
                          <td>
                            <span style={{ display: "inline-flex", alignItems: "center" }}>
                              <span
                                className={`sga-status-dot ${isCritical ? "is-critical" : "is-ok"}`}
                                aria-hidden
                              />
                              <span style={{ fontSize: 13, color: isCritical ? "#dc2626" : "var(--muted)" }}>
                                {isCritical ? "Crítico" : "OK"}
                              </span>
                            </span>
                          </td>
                          <td>
                            {isAdmin && (
                              <div style={{ display: "flex", gap: 6 }}>
                                <button
                                  className="button-secondary"
                                  onClick={() => {
                                    setAdjustingId(isAdjusting ? null : item.id);
                                    setConfigingId(null);
                                  }}
                                  style={{ fontSize: 12, padding: "2px 10px" }}
                                  type="button"
                                >
                                  {isAdjusting ? "Cerrar" : "Ajustar"}
                                </button>
                                <button
                                  className="button-secondary"
                                  onClick={() => {
                                    setConfigingId(isConfiging ? null : item.id);
                                    setAdjustingId(null);
                                  }}
                                  style={{ fontSize: 12, padding: "2px 10px" }}
                                  title={
                                    item.replenishment_auto_enabled
                                      ? "Auto-reposición activa"
                                      : "Configurar reposición"
                                  }
                                  type="button"
                                >
                                  {isConfiging
                                    ? "Cerrar"
                                    : item.replenishment_auto_enabled
                                      ? "Config ✓"
                                      : "Config"}
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>

                        {isAdjusting && (
                          <tr key={`adj-${item.id}`}>
                            <td
                              colSpan={9}
                              style={{ background: "var(--surface)", padding: "12px 16px" }}
                            >
                              <AdjustForm
                                item={item}
                                onDone={handleAdjustDone}
                              />
                            </td>
                          </tr>
                        )}

                        {isConfiging && (
                          <tr key={`cfg-${item.id}`}>
                            <td
                              colSpan={9}
                              style={{ background: "var(--surface)", padding: "12px 16px" }}
                            >
                              <ConfigForm
                                item={item}
                                onDone={handleConfigDone}
                                suppliers={suppliers}
                              />
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Reposición ──────────────────────────────────────────────────── */}
      {activeTab === "reposicion" && (
        <ReplenishmentTab
          hasMultipleShops={hasMultipleShops}
          recommendations={recommendations}
          shopId={shopId}
        />
      )}

      {/* ── Tab: Entradas ────────────────────────────────────────────────────── */}
      {activeTab === "entradas" && (
        <div className="stack">
          {shipments.length === 0 ? (
            <div className="sga-empty">Sin entradas registradas.</div>
          ) : (
            shipments.map((s) => (
              <ShipmentCard
                isAdmin={isAdmin}
                key={s.id}
                onReceived={handleShipmentReceived}
                shipment={s}
              />
            ))
          )}
        </div>
      )}

      {/* ── Tab: Movimientos ─────────────────────────────────────────────────── */}
      {activeTab === "movimientos" && (
        <div className="stack">
          {movements.length === 0 ? (
            <div className="sga-empty">Sin movimientos registrados.</div>
          ) : (
            <div className="sga-table-wrap">
              <table className="sga-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>SKU</th>
                    <th>Tipo</th>
                    <th>Δ Uds.</th>
                    <th>Antes</th>
                    <th>Después</th>
                    <th>Referencia</th>
                    <th>Empleado</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((m) => (
                    <tr key={m.id}>
                      <td
                        style={{ color: "var(--muted)", fontSize: 12, whiteSpace: "nowrap" }}
                        title={new Date(m.created_at).toLocaleString("es-ES")}
                      >
                        {formatRelative(m.created_at)}
                      </td>
                      <td>
                        <code>{m.sku}</code>
                      </td>
                      <td className="sga-movement-cell">
                        {MOVEMENT_LABELS[m.movement_type] ?? m.movement_type}
                      </td>
                      <td>
                        <span
                          className={
                            m.qty_delta >= 0
                              ? "sga-delta-positive"
                              : "sga-delta-negative"
                          }
                        >
                          {m.qty_delta >= 0 ? `+${m.qty_delta}` : m.qty_delta}
                        </span>
                      </td>
                      <td style={{ color: "var(--muted)" }}>{m.qty_before}</td>
                      <td>{m.qty_after}</td>
                      <td style={{ color: "var(--muted)", fontSize: 12 }}>
                        {m.reference_type
                          ? `${m.reference_type}${m.reference_id ? ` #${m.reference_id}` : ""}`
                          : "—"}
                      </td>
                      <td style={{ color: "var(--muted)", fontSize: 12 }}>
                        {m.performed_by_name ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
