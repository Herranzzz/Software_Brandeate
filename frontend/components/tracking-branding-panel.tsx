"use client";

import { useState, useTransition } from "react";

import { useToast } from "@/components/toast";
import type { TrackingConfig } from "@/lib/types";

async function saveTrackingConfig(shopId: number, config: TrackingConfig): Promise<void> {
  const res = await fetch(`/api/shops/${shopId}/tracking-config`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error("Error al guardar");
}


type Props = {
  shopId: number;
  shopName: string;
  initialConfig: TrackingConfig | null;
};

export function TrackingBrandingPanel({ shopId, shopName, initialConfig }: Props) {
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();

  const [logoUrl, setLogoUrl] = useState(initialConfig?.logo_url ?? "");
  const [accentColor, setAccentColor] = useState(initialConfig?.accent_color ?? "#ef4444");
  const [displayName, setDisplayName] = useState(initialConfig?.display_name ?? "");

  function handleSave() {
    startTransition(async () => {
      try {
        await saveTrackingConfig(shopId, {
          ...initialConfig,
          logo_url: logoUrl.trim() || undefined,
          accent_color: accentColor.trim() || undefined,
          display_name: displayName.trim() || undefined,
        });
        toast("Apariencia guardada", "success");
      } catch {
        toast("Error al guardar", "error");
      }
    });
  }

  return (
    <div className="trk-branding-panel">
      <div className="trk-branding-fields">
        <div className="field">
          <label htmlFor="trk-brand-name">Nombre de marca</label>
          <input
            id="trk-brand-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={shopName}
          />
          <small className="table-secondary">Se muestra en la cabecera de la página de tracking.</small>
        </div>

        <div className="field">
          <label htmlFor="trk-logo">Logo (URL)</label>
          <input
            id="trk-logo"
            type="url"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            placeholder="https://mi-tienda.com/logo.png"
          />
        </div>

        <div className="field">
          <label htmlFor="trk-color">Color de acento</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              id="trk-color"
              type="color"
              value={accentColor || "#ef4444"}
              onChange={(e) => setAccentColor(e.target.value)}
              style={{ width: 40, height: 34, padding: 2, border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer" }}
            />
            <input
              value={accentColor}
              onChange={(e) => setAccentColor(e.target.value)}
              placeholder="#ef4444"
              style={{ flex: 1 }}
            />
          </div>
          <small className="table-secondary">Color del botón y detalles de la página.</small>
        </div>
      </div>

      <button className="button" onClick={handleSave} disabled={isPending} type="button">
        {isPending ? "Guardando…" : "Guardar apariencia"}
      </button>
    </div>
  );
}
