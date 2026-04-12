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

  function handleToggle(carrier: CarrierInfo) {
    const current = isEnabled(carrier.code);
    startTransition(async () => {
      try {
        const updated = await upsertCarrierConfig({
          shop_id: shopId,
          carrier_code: carrier.code,
          is_enabled: !current,
        });
        setConfigs((prev) => {
          const existing = prev.find((c) => c.carrier_code === carrier.code);
          if (existing) return prev.map((c) => (c.carrier_code === carrier.code ? updated : c));
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

  if (loading) return <div className="carrier-empty">Cargando carriers…</div>;

  return (
    <div className="carrier-panel">
      {carriers.length === 0 && (
        <div className="carrier-empty">No hay carriers configurados en esta instalación.</div>
      )}
      {carriers.map((carrier) => {
        const enabled = isEnabled(carrier.code);
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
