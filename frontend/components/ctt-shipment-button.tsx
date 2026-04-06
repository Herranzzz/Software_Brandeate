"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { AppModal } from "@/components/app-modal";
import {
  CTT_SERVICE_OPTIONS,
  CTT_WEIGHT_BANDS,
  getOrderShipmentLabelUrl,
  getInitialCttServiceCode,
  getInitialCttWeightBand,
  getOrderShippingContact,
} from "@/lib/ctt";
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
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [cttStatus, setCttStatus] = useState<CttStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [shippingCode, setShippingCode] = useState("");
  const [labelUrl, setLabelUrl] = useState("");
  const [shopifySyncStatus, setShopifySyncStatus] = useState("");
  const [isRefreshingOrder, setIsRefreshingOrder] = useState(false);

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
  }

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
    setOpen(true);
    void refreshOrderSnapshot();
  }

  async function handleCreateAndPrint() {
    setCttStatus("loading-shipping");
    setErrorMessage("");
    setShippingCode("");
    setLabelUrl("");

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
          weight_tier_code: weightTierCode,
          shipping_type_code: shippingTypeCode,
          shipping_rule_id: ruleResolution?.shipping_rule_id ?? undefined,
          shipping_rule_name: ruleResolution?.shipping_rule_name ?? undefined,
          detected_zone: ruleResolution?.zone_name ?? undefined,
          resolution_mode: manualServiceOverride ? "manual" : "automatic",
          item_count: parseInt(itemCount, 10) || 1,
        }),
      });

      if (!shippingRes.ok) {
        const err = (await shippingRes.json()) as { detail?: string };
        throw new Error(err.detail ?? "Error al crear el envío en CTT Express");
      }

      const { shipping_code, shopify_sync_status } = (await shippingRes.json()) as {
        shipping_code: string;
        shopify_sync_status?: string | null;
      };
      setShippingCode(shipping_code);
      setShopifySyncStatus(shopify_sync_status || "");

      setCttStatus("loading-label");
      setLabelUrl(`/api/ctt/shippings/${shipping_code}/label`);

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
                <div className="ctt-source-note">
                  <strong>Datos precargados desde Shopify</strong>
                  <span>
                    {recipientAddress || "Sin dirección"} · {recipientPostalCode || "Sin CP"} · {recipientTown || "Sin ciudad"}
                    {isRefreshingOrder ? " · Actualizando datos..." : ""}
                  </span>
                </div>
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
                  <div className="field field-span-2">
                    <label>Regla detectada</label>
                    <div className="ctt-resolution-banner">
                      <strong>
                        {ruleResolution?.matched
                          ? `${ruleResolution.zone_name ?? "Zona"} · ${ruleResolution.carrier_service_label ?? ruleResolution.carrier_service_code}`
                          : "Sin coincidencia automática"}
                      </strong>
                      <span>
                        {manualServiceOverride
                          ? "Servicio ajustado manualmente por operaciones."
                          : ruleResolution?.match_reason ?? "Se usará el servicio por defecto de la tienda."}
                      </span>
                    </div>
                  </div>
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
                  Envío creado correctamente.{shippingCode ? ` Código CTT: ${shippingCode}` : ""}
                </div>
                {shopifySyncStatus ? (
                  <div className={`feedback ${shopifySyncStatus === "synced" ? "feedback-success" : "feedback-error"}`}>
                    {shopifySyncStatus === "synced"
                      ? "Tracking sincronizado con Shopify."
                      : shopifySyncStatus === "failed"
                        ? "La etiqueta se creó, pero Shopify no se pudo actualizar."
                        : "La etiqueta se creó sin sincronización activa con Shopify."}
                  </div>
                ) : null}
                {labelUrl ? (
                  <div className="ctt-label-preview">
                    <div className="ctt-label-preview-head">
                      <div>
                        <strong>Etiqueta lista</strong>
                        <p>La vista previa se mantiene fija aquí hasta que cierres el modal.</p>
                      </div>
                      <a
                        className="button-secondary"
                        href={labelUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Abrir PDF individual
                      </a>
                    </div>
                    <iframe className="ctt-label-frame" src={labelUrl} title={`Etiqueta CTT ${shippingCode}`} />
                  </div>
                ) : null}
                <div className="modal-footer">
                  {shippingCode ? (
                    <>
                      <a
                        className="button-secondary"
                        href={existingDownloadUrl || `${labelUrl || `/api/ctt/shippings/${shippingCode}/label`}?download=1`}
                        download
                        rel="noreferrer"
                        target="_blank"
                      >
                        Descargar PDF térmico
                      </a>
                      <a
                        className="button-secondary"
                        href={existingThermalUrl || `/api/ctt/shippings/${shippingCode}/label?label_type=ZPL&model_type=SINGLE&download=1`}
                        download
                        rel="noreferrer"
                        target="_blank"
                      >
                        Descargar ZPL
                      </a>
                    </>
                  ) : null}
                  <button className="button-secondary" onClick={closeModal} type="button">
                    Cerrar
                  </button>
                </div>
              </div>
            )}
      </AppModal>
    </>
  );
}
