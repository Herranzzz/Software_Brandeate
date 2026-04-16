"use client";

import { useState, useTransition } from "react";
import { useToast } from "@/components/toast";
import type { ShopMarketingConfig } from "@/lib/types";

async function saveMarketingConfig(shopId: number, config: ShopMarketingConfig): Promise<void> {
  const res = await fetch(`/api/shops/${shopId}/marketing-config`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error("Error al guardar");
}

type Props = {
  shopId: number;
  shopName: string;
  initialConfig: ShopMarketingConfig | null;
};

export function MarketingConfigPanel({ shopId, shopName, initialConfig }: Props) {
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();

  const [ga4Id, setGa4Id] = useState(initialConfig?.ga4_measurement_id ?? "");
  const [metaPixelId, setMetaPixelId] = useState(initialConfig?.meta_pixel_id ?? "");
  const [tiktokPixelId, setTiktokPixelId] = useState(initialConfig?.tiktok_pixel_id ?? "");
  const [gtmId, setGtmId] = useState(initialConfig?.gtm_container_id ?? "");

  function handleSave() {
    startTransition(async () => {
      try {
        await saveMarketingConfig(shopId, {
          ga4_measurement_id: ga4Id.trim() || null,
          meta_pixel_id: metaPixelId.trim() || null,
          tiktok_pixel_id: tiktokPixelId.trim() || null,
          gtm_container_id: gtmId.trim() || null,
        });
        toast({ title: "Configuración guardada", description: `${shopName} actualizado` });
      } catch {
        toast({ title: "Error al guardar", variant: "destructive" });
      }
    });
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <p className="subtitle" style={{ marginBottom: 4 }}>
        Los píxeles se inyectan automáticamente en la página de tracking pública de cada pedido.
      </p>

      <div className="form-field">
        <label className="form-label">Google Analytics 4 — Measurement ID</label>
        <input
          className="input"
          placeholder="G-XXXXXXXXXX"
          value={ga4Id}
          onChange={(e) => setGa4Id(e.target.value)}
        />
        <span className="form-hint">Empieza por G-</span>
      </div>

      <div className="form-field">
        <label className="form-label">Meta Pixel ID</label>
        <input
          className="input"
          placeholder="1234567890123456"
          value={metaPixelId}
          onChange={(e) => setMetaPixelId(e.target.value)}
        />
        <span className="form-hint">ID numérico del Pixel de Meta / Facebook</span>
      </div>

      <div className="form-field">
        <label className="form-label">TikTok Pixel ID</label>
        <input
          className="input"
          placeholder="CXXXXXXXXXXXXXXXXXX"
          value={tiktokPixelId}
          onChange={(e) => setTiktokPixelId(e.target.value)}
        />
        <span className="form-hint">ID del píxel de TikTok Ads</span>
      </div>

      <div className="form-field">
        <label className="form-label">Google Tag Manager — Container ID</label>
        <input
          className="input"
          placeholder="GTM-XXXXXXX"
          value={gtmId}
          onChange={(e) => setGtmId(e.target.value)}
        />
        <span className="form-hint">Alternativa a GA4 directo si usas GTM</span>
      </div>

      <button className="button" disabled={isPending} onClick={handleSave} type="button">
        {isPending ? "Guardando…" : "Guardar píxeles"}
      </button>
    </div>
  );
}
