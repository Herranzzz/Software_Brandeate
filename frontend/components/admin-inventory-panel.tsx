"use client";

import { useState, useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  adjustInventoryStock,
  receiveInboundShipment,
  updateInboundShipment,
} from "@/lib/api-client";
import type {
  InventoryItem,
  InboundShipment,
  InboundShipmentLine,
  StockMovement,
  StockMovementType,
} from "@/lib/types";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = "resumen" | "skus" | "entradas" | "movimientos";

type AdminInventoryPanelProps = {
  items: InventoryItem[];
  inboundShipments: InboundShipment[];
  movements: StockMovement[];
  alerts: InventoryItem[];
  isAdmin: boolean;
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
}: AdminInventoryPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>("resumen");
  const [items, setItems] = useState<InventoryItem[]>(initialItems);
  const [shipments, setShipments] = useState<InboundShipment[]>(initialShipments);
  const [skuSearch, setSkuSearch] = useState("");
  const [adjustingId, setAdjustingId] = useState<number | null>(null);

  // ── KPI computations ────────────────────────────────────────────────────────

  const criticalCount = items.filter(
    (i) => i.reorder_point != null && i.stock_on_hand <= i.reorder_point
  ).length;

  const pendingInboundCount = shipments.filter(
    (s) => s.status === "sent" || s.status === "in_transit"
  ).length;

  const todayMovementsCount = movements.filter((m) => isToday(m.created_at)).length;

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
        <div className="stack">
          <div className="sga-kpi-strip">
            <div className="sga-kpi">
              <div className="sga-kpi-value">{items.length}</div>
              <div className="sga-kpi-label">Total SKUs</div>
              <div className="sga-kpi-sub">referencias activas</div>
            </div>

            <div className={`sga-kpi${criticalCount > 0 ? " is-danger" : ""}`}>
              <div className="sga-kpi-value">{criticalCount}</div>
              <div className="sga-kpi-label">Stock crítico</div>
              <div className="sga-kpi-sub">en o bajo punto de reposición</div>
            </div>

            <div className={`sga-kpi${pendingInboundCount > 0 ? " is-warning" : ""}`}>
              <div className="sga-kpi-value">{pendingInboundCount}</div>
              <div className="sga-kpi-label">Entradas pendientes</div>
              <div className="sga-kpi-sub">enviadas o en tránsito</div>
            </div>

            <div className="sga-kpi">
              <div className="sga-kpi-value">{todayMovementsCount}</div>
              <div className="sga-kpi-label">Movimientos hoy</div>
              <div className="sga-kpi-sub">registros del día</div>
            </div>
          </div>

          {alerts.length > 0 && (
            <div className="sga-reorder-banner">
              <strong>{alerts.length} SKUs necesitan reposición</strong>
              <span style={{ fontSize: 13, color: "var(--muted)", marginLeft: 8 }}>
                Stock igual o inferior al punto de reposición.
              </span>
              <button
                className="button-secondary"
                onClick={() => setActiveTab("skus")}
                style={{ marginLeft: "auto", fontSize: 13 }}
                type="button"
              >
                Ver SKUs →
              </button>
            </div>
          )}

          {/* Últimas entradas */}
          <div>
            <div className="sga-section-head">
              <span className="sga-section-title">Últimas entradas</span>
              <button
                className="button-secondary"
                onClick={() => setActiveTab("entradas")}
                style={{ fontSize: 13 }}
                type="button"
              >
                Ver todas
              </button>
            </div>

            {shipments.length === 0 ? (
              <p className="sga-empty">Sin entradas registradas.</p>
            ) : (
              <div className="sga-table-wrap">
                <table className="sga-table">
                  <thead>
                    <tr>
                      <th>Referencia</th>
                      <th>Estado</th>
                      <th>Líneas</th>
                      <th>Llegada esperada</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shipments.slice(0, 5).map((s) => (
                      <tr
                        key={s.id}
                        onClick={() => setActiveTab("entradas")}
                        style={{ cursor: "pointer" }}
                      >
                        <td>
                          <strong>#{s.reference}</strong>
                        </td>
                        <td>
                          <StatusBadge status={s.status} />
                        </td>
                        <td>{s.lines.length}</td>
                        <td>{formatDate(s.expected_arrival)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Últimos movimientos */}
          <div>
            <div className="sga-section-head">
              <span className="sga-section-title">Últimos movimientos</span>
              <button
                className="button-secondary"
                onClick={() => setActiveTab("movimientos")}
                style={{ fontSize: 13 }}
                type="button"
              >
                Ver todos
              </button>
            </div>

            {movements.length === 0 ? (
              <p className="sga-empty">Sin movimientos registrados.</p>
            ) : (
              <div className="sga-table-wrap">
                <table className="sga-table">
                  <thead>
                    <tr>
                      <th>Cuando</th>
                      <th>SKU</th>
                      <th>Tipo</th>
                      <th>Δ Uds.</th>
                      <th>Después</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.slice(0, 10).map((m) => (
                      <tr key={m.id}>
                        <td style={{ color: "var(--muted)", fontSize: 12 }}>
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
                        <td>{m.qty_after}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Tab: SKUs ────────────────────────────────────────────────────────── */}
      {activeTab === "skus" && (
        <div className="stack">
          <div style={{ maxWidth: 320 }}>
            <input
              className="sga-input"
              onChange={(e) => setSkuSearch(e.target.value)}
              placeholder="Buscar por SKU o nombre…"
              style={{ width: "100%" }}
              type="search"
              value={skuSearch}
            />
          </div>

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

                    return (
                      <>
                        <tr key={item.id}>
                          <td>
                            <code>{item.sku}</code>
                          </td>
                          <td>{item.name}</td>
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
                            <span
                              className={`sga-badge ${isCritical ? "sga-badge-critical" : "sga-badge-ok"}`}
                            >
                              {isCritical ? "Crítico" : "OK"}
                            </span>
                          </td>
                          <td>
                            {isAdmin && (
                              <button
                                className="button-secondary"
                                onClick={() =>
                                  setAdjustingId(isAdjusting ? null : item.id)
                                }
                                style={{ fontSize: 12, padding: "2px 10px" }}
                                type="button"
                              >
                                {isAdjusting ? "Cerrar" : "Ajustar"}
                              </button>
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
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
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
