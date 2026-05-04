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

// ─── Hidden iframe pre-loader ──────────────────────────────────────────────
//
// Chrome blocks window.print() unless it is called synchronously within a
// user-gesture handler (click, keypress). Any await or setTimeout in between
// breaks the gesture context and print() is silently ignored.
//
// Fix: build the print iframe *before* the user clicks "Imprimir etiqueta"
// (while the label is being fetched / after creation). When the user clicks we
// call iframe.contentWindow.print() synchronously — no awaits, no timers.
//
// The PDF blob URL is embedded in a same-origin HTML wrapper so that
// contentWindow is accessible (loading the PDF blob directly makes Chrome
// hand the iframe off to its PDF-viewer extension, which runs cross-origin).

function buildPrintHtml(pdfBlobUrl: string): string {
  return (
    "<!DOCTYPE html><html><head><style>" +
    "*{margin:0;padding:0}html,body{width:100%;height:100%;overflow:hidden}" +
    "embed{display:block;width:100%;height:100%;border:0}" +
    "</style></head><body>" +
    `<embed src="${pdfBlobUrl}" type="application/pdf">` +
    "</body></html>"
  );
}

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
  // Pre-loaded print iframe — ready for a synchronous win.print() call.
  const printFrameRef = useRef<HTMLIFrameElement | null>(null);
  const printPdfUrlRef = useRef("");
  const printHtmlUrlRef = useRef("");
  const [printReady, setPrintReady] = useState(false);
  // Cancelled flag used inside the 1-second iframe-ready timeout so we don't
  // call setPrintReady on a component that has already cleaned up.
  const printSetupCancelledRef = useRef(false);

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

  // ── Print frame lifecycle ──────────────────────────────────────────────

  function cleanupPrintFrame() {
    printSetupCancelledRef.current = true;
    if (printFrameRef.current?.parentNode) {
      printFrameRef.current.parentNode.removeChild(printFrameRef.current);
    }
    printFrameRef.current = null;
    if (printPdfUrlRef.current) URL.revokeObjectURL(printPdfUrlRef.current);
    if (printHtmlUrlRef.current) URL.revokeObjectURL(printHtmlUrlRef.current);
    printPdfUrlRef.current = "";
    printHtmlUrlRef.current = "";
    setPrintReady(false);
  }

  function setupPrintFrame(blob: Blob) {
    cleanupPrintFrame();
    printSetupCancelledRef.current = false;

    const pdfUrl = URL.createObjectURL(blob);
    printPdfUrlRef.current = pdfUrl;

    const htmlBlob = new Blob([buildPrintHtml(pdfUrl)], { type: "text/html" });
    const htmlUrl = URL.createObjectURL(htmlBlob);
    printHtmlUrlRef.current = htmlUrl;

    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText =
      "position:fixed;right:-99999px;bottom:-99999px;" +
      "width:595px;height:842px;border:0;visibility:hidden;pointer-events:none;";

    iframe.addEventListener(
      "load",
      () => {
        // Give the <embed> 1 second to render the PDF before marking ready.
        window.setTimeout(() => {
          if (printSetupCancelledRef.current) return;
          printFrameRef.current = iframe;
          setPrintReady(true);
        }, 1000);
      },
      { once: true },
    );

    document.body.appendChild(iframe);
    iframe.src = htmlUrl;
  }

  // ── Print action — always synchronous inside the click handler ──────────
  //
  // Chrome blocks window.print() if called after any await/setTimeout — the
  // user gesture context is lost. Both paths here are synchronous:
  //   Fast path: pre-loaded hidden iframe → iframe.contentWindow.print()
  //   Fallback:  window.open(pdfUrl, '_blank') — always allowed in a click handler

  function handlePrintLabel() {
    const code = shippingCode || order.shipment?.tracking_number;
    if (!code) return;

    // Fast path: iframe pre-loaded and ready.
    if (printReady && printFrameRef.current?.contentWindow) {
      const win = printFrameRef.current.contentWindow;
      win.addEventListener("afterprint", () => { window.setTimeout(cleanupPrintFrame, 500); }, { once: true });
      try {
        win.print();
        return;
      } catch {
        cleanupPrintFrame();
        // Fall through to window.open below.
      }
    }

    // Reliable fallback: open PDF in a new tab (synchronous, never blocked by Chrome).
    // If the blob was pre-fetched it opens instantly; otherwise the browser fetches it.
    const url = printPdfUrlRef.current || `/api/ctt/shippings/${code}/label`;
    window.open(url, "_blank", "noopener");
  }

  // ── Prefetch helper shared by new label (mode=print) and existing label ─

  function startPrefetch(code: string) {
    prefetchAbortRef.current?.abort();
    const controller = new AbortController();
    prefetchAbortRef.current = controller;
    prefetchLabelBlob(code, controller.signal)
      .then((blob) => {
        if (!controller.signal.aborted) {
          setupPrintFrame(blob);
        }
      })
      .catch(() => {
        // Prefetch failure is silent — slow path in handlePrintLabel will handle it.
      });
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
    cleanupPrintFrame();
    setIsPreviewVisible(false);
    setError("");

    if (hasShipmentAlready) {
      const code = order.shipment?.tracking_number ?? "";
      setShippingCode(code);
      setShopifySyncStatus(order.shipment?.shopify_sync_status ?? "");
      setPhase("success");
      // Start prefetching the PDF so the print frame is ready by the time
      // the user clicks "Imprimir etiqueta".
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
      prefetchAbortRef.current?.abort();
      cleanupPrintFrame();
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
        // Start pre-loading the print iframe — by the time the user reads
        // the success screen and clicks "Imprimir", the frame will be ready.
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
                {printReady ? "Imprimir etiqueta ·" : "Imprimir etiqueta"}
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
