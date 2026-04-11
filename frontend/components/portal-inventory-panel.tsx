"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { InventoryItem, InboundShipment, InboundShipmentLine } from "@/lib/types";
import {
  createInboundShipment,
  addInboundShipmentLine,
  deleteInboundShipmentLine,
  updateInboundShipment,
} from "@/lib/api-client";

type PortalInventoryPanelProps = {
  items: InventoryItem[];
  inboundShipments: InboundShipment[];
  shopId: number;
  alerts: InventoryItem[];
};

type Tab = "stock" | "enviar" | "entradas";

type ShipmentLine = {
  sku: string;
  name: string;
  qty: number;
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Borrador",
  sent: "Enviado",
  in_transit: "En tránsito",
  received: "Recibido",
  closed: "Cerrado",
};

const STATUS_BADGE: Record<string, string> = {
  draft: "sga-badge sga-badge-draft",
  sent: "sga-badge sga-badge-sent",
  in_transit: "sga-badge sga-badge-in_transit",
  received: "sga-badge sga-badge-received",
  closed: "sga-badge sga-badge-closed",
};

function getBarColor(item: InventoryItem): string {
  const { stock_available, reorder_point } = item;
  if (reorder_point == null) return "is-ok";
  if (stock_available <= reorder_point) return "is-critical";
  if (stock_available <= reorder_point * 2) return "is-low";
  return "is-ok";
}

function getBarFill(item: InventoryItem): number {
  const { stock_available, reorder_point } = item;
  if (reorder_point == null) return stock_available > 0 ? 100 : 0;
  const pct = (stock_available / (reorder_point * 3)) * 100;
  return Math.min(100, Math.max(0, pct));
}

function getStatusBadge(item: InventoryItem): { label: string; cls: string } {
  const { stock_available, reorder_point } = item;
  if (reorder_point == null) return { label: "Sin reposición", cls: "sga-badge sga-badge-unknown" };
  if (stock_available <= reorder_point) return { label: "Crítico", cls: "sga-badge sga-badge-critical" };
  if (stock_available <= reorder_point * 2) return { label: "Bajo", cls: "sga-badge sga-badge-low" };
  return { label: "OK", cls: "sga-badge sga-badge-ok" };
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

export function PortalInventoryPanel({
  items,
  inboundShipments,
  shopId,
  alerts,
}: PortalInventoryPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [activeTab, setActiveTab] = useState<Tab>("stock");
  const [expandedShipments, setExpandedShipments] = useState<Set<number>>(new Set());
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [markingSent, setMarkingSent] = useState<number | null>(null);

  // Form state
  const [reference, setReference] = useState("");
  const [expectedArrival, setExpectedArrival] = useState("");
  const [carrier, setCarrier] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<ShipmentLine[]>([{ sku: "", name: "", qty: 1 }]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function switchToEnviarWithSku(sku: string) {
    setLines([{ sku, name: "", qty: 1 }]);
    setActiveTab("enviar");
  }

  function addLine() {
    setLines((prev) => [...prev, { sku: "", name: "", qty: 1 }]);
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  function updateLine(index: number, field: keyof ShipmentLine, value: string | number) {
    setLines((prev) =>
      prev.map((line, i) => (i === index ? { ...line, [field]: value } : line))
    );
  }

  function resetForm() {
    setReference("");
    setExpectedArrival("");
    setCarrier("");
    setTrackingNumber("");
    setNotes("");
    setLines([{ sku: "", name: "", qty: 1 }]);
    setSubmitError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reference.trim()) {
      setSubmitError("La referencia es obligatoria.");
      return;
    }
    const validLines = lines.filter((l) => l.sku.trim());
    if (validLines.length === 0) {
      setSubmitError("Añade al menos una referencia con SKU.");
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const shipment = await createInboundShipment({
        shop_id: shopId,
        reference: reference.trim(),
        expected_arrival: expectedArrival || undefined,
        carrier: carrier.trim() || undefined,
        tracking_number: trackingNumber.trim() || undefined,
        notes: notes.trim() || undefined,
      });

      await Promise.all(
        validLines.map((line) =>
          addInboundShipmentLine(shipment.id, {
            sku: line.sku.trim(),
            name: line.name.trim() || undefined,
            qty_expected: line.qty,
          })
        )
      );

      resetForm();
      setSuccessMessage(`Nota de envío "${shipment.reference}" creada con éxito.`);
      setActiveTab("entradas");
      startTransition(() => router.refresh());
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Error al crear el envío. Inténtalo de nuevo.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleMarkSent(shipmentId: number) {
    setMarkingSent(shipmentId);
    try {
      await updateInboundShipment(shipmentId, { status: "sent" });
      startTransition(() => router.refresh());
    } catch {
      // silently ignore — page will reflect stale state until refresh
    } finally {
      setMarkingSent(null);
    }
  }

  function toggleExpand(id: number) {
    setExpandedShipments((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const pendingCount = inboundShipments.filter(
    (s) => s.status === "sent" || s.status === "in_transit"
  ).length;

  return (
    <div className="stack">
      {/* Tabs */}
      <div className="sga-tabs">
        <button
          className={`sga-tab${activeTab === "stock" ? " is-active" : ""}`}
          onClick={() => setActiveTab("stock")}
          type="button"
        >
          Mi stock
          {alerts.length > 0 && (
            <span className="sga-tab-badge">{alerts.length}</span>
          )}
        </button>
        <button
          className={`sga-tab${activeTab === "enviar" ? " is-active" : ""}`}
          onClick={() => setActiveTab("enviar")}
          type="button"
        >
          Enviar mercancía
        </button>
        <button
          className={`sga-tab${activeTab === "entradas" ? " is-active" : ""}`}
          onClick={() => setActiveTab("entradas")}
          type="button"
        >
          Mis entradas
          {pendingCount > 0 && (
            <span className="sga-tab-badge">{pendingCount}</span>
          )}
        </button>
      </div>

      {/* ── Tab 1: Mi stock ─────────────────────────────────────────────── */}
      {activeTab === "stock" && (
        <div className="stack">
          {alerts.length > 0 && (
            <div className="sga-reorder-banner">
              <div className="sga-reorder-banner-icon">⚠️</div>
              <div className="sga-reorder-banner-body">
                <div className="sga-reorder-banner-title">
                  {alerts.length} referencias necesitan reposición — tu stock está por debajo del punto de reposición configurado
                </div>
                <div className="sga-reorder-banner-sub">
                  Ve a &lsquo;Enviar mercancía&rsquo; para crear un envío de reposición
                </div>
              </div>
            </div>
          )}

          {items.length === 0 ? (
            <div className="sga-empty">
              <div className="sga-empty-icon">📦</div>
              <p className="sga-empty-title">Sin stock registrado</p>
              <p className="sga-empty-sub">
                Tu inventario aparecerá aquí una vez que enviemos tu mercancía. Crea tu primer envío en la pestaña &lsquo;Enviar mercancía&rsquo;.
              </p>
            </div>
          ) : (
            <div className="sga-table-wrap">
              <table className="sga-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Producto</th>
                    <th>Ubicación</th>
                    <th>Stock disponible</th>
                    <th>Reservado</th>
                    <th>Punto reposición</th>
                    <th>Estado</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const barFill = getBarFill(item);
                    const barColor = getBarColor(item);
                    const status = getStatusBadge(item);
                    return (
                      <tr key={item.id}>
                        <td><code>{item.sku}</code></td>
                        <td>{item.name}</td>
                        <td>{item.location ?? "—"}</td>
                        <td>
                          <div className="sga-stock-cell">
                            <span className="sga-stock-num">{item.stock_available}</span>
                            <div className="sga-stock-bar">
                              <div
                                className={`sga-stock-bar-fill ${barColor}`}
                                style={{ width: `${barFill}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td>{item.stock_reserved}</td>
                        <td>{item.reorder_point ?? "—"}</td>
                        <td>
                          <span className={status.cls}>{status.label}</span>
                        </td>
                        <td>
                          <button
                            className="button-sm"
                            onClick={() => switchToEnviarWithSku(item.sku)}
                            type="button"
                          >
                            Reponer
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Tab 2: Enviar mercancía ──────────────────────────────────────── */}
      {activeTab === "enviar" && (
        <div className="sga-form-card">
          <div className="sga-form-title">Nuevo envío de mercancía</div>
          <div className="sga-form-sub">
            Crea una nota de envío (ASN) para informarnos de la mercancía que vas a enviarnos. Confirmaremos la recepción cuando llegue al almacén.
          </div>

          <form onSubmit={handleSubmit} className="stack">
            <div className="sga-form-grid">
              <div className="sga-field">
                <label className="sga-label" htmlFor="asn-reference">
                  Referencia <span aria-hidden>*</span>
                </label>
                <input
                  className="sga-input"
                  id="asn-reference"
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="Ej: PO-2024-001"
                  required
                  type="text"
                  value={reference}
                />
              </div>

              <div className="sga-field">
                <label className="sga-label" htmlFor="asn-arrival">
                  Fecha estimada de llegada
                </label>
                <input
                  className="sga-input"
                  id="asn-arrival"
                  onChange={(e) => setExpectedArrival(e.target.value)}
                  type="date"
                  value={expectedArrival}
                />
              </div>

              <div className="sga-field">
                <label className="sga-label" htmlFor="asn-carrier">
                  Transportista
                </label>
                <input
                  className="sga-input"
                  id="asn-carrier"
                  onChange={(e) => setCarrier(e.target.value)}
                  placeholder="Ej: CTT, Correos, DHL"
                  type="text"
                  value={carrier}
                />
              </div>

              <div className="sga-field">
                <label className="sga-label" htmlFor="asn-tracking">
                  Nº seguimiento
                </label>
                <input
                  className="sga-input"
                  id="asn-tracking"
                  onChange={(e) => setTrackingNumber(e.target.value)}
                  type="text"
                  value={trackingNumber}
                />
              </div>

              <div className="sga-field" style={{ gridColumn: "1 / -1" }}>
                <label className="sga-label" htmlFor="asn-notes">
                  Notas
                </label>
                <textarea
                  className="sga-input"
                  id="asn-notes"
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  value={notes}
                />
              </div>
            </div>

            {/* Lines */}
            <div className="sga-lines-wrap">
              <div className="sga-lines-title">Artículos a enviar</div>
              {lines.length === 0 ? (
                <p className="sga-form-sub">Añade al menos una referencia</p>
              ) : (
                <table className="sga-lines-table">
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Nombre del producto</th>
                      <th>Uds. a enviar</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line, idx) => (
                      <tr key={idx}>
                        <td>
                          <input
                            className="sga-input sga-input-sm"
                            onChange={(e) => updateLine(idx, "sku", e.target.value)}
                            placeholder="SKU-001"
                            type="text"
                            value={line.sku}
                          />
                        </td>
                        <td>
                          <input
                            className="sga-input sga-input-sm"
                            onChange={(e) => updateLine(idx, "name", e.target.value)}
                            placeholder="Nombre del artículo"
                            type="text"
                            value={line.name}
                          />
                        </td>
                        <td>
                          <input
                            className="sga-input sga-input-sm"
                            min={1}
                            onChange={(e) => updateLine(idx, "qty", parseInt(e.target.value, 10) || 1)}
                            style={{ width: 80 }}
                            type="number"
                            value={line.qty}
                          />
                        </td>
                        <td>
                          <button
                            className="button-sm"
                            onClick={() => removeLine(idx)}
                            title="Eliminar línea"
                            type="button"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <button
                className="button-secondary"
                onClick={addLine}
                style={{ marginTop: 8 }}
                type="button"
              >
                + Añadir referencia
              </button>
            </div>

            {submitError && (
              <p style={{ color: "var(--danger, #dc2626)", fontSize: 14 }}>{submitError}</p>
            )}

            <div>
              <button
                className="button"
                disabled={isSubmitting || isPending}
                type="submit"
              >
                {isSubmitting ? "Creando…" : "Crear nota de envío"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Tab 3: Mis entradas ──────────────────────────────────────────── */}
      {activeTab === "entradas" && (
        <div className="stack">
          {successMessage && (
            <div className="sga-alert-list">
              <div className="sga-alert-item">
                <div className="sga-alert-icon">✅</div>
                <div className="sga-alert-body">
                  <div className="sga-alert-sku">{successMessage}</div>
                </div>
                <div className="sga-alert-actions">
                  <button
                    className="button-sm"
                    onClick={() => setSuccessMessage(null)}
                    type="button"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>
          )}

          {inboundShipments.length === 0 ? (
            <div className="sga-empty">
              <div className="sga-empty-icon">🚚</div>
              <p className="sga-empty-title">Sin envíos de mercancía</p>
              <p className="sga-empty-sub">
                Cuando envíes mercancía a nuestro almacén, el historial aparecerá aquí.
              </p>
            </div>
          ) : (
            inboundShipments.map((shipment) => {
              const isExpanded = expandedShipments.has(shipment.id);
              const totalAccepted = shipment.lines.reduce((s, l) => s + l.qty_accepted, 0);

              return (
                <div className="sga-shipment-card" key={shipment.id}>
                  <div className="sga-shipment-head">
                    <div>
                      <div className="sga-shipment-ref">{shipment.reference}</div>
                      <div className="sga-shipment-meta">
                        <span className={STATUS_BADGE[shipment.status] ?? "sga-badge"}>
                          {STATUS_LABEL[shipment.status] ?? shipment.status}
                        </span>
                        <span className="sga-shipment-meta-item">
                          Creado {formatDate(shipment.created_at)}
                        </span>
                        {shipment.expected_arrival && (
                          <span className="sga-shipment-meta-item">
                            Llegada estimada: {formatDate(shipment.expected_arrival)}
                          </span>
                        )}
                        {shipment.carrier && (
                          <span className="sga-shipment-meta-item">
                            {shipment.carrier}
                            {shipment.tracking_number && ` · ${shipment.tracking_number}`}
                          </span>
                        )}
                        <span className="sga-shipment-meta-item">
                          {shipment.total_expected} uds. esperadas
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Status-specific info */}
                  {shipment.status === "draft" && (
                    <div style={{ marginTop: 8 }}>
                      <button
                        className="button"
                        disabled={markingSent === shipment.id}
                        onClick={() => handleMarkSent(shipment.id)}
                        type="button"
                      >
                        {markingSent === shipment.id ? "Actualizando…" : "Marcar como enviado"}
                      </button>
                    </div>
                  )}

                  {(shipment.status === "sent" || shipment.status === "in_transit") && (
                    <div className="sga-alert-item" style={{ marginTop: 8, borderRadius: 6 }}>
                      <div className="sga-alert-icon">🚚</div>
                      <div className="sga-alert-body">
                        <div className="sga-alert-sku">En camino</div>
                        <div className="sga-alert-meta">
                          Brandeate confirmará la recepción cuando llegue al almacén
                        </div>
                      </div>
                    </div>
                  )}

                  {shipment.status === "received" && (
                    <div className="sga-alert-item" style={{ marginTop: 8, borderRadius: 6 }}>
                      <div className="sga-alert-icon">✅</div>
                      <div className="sga-alert-body">
                        <div className="sga-alert-sku">
                          {totalAccepted} / {shipment.total_expected} uds. aceptadas
                        </div>
                        {shipment.received_at && (
                          <div className="sga-alert-meta">
                            Recibido el {formatDate(shipment.received_at)}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Expandable lines */}
                  {shipment.lines.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <button
                        className="button-secondary"
                        onClick={() => toggleExpand(shipment.id)}
                        type="button"
                      >
                        {isExpanded ? "Ocultar artículos" : "Ver artículos"}
                        {" "}({shipment.lines.length})
                      </button>

                      {isExpanded && (
                        <div className="sga-table-wrap" style={{ marginTop: 8 }}>
                          <table className="sga-table">
                            <thead>
                              <tr>
                                <th>SKU</th>
                                <th>Nombre</th>
                                <th>Esperadas</th>
                                <th>Recibidas</th>
                                <th>Aceptadas</th>
                                <th>Estado línea</th>
                              </tr>
                            </thead>
                            <tbody>
                              {shipment.lines.map((line) => {
                                let lineStatusLabel: string;
                                let lineStatusCls: string;
                                if (line.qty_received > 0) {
                                  lineStatusLabel = "Recibido";
                                  lineStatusCls = "sga-badge sga-badge-received";
                                } else if (shipment.status === "received") {
                                  lineStatusLabel = "No recibido";
                                  lineStatusCls = "sga-badge sga-badge-critical";
                                } else {
                                  lineStatusLabel = "Pendiente";
                                  lineStatusCls = "sga-badge sga-badge-draft";
                                }
                                return (
                                  <tr key={line.id}>
                                    <td><code>{line.sku}</code></td>
                                    <td>{line.name ?? "—"}</td>
                                    <td>{line.qty_expected}</td>
                                    <td>{line.qty_received}</td>
                                    <td>{line.qty_accepted}</td>
                                    <td>
                                      <span className={lineStatusCls}>{lineStatusLabel}</span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
