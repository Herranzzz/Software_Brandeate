"use client";

import { useEffect, useState, useTransition } from "react";

import { useToast } from "@/components/toast";
import { fetchAvailableCarriers, fetchCarrierConfigs, upsertCarrierConfig } from "@/lib/api";
import type { CarrierConfig, CarrierInfo } from "@/lib/types";


type Props = {
  shopId: number;
};

export function ShopifyTrackingLinkPanel({ shopId }: Props) {
  const { toast } = useToast();
  const [, startTransition] = useTransition();

  const [carriers, setCarriers] = useState<CarrierInfo[]>([]);
  const [configs, setConfigs] = useState<CarrierConfig[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchAvailableCarriers(), fetchCarrierConfigs(shopId)])
      .then(([c, cfgs]) => {
        setCarriers(c.filter((car) => car.supports_tracking));
        setConfigs(cfgs);
      })
      .catch(() => toast("Error cargando configuración de tracking", "error"))
      .finally(() => setLoading(false));
  }, [shopId, toast]);

  function usesBranded(code: string): boolean {
    const cfg = configs.find((c) => c.carrier_code === code);
    return Boolean(cfg?.config_json && (cfg.config_json as Record<string, unknown>).use_branded_tracking_link === true);
  }

  function handleToggle(carrier: CarrierInfo, wantBranded: boolean) {
    const existing = configs.find((c) => c.carrier_code === carrier.code);
    const prevJson = (existing?.config_json as Record<string, unknown> | null | undefined) ?? {};
    startTransition(async () => {
      try {
        const updated = await upsertCarrierConfig({
          shop_id: shopId,
          carrier_code: carrier.code,
          is_enabled: existing?.is_enabled ?? true,
          config_json: { ...prevJson, use_branded_tracking_link: wantBranded },
        });
        setConfigs((prev) => {
          const exists = prev.find((c) => c.carrier_code === carrier.code);
          return exists
            ? prev.map((c) => (c.carrier_code === carrier.code ? updated : c))
            : [...prev, updated];
        });
        toast(
          wantBranded
            ? `${carrier.name}: el cliente verá el tracking de Brandeate`
            : `${carrier.name}: el cliente verá el tracking del transportista`,
          "success",
        );
      } catch {
        toast("Error al guardar", "error");
      }
    });
  }

  if (loading) {
    return <p className="muted">Cargando…</p>;
  }

  if (carriers.length === 0) {
    return <p className="muted">No hay transportistas con tracking disponibles.</p>;
  }

  return (
    <div className="trk-link-panel">
      <p className="table-secondary" style={{ marginBottom: 16 }}>
        Elige qué enlace se envía a Shopify cuando se crea la etiqueta. Shopify lo incluye en
        el email de envío que recibe el cliente.
      </p>

      {carriers.map((carrier) => {
        const branded = usesBranded(carrier.code);
        return (
          <div key={carrier.code} className="trk-link-row">
            <div className="trk-link-carrier-name">{carrier.name}</div>

            <div className="trk-link-options">
              {/* Opción: transportista nativo */}
              <button
                type="button"
                className={`trk-link-option ${!branded ? "trk-link-option-active" : ""}`}
                onClick={() => { if (branded) handleToggle(carrier, false); }}
                disabled={!branded}
                title="El cliente hace clic en el tracking del propio transportista (CTT, DHL…)"
              >
                <span className="trk-link-option-icon">🚚</span>
                <span className="trk-link-option-label">
                  Transportista
                  <small>Link nativo del carrier</small>
                </span>
                {!branded && <span className="trk-link-option-check">✓</span>}
              </button>

              {/* Opción: Brandeate */}
              <button
                type="button"
                className={`trk-link-option ${branded ? "trk-link-option-active" : ""}`}
                onClick={() => { if (!branded) handleToggle(carrier, true); }}
                disabled={branded}
                title="El cliente ve tu página de tracking personalizada con tu logo y colores"
              >
                <span className="trk-link-option-icon">✨</span>
                <span className="trk-link-option-label">
                  Brandeate
                  <small>Tu página de tracking personalizada</small>
                </span>
                {branded && <span className="trk-link-option-check">✓</span>}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
