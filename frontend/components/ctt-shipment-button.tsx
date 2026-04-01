"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { Order } from "@/lib/types";


type CttStatus = "idle" | "loading-shipping" | "loading-label" | "success" | "error";

type CttShipmentButtonProps = {
  order: Order;
};

export function CttShipmentButton({ order }: CttShipmentButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [cttStatus, setCttStatus] = useState<CttStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [shippingCode, setShippingCode] = useState("");

  // Recipient fields — pre-filled from order data
  const [recipientName, setRecipientName] = useState(order.customer_name);
  const [recipientEmail, setRecipientEmail] = useState(order.customer_email);
  const [recipientCountry, setRecipientCountry] = useState("ES");
  const [recipientPostalCode, setRecipientPostalCode] = useState("");
  const [recipientAddress, setRecipientAddress] = useState("");
  const [recipientTown, setRecipientTown] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");

  // Shipping details
  const [weight, setWeight] = useState("");
  const [itemCount, setItemCount] = useState(String(order.items.length || 1));

  function resetForm() {
    setCttStatus("idle");
    setErrorMessage("");
    setShippingCode("");
  }

  function closeModal() {
    setOpen(false);
    resetForm();
  }

  async function handleCreateAndPrint() {
    // Open window immediately (before any await) to avoid browser popup blocker
    const labelWindow = window.open("about:blank", "_blank");

    setCttStatus("loading-shipping");
    setErrorMessage("");
    setShippingCode("");

    try {
      // Step 1: Create CTT shipping
      const shippingRes = await fetch("/api/ctt/shippings", {
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
          shipping_weight_declared: parseFloat(weight),
          item_count: parseInt(itemCount, 10) || 1,
        }),
      });

      if (!shippingRes.ok) {
        labelWindow?.close();
        const err = (await shippingRes.json()) as { detail?: string };
        throw new Error(err.detail ?? "Error al crear el envío en CTT Express");
      }

      const { shipping_code } = (await shippingRes.json()) as { shipping_code: string };
      setShippingCode(shipping_code);

      // Step 2: Navigate pre-opened window to the label PDF
      setCttStatus("loading-label");
      if (labelWindow) {
        labelWindow.location.href = `/api/ctt/shippings/${shipping_code}/label`;
      }

      // Step 3: Register local shipment (non-blocking)
      if (!order.shipment) {
        fetch("/api/shipments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            order_id: order.id,
            carrier: "CTT Express",
            tracking_number: shipping_code,
          }),
        }).catch(() => { /* ignore — CTT shipment already created */ });
      }

      setCttStatus("success");
      startTransition(() => { router.refresh(); });
    } catch (err) {
      setCttStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Error desconocido");
    }
  }

  const isLoading = cttStatus === "loading-shipping" || cttStatus === "loading-label" || isPending;

  const loadingLabel =
    cttStatus === "loading-shipping"
      ? "Creando envío en CTT..."
      : cttStatus === "loading-label"
        ? "Obteniendo etiqueta..."
        : "Procesando...";

  const canSubmit =
    recipientName.trim() !== "" &&
    recipientPostalCode.trim() !== "" &&
    recipientAddress.trim() !== "" &&
    recipientTown.trim() !== "" &&
    recipientPhone.trim() !== "" &&
    weight.trim() !== "" &&
    parseFloat(weight) > 0;

  return (
    <>
      <button className="button-secondary" onClick={() => setOpen(true)} type="button">
        CTT — Crear envío y etiqueta
      </button>

      {open ? (
        <div className="modal-backdrop" onClick={closeModal} role="presentation">
          <div
            aria-modal="true"
            className="modal-sheet"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="modal-head">
              <div>
                <span className="eyebrow">CTT Express</span>
                <h3 className="section-title section-title-small">Crear envío y etiqueta</h3>
                <p className="subtitle">
                  Registra el envío en CTT Express y descarga la etiqueta PDF en un solo paso.
                </p>
              </div>
              <button className="button-secondary" disabled={isLoading} onClick={closeModal} type="button">
                Cerrar
              </button>
            </div>

            {cttStatus !== "success" ? (
              <div className="stack">
                <div className="grid grid-2">
                  <div className="field">
                    <label htmlFor="ctt-recipient-name">Nombre destinatario</label>
                    <input
                      id="ctt-recipient-name"
                      onChange={(e) => setRecipientName(e.target.value)}
                      placeholder="María García"
                      value={recipientName}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="ctt-recipient-email">Email destinatario</label>
                    <input
                      id="ctt-recipient-email"
                      onChange={(e) => setRecipientEmail(e.target.value)}
                      placeholder="cliente@email.com"
                      type="email"
                      value={recipientEmail}
                    />
                  </div>
                </div>

                <div className="field">
                  <label htmlFor="ctt-recipient-address">Dirección</label>
                  <input
                    id="ctt-recipient-address"
                    onChange={(e) => setRecipientAddress(e.target.value)}
                    placeholder="Calle Mayor 10, 2ºA"
                    value={recipientAddress}
                  />
                </div>

                <div className="grid grid-2">
                  <div className="field">
                    <label htmlFor="ctt-recipient-postal">Código postal</label>
                    <input
                      id="ctt-recipient-postal"
                      onChange={(e) => setRecipientPostalCode(e.target.value)}
                      placeholder="28001"
                      value={recipientPostalCode}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="ctt-recipient-town">Ciudad</label>
                    <input
                      id="ctt-recipient-town"
                      onChange={(e) => setRecipientTown(e.target.value)}
                      placeholder="Madrid"
                      value={recipientTown}
                    />
                  </div>
                </div>

                <div className="grid grid-2">
                  <div className="field">
                    <label htmlFor="ctt-recipient-phone">Teléfono</label>
                    <input
                      id="ctt-recipient-phone"
                      onChange={(e) => setRecipientPhone(e.target.value)}
                      placeholder="612345678"
                      type="tel"
                      value={recipientPhone}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="ctt-recipient-country">País</label>
                    <input
                      id="ctt-recipient-country"
                      onChange={(e) => setRecipientCountry(e.target.value)}
                      placeholder="ES"
                      value={recipientCountry}
                    />
                  </div>
                </div>

                <div className="grid grid-2">
                  <div className="field">
                    <label htmlFor="ctt-weight">Peso (kg)</label>
                    <input
                      id="ctt-weight"
                      min="0.01"
                      onChange={(e) => setWeight(e.target.value)}
                      placeholder="1.5"
                      step="0.01"
                      type="number"
                      value={weight}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="ctt-item-count">Nº bultos</label>
                    <input
                      id="ctt-item-count"
                      min="1"
                      onChange={(e) => setItemCount(e.target.value)}
                      type="number"
                      value={itemCount}
                    />
                  </div>
                </div>

                <div className="modal-footer">
                  <button
                    className="button"
                    disabled={isLoading || !canSubmit}
                    onClick={handleCreateAndPrint}
                    type="button"
                  >
                    {isLoading ? loadingLabel : "Crear envío y abrir etiqueta"}
                  </button>
                </div>

                {cttStatus === "error" ? (
                  <div className="feedback feedback-error">{errorMessage}</div>
                ) : null}
              </div>
            ) : (
              <div className="stack">
                <div className="feedback feedback-success">
                  Envío creado correctamente.{shippingCode ? ` Código CTT: ${shippingCode}` : ""}
                </div>
                <div className="modal-footer">
                  {shippingCode ? (
                    <a
                      className="button-secondary"
                      href={`/api/ctt/shippings/${shippingCode}/label`}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Descargar etiqueta de nuevo
                    </a>
                  ) : null}
                  <button className="button-secondary" onClick={closeModal} type="button">
                    Cerrar
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
