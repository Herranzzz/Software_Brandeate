"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { Order } from "@/lib/types";

type PortalReturnWizardProps = {
  orders: Order[];
  shopId?: string;
};

type Reason = {
  value: "shipping_exception" | "personalization_error" | "address_issue" | "stock_issue" | "missing_asset";
  icon: string;
  label: string;
  title: string;
  description: string;
};

const REASONS: Reason[] = [
  {
    value: "shipping_exception",
    icon: "🚚",
    label: "Problema de envío",
    title: "Devolución por problema con el envío",
    description: "El paquete llegó tarde, dañado o sufrió una incidencia con el carrier.",
  },
  {
    value: "personalization_error",
    icon: "🎨",
    label: "Personalización incorrecta",
    title: "Devolución por personalización incorrecta",
    description: "El texto, foto, diseño o acabado no coincide con lo que se pidió.",
  },
  {
    value: "address_issue",
    icon: "📍",
    label: "No entregado",
    title: "Devolución por no entrega o dirección",
    description: "El carrier no pudo completar la entrega o hay un problema con la dirección.",
  },
  {
    value: "stock_issue",
    icon: "📦",
    label: "Producto defectuoso",
    title: "Devolución por producto defectuoso",
    description: "El producto llegó roto, con daño visible o con algún fallo de fabricación.",
  },
  {
    value: "missing_asset",
    icon: "📎",
    label: "Falta material",
    title: "Solicitud de revisión con material pendiente",
    description: "Necesitas añadir más contexto, fotos o referencias para completar el caso.",
  },
];

const STATUS_LABEL: Record<string, string> = {
  pending: "Pendiente",
  in_progress: "En proceso",
  ready_to_ship: "Listo para enviar",
  shipped: "Enviado",
  delivered: "Entregado",
  exception: "Incidencia",
};

type Step = 1 | 2 | 3;

export function PortalReturnWizard({ orders, shopId }: PortalReturnWizardProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState<Step>(1);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [selectedReason, setSelectedReason] = useState<Reason | null>(null);
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");
  const [description, setDescription] = useState("");
  const [imageLinks, setImageLinks] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdCaseId, setCreatedCaseId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const selectedOrder = orders.find((o) => o.id === selectedOrderId) ?? null;

  const filteredOrders = orders.filter((o) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      o.external_id.toLowerCase().includes(q) ||
      o.customer_name.toLowerCase().includes(q) ||
      o.customer_email.toLowerCase().includes(q)
    );
  });

  function openWizard() {
    setStep(1);
    setSelectedOrderId(null);
    setSelectedReason(null);
    setPriority("medium");
    setDescription("");
    setImageLinks("");
    setError(null);
    setCreatedCaseId(null);
    setSearchQuery("");
    setIsOpen(true);
  }

  function closeWizard() {
    setIsOpen(false);
  }

  async function handleSubmit() {
    if (!selectedOrderId || !selectedReason) return;
    setIsSubmitting(true);
    setError(null);

    const composedDescription = [
      description.trim(),
      imageLinks.trim() ? `Enlaces de apoyo:\n${imageLinks.trim()}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    try {
      const response = await fetch("/api/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id: selectedOrderId,
          type: selectedReason.value,
          priority,
          status: "open",
          title: selectedReason.title,
          description: composedDescription || selectedReason.description,
        }),
      });

      if (!response.ok) {
        let detail = "No hemos podido crear la solicitud ahora mismo.";
        try {
          const payload = (await response.json()) as { detail?: string };
          if (payload.detail) detail = payload.detail;
        } catch { /* ignore */ }
        setError(detail);
        return;
      }

      const created = (await response.json()) as { id?: number };
      setCreatedCaseId(created.id ?? null);
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <button className="button" onClick={openWizard} type="button">
        + Nueva solicitud
      </button>

      {isOpen && (
        <div className="rwiz-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeWizard(); }}>
          <div className="rwiz-dialog" role="dialog" aria-modal="true">

            {/* Success screen */}
            {createdCaseId !== null ? (
              <div className="rwiz-success">
                <div className="rwiz-success-icon">✅</div>
                <h2 className="rwiz-success-title">Solicitud enviada</h2>
                <p className="rwiz-success-sub">
                  Hemos recibido tu caso. El equipo lo revisará y verás el estado actualizado en la lista de devoluciones.
                </p>
                {createdCaseId && (
                  <div className="rwiz-success-id">
                    <span className="rwiz-success-id-label">Referencia del caso</span>
                    <code className="rwiz-success-id-code">#{createdCaseId}</code>
                  </div>
                )}
                <div className="rwiz-success-steps">
                  <div className="rwiz-success-step">
                    <span className="rwiz-success-step-icon">📋</span>
                    <div>
                      <strong>1. Abierto</strong>
                      <span>Tu caso está en cola de revisión</span>
                    </div>
                  </div>
                  <div className="rwiz-success-step">
                    <span className="rwiz-success-step-icon">🔍</span>
                    <div>
                      <strong>2. En revisión</strong>
                      <span>El equipo analiza y contacta si necesita más datos</span>
                    </div>
                  </div>
                  <div className="rwiz-success-step">
                    <span className="rwiz-success-step-icon">✅</span>
                    <div>
                      <strong>3. Resuelto</strong>
                      <span>Cierre confirmado con la solución acordada</span>
                    </div>
                  </div>
                </div>
                <button className="button" onClick={closeWizard} type="button">
                  Ver mis devoluciones
                </button>
              </div>
            ) : (
              <>
                {/* Header */}
                <div className="rwiz-header">
                  <div className="rwiz-header-left">
                    <h2 className="rwiz-title">Nueva solicitud de devolución</h2>
                    <div className="rwiz-steps">
                      {([1, 2, 3] as Step[]).map((s) => (
                        <div
                          className={`rwiz-step-dot${step === s ? " rwiz-step-active" : step > s ? " rwiz-step-done" : ""}`}
                          key={s}
                        >
                          {step > s ? "✓" : s}
                        </div>
                      ))}
                      <span className="rwiz-step-label">
                        {step === 1 ? "Elige el pedido" : step === 2 ? "Motivo" : "Detalles"}
                      </span>
                    </div>
                  </div>
                  <button className="rwiz-close" onClick={closeWizard} type="button" aria-label="Cerrar">✕</button>
                </div>

                {/* Body */}
                <div className="rwiz-body">
                  {/* Step 1: Select order */}
                  {step === 1 && (
                    <div className="rwiz-step-content">
                      <p className="rwiz-step-intro">Selecciona el pedido afectado para abrir la solicitud.</p>
                      <div className="field">
                        <input
                          className="rwiz-search"
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Buscar por nº pedido, nombre o email..."
                          type="search"
                          value={searchQuery}
                        />
                      </div>
                      <div className="rwiz-order-grid">
                        {filteredOrders.length === 0 ? (
                          <p className="rwiz-empty">No hay pedidos que coincidan con la búsqueda.</p>
                        ) : (
                          filteredOrders.map((order) => (
                            <button
                              className={`rwiz-order-card${selectedOrderId === order.id ? " rwiz-order-selected" : ""}`}
                              key={order.id}
                              onClick={() => setSelectedOrderId(order.id)}
                              type="button"
                            >
                              <div className="rwiz-order-card-top">
                                <span className="rwiz-order-id">#{order.external_id}</span>
                                <span className="rwiz-order-status">{STATUS_LABEL[order.status] ?? order.status}</span>
                              </div>
                              <span className="rwiz-order-customer">{order.customer_name}</span>
                              {order.customer_email && (
                                <span className="rwiz-order-email">{order.customer_email}</span>
                              )}
                              {selectedOrderId === order.id && (
                                <span className="rwiz-order-check">✓ Seleccionado</span>
                              )}
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}

                  {/* Step 2: Select reason */}
                  {step === 2 && (
                    <div className="rwiz-step-content">
                      <p className="rwiz-step-intro">
                        Pedido <strong>#{selectedOrder?.external_id}</strong> · {selectedOrder?.customer_name}.
                        ¿Cuál es el motivo principal?
                      </p>
                      <div className="rwiz-reason-grid">
                        {REASONS.map((reason) => (
                          <button
                            className={`rwiz-reason-card${selectedReason?.value === reason.value ? " rwiz-reason-selected" : ""}`}
                            key={reason.value}
                            onClick={() => setSelectedReason(reason)}
                            type="button"
                          >
                            <span className="rwiz-reason-icon">{reason.icon}</span>
                            <strong className="rwiz-reason-label">{reason.label}</strong>
                            <span className="rwiz-reason-desc">{reason.description}</span>
                            {selectedReason?.value === reason.value && (
                              <span className="rwiz-reason-check">✓</span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Step 3: Details */}
                  {step === 3 && (
                    <div className="rwiz-step-content">
                      <div className="rwiz-summary-pill">
                        <span>#{selectedOrder?.external_id}</span>
                        <span className="rwiz-summary-sep">·</span>
                        <span>{selectedReason?.icon} {selectedReason?.label}</span>
                      </div>

                      <div className="field">
                        <label htmlFor="rwiz-desc">¿Qué ha ocurrido?</label>
                        <textarea
                          id="rwiz-desc"
                          onChange={(e) => setDescription(e.target.value)}
                          placeholder="Describe brevemente el problema y qué esperas que revisemos."
                          rows={5}
                          value={description}
                        />
                      </div>

                      <div className="field">
                        <label htmlFor="rwiz-images">Enlaces a imágenes o pruebas <span className="rwiz-optional">(opcional)</span></label>
                        <textarea
                          id="rwiz-images"
                          onChange={(e) => setImageLinks(e.target.value)}
                          placeholder="Pega uno o varios enlaces, uno por línea."
                          rows={3}
                          value={imageLinks}
                        />
                      </div>

                      <div className="field">
                        <label htmlFor="rwiz-priority">Prioridad</label>
                        <select
                          id="rwiz-priority"
                          onChange={(e) => setPriority(e.target.value as "low" | "medium" | "high")}
                          value={priority}
                        >
                          <option value="low">Baja — puede esperar unos días</option>
                          <option value="medium">Media — revisión en 24-48 h</option>
                          <option value="high">Alta — urgente, afecta al cliente</option>
                        </select>
                      </div>

                      {error && <div className="feedback feedback-error">{error}</div>}
                    </div>
                  )}
                </div>

                {/* Footer nav */}
                <div className="rwiz-footer">
                  {step > 1 ? (
                    <button className="button-secondary" onClick={() => setStep((s) => (s - 1) as Step)} type="button">
                      ← Atrás
                    </button>
                  ) : (
                    <button className="button-secondary" onClick={closeWizard} type="button">
                      Cancelar
                    </button>
                  )}

                  {step < 3 ? (
                    <button
                      className="button"
                      disabled={step === 1 ? !selectedOrderId : !selectedReason}
                      onClick={() => setStep((s) => (s + 1) as Step)}
                      type="button"
                    >
                      Continuar →
                    </button>
                  ) : (
                    <button
                      className="button"
                      disabled={isSubmitting}
                      onClick={() => void handleSubmit()}
                      type="button"
                    >
                      {isSubmitting ? "Enviando..." : "Enviar solicitud"}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
