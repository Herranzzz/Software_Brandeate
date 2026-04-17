"use client";

import { useEffect, useState } from "react";

import { AppModal } from "@/components/app-modal";
import { useToast } from "@/components/toast";
import {
  CTT_SERVICE_OPTIONS,
  CTT_WEIGHT_BANDS,
  getOrderShipmentLabelUrl,
  getInitialCttServiceCode,
  getInitialCttWeightBand,
  getOrderShippingContact,
} from "@/lib/ctt";
import { printLabel } from "@/lib/print-utils";
import type { Order, ShippingRuleResolution, Shop } from "@/lib/types";


type CttLabelCellProps = {
  order: Order;
  onShipmentCreated?: (trackingCode: string) => void;
  onOrderUpdated?: (order: Order) => void;
};

type Status = "idle" | "loading" | "success" | "error";

// The single "Preparar" button has two possible outcomes once inside the modal:
//  - "prepare"  → create the CTT label (backend auto-marks order as packed)
//                 but DO NOT print. Lands in the employee's print queue.
//  - "print"    → create the CTT label + print it right away (current behavior).
type SubmitMode = "prepare" | "print";

export function CttLabelCell({ order, onShipmentCreated, onOrderUpdated }: CttLabelCellProps) {
  const { toast } = useToast();
  const initialContact = getOrderShippingContact(order);
  const existingLabelUrl = getOrderShipmentLabelUrl(order);
  const existingDownloadUrl = getOrderShipmentLabelUrl(order, { download: true });
  const existingThermalUrl = getOrderShipmentLabelUrl(order, { download: true, labelType: "ZPL" });
  const [status, setStatus] = useState<Status>("idle");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [shippingCode, setShippingCode] = useState("");
  const [labelUrl, setLabelUrl] = useState("");
  const [shopifySyncStatus, setShopifySyncStatus] = useState("");
  const [isRefreshingOrder, setIsRefreshingOrder] = useState(false);
  const [isPreviewVisible, setIsPreviewVisible] = useState(false);
  const [isPrintingLabel, setIsPrintingLabel] = useState(false);
  // Tracks which of the two sticky-bar buttons the user clicked so we can
  // label them correctly ("Preparando…" vs "Creando e imprimiendo…") and so
  // the close-after-success branch knows whether a toast is needed.
  const [submitMode, setSubmitMode] = useState<SubmitMode | null>(null);

  const hasShipmentAlready = Boolean(existingLabelUrl);

  const [recipientName, setRecipientName] = useState(initialContact.recipientName);
  const [recipientEmail, setRecipientEmail] = useState(initialContact.recipientEmail);
  const [recipientCountry, setRecipientCountry] = useState(initialContact.recipientCountry);
  const [recipientPostalCode, setRecipientPostalCode] = useState(initialContact.recipientPostalCode);
  const [recipientAddress, setRecipientAddress] = useState(initialContact.recipientAddress);
  const [recipientTown, setRecipientTown] = useState(initialContact.recipientTown);
  const [recipientPhone, setRecipientPhone] = useState(initialContact.recipientPhone);
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
    if (!open || status === "success") {
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
  }, [open, status, order.id, weightTierCode, manualServiceOverride]);

  function openModal(e: React.MouseEvent) {
    e.stopPropagation();
    syncFromOrder();
    const hasExistingLabel = Boolean(existingLabelUrl);
    setStatus(hasExistingLabel ? "success" : "idle");
    setError("");
    setShippingCode(hasExistingLabel ? order.shipment?.tracking_number ?? "" : "");
    setLabelUrl(hasExistingLabel ? existingLabelUrl ?? "" : "");
    setIsPreviewVisible(false);
    setOpen(true);
    setShopifySyncStatus(hasExistingLabel ? order.shipment?.shopify_sync_status ?? "" : "");
    void refreshOrderSnapshot();
  }

  function closeModal() {
    setOpen(false);
    setShippingCode("");
    setLabelUrl("");
    setIsPreviewVisible(false);
    setIsPrintingLabel(false);
  }

  async function handlePrintLabel() {
    if (!shippingCode || isPrintingLabel) {
      return;
    }
    setIsPrintingLabel(true);
    try {
      await printLabel(shippingCode, { format: "PDF" });
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "No se pudo abrir la impresión");
    } finally {
      setIsPrintingLabel(false);
    }
  }

  async function handleSubmit(mode: SubmitMode) {
    setStatus("loading");
    setSubmitMode(mode);
    setError("");
    setLabelUrl("");

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
          weight_tier_code: weightTierCode,
          shipping_type_code: shippingTypeCode,
          shipping_rule_id: ruleResolution?.shipping_rule_id ?? undefined,
          shipping_rule_name: ruleResolution?.shipping_rule_name ?? undefined,
          detected_zone: ruleResolution?.zone_name ?? undefined,
          resolution_mode: manualServiceOverride ? "manual" : "automatic",
          item_count: Math.max(parseInt(itemCount, 10) || 1, 1),
        }),
      });

      if (!res.ok) {
        const body = (await res.json()) as { detail?: string };
        throw new Error(body.detail ?? "Error al crear el envío en CTT Express");
      }

      const { shipping_code, shopify_sync_status } = (await res.json()) as {
        shipping_code: string;
        shopify_sync_status?: string | null;
      };

      const nextLabelUrl = `/api/ctt/shippings/${shipping_code}/label`;

      setShippingCode(shipping_code);
      setLabelUrl(nextLabelUrl);
      setIsPreviewVisible(false);
      setShopifySyncStatus(shopify_sync_status || "");
      setStatus("success");

      try {
        const freshOrderRes = await fetch(`/api/orders/${order.id}`, { cache: "no-store" });
        if (freshOrderRes.ok) {
          const freshOrder = (await freshOrderRes.json()) as Order;
          onOrderUpdated?.(freshOrder);
        }
      } catch {
        // Best effort: keep success state even if post-refresh fails.
      }

      onShipmentCreated?.(shipping_code);

      if (mode === "print") {
        // Auto-print: trigger print dialog immediately after creation.
        try {
          await printLabel(shipping_code, { format: "PDF" });
        } catch {
          // Print failed silently — user can still click the print button
          // from the success screen.
        }
      } else {
        // "Preparar sin imprimir": label is ready in CTT's system and the
        // backend auto-marked the order as packed (see _mark_order_prepared).
        // Close the modal straight away so the user can move to the next
        // order, and nudge them toward the employee print queue.
        toast(
          `Pedido preparado · etiqueta en cola de impresión (${shipping_code})`,
          "success",
        );
        closeModal();
      }
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setSubmitMode(null);
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
      <div className="ctt-label-cell-actions">
        <button
          className={`button table-action ${hasShipmentAlready ? "button-secondary" : ""}`}
          onClick={openModal}
          title={
            hasShipmentAlready
              ? "Ver etiqueta CTT ya creada"
              : "Crear etiqueta y elegir entre preparar (sin imprimir) o imprimir ahora"
          }
          type="button"
        >
          {hasShipmentAlready ? "Ver etiqueta" : "Preparar"}
        </button>
      </div>

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
        subtitle={`${order.customer_name} · ${order.customer_email}`}
        title={`Envío · ${order.external_id}`}
        width="wide"
      >
            {status === "success" ? (
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
            ) : (
              <div className="stack">
                <div className="ctt-create-hero">
                  <div className="ctt-create-hero-copy">
                    <strong>Etiqueta lista para preparar</strong>
                    <p>Revisa estos datos y usa el botón fijo para lanzar la etiqueta sin tener que recorrer todo el modal.</p>
                  </div>
                  <div className="ctt-create-hero-metrics">
                    <span>{shippingTypeCode || "Sin servicio"}</span>
                    <span>{CTT_WEIGHT_BANDS.find((band) => band.code === weightTierCode)?.label ?? "Peso"}</span>
                    <span>{Math.max(parseInt(itemCount, 10) || 1, 1)} bulto(s)</span>
                  </div>
                </div>
                <div className="grid grid-2">
                  <div className="field">
                    <label htmlFor={`ctt-service-${order.id}`}>Servicio CTT</label>
                    <select
                      id={`ctt-service-${order.id}`}
                      onChange={(e) => {
                        const nextValue = e.target.value;
                        setShippingTypeCode(nextValue);
                        setManualServiceOverride(nextValue !== (ruleResolution?.carrier_service_code ?? nextValue));
                      }}
                      value={shippingTypeCode}
                    >
                      {CTT_SERVICE_OPTIONS.map((service) => (
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
                {isRefreshingOrder ? (
                  <div className="table-secondary">Actualizando datos del pedido...</div>
                ) : null}

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
                    <label htmlFor={`ctt-email-${order.id}`}>Email destinatario</label>
                    <input
                      id={`ctt-email-${order.id}`}
                      onChange={(e) => setRecipientEmail(e.target.value)}
                      type="email"
                      value={recipientEmail}
                    />
                  </div>
                </div>

                <div className="field">
                  <label htmlFor={`ctt-bultos-${order.id}`}>Bultos</label>
                  <input
                    id={`ctt-bultos-${order.id}`}
                    min="1"
                    onChange={(e) => setItemCount(e.target.value)}
                    type="number"
                    value={itemCount}
                  />
                </div>

                <div className="ctt-create-sticky-bar ctt-create-sticky-bar-split">
                  <div className="ctt-create-sticky-copy">
                    <strong>¿Preparar o imprimir ahora?</strong>
                    <span>
                      Servicio {shippingTypeCode || "pendiente"} · {Math.max(parseInt(itemCount, 10) || 1, 1)} bulto(s)
                    </span>
                  </div>
                  <div className="ctt-create-sticky-actions">
                    <button
                      className="button-secondary ctt-create-sticky-button"
                      disabled={isLoading || !canSubmit}
                      onClick={() => handleSubmit("prepare")}
                      title="Crea la etiqueta y marca el pedido como preparado. Aparecerá en tu cola de impresión para imprimirla junto al resto."
                      type="button"
                    >
                      {isLoading && submitMode === "prepare"
                        ? "Preparando..."
                        : "Preparar pedido"}
                    </button>
                    <button
                      className="button ctt-create-sticky-button"
                      disabled={isLoading || !canSubmit}
                      onClick={() => handleSubmit("print")}
                      title="Crea la etiqueta y envíala directamente a la impresora."
                      type="button"
                    >
                      {isLoading && submitMode === "print"
                        ? "Creando e imprimiendo..."
                        : "Imprimir etiqueta"}
                    </button>
                  </div>
                </div>

                {status === "error" ? (
                  <div className="feedback feedback-error">{error}</div>
                ) : null}
              </div>
            )}
      </AppModal>
    </>
  );
}
