"use client";

import { useEffect, useState, useTransition } from "react";

import { useToast } from "@/components/toast";
import type { CarrierConfig, CarrierInfo } from "@/lib/types";


// These fetch via Next.js proxy routes so the server cookie is forwarded
async function fetchCarriersViaProxy(): Promise<CarrierInfo[]> {
  const res = await fetch("/api/carrier-configs/available", { cache: "no-store" });
  if (!res.ok) throw new Error("Error cargando carriers");
  return res.json() as Promise<CarrierInfo[]>;
}

async function fetchConfigsViaProxy(shopId: number): Promise<CarrierConfig[]> {
  const res = await fetch(`/api/carrier-configs?shop_id=${shopId}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Error cargando configuración");
  return res.json() as Promise<CarrierConfig[]>;
}

async function upsertConfigViaProxy(body: {
  shop_id: number;
  carrier_code: string;
  is_enabled: boolean;
  config_json?: Record<string, unknown> | null;
}): Promise<CarrierConfig> {
  const res = await fetch("/api/carrier-configs", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Error al guardar");
  return res.json() as Promise<CarrierConfig>;
}


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
    Promise.all([fetchCarriersViaProxy(), fetchConfigsViaProxy(shopId)])
      .then(([c, cfgs]) => {
        setCarriers(c.filter((car) => car.supports_tracking));
        setConfigs(cfgs);
      })
      .catch(() => toast("Error cargando configuración de tracking", "error"))
      .finally(() => setLoading(false));
  }, [shopId, toast]);

  function usesBranded(code: string): boolean {
    const cfg = configs.find((c) => c.carrier_code === code);
    return Boolean(
      cfg?.config_json &&
        (cfg.config_json as Record<string, unknown>).use_branded_tracking_link === true,
    );
  }

  function handleToggle(carrier: CarrierInfo, wantBranded: boolean) {
    const existing = configs.find((c) => c.carrier_code === carrier.code);
    const prevJson = (existing?.config_json as Record<string, unknown> | null | undefined) ?? {};
    startTransition(async () => {
      try {
        const updated = await upsertConfigViaProxy({
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
            ? `${carrier.name}: se enviará el tracking de Brandeate a Shopify`
            : `${carrier.name}: Shopify gestionará el tracking sin enlace personalizado`,
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
        Elige qué enlace se envía a Shopify al crear la etiqueta. Shopify lo incluye en el email
        de envío al cliente.
      </p>

      {carriers.map((carrier) => {
        const branded = usesBranded(carrier.code);
        return (
          <div key={carrier.code} className="trk-link-row">
            <div className="trk-link-carrier-name">{carrier.name}</div>

            <div className="trk-link-options">
              {/* Opción: sin enlace personalizado */}
              <button
                type="button"
                className={`trk-link-option ${!branded ? "trk-link-option-active" : ""}`}
                onClick={() => { if (branded) handleToggle(carrier, false); }}
                disabled={!branded}
                title="Shopify gestiona el seguimiento sin enlace personalizado"
              >
                <span className="trk-link-option-icon">📦</span>
                <span className="trk-link-option-label">
                  Sin enlace personalizado
                  <small>Shopify gestiona el seguimiento</small>
                </span>
                {!branded && <span className="trk-link-option-check">✓</span>}
              </button>

              {/* Opción: tracking Brandeate */}
              <button
                type="button"
                className={`trk-link-option ${branded ? "trk-link-option-active" : ""}`}
                onClick={() => { if (!branded) handleToggle(carrier, true); }}
                disabled={branded}
                title="El cliente recibe el enlace a la página de tracking de Brandeate"
              >
                <span className="trk-link-option-icon">✨</span>
                <span className="trk-link-option-label">
                  Tracking de Brandeate
                  <small>Enlace personalizado en el email de Shopify</small>
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
