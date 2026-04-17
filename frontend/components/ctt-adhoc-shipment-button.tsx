"use client";

import { useState } from "react";

import { AppModal } from "@/components/app-modal";
import { useToast } from "@/components/toast";
import {
  getCttServiceOptions,
  CTT_WEIGHT_BANDS,
  getInitialCttServiceCode,
  getInitialCttWeightBand,
  getOrderShippingContact,
} from "@/lib/ctt";
import type { Order } from "@/lib/types";


type AdhocStatus = "idle" | "loading" | "success" | "error";

type CttAdhocShipmentButtonProps = {
  order: Order;
};

function downloadAdhocLabelPdf(trackingCode: string): void {
  const anchor = document.createElement("a");
  anchor.href = `/api/ctt/shippings/${trackingCode}/label?label_type=PDF&model_type=SINGLE&download=1`;
  anchor.download = `etiqueta-${trackingCode}.pdf`;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/**
 * Creates an ADDITIONAL CTT shipment for an order without touching the order's
 * primary shipment. Useful when a second package needs to go to the same
 * customer/address — avoids having to open CTT's external software.
 *
 * On success the label PDF is auto-downloaded; the tracking code is shown in
 * the modal for reference (no DB persistence of adhoc labels — intentional).
 */
export function CttAdhocShipmentButton({ order }: CttAdhocShipmentButtonProps) {
  const initialContact = getOrderShippingContact(order);
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<AdhocStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [shippingCode, setShippingCode] = useState("");

  const [recipientName, setRecipientName] = useState(initialContact.recipientName);
  const [recipientEmail, setRecipientEmail] = useState(initialContact.recipientEmail);
  const [recipientCountry, setRecipientCountry] = useState(initialContact.recipientCountry);
  const [recipientPostalCode, setRecipientPostalCode] = useState(initialContact.recipientPostalCode);
  const [recipientAddress, setRecipientAddress] = useState(initialContact.recipientAddress);
  const [recipientTown, setRecipientTown] = useState(initialContact.recipientTown);
  const [recipientPhone, setRecipientPhone] = useState(initialContact.recipientPhone);

  const [weightTierCode, setWeightTierCode] = useState(getInitialCttWeightBand(order));
  const [shippingTypeCode, setShippingTypeCode] = useState(getInitialCttServiceCode(order));
  const [itemCount, setItemCount] = useState("1");

  function resetForm() {
    setStatus("idle");
    setErrorMessage("");
    setShippingCode("");
  }

  function openModal() {
    const nextContact = getOrderShippingContact(order);
    setRecipientName(nextContact.recipientName);
    setRecipientEmail(nextContact.recipientEmail);
    setRecipientCountry(nextContact.recipientCountry);
    setRecipientPostalCode(nextContact.recipientPostalCode);
    setRecipientAddress(nextContact.recipientAddress);
    setRecipientTown(nextContact.recipientTown);
    setRecipientPhone(nextContact.recipientPhone);
    setWeightTierCode(getInitialCttWeightBand(order));
    setShippingTypeCode(getInitialCttServiceCode(order));
    setItemCount("1");
    resetForm();
    setOpen(true);
  }

  function closeModal() {
    setOpen(false);
    resetForm();
  }

  async function handleCreateAdhoc() {
    setStatus("loading");
    setErrorMessage("");
    setShippingCode("");

    try {
      const res = await fetch("/api/ctt/shippings/adhoc", {
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
          weight_tier_code: weightTierCode,
          shipping_type_code: shippingTypeCode,
          item_count: parseInt(itemCount, 10) || 1,
        }),
      });

      if (!res.ok) {
        const err = (await res.json()) as { detail?: string };
        throw new Error(err.detail ?? "Error al crear el envío adicional en CTT Express");
      }

      const { shipping_code } = (await res.json()) as { shipping_code: string };
      setShippingCode(shipping_code);
      setStatus("success");
      toast("Envío adicional creado y etiqueta descargada", "success");
      downloadAdhocLabelPdf(shipping_code);
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Error desconocido");
    }
  }

  const isLoading = status === "loading";

  const canSubmit =
    recipientName.trim() !== "" &&
    recipientPostalCode.trim() !== "" &&
    recipientAddress.trim() !== "" &&
    recipientTown.trim() !== "" &&
    recipientPhone.trim() !== "" &&
    weightTierCode.trim() !== "" &&
    shippingTypeCode.trim() !== "";

  return (
    <>
      <button className="button-secondary" onClick={openModal} type="button">
        CTT — Envío adicional
      </button>

      <AppModal
        actions={(
          <button className="button-secondary" disabled={isLoading} onClick={closeModal} type="button">
            Cerrar
          </button>
        )}
        bodyClassName="ctt-modal-body"
        eyebrow="CTT Express"
        onClose={closeModal}
        open={open}
        subtitle="Crea una segunda etiqueta para el mismo pedido sin abrir el software de CTT. No reemplaza la etiqueta original."
        title="Crear envío adicional"
        width="wide"
      >
        {status !== "success" ? (
          <div className="stack">
            <div className="ctt-create-hero">
              <div className="ctt-create-hero-copy">
                <strong>Etiqueta adicional para este pedido</strong>
                <p>Datos pre-rellenados con la dirección del cliente. Ajusta lo que necesites y lanza la etiqueta.</p>
              </div>
              <div className="ctt-create-hero-metrics">
                <span>{shippingTypeCode || "Sin servicio"}</span>
                <span>{CTT_WEIGHT_BANDS.find((band) => band.code === weightTierCode)?.label ?? "Peso"}</span>
                <span>{Math.max(parseInt(itemCount, 10) || 1, 1)} bulto(s)</span>
              </div>
            </div>

            <div className="grid grid-2">
              <div className="field">
                <label htmlFor="ctt-adhoc-service">Servicio CTT</label>
                <select
                  id="ctt-adhoc-service"
                  onChange={(e) => setShippingTypeCode(e.target.value)}
                  value={shippingTypeCode}
                >
                  {getCttServiceOptions(order).map((service) => (
                    <option key={service.code} value={service.code}>
                      {service.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Tramo de peso</label>
                <div className="ctt-weight-grid">
                  {CTT_WEIGHT_BANDS.map((band) => (
                    <button
                      className={`orders-filter-pill ctt-weight-pill ${weightTierCode === band.code ? "orders-filter-pill-active" : ""}`}
                      key={band.code}
                      onClick={() => setWeightTierCode(band.code)}
                      type="button"
                    >
                      {band.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-2">
              <div className="field">
                <label htmlFor="ctt-adhoc-name">Nombre destinatario</label>
                <input id="ctt-adhoc-name" onChange={(e) => setRecipientName(e.target.value)} value={recipientName} />
              </div>
              <div className="field">
                <label htmlFor="ctt-adhoc-email">Email destinatario</label>
                <input id="ctt-adhoc-email" onChange={(e) => setRecipientEmail(e.target.value)} type="email" value={recipientEmail} />
              </div>
            </div>

            <div className="field">
              <label htmlFor="ctt-adhoc-address">Dirección</label>
              <input id="ctt-adhoc-address" onChange={(e) => setRecipientAddress(e.target.value)} value={recipientAddress} />
            </div>

            <div className="grid grid-2">
              <div className="field">
                <label htmlFor="ctt-adhoc-postal">Código postal</label>
                <input id="ctt-adhoc-postal" onChange={(e) => setRecipientPostalCode(e.target.value)} value={recipientPostalCode} />
              </div>
              <div className="field">
                <label htmlFor="ctt-adhoc-town">Ciudad</label>
                <input id="ctt-adhoc-town" onChange={(e) => setRecipientTown(e.target.value)} value={recipientTown} />
              </div>
            </div>

            <div className="grid grid-2">
              <div className="field">
                <label htmlFor="ctt-adhoc-phone">Teléfono</label>
                <input id="ctt-adhoc-phone" onChange={(e) => setRecipientPhone(e.target.value)} type="tel" value={recipientPhone} />
              </div>
              <div className="field">
                <label htmlFor="ctt-adhoc-country">País</label>
                <input id="ctt-adhoc-country" onChange={(e) => setRecipientCountry(e.target.value)} value={recipientCountry} />
              </div>
            </div>

            <div className="field">
              <label htmlFor="ctt-adhoc-items">Nº bultos</label>
              <input
                id="ctt-adhoc-items"
                min="1"
                onChange={(e) => setItemCount(e.target.value)}
                type="number"
                value={itemCount}
              />
            </div>

            <div className="ctt-create-sticky-bar">
              <div className="ctt-create-sticky-copy">
                <strong>Crear etiqueta adicional</strong>
                <span>
                  Servicio {shippingTypeCode || "pendiente"} · {Math.max(parseInt(itemCount, 10) || 1, 1)} bulto(s)
                </span>
              </div>
              <button
                className="button ctt-create-sticky-button"
                disabled={isLoading || !canSubmit}
                onClick={handleCreateAdhoc}
                type="button"
              >
                {isLoading ? "Creando..." : "Crear envío adicional"}
              </button>
            </div>

            {status === "error" ? <div className="feedback feedback-error">{errorMessage}</div> : null}
          </div>
        ) : (
          <div className="stack">
            <div className="feedback feedback-success">
              Envío adicional creado · <strong>{shippingCode}</strong>
            </div>
            <p className="helper-text">
              La etiqueta se está descargando en tu navegador. Guarda el código{" "}
              <strong>{shippingCode}</strong> para referencia — este envío no queda vinculado a la etiqueta
              original del pedido.
            </p>
            <div className="ctt-label-actions-grid">
              <a
                className="button ctt-print-big"
                href={`/api/ctt/shippings/${shippingCode}/label?label_type=PDF&model_type=SINGLE&download=1`}
                download
                rel="noreferrer"
                target="_blank"
              >
                Volver a descargar PDF
              </a>
              <a
                className="button-secondary ctt-download-btn"
                href={`/api/ctt/shippings/${shippingCode}/label?label_type=ZPL&model_type=SINGLE&download=1`}
                download
                rel="noreferrer"
                target="_blank"
              >
                Descargar ZPL (térmica)
              </a>
            </div>
          </div>
        )}
      </AppModal>
    </>
  );
}
