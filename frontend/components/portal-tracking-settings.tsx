"use client";

import { useEffect, useState } from "react";

import type { TrackingCTA } from "@/lib/tenant-branding";

const CTA_STORAGE_KEY = "brandeate_tracking_cta_v1";
type StoredCTAConfig = Record<string, TrackingCTA>;

type PortalTrackingSettingsProps = {
  shopSlug: string;
  shopName: string;
  publicTrackingExample?: string | null;
};

function loadConfig(shopSlug: string): TrackingCTA {
  try {
    const raw = localStorage.getItem(CTA_STORAGE_KEY);
    if (raw) {
      const store = JSON.parse(raw) as StoredCTAConfig;
      return store[shopSlug] ?? {};
    }
  } catch { /* ignore */ }
  return {};
}

function saveConfig(shopSlug: string, config: TrackingCTA) {
  try {
    const raw = localStorage.getItem(CTA_STORAGE_KEY);
    const store: StoredCTAConfig = raw ? (JSON.parse(raw) as StoredCTAConfig) : {};
    store[shopSlug] = config;
    localStorage.setItem(CTA_STORAGE_KEY, JSON.stringify(store));
  } catch { /* ignore */ }
}

export function PortalTrackingSettings({ shopSlug, shopName, publicTrackingExample }: PortalTrackingSettingsProps) {
  const [ctaUrl, setCtaUrl] = useState("");
  const [ctaLabel, setCtaLabel] = useState("");
  const [discountCode, setDiscountCode] = useState("");
  const [discountText, setDiscountText] = useState("");
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const cfg = loadConfig(shopSlug);
    setCtaUrl(cfg.ctaUrl ?? "");
    setCtaLabel(cfg.ctaLabel ?? "");
    setDiscountCode(cfg.discountCode ?? "");
    setDiscountText(cfg.discountText ?? "");
    setMessage(cfg.message ?? "");
  }, [shopSlug]);

  function handleSave() {
    const config: TrackingCTA = {
      ctaUrl: ctaUrl.trim() || undefined,
      ctaLabel: ctaLabel.trim() || undefined,
      discountCode: discountCode.trim() || undefined,
      discountText: discountText.trim() || undefined,
      message: message.trim() || undefined,
    };
    saveConfig(shopSlug, config);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div className="stack">
      <div className="info-banner">
        Personaliza lo que ve tu cliente cuando consulta el estado de su envío. Esta configuración se almacena en tu navegador para previsualización — escríbenos a <strong>hola@brandeate.com</strong> para activarla en producción.
      </div>

      <div className="crm-form-grid">
        <div className="field">
          <label htmlFor="trk-cta-url">URL de tu tienda</label>
          <input
            id="trk-cta-url"
            onChange={(e) => setCtaUrl(e.target.value)}
            placeholder="https://mi-tienda.com"
            type="url"
            value={ctaUrl}
          />
          <small className="table-secondary">Botón "Volver a la tienda" al final del tracking.</small>
        </div>
        <div className="field">
          <label htmlFor="trk-cta-label">Texto del botón CTA</label>
          <input
            id="trk-cta-label"
            onChange={(e) => setCtaLabel(e.target.value)}
            placeholder="Volver a la tienda"
            value={ctaLabel}
          />
        </div>
        <div className="field">
          <label htmlFor="trk-discount-code">Código de descuento</label>
          <input
            id="trk-discount-code"
            onChange={(e) => setDiscountCode(e.target.value)}
            placeholder="GRACIAS10"
            value={discountCode}
          />
          <small className="table-secondary">Se muestra con botón de copiar para el cliente.</small>
        </div>
        <div className="field">
          <label htmlFor="trk-discount-text">Descripción del descuento</label>
          <input
            id="trk-discount-text"
            onChange={(e) => setDiscountText(e.target.value)}
            placeholder="10% de descuento en tu próximo pedido"
            value={discountText}
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor="trk-message">Mensaje personalizado</label>
        <input
          id="trk-message"
          onChange={(e) => setMessage(e.target.value)}
          placeholder={`Gracias por comprar en ${shopName}. ¡Esperamos verte pronto!`}
          value={message}
        />
        <small className="table-secondary">Aparece encima del botón CTA.</small>
      </div>

      <div className="actions-row">
        <button className="button" onClick={handleSave} type="button">
          {saved ? "✓ Guardado" : "Guardar configuración"}
        </button>
        {publicTrackingExample && (
          <a
            className="button-secondary"
            href={publicTrackingExample}
            rel="noreferrer"
            target="_blank"
          >
            Previsualizar tracking ↗
          </a>
        )}
      </div>

      {saved && (
        <div className="feedback feedback-success">
          Configuración guardada. Abre la página de tracking en este dispositivo para ver los cambios en tiempo real.
        </div>
      )}
    </div>
  );
}
