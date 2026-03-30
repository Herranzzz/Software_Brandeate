"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ShopifySyncPanel } from "@/components/shopify-sync-panel";
import type { Shop, ShopIntegration } from "@/lib/types";


type TenantShopifyPanelProps = {
  shop: Shop;
  integration?: ShopIntegration | null;
};


export function TenantShopifyPanel({ shop, integration = null }: TenantShopifyPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [shopDomain, setShopDomain] = useState(integration?.shop_domain ?? "");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function handleConnect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    const response = await fetch("/api/integrations/shopify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        shop_id: shop.id,
        shop_domain: shopDomain,
        access_token: accessToken || undefined,
        client_id: clientId || undefined,
        client_secret: clientSecret || undefined,
      }),
    });

    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;

    if (!response.ok) {
      setMessage({
        kind: "error",
        text: payload?.detail ?? "No se pudo conectar Shopify.",
      });
      return;
    }

    setMessage({
      kind: "success",
      text: integration ? "Integración Shopify actualizada." : "Shopify conectado correctamente.",
    });
    setClientId("");
    setClientSecret("");
    setAccessToken("");
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className="stack">
      <form className="stack" onSubmit={handleConnect}>
        <div className="portal-settings-grid">
          <div className="field">
            <label htmlFor="tenant-shopify-domain">Dominio Shopify</label>
            <input
              id="tenant-shopify-domain"
              onChange={(event) => setShopDomain(event.target.value)}
              placeholder="mi-tienda.myshopify.com"
              value={shopDomain}
            />
          </div>

          <div className="field">
            <label htmlFor="tenant-shopify-client-id">
              Client ID
            </label>
            <input
              id="tenant-shopify-client-id"
              onChange={(event) => setClientId(event.target.value)}
              placeholder="Shopify client id"
              value={clientId}
            />
          </div>

          <div className="field">
            <label htmlFor="tenant-shopify-client-secret">
              Client secret
            </label>
            <input
              id="tenant-shopify-client-secret"
              onChange={(event) => setClientSecret(event.target.value)}
              placeholder="shpss_..."
              type="password"
              value={clientSecret}
            />
          </div>

          <div className="field">
            <label htmlFor="tenant-shopify-token">
              Access token manual
            </label>
            <input
              id="tenant-shopify-token"
              onChange={(event) => setAccessToken(event.target.value)}
              placeholder="Opcional para integraciones legacy"
              type="password"
              value={accessToken}
            />
          </div>
        </div>

        <div className="info-banner">
          Usa <strong>Client ID + Client secret</strong> si tu app de Shopify viene del Dev Dashboard. El access token manual queda como opción legacy.
        </div>

        <div className="actions-row">
          <button
            className="button"
            disabled={
              isPending ||
              !shopDomain.trim() ||
              (!accessToken.trim() && !(clientId.trim() && clientSecret.trim()))
            }
            type="submit"
          >
            {isPending ? "Guardando..." : integration ? "Actualizar conexión Shopify" : "Conectar Shopify"}
          </button>
        </div>
      </form>

      {message ? <div className={`feedback feedback-${message.kind}`}>{message.text}</div> : null}

      {integration ? (
        <ShopifySyncPanel
          compact
          defaultShopId={shop.id}
          integrations={[integration]}
          shops={[shop]}
        />
      ) : (
        <div className="info-banner">
          Conecta tu tienda Shopify para empezar a sincronizar pedidos desde el portal cliente.
        </div>
      )}
    </div>
  );
}
