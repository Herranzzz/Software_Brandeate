"use client";

import { useEffect, useState } from "react";

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


type CttLabelCellProps = {
  order: Order;
  onShipmentCreated?: (trackingCode: string) => void;
};

type Status = "idle" | "loading" | "success" | "error";

export function CttLabelCell({ order, onShipmentCreated }: CttLabelCellProps) {
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
    setOpen(true);
    setShopifySyncStatus(hasExistingLabel ? order.shipment?.shopify_sync_status ?? "" : "");
    void refreshOrderSnapshot();
  }

  function closeModal() {
    setOpen(false);
    setShippingCode("");
    setLabelUrl("");
  }

  async function handleSubmit() {
    setStatus("loading");
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
      setShopifySyncStatus(shopify_sync_status || "");
      setStatus("success");
      onShipmentCreated?.(shipping_code);
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
    weightTierCode.trim() !== "" &&
    shippingTypeCode.trim() !== "";

  return (
    <>
      <button
        className="button-secondary table-action"
        onClick={openModal}
        title={existingLabelUrl ? "Ver etiqueta CTT disponible" : "Crear envío CTT Express y descargar etiqueta"}
        type="button"
      >
        {existingLabelUrl ? "Ver etiqueta CTT" : "CTT etiqueta"}
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
        subtitle={`${order.customer_name} · ${order.customer_email}`}
        title={`Envío · ${order.external_id}`}
        width="wide"
      >
            {status === "success" ? (
              <div className="stack">
                <div className="feedback feedback-success">
                  Envío creado correctamente.{shippingCode ? ` Código: ${shippingCode}` : ""}
                </div>
                {shopifySyncStatus ? (
                  <div className={`feedback ${shopifySyncStatus === "synced" ? "feedback-success" : "feedback-error"}`}>
                    {shopifySyncStatus === "synced"
                      ? "Tracking enviado también a Shopify."
                      : shopifySyncStatus === "failed"
                        ? "La etiqueta se creó, pero Shopify no se pudo actualizar automáticamente."
                        : "La etiqueta se creó sin sincronización activa con Shopify."}
                  </div>
                ) : null}
                {labelUrl ? (
                  <div className="ctt-label-preview">
                    <div className="ctt-label-preview-head">
                      <div>
                        <strong>Etiqueta lista</strong>
                        <p>La etiqueta se muestra aquí para evitar bloqueos del navegador.</p>
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
                {shippingCode ? (
                  <div className="modal-footer">
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
                    <button className="button-secondary" onClick={closeModal} type="button">
                      Cerrar
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="stack">
                <div className="ctt-source-note">
                  <strong>Datos precargados desde Shopify</strong>
                  <span>
                    {recipientAddress || "Sin dirección"} · {recipientPostalCode || "Sin CP"} · {recipientTown || "Sin ciudad"}
                    {isRefreshingOrder ? " · Actualizando datos..." : ""}
                  </span>
                </div>
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

                <div className="modal-footer">
                  <button
                    className="button"
                    disabled={isLoading || !canSubmit}
                    onClick={handleSubmit}
                    type="button"
                  >
                    {isLoading ? "Creando envío..." : "Crear envío y mostrar etiqueta"}
                  </button>
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
