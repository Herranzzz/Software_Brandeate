"use client";

import { useState } from "react";

import type { Order } from "@/lib/types";


type CttLabelCellProps = {
  order: Order;
  onShipmentCreated?: (trackingCode: string) => void;
};

type Status = "idle" | "loading" | "success" | "error";

export function CttLabelCell({ order, onShipmentCreated }: CttLabelCellProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  const [recipientName, setRecipientName] = useState(order.customer_name);
  const [recipientEmail, setRecipientEmail] = useState(order.customer_email);
  const [recipientCountry, setRecipientCountry] = useState("ES");
  const [recipientPostalCode, setRecipientPostalCode] = useState("");
  const [recipientAddress, setRecipientAddress] = useState("");
  const [recipientTown, setRecipientTown] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [weight, setWeight] = useState("1");

  function openModal(e: React.MouseEvent) {
    e.stopPropagation();
    setStatus("idle");
    setError("");
    setOpen(true);
  }

  function closeModal() {
    setOpen(false);
  }

  async function handleSubmit() {
    setStatus("loading");
    setError("");

    try {
      const res = await fetch("/api/ctt/shippings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id: order.id,
          recipient_name: recipientName,
          recipient_email: recipientEmail || undefined,
          recipient_country_code: recipientCountry,
          recipient_postal_code: recipientPostalCode,
          recipient_address: recipientAddress,
          recipient_town: recipientTown,
          recipient_phones: recipientPhone ? [recipientPhone] : [],
          shipping_weight_declared: parseFloat(weight) || 1,
          item_count: Math.max(order.items.length, 1),
        }),
      });

      if (!res.ok) {
        const body = (await res.json()) as { detail?: string };
        throw new Error(body.detail ?? "Error al crear el envío");
      }

      const { shipping_code } = (await res.json()) as { shipping_code: string };

      // Register local shipment if not yet created
      if (!order.shipment) {
        await fetch("/api/shipments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            order_id: order.id,
            carrier: "CTT Express",
            tracking_number: shipping_code,
          }),
        });
      }

      // Open label in new tab
      window.open(`/api/ctt/shippings/${shipping_code}/label`, "_blank");

      setStatus("success");
      onShipmentCreated?.(shipping_code);
      setTimeout(() => setOpen(false), 1200);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Error desconocido");
    }
  }

  const isLoading = status === "loading";
  const canSubmit =
    recipientName.trim() !== "" &&
    recipientPostalCode.trim() !== "" &&
    recipientAddress.trim() !== "" &&
    recipientTown.trim() !== "" &&
    recipientPhone.trim() !== "" &&
    parseFloat(weight) > 0;

  return (
    <>
      <button
        className="button-secondary table-action"
        onClick={openModal}
        title="Crear envío CTT Express y descargar etiqueta"
        type="button"
      >
        CTT etiqueta
      </button>

      {open ? (
        <div className="modal-backdrop" onClick={closeModal} role="presentation">
          <div
            aria-modal="true"
            className="modal-sheet"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
          >
            <div className="modal-head">
              <div>
                <span className="eyebrow">CTT Express</span>
                <h3 className="section-title section-title-small">
                  Envío · {order.external_id}
                </h3>
                <p className="subtitle">
                  {order.customer_name} · {order.customer_email}
                </p>
              </div>
              <button className="button-secondary" disabled={isLoading} onClick={closeModal} type="button">
                Cerrar
              </button>
            </div>

            {status === "success" ? (
              <div className="stack">
                <div className="feedback feedback-success">
                  Envío creado. La etiqueta se ha abierto en una nueva pestaña.
                </div>
              </div>
            ) : (
              <div className="stack">
                <div className="grid grid-2">
                  <div className="field">
                    <label htmlFor={`ctt-name-${order.id}`}>Destinatario</label>
                    <input
                      id={`ctt-name-${order.id}`}
                      onChange={(e) => setRecipientName(e.target.value)}
                      value={recipientName}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`ctt-phone-${order.id}`}>Teléfono</label>
                    <input
                      id={`ctt-phone-${order.id}`}
                      onChange={(e) => setRecipientPhone(e.target.value)}
                      placeholder="612345678"
                      type="tel"
                      value={recipientPhone}
                    />
                  </div>
                </div>

                <div className="field">
                  <label htmlFor={`ctt-address-${order.id}`}>Dirección</label>
                  <input
                    id={`ctt-address-${order.id}`}
                    onChange={(e) => setRecipientAddress(e.target.value)}
                    placeholder="Calle Mayor 10, 2ºA"
                    value={recipientAddress}
                  />
                </div>

                <div className="grid grid-2">
                  <div className="field">
                    <label htmlFor={`ctt-cp-${order.id}`}>CP</label>
                    <input
                      id={`ctt-cp-${order.id}`}
                      onChange={(e) => setRecipientPostalCode(e.target.value)}
                      placeholder="28001"
                      value={recipientPostalCode}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`ctt-town-${order.id}`}>Ciudad</label>
                    <input
                      id={`ctt-town-${order.id}`}
                      onChange={(e) => setRecipientTown(e.target.value)}
                      placeholder="Madrid"
                      value={recipientTown}
                    />
                  </div>
                </div>

                <div className="grid grid-2">
                  <div className="field">
                    <label htmlFor={`ctt-weight-${order.id}`}>Peso (kg)</label>
                    <input
                      id={`ctt-weight-${order.id}`}
                      min="0.01"
                      onChange={(e) => setWeight(e.target.value)}
                      step="0.01"
                      type="number"
                      value={weight}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`ctt-email-${order.id}`}>Email destinatario</label>
                    <input
                      id={`ctt-email-${order.id}`}
                      onChange={(e) => setRecipientEmail(e.target.value)}
                      type="email"
                      value={recipientEmail}
                    />
                  </div>
                </div>

                <div className="modal-footer">
                  <button
                    className="button"
                    disabled={isLoading || !canSubmit}
                    onClick={handleSubmit}
                    type="button"
                  >
                    {isLoading ? "Creando envío..." : "Crear envío y descargar etiqueta"}
                  </button>
                </div>

                {status === "error" ? (
                  <div className="feedback feedback-error">{error}</div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
