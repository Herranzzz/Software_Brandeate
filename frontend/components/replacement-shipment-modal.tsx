"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { AppModal } from "@/components/app-modal";
import { useToast } from "@/components/toast";
import { CTT_WEIGHT_BANDS, getCttServiceOptions } from "@/lib/ctt";
import { printLabel } from "@/lib/print-utils";
import type { Order } from "@/lib/types";

type ReplacementStatus = "idle" | "loading" | "success" | "error";

type ReplacementShipmentModalProps = {
  order: Order;
};

export function ReplacementShipmentModal({ order }: ReplacementShipmentModalProps) {
  const activeShipment = order.shipment;
  const router = useRouter();
  const { toast } = useToast();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<ReplacementStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [newShippingCode, setNewShippingCode] = useState("");
  const [isPrinting, setIsPrinting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const [replacementReason, setReplacementReason] = useState("");
  const [weightTierCode, setWeightTierCode] = useState(activeShipment?.weight_tier_code ?? "");
  const [shippingTypeCode, setShippingTypeCode] = useState(activeShipment?.shipping_type_code ?? "");
  const [itemCount, setItemCount] = useState(String(activeShipment?.package_count ?? 1));

  function resetForm() {
    setStatus("idle");
    setErrorMessage("");
    setNewShippingCode("");
    setReplacementReason("");
    setWeightTierCode(order.shipment?.weight_tier_code ?? "");
    setShippingTypeCode(order.shipment?.shipping_type_code ?? "");
    setItemCount(String(order.shipment?.package_count ?? 1));
    setIsPrinting(false);
    abortRef.current?.abort();
    abortRef.current = null;
  }

  function openModal() {
    resetForm();
    setOpen(true);
  }

  function closeModal() {
    setOpen(false);
    resetForm();
  }

  async function handleCreateReplacement() {
    if (status === "loading") return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const timeoutId = window.setTimeout(() => controller.abort(), 90_000);

    setStatus("loading");
    setErrorMessage("");

    try {
      const res = await fetch(`/api/ctt/shippings/${order.id}/replacements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          replacement_reason: replacementReason,
          weight_tier_code: weightTierCode || undefined,
          shipping_type_code: shippingTypeCode || undefined,
          item_count: parseInt(itemCount, 10) || 1,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        let detail = `Error al crear el reenvío (${res.status})`;
        try {
          const err = (await res.json()) as { detail?: string };
          if (err?.detail) detail = err.detail;
        } catch { /* non-JSON body */ }
        throw new Error(detail);
      }

      const { shipping_code } = (await res.json()) as { shipping_code: string };
      setNewShippingCode(shipping_code);
      setStatus("success");
      toast("Reenvío creado correctamente", "success");
      startTransition(() => { router.refresh(); });

      try {
        setIsPrinting(true);
        await printLabel(shipping_code, { format: "PDF" });
      } catch (printErr) {
        const msg = printErr instanceof Error ? printErr.message : "Error de impresión";
        toast(`Etiqueta creada, pero no se pudo imprimir: ${msg}`, "error");
      } finally {
        setIsPrinting(false);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setStatus("error");
        setErrorMessage("La creación tardó demasiado. CTT puede estar lento — inténtalo de nuevo.");
      } else {
        setStatus("error");
        setErrorMessage(err instanceof Error ? err.message : "Error desconocido");
      }
    } finally {
      window.clearTimeout(timeoutId);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  async function handlePrintLabel() {
    if (!newShippingCode || isPrinting) return;
    setIsPrinting(true);
    try {
      await printLabel(newShippingCode, { format: "PDF" });
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo imprimir la etiqueta", "error");
    } finally {
      setIsPrinting(false);
    }
  }

  const canSubmit = replacementReason.trim().length > 0 && weightTierCode.trim() !== "" && shippingTypeCode.trim() !== "";
  const isLoading = status === "loading";

  if (!activeShipment) return null;

  return (
    <>
      <button className="button-secondary" onClick={openModal} type="button">
        Crear reenvío
      </button>

      <AppModal
        actions={(
          <button className="button-secondary" disabled={isLoading} onClick={closeModal} type="button">
            Cerrar
          </button>
        )}
        eyebrow="CTT Express"
        onClose={closeModal}
        open={open}
        subtitle={`Reenvío sobre ${activeShipment.tracking_number}. Se cancelará el fulfillment anterior en Shopify y se creará uno nuevo.`}
        title="Crear reenvío"
        width="wide"
      >
        {status !== "success" ? (
          <div className="stack">
            <div className="feedback feedback-warning">
              Se cancelará el fulfillment de Shopify del envío actual y se creará uno nuevo con la nueva etiqueta.
            </div>

            <div className="field">
              <label htmlFor="replacement-reason">Motivo del reenvío <span className="field-required">*</span></label>
              <textarea
                id="replacement-reason"
                onChange={(e) => setReplacementReason(e.target.value)}
                placeholder="Ej: Paquete perdido en tránsito, el cliente no lo recibió..."
                rows={3}
                value={replacementReason}
              />
            </div>

            <div className="grid grid-2">
              <div className="field">
                <label htmlFor="replacement-service-code">Servicio CTT</label>
                <select
                  id="replacement-service-code"
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

            <div className="field">
              <label htmlFor="replacement-item-count">Nº bultos</label>
              <input
                id="replacement-item-count"
                min="1"
                onChange={(e) => setItemCount(e.target.value)}
                type="number"
                value={itemCount}
              />
            </div>

            <button
              className="button"
              disabled={isLoading || !canSubmit}
              onClick={handleCreateReplacement}
              type="button"
            >
              {isLoading ? "Creando reenvío..." : "Crear reenvío y etiqueta"}
            </button>

            {status === "error" && (
              <div className="feedback feedback-error">{errorMessage}</div>
            )}
          </div>
        ) : (
          <div className="stack">
            <div className="feedback feedback-success">
              Reenvío creado · <strong>{newShippingCode}</strong>
            </div>
            <div className="ctt-label-actions-grid">
              <button
                className="button ctt-print-big"
                disabled={isPrinting || !newShippingCode}
                onClick={handlePrintLabel}
                type="button"
              >
                {isPrinting ? "Imprimiendo..." : "Imprimir etiqueta"}
              </button>
              <a
                className="button-secondary ctt-download-btn"
                download
                href={`/api/ctt/shippings/${newShippingCode}/label?download=1`}
                rel="noreferrer"
                target="_blank"
              >
                Descargar PDF
              </a>
            </div>
          </div>
        )}
      </AppModal>
    </>
  );
}
