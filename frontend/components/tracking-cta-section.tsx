"use client";

import { useEffect, useState } from "react";

import type { TrackingCTA } from "@/lib/tenant-branding";

const CTA_STORAGE_KEY = "brandeate_tracking_cta_v1";

type StoredCTAConfig = Record<string, TrackingCTA>; // keyed by shopSlug

type TrackingCTASectionProps = {
  shopSlug: string;
  shopName: string;
  accentColor: string;
  branding: TrackingCTA | null;
  isDelivered: boolean;
};

function CopyIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
      <rect height="13" rx="2" stroke="currentColor" strokeWidth="1.8" width="13" x="9" y="9" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
      <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
    </svg>
  );
}

export function TrackingCTASection({ shopSlug, shopName, accentColor, branding, isDelivered }: TrackingCTASectionProps) {
  const [config, setConfig] = useState<TrackingCTA | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Prefer localStorage config (set via portal settings), fall back to static branding
    try {
      const raw = localStorage.getItem(CTA_STORAGE_KEY);
      if (raw) {
        const store = JSON.parse(raw) as StoredCTAConfig;
        const local = store[shopSlug] ?? store["__default__"] ?? null;
        if (local) { setConfig(local); return; }
      }
    } catch { /* ignore */ }
    // Fall back to static branding from tenant-branding.ts
    if (branding) setConfig(branding);
  }, [shopSlug, branding]);

  if (!config) return null;
  const hasAnything = config.ctaUrl || config.discountCode || config.message;
  if (!hasAnything) return null;

  async function copyCode(code: string) {
    await navigator.clipboard.writeText(code).catch(() => null);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className="trk-cta-section" style={{ "--tracking-accent": accentColor } as React.CSSProperties}>
      {config.message && (
        <p className="trk-cta-message">{config.message}</p>
      )}

      {!config.message && isDelivered && (
        <p className="trk-cta-message">
          Gracias por tu compra en <strong>{shopName}</strong>. Esperamos verte pronto.
        </p>
      )}

      {config.ctaUrl && (
        <a
          className="trk-cta-btn"
          href={config.ctaUrl}
          rel="noreferrer"
          target="_blank"
        >
          {config.ctaLabel ?? "Volver a la tienda"} →
        </a>
      )}

      {config.discountCode && (
        <div className="trk-discount-block">
          <p className="trk-discount-text">
            {config.discountText ?? "Usa este código en tu próximo pedido"}
          </p>
          <div className="trk-discount-code-row">
            <code className="trk-discount-code">{config.discountCode}</code>
            <button
              className="trk-discount-copy"
              onClick={() => void copyCode(config.discountCode!)}
              type="button"
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
              {copied ? "Copiado" : "Copiar código"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
