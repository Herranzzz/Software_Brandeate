"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { AppModal } from "@/components/app-modal";
import { useToast } from "@/components/toast";
import {
  getCttServiceOptions,
  CTT_WEIGHT_BANDS,
  getOrderShipmentLabelUrl,
  getInitialCttServiceCode,
  getInitialCttWeightBand,
  getOrderShippingContact,
} from "@/lib/ctt";
import { printLabel } from "@/lib/print-utils";
import type { Order, ShippingRuleResolution, Shop } from "@/lib/types";


type CttStatus = "idle" | "loading-shipping" | "loading-label" | "success" | "error";

type CttShipmentButtonProps = {
  order: Order;
};

export function CttShipmentButton({ order }: CttShipmentButtonProps) {
  const initialContact = getOrderShippingContact(order);
  const existingLabelUrl = getOrderShipmentLabelUrl(order);
  const existingDownloadUrl = getOrderShipmentLabelUrl(order, { download: true });
  const existingThermalUrl = getOrderShipmentLabelUrl(order, { download: true, labelType: "ZPL" });
  const router = useRouter();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [cttStatus, setCttStatus] = useState<CttStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [shippingCode, setShippingCode] = useState("");
  const [labelUrl, setLabelUrl] = useState("");
  const [shopifySyncStatus, setShopifySyncStatus] = useState("");
  const [isRefreshingOrder, setIsRefreshingOrder] = useState(false);
  const [isPreviewVisible, setIsPreviewVisible] = useState(false);
  const [isPrintingLabel, setIsPrintingLabel] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  // Recipient fields — pre-filled from order data
  const [recipientName, setRecipientName] = useState(initialContact.recipientName);
  const [recipientEmail, setRecipientEmail] = useState(initialContact.recipientEmail);
  const [recipientCountry, setRecipientCountry] = useState(initialContact.recipientCountry);
  const [recipientPostalCode, setRecipientPostalCode] = useState(initialContact.recipientPostalCode);
  const [recipientAddress, setRecipientAddress] = useState(initialContact.recipientAddress);
  const [recipientTown, setRecipientTown] = useState(initialContact.recipientTown);
  const [recipientPhone, setRecipientPhone] = useState(initialContact.recipientPhone);

  // Shipping details
  const [weightTierCode, setWeightTierCode] = useState(getInitialCttWeightBand(order));
  const [shippingTypeCode, setShippingTypeCode] = useState(getInitialCttServiceCode(order));
  const [itemCount, setItemCount] = useState(String(order.shipment?.package_count ?? 1));
  const [ruleResolution, setRuleResolution] = useState<ShippingRuleResolution | null>(null);
  const [manualServiceOverride, setManualServiceOverride] = useState(false);

  function syncFromOrder() {
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
    setItemCount(String(order.shipment?.package_count ?? 1));
    setRuleResolution(null);
    setManualServiceOverride(false);
  }

  async function refreshOrderSnapshot() {
    setIsRefreshingOrder(true);
    try {
      const [orderResponse, shopResponse] = await Promise.all([
        fetch(`/api/orders/${order.id}`, { cache: "no-store" }),
        fetch(`/api/shops/${order.shop_id}`, { cache: "no-store" }),
      ]);
      if (!orderResponse.ok) {
        return;
      }
      const freshOrder = (await orderResponse.json()) as Order;
      const freshShop = shopResponse.ok ? (await shopResponse.json()) as Shop : null;
      const nextContact = getOrderShippingContact(freshOrder);
      setRecipientName(nextContact.recipientName);
      setRecipientEmail(nextContact.recipientEmail);
      setRecipientCountry(nextContact.recipientCountry);
      setRecipientPostalCode(nextContact.recipientPostalCode);
      setRecipientAddress(nextContact.recipientAddress);
      setRecipientTown(nextContact.recipientTown);
      setRecipientPhone(nextContact.recipientPhone);
      setWeightTierCode(getInitialCttWeightBand(freshOrder, freshShop?.shipping_settings));
      setShippingTypeCode(getInitialCttServiceCode(freshOrder, freshShop?.shipping_settings));
      setItemCount(String(freshOrder.shipment?.package_count ?? 1));
    } catch {
      // Keep current order snapshot if refresh fails.
    } finally {
      setIsRefreshingOrder(false);
    }
  }

  useEffect(() => {
    if (!open || cttStatus === "success") {
      return;
    }

    let cancelled = false;

    async function resolveRule() {
      try {
        const response = await fetch("/api/shipping-rules/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            order_id: order.id,
            weight_tier_code: weightTierCode,
          }),
        });
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as ShippingRuleResolution;
        if (cancelled) {
          return;
        }
        setRuleResolution(payload);
        if (!manualServiceOverride && payload.carrier_service_code) {
          setShippingTypeCode(payload.carrier_service_code);
        }
      } catch {
        if (!cancelled) {
          setRuleResolution(null);
        }
      }
    }

    void resolveRule();
    return () => {
      cancelled = true;
    };
  }, [open, order.id, weightTierCode, manualServiceOverride, cttStatus]);

  function resetForm() {
    setCttStatus("idle");
    setErrorMessage("");
    setShippingCode("");
    setLabelUrl("");
    setShopifySyncStatus("");
    setIsPreviewVisible(false);
    setIsPrintingLabel(false);
    setElapsedSeconds(0);
    abortRef.current?.abort();
    abortRef.current = null;
  }

  // Tick an elapsed-seconds counter while a CTT call is pending so the user
  // sees the request is still alive during retries (backend retries transient
  // failures up to ~60s total).
  useEffect(() => {
    if (cttStatus !== "loading-shipping" && cttStatus !== "loading-label") {
      return;
    }
    setElapsedSeconds(0);
    const started = Date.now();
    const id = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - started) / 1000));
    }, 500);
    return () => window.clearInterval(id);
  }, [cttStatus]);

  function closeModal() {
    setOpen(false);
    resetForm();
  }

  function openModal() {
    syncFromOrder();
    const hasExistingLabel = Boolean(existingLabelUrl);
    setCttStatus(hasExistingLabel ? "success" : "idle");
    setShippingCode(hasExistingLabel ? (order.shipment?.tracking_number ?? "") : "");
    setLabelUrl(hasExistingLabel ? (existingLabelUrl ?? "") : "");
    setShopifySyncStatus(hasExistingLabel ? (order.shipment?.shopify_sync_status ?? "") : "");
    setIsPreviewVisible(false);
    setOpen(true);
    void refreshOrderSnapshot();
  }

  async function handlePrintLabel() {
    if (!shippingCode || isPrintingLabel) {
      return;
    }
    setIsPrintingLabel(true);
    try {
      await printLabel(shippingCode, { format: "PDF" });
    } catch (err) {
      setCttStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "No se pudo abrir la impresión");
    } finally {
      setIsPrintingLabel(false);
    }
  }

  async function handleCreateAndPrint() {
    // Guard against double-click: if we're already creating or fetching a label
    // for this order, drop the extra click instead of racing two requests.
    if (cttStatus === "loading-shipping" || cttStatus === "loading-label") {
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    // Backend may retry transient CTT errors for up to ~60s; give the client
    // some slack on top of that before cutting the request.
    const clientTimeoutId = window.setTimeout(() => controller.abort(), 90_000);

    setCttStatus("loading-shipping");
    setErrorMessage("");
    setShippingCode("");
    setLabelUrl("");

    try {
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
          weight_tier_code: weightTierCode,
          shipping_type_code: shippingTypeCode,
          shipping_rule_id: ruleResolution?.shipping_rule_id ?? undefined,
          shipping_rule_name: ruleResolution?.shipping_rule_name ?? undefined,
          detected_zone: ruleResolution?.zone_name ?? undefined,
          resolution_mode: manualServiceOverride ? "manual" : "automatic",
          item_count: parseInt(itemCount, 10) || 1,
        }),
        signal: controller.signal,
      });

      if (!shippingRes.ok) {
        let detail = `Error al crear el envío en CTT Express (${shippingRes.status})`;
        try {
          const err = (await shippingRes.json()) as { detail?: string };
          if (err?.detail) detail = err.detail;
        } catch {
          // non-JSON body — keep generic message
        }
        throw new Error(detail);
      }

      const { shipping_code, shopify_sync_status } = (await shippingRes.json()) as {
        shipping_code: string;
        shopify_sync_status?: string | null;
      };
      setShippingCode(shipping_code);
      setShopifySyncStatus(shopify_sync_status || "");
      setLabelUrl(`/api/ctt/shippings/${shipping_code}/label`);
      setIsPreviewVisible(false);

      // Mark the shipment as created BEFORE attempting to print so the user
      // keeps the success state (and the Print / Download buttons) even if
      // print fails. Previously a silent print failure left no recovery path.
      setCttStatus("success");
      toast("Etiqueta creada correctamente", "success");
      startTransition(() => { router.refresh(); });

      try {
        setIsPrintingLabel(true);
        await printLabel(shipping_code, { format: "PDF" });
      } catch (printErr) {
        const msg = printErr instanceof Error ? printErr.message : "Impresión automática fallida";
        toast(`Etiqueta creada, pero no se pudo imprimir: ${msg}. Usa el botón "Imprimir etiqueta".`, "error");
      } finally {
        setIsPrintingLabel(false);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setCttStatus("error");
        setErrorMessage("La creación de la etiqueta tardó demasiado. CTT puede estar lento — vuelve a intentarlo.");
      } else {
        setCttStatus("error");
        setErrorMessage(err instanceof Error ? err.message : "Error desconocido");
      }
    } finally {
      window.clearTimeout(clientTimeoutId);
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }

  const isLoading = cttStatus === "loading-shipping" || cttStatus === "loading-label" || isPending;

  const elapsedSuffix = elapsedSeconds >= 3 ? ` (${elapsedSeconds}s)` : "";
  const loadingLabel =
    cttStatus === "loading-shipping"
      ? `Creando envío en CTT...${elapsedSuffix}`
      : cttStatus === "loading-label"
        ? `Obteniendo etiqueta...${elapsedSuffix}`
        : "Procesando...";

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
        {existingLabelUrl ? "CTT — Ver etiqueta" : "CTT — Crear envío y etiqueta"}
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
        subtitle="Registra el envío en CTT Express y descarga la etiqueta PDF en un solo paso."
        title="Crear envío y etiqueta"
        width="wide"
      >
            {cttStatus !== "success" ? (
              <div className="stack">
                <div className="ctt-create-hero">
                  <div className="ctt-create-hero-copy">
                    <strong>Etiqueta lista para preparar</strong>
                    <p>Revisa los datos y usa el botón fijo para lanzar la etiqueta sin bajar al final del formulario.</p>
                  </div>
                  <div className="ctt-create-hero-metrics">
                    <span>{shippingTypeCode || "Sin servicio"}</span>
                    <span>{CTT_WEIGHT_BANDS.find((band) => band.code === weightTierCode)?.label ?? "Peso"}</span>
                    <span>{Math.max(parseInt(itemCount, 10) || 1, 1)} bulto(s)</span>
                  </div>
                </div>
                <div className="grid grid-2">
                  <div className="field">
                    <label htmlFor="ctt-service-code">Servicio CTT</label>
                    <select
                      id="ctt-service-code"
                      onChange={(e) => {
                        const nextValue = e.target.value;
                        setShippingTypeCode(nextValue);
                        setManualServiceOverride(nextValue !== (ruleResolution?.carrier_service_code ?? nextValue));
                      }}
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
                    <label>{isRefreshingOrder ? "Tramo de peso · actualizando dirección..." : "Tramo de peso"}</label>
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
                {isRefreshingOrder ? (
                  <div className="table-secondary">Actualizando datos del pedido...</div>
                ) : null}
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

                <div className="ctt-create-sticky-bar">
                  <div className="ctt-create-sticky-copy">
                    <strong>Crear etiqueta CTT</strong>
                    <span>
                      Servicio {shippingTypeCode || "pendiente"} · {Math.max(parseInt(itemCount, 10) || 1, 1)} bulto(s)
                    </span>
                  </div>
                  <button
                    className="button ctt-create-sticky-button"
                    disabled={isLoading || !canSubmit}
                    onClick={handleCreateAndPrint}
                    type="button"
                  >
                    {isLoading ? loadingLabel : "Crear envío y mostrar etiqueta"}
                  </button>
                </div>

                {cttStatus === "error" ? (
                  <div className="feedback feedback-error">{errorMessage}</div>
                ) : null}
              </div>
            ) : (
              <div className="stack">
                <div className="feedback feedback-success">
                  Envío creado · <strong>{shippingCode}</strong>
                  {shopifySyncStatus === "synced" ? " · Shopify sincronizado" : ""}
                </div>

                <div className="ctt-label-actions-grid">
                  <button
                    className="button ctt-print-big"
                    disabled={isPrintingLabel || !shippingCode}
                    onClick={handlePrintLabel}
                    type="button"
                  >
                    {isPrintingLabel ? "Imprimiendo..." : "Imprimir etiqueta"}
                  </button>

                  <a
                    className="button-secondary ctt-download-btn"
                    href={existingDownloadUrl || `${labelUrl || `/api/ctt/shippings/${shippingCode}/label`}?download=1`}
                    download
                    rel="noreferrer"
                    target="_blank"
                  >
                    Descargar PDF
                  </a>
                </div>

                <div className="ctt-label-extras">
                  <a
                    className="button-link"
                    href={existingThermalUrl || `/api/ctt/shippings/${shippingCode}/label?label_type=ZPL&model_type=SINGLE&download=1`}
                    download
                    rel="noreferrer"
                    target="_blank"
                  >
                    Descargar ZPL (térmica)
                  </a>
                  <button
                    className="button-link"
                    onClick={() => setIsPreviewVisible((v) => !v)}
                    type="button"
                  >
                    {isPreviewVisible ? "Ocultar vista previa" : "Ver vista previa"}
                  </button>
                </div>

                {labelUrl && isPreviewVisible ? (
                  <iframe className="ctt-label-frame" src={labelUrl} title={`Etiqueta CTT ${shippingCode}`} />
                ) : null}
              </div>
            )}
      </AppModal>
    </>
  );
}
