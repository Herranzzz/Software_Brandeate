"use client";

import { useState, useTransition } from "react";

import { useToast } from "@/components/toast";
import { updateShopTrackingConfig } from "@/lib/api";
import type { TrackingConfig } from "@/lib/types";

type PortalTrackingSettingsProps = {
  shopId: number;
  shopName: string;
  initialConfig: TrackingConfig | null;
  publicTrackingExample?: string | null;
};

export function PortalTrackingSettings({
  shopId,
  shopName,
  initialConfig,
  publicTrackingExample,
}: PortalTrackingSettingsProps) {
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();

  const [accentColor, setAccentColor] = useState(initialConfig?.accent_color ?? "");
  const [logoUrl, setLogoUrl] = useState(initialConfig?.logo_url ?? "");
  const [ctaUrl, setCtaUrl] = useState(initialConfig?.cta_url ?? "");
  const [ctaLabel, setCtaLabel] = useState(initialConfig?.cta_label ?? "");
  const [discountCode, setDiscountCode] = useState(initialConfig?.discount_code ?? "");
  const [discountText, setDiscountText] = useState(initialConfig?.discount_text ?? "");
  const [message, setMessage] = useState(initialConfig?.message ?? "");
  const [displayName, setDisplayName] = useState(initialConfig?.display_name ?? "");
  const [reviewUrl, setReviewUrl] = useState(initialConfig?.review_url ?? "");
  const [reviewLabel, setReviewLabel] = useState(initialConfig?.review_label ?? "");

  function handleSave() {
    startTransition(async () => {
      try {
        const config: TrackingConfig = {
          accent_color: accentColor.trim() || undefined,
          logo_url: logoUrl.trim() || undefined,
          cta_url: ctaUrl.trim() || undefined,
          cta_label: ctaLabel.trim() || undefined,
          discount_code: discountCode.trim() || undefined,
          discount_text: discountText.trim() || undefined,
          message: message.trim() || undefined,
          display_name: displayName.trim() || undefined,
          review_url: reviewUrl.trim() || undefined,
          review_label: reviewLabel.trim() || undefined,
        };
        await updateShopTrackingConfig(shopId, config);
        toast("Configuración de tracking guardada", "success");
      } catch (e) {
        toast(e instanceof Error ? e.message : "Error al guardar", "error");
      }
    });
  }

  return (
    <div className="stack">
      <div className="crm-form-grid">
        <div className="field">
          <label htmlFor="trk-display-name">Nombre de marca</label>
          <input
            id="trk-display-name"
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={shopName}
            value={displayName}
          />
          <small className="table-secondary">Se muestra en la cabecera del tracking en lugar del nombre de tienda.</small>
        </div>
        <div className="field">
          <label htmlFor="trk-accent-color">Color principal</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              id="trk-accent-color"
              type="color"
              value={accentColor || "#ef4444"}
              onChange={(e) => setAccentColor(e.target.value)}
              style={{ width: 40, height: 34, padding: 2, border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer" }}
            />
            <input
              onChange={(e) => setAccentColor(e.target.value)}
              placeholder="#ef4444"
              value={accentColor}
              style={{ flex: 1 }}
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="trk-logo-url">URL del logo</label>
          <input
            id="trk-logo-url"
            onChange={(e) => setLogoUrl(e.target.value)}
            placeholder="https://mi-tienda.com/logo.png"
            type="url"
            value={logoUrl}
          />
        </div>
        <div className="field">
          <label htmlFor="trk-cta-url">URL de tu tienda</label>
          <input
            id="trk-cta-url"
            onChange={(e) => setCtaUrl(e.target.value)}
            placeholder="https://mi-tienda.com"
            type="url"
            value={ctaUrl}
          />
          <small className="table-secondary">Botón &quot;Volver a la tienda&quot; al final del tracking.</small>
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

      {/* ── Reseñas ─────────────────────────────────────────── */}
      <div className="trk-settings-divider">
        <span>⭐ Solicitar reseña al entregar</span>
      </div>
      <p className="table-secondary" style={{ marginTop: -8 }}>
        Cuando el pedido esté entregado, se mostrará una pantalla pidiendo al cliente que deje una reseña.
      </p>
      <div className="crm-form-grid">
        <div className="field">
          <label htmlFor="trk-review-url">URL de reseñas</label>
          <input
            id="trk-review-url"
            onChange={(e) => setReviewUrl(e.target.value)}
            placeholder="https://g.page/r/tu-negocio/review"
            type="url"
            value={reviewUrl}
          />
          <small className="table-secondary">Google Reviews, Trustpilot, tu web… Deja vacío para no mostrar la pantalla de reseña.</small>
        </div>
        <div className="field">
          <label htmlFor="trk-review-label">Texto del botón de reseña</label>
          <input
            id="trk-review-label"
            onChange={(e) => setReviewLabel(e.target.value)}
            placeholder="Dejar reseña en Google"
            value={reviewLabel}
          />
          <small className="table-secondary">Por defecto: &quot;Dejar una reseña&quot;.</small>
        </div>
      </div>

      <div className="actions-row">
        <button className="button" onClick={handleSave} type="button" disabled={isPending}>
          {isPending ? "Guardando…" : "Guardar configuración"}
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
    </div>
  );
}
