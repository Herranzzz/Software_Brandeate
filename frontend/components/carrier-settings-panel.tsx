"use client";

import { useEffect, useState, useTransition } from "react";
import { useToast } from "@/components/toast";
import { fetchAvailableCarriers, fetchCarrierConfigs, upsertCarrierConfig } from "@/lib/api";
import type { CarrierInfo, CarrierConfig } from "@/lib/types";

type CarrierSettingsPanelProps = {
  shopId: number;
};

export function CarrierSettingsPanel({ shopId }: CarrierSettingsPanelProps) {
  const { toast } = useToast();
  const [carriers, setCarriers] = useState<CarrierInfo[]>([]);
  const [configs, setConfigs] = useState<CarrierConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    Promise.all([fetchAvailableCarriers(), fetchCarrierConfigs(shopId)])
      .then(([available, configured]) => {
        setCarriers(available);
        setConfigs(configured);
      })
      .catch(() => toast("Error cargando configuración de carriers", "error"))
      .finally(() => setLoading(false));
  }, [shopId, toast]);

  function isEnabled(code: string): boolean {
    const cfg = configs.find((c) => c.carrier_code === code);
    // Default: enabled if no config record (CTT is always on by default)
    return cfg ? cfg.is_enabled : true;
  }

  function usesBrandedTracking(code: string): boolean {
    const cfg = configs.find((c) => c.carrier_code === code);
    return Boolean(
      cfg &&
        cfg.config_json &&
        (cfg.config_json as Record<string, unknown>).use_branded_tracking_link === true,
    );
  }

  function handleToggle(carrier: CarrierInfo) {
    const current = isEnabled(carrier.code);
    const existing = configs.find((c) => c.carrier_code === carrier.code);
    startTransition(async () => {
      try {
        const updated = await upsertCarrierConfig({
          shop_id: shopId,
          carrier_code: carrier.code,
          is_enabled: !current,
          // Preserve any existing config_json so toggling the enable
          // switch doesn't wipe the branded-tracking flag.
          config_json: existing?.config_json ?? null,
        });
        setConfigs((prev) => {
          const existingIdx = prev.find((c) => c.carrier_code === carrier.code);
          if (existingIdx) return prev.map((c) => (c.carrier_code === carrier.code ? updated : c));
          return [...prev, updated];
        });
        toast(
          !current ? `${carrier.name} activado` : `${carrier.name} desactivado`,
          "info",
        );
      } catch {
        toast("Error al actualizar carrier", "error");
      }
    });
  }

  function handleToggleBrandedTracking(carrier: CarrierInfo) {
    const current = usesBrandedTracking(carrier.code);
    const existing = configs.find((c) => c.carrier_code === carrier.code);
    const prevConfig = (existing?.config_json as Record<string, unknown> | null | undefined) ?? {};
    startTransition(async () => {
      try {
        const updated = await upsertCarrierConfig({
          shop_id: shopId,
          carrier_code: carrier.code,
          is_enabled: existing?.is_enabled ?? true,
          config_json: { ...prevConfig, use_branded_tracking_link: !current },
        });
        setConfigs((prev) => {
          const existingIdx = prev.find((c) => c.carrier_code === carrier.code);
          if (existingIdx) return prev.map((c) => (c.carrier_code === carrier.code ? updated : c));
          return [...prev, updated];
        });
        toast(
          !current
            ? `${carrier.name}: enviando enlace de tracking de Brandeate a Shopify`
            : `${carrier.name}: enviando enlace nativo del transportista a Shopify`,
          "info",
        );
      } catch {
        toast("Error al actualizar el enlace de tracking", "error");
      }
    });
  }

  if (loading) return <div className="carrier-empty">Cargando carriers…</div>;

  return (
    <div className="carrier-panel">
      {carriers.length === 0 && (
        <div className="carrier-empty">No hay carriers configurados en esta instalación.</div>
      )}
      {carriers.map((carrier) => {
        const enabled = isEnabled(carrier.code);
        const branded = usesBrandedTracking(carrier.code);
        return (
          <div key={carrier.code} className="carrier-row">
            <div className="carrier-row-info">
              <div className="carrier-name">{carrier.name}</div>
              <div className="carrier-caps">
                {carrier.supports_label_creation && (
                  <span className="carrier-cap-tag">Etiquetas</span>
                )}
                {carrier.supports_tracking && (
                  <span className="carrier-cap-tag">Tracking</span>
                )}
                {carrier.supports_live_rates && (
                  <span className="carrier-cap-tag">Tarifas en tiempo real</span>
                )}
              </div>
              {enabled && carrier.supports_tracking ? (
                <div className="carrier-tracking-link-choice">
                  <span className="carrier-tracking-link-label">
                    Enlace de tracking en Shopify:
                  </span>
                  <button
                    className={`button-small ${branded ? "button-secondary" : "button"}`}
                    type="button"
                    disabled={isPending || branded === false}
                    onClick={() => {
                      if (branded) handleToggleBrandedTracking(carrier);
                    }}
                    title="Usa el enlace nativo del transportista. Es lo que Shopify mostrará al cliente en el email de envío."
                  >
                    Nativo del transportista
                  </button>
                  <button
                    className={`button-small ${branded ? "button" : "button-secondary"}`}
                    type="button"
                    disabled={isPending || branded === true}
                    onClick={() => {
                      if (!branded) handleToggleBrandedTracking(carrier);
                    }}
                    title="Usa la página de tracking de Brandeate. El cliente aterriza en tu web con tu branding."
                  >
                    Brandeate
                  </button>
                </div>
              ) : null}
            </div>
            <div className="carrier-row-actions">
              <span className={`carrier-status ${enabled ? "carrier-active" : "carrier-inactive"}`}>
                {enabled ? "Activo" : "Inactivo"}
              </span>
              <button
                className="button-small button-secondary"
                type="button"
                disabled={isPending}
                onClick={() => handleToggle(carrier)}
              >
                {enabled ? "Desactivar" : "Activar"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
