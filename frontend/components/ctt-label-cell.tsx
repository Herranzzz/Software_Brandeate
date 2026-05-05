"use client";

import { useEffect, useRef, useState } from "react";

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
import { prefetchLabelBlob } from "@/lib/print-utils";
import type { Order, ShippingRuleResolution, Shop } from "@/lib/types";

type CttLabelCellProps = {
  order: Order;
  onShipmentCreated?: (trackingCode: string) => void;
  onOrderUpdated?: (order: Order) => void;
};

// confirm  → user reviews items + address before creating
// creating → API call in flight (can be backgrounded by closing the modal)
// success  → label created, print frame loading in background
// error    → creation failed, retry available
type Phase = "confirm" | "creating" | "success" | "error";

export function CttLabelCell({ order, onShipmentCreated, onOrderUpdated }: CttLabelCellProps) {
  const { toast } = useToast();
  const initialContact = getOrderShippingContact(order);
  const existingLabelUrl = getOrderShipmentLabelUrl(order);
  const existingDownloadUrl = getOrderShipmentLabelUrl(order, { download: true });
  const existingThermalUrl = getOrderShipmentLabelUrl(order, { download: true, labelType: "ZPL" });

  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("confirm");
  const [error, setError] = useState("");
  const [shippingCode, setShippingCode] = useState("");
  const [shopifySyncStatus, setShopifySyncStatus] = useState("");
  const [isRefreshingOrder, setIsRefreshingOrder] = useState(false);
  const [isPreviewVisible, setIsPreviewVisible] = useState(false);
  // Pre-fetched blob URL — popup opens instantly without a server round-trip.
  const printPdfUrlRef = useRef("");
  const [labelCached, setLabelCached] = useState(false);

  // In-flight prefetch abort controller.
  const prefetchAbortRef = useRef<AbortController | null>(null);

  // When the user closes the modal while "creating", the API call continues.
  const backgroundModeRef = useRef(false);

  // Form fields
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

  const hasShipmentAlready = Boolean(existingLabelUrl);

  // ── Prefetch + print ───────────────────────────────────────────────────
  //
  // Strategy: fetch the PDF blob in the background as soon as we know the
  // tracking code. When the user clicks "Imprimir etiqueta" we open a small
  // centered popup window (popup=1) with the pre-fetched blob URL so it
  // appears INSTANTLY — no server round-trip at click time.
  //
  // The popup shows Chrome's native PDF viewer (with its own Print button /
  // Ctrl+P). This is reliable across all Chrome versions and never requires
  // an async call inside the click handler.

  function cleanupPrefetch() {
    prefetchAbortRef.current?.abort();
    if (printPdfUrlRef.current) {
      URL.revokeObjectURL(printPdfUrlRef.current);
      printPdfUrlRef.current = "";
    }
    setLabelCached(false);
  }

  function startPrefetch(code: string) {
    prefetchAbortRef.current?.abort();
    const controller = new AbortController();
    prefetchAbortRef.current = controller;
    setLabelCached(false);
    prefetchLabelBlob(code, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        if (printPdfUrlRef.current) URL.revokeObjectURL(printPdfUrlRef.current);
        printPdfUrlRef.current = URL.createObjectURL(blob);
        setLabelCached(true);
      })
      .catch(() => {
        // Silent — handlePrintLabel falls back to the API URL.
      });
  }

  function handlePrintLabel() {
    const code = shippingCode || order.shipment?.tracking_number;
    if (!code) return;

    // Pre-fetched blob opens instantly; API URL fetches on demand.
    const pdfUrl = printPdfUrlRef.current || `/api/ctt/shippings/${code}/label`;

    // Open a small centered popup — feels modal-like, keeps the app page
    // intact. Chrome's PDF viewer inside the popup has its own Print button
    // (and responds to Ctrl+P), which opens Chrome's native print dialog.
    const pw = 640, ph = 880;
    const left = Math.max(0, Math.round((screen.width - pw) / 2));
    const top  = Math.max(0, Math.round((screen.height - ph) / 2));
    const popup = window.open(
      pdfUrl,
      `etiqueta_${code}`,
      `width=${pw},height=${ph},left=${left},top=${top},popup=1`,
    );

    // popup=null means the browser blocked it (very rare for direct clicks).
    // Fall back to a new tab so the user always gets something.
    if (!popup) window.open(pdfUrl, "_blank", "noopener");
  }

  // ── Form helpers ──────────────────────────────────────────────────────

  function syncFromOrder() {
    const c = getOrderShippingContact(order);
    setRecipientName(c.recipientName);
    setRecipientEmail(c.recipientEmail);
    setRecipientCountry(c.recipientCountry);
    setRecipientPostalCode(c.recipientPostalCode);
    setRecipientAddress(c.recipientAddress);
    setRecipientTown(c.recipientTown);
    setRecipientPhone(c.recipientPhone);
    setWeightTierCode(getInitialCttWeightBand(order));
    setShippingTypeCode(getInitialCttServiceCode(order));
    setItemCount(String(order.shipment?.package_count ?? 1));
    setRuleResolution(null);
    setManualServiceOverride(false);
  }

  async function refreshOrderSnapshot() {
    setIsRefreshingOrder(true);
    try {
      const [orderRes, shopRes] = await Promise.all([
        fetch(`/api/orders/${order.id}`, { cache: "no-store" }),
        fetch(`/api/shops/${order.shop_id}`, { cache: "no-store" }),
      ]);
      if (!orderRes.ok) return;
      const freshOrder = (await orderRes.json()) as Order;
      const freshShop = shopRes.ok ? ((await shopRes.json()) as Shop) : null;
      const c = getOrderShippingContact(freshOrder);
      setRecipientName(c.recipientName);
      setRecipientEmail(c.recipientEmail);
      setRecipientCountry(c.recipientCountry);
      setRecipientPostalCode(c.recipientPostalCode);
      setRecipientAddress(c.recipientAddress);
      setRecipientTown(c.recipientTown);
      setRecipientPhone(c.recipientPhone);
      setWeightTierCode(getInitialCttWeightBand(freshOrder, freshShop?.shipping_settings));
      setShippingTypeCode(getInitialCttServiceCode(freshOrder, freshShop?.shipping_settings));
      setItemCount(String(freshOrder.shipment?.package_count ?? 1));
    } catch {
      // Keep current snapshot on failure.
    } finally {
      setIsRefreshingOrder(false);
    }
  }

  useEffect(() => {
    if (!open || phase === "success" || phase === "creating") return;
    let cancelled = false;

    async function resolveRule() {
      try {
        const res = await fetch("/api/shipping-rules/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order_id: order.id, weight_tier_code: weightTierCode }),
        });
        if (!res.ok) return;
        const payload = (await res.json()) as ShippingRuleResolution;
        if (cancelled) return;
        setRuleResolution(payload);
        if (!manualServiceOverride && payload.carrier_service_code) {
          setShippingTypeCode(payload.carrier_service_code);
        }
      } catch {
        if (!cancelled) setRuleResolution(null);
      }
    }

    void resolveRule();
    return () => {
      cancelled = true;
    };
  }, [open, phase, order.id, weightTierCode, manualServiceOverride]);

  // ── Modal open / close ────────────────────────────────────────────────

  function openModal(e: React.MouseEvent) {
    e.stopPropagation();
    syncFromOrder();
    backgroundModeRef.current = false;
    cleanupPrefetch();
    setIsPreviewVisible(false);
    setError("");

    if (hasShipmentAlready) {
      const code = order.shipment?.tracking_number ?? "";
      setShippingCode(code);
      setShopifySyncStatus(order.shipment?.shopify_sync_status ?? "");
      setPhase("success");
      // Start fetching the PDF in the background so the popup opens instantly.
      if (code) startPrefetch(code);
    } else {
      setPhase("confirm");
    }

    setOpen(true);
    void refreshOrderSnapshot();
  }

  function closeModal() {
    if (phase === "creating") {
      backgroundModeRef.current = true;
    } else {
      cleanupPrefetch();
    }
    setOpen(false);
    setIsPreviewVisible(false);
  }

  // ── Label creation ────────────────────────────────────────────────────

  async function handleCreate(mode: "prepare" | "print") {
    setPhase("creating");
    backgroundModeRef.current = false;

    const body = {
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
    };

    try {
      const res = await fetch("/api/ctt/shippings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const b = (await res.json()) as { detail?: string };
        throw new Error(b.detail ?? "Error al crear el envío en CTT Express");
      }

      const { shipping_code, shopify_sync_status } = (await res.json()) as {
        shipping_code: string;
        shopify_sync_status?: string | null;
      };

      // Best-effort: refresh the order in the parent list.
      try {
        const freshRes = await fetch(`/api/orders/${order.id}`, { cache: "no-store" });
        if (freshRes.ok) onOrderUpdated?.((await freshRes.json()) as Order);
      } catch {
        // ignore
      }
      onShipmentCreated?.(shipping_code);

      if (backgroundModeRef.current) {
        toast(
          mode === "prepare"
            ? `Etiqueta preparada · ${shipping_code} · añadida a la cola`
            : `Etiqueta creada · ${shipping_code}`,
          "success",
        );
        return;
      }

      setShippingCode(shipping_code);
      setShopifySyncStatus(shopify_sync_status || "");
      setPhase("success");

      if (mode === "prepare") {
        toast(`Pedido preparado · etiqueta en cola de impresión (${shipping_code})`, "success");
        closeModal();
      } else {
        // Pre-fetch the PDF so the print popup opens instantly on click.
        startPrefetch(shipping_code);
      }
    } catch (err) {
      if (backgroundModeRef.current) {
        toast(
          `Error creando etiqueta: ${err instanceof Error ? err.message : "Error desconocido"}`,
          "error",
        );
        return;
      }
      setPhase("error");
      setError(err instanceof Error ? err.message : "Error desconocido");
    }
  }

  // ── Derived values ────────────────────────────────────────────────────

  const canSubmit =
    recipientName.trim() !== "" &&
    recipientPostalCode.trim() !== "" &&
    recipientAddress.trim() !== "" &&
    recipientTown.trim() !== "" &&
    recipientPhone.trim() !== "" &&
    weightTierCode.trim() !== "" &&
    shippingTypeCode.trim() !== "";

  const weightLabel = CTT_WEIGHT_BANDS.find((b) => b.code === weightTierCode)?.label ?? "Peso";
  const bultos = Math.max(parseInt(itemCount, 10) || 1, 1);
  const activeCode = shippingCode || order.shipment?.tracking_number || "";

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <>
      <div className="ctt-label-cell-actions">
        <button
          className={`button table-action ${hasShipmentAlready ? "button-secondary" : ""}`}
          onClick={openModal}
          title={
            hasShipmentAlready
              ? "Ver etiqueta CTT ya creada"
              : "Revisar pedido y crear etiqueta CTT"
          }
          type="button"
        >
          {hasShipmentAlready ? "Ver etiqueta" : "Preparar"}
        </button>
      </div>

      <AppModal
        actions={
          <button className="button-secondary" onClick={closeModal} type="button">
            {phase === "creating" ? "Cerrar · seguir en fondo" : "Cerrar"}
          </button>
        }
        bodyClassName="ctt-modal-body"
        eyebrow="CTT Express"
        onClose={closeModal}
        open={open}
        subtitle={`${order.customer_name} · ${order.customer_email}`}
        title={`Envío · ${order.external_id}`}
        width="wide"
      >
        {/* ── SUCCESS ── */}
        {phase === "success" && (
          <div className="stack">
            <div className="ctt-label-hero">
              <div className="ctt-label-hero-main">
                <div>
                  <strong>Envío creado</strong>
                  <p>
                    {shopifySyncStatus === "synced" ? "Shopify sincronizado · " : ""}
                    {activeCode}
                  </p>
                </div>
                <span className="ctt-label-code-pill">{activeCode}</span>
              </div>
            </div>

            <div className="ctt-label-actions-grid">
              <button
                className="button ctt-print-big"
                onClick={handlePrintLabel}
                type="button"
              >
                {labelCached ? "Imprimir etiqueta ⚡" : "Imprimir etiqueta"}
              </button>
              <a
                className="button-secondary ctt-download-btn"
                download
                href={
                  existingDownloadUrl ||
                  `/api/ctt/shippings/${activeCode}/label?download=1`
                }
                rel="noreferrer"
                target="_blank"
              >
                Descargar PDF
              </a>
            </div>

            <div className="ctt-label-extras">
              <a
                className="button-link"
                download
                href={
                  existingThermalUrl ||
                  `/api/ctt/shippings/${activeCode}/label?label_type=ZPL&model_type=SINGLE&download=1`
                }
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

            {isPreviewVisible && activeCode ? (
              <iframe
                className="ctt-label-frame"
                src={`/api/ctt/shippings/${activeCode}/label`}
                title={`Etiqueta CTT ${activeCode}`}
              />
            ) : null}
          </div>
        )}

        {/* ── CREATING ── */}
        {phase === "creating" && (
          <div className="ctt-creating-state">
            <div className="ctt-creating-spinner" />
            <strong>Creando etiqueta CTT...</strong>
            <p>
              Comunicando con CTT Express. Puedes cerrar esta ventana y seguir trabajando — te
              avisaremos cuando esté lista.
            </p>
          </div>
        )}

        {/* ── ERROR ── */}
        {phase === "error" && (
          <div className="stack">
            <div className="feedback feedback-error">{error}</div>
            <button
              className="button-secondary"
              onClick={() => setPhase("confirm")}
              type="button"
            >
              Volver a intentar
            </button>
          </div>
        )}

        {/* ── CONFIRM ── */}
        {phase === "confirm" && (
          <div className="stack">
            {/* Items list */}
            <div className="ctt-confirm-items">
              <div className="ctt-confirm-items-header">
                <strong>Artículos del pedido</strong>
                <span className="table-secondary">
                  {order.items.length} línea{order.items.length !== 1 ? "s" : ""}
                </span>
              </div>
              <ul className="ctt-confirm-items-list">
                {order.items.map((item) => (
                  <li className="ctt-confirm-item" key={item.id}>
                    <span className="ctt-confirm-item-check">✓</span>
                    <span className="ctt-confirm-item-name">
                      {item.name}
                      {item.variant_title ? ` · ${item.variant_title}` : ""}
                    </span>
                    <span className="ctt-confirm-item-qty">× {item.quantity}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Address summary */}
            <div className="ctt-confirm-address">
              <strong>Destino{isRefreshingOrder ? " · actualizando..." : ""}</strong>
              <p>
                {recipientName}
                <br />
                {recipientAddress}
                <br />
                {recipientPostalCode} {recipientTown}
                <br />
                {recipientPhone}
              </p>
            </div>

            {/* Config summary pills */}
            <div className="ctt-create-hero-metrics">
              <span>{shippingTypeCode || "Sin servicio"}</span>
              <span>{weightLabel}</span>
              <span>
                {bultos} bulto{bultos !== 1 ? "s" : ""}
              </span>
            </div>

            {/* Collapsible edit section */}
            <details className="ctt-edit-details">
              <summary className="ctt-edit-summary">Editar datos de envío</summary>
              <div className="stack ctt-edit-fields">
                <div className="grid grid-2">
                  <div className="field">
                    <label htmlFor={`ctt-service-${order.id}`}>Servicio CTT</label>
                    <select
                      id={`ctt-service-${order.id}`}
                      onChange={(e) => {
                        const v = e.target.value;
                        setShippingTypeCode(v);
                        setManualServiceOverride(
                          v !== (ruleResolution?.carrier_service_code ?? v),
                        );
                      }}
                      value={shippingTypeCode}
                    >
                      {CTT_SERVICE_OPTIONS.map((s) => (
                        <option key={s.code} value={s.code}>
                          {s.label}
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
                    <label htmlFor={`ctt-email-${order.id}`}>Email destinatario</label>
                    <input
                      id={`ctt-email-${order.id}`}
                      onChange={(e) => setRecipientEmail(e.target.value)}
                      type="email"
                      value={recipientEmail}
                    />
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
                </div>
              </div>
            </details>

            {/* Sticky action bar */}
            <div className="ctt-create-sticky-bar ctt-create-sticky-bar-split">
              <div className="ctt-create-sticky-copy">
                <strong>¿Todo correcto?</strong>
                <span>Revisa artículos y destino antes de crear la etiqueta</span>
              </div>
              <div className="ctt-create-sticky-actions">
                <button
                  className="button-secondary ctt-create-sticky-button"
                  disabled={!canSubmit}
                  onClick={() => handleCreate("prepare")}
                  title="Crea la etiqueta y añade el pedido a la cola de impresión"
                  type="button"
                >
                  Solo preparar
                </button>
                <button
                  className="button ctt-create-sticky-button"
                  disabled={!canSubmit}
                  onClick={() => handleCreate("print")}
                  title="Crea la etiqueta para imprimirla a continuación"
                  type="button"
                >
                  Imprimir etiqueta
                </button>
              </div>
            </div>
          </div>
        )}
      </AppModal>
    </>
  );
}
