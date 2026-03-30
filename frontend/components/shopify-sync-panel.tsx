"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { Shop, ShopIntegration, ShopifySyncResult } from "@/lib/types";


type ShopifySyncPanelProps = {
  shops: Shop[];
  integrations?: ShopIntegration[];
  defaultShopId?: number | null;
  compact?: boolean;
};


export function ShopifySyncPanel({
  shops,
  integrations = [],
  defaultShopId = null,
  compact = false,
}: ShopifySyncPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<"sync" | "import" | null>(null);
  const [shopId, setShopId] = useState(
    defaultShopId !== null ? String(defaultShopId) : shops[0] ? String(shops[0].id) : "",
  );
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(
    null,
  );
  const [result, setResult] = useState<ShopifySyncResult | null>(null);

  async function runAction(action: "sync" | "import") {
    if (!shopId) {
      setMessage({ kind: "error", text: "Selecciona una tienda para sincronizar." });
      return;
    }

    setMessage(null);
    setResult(null);
    setPendingAction(action);

    try {
      const path =
        action === "import"
          ? `/api/integrations/shopify/${shopId}/import-orders`
          : `/api/integrations/shopify/${shopId}/sync-orders`;

      const response = await fetch(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const payload = (await response.json().catch(() => null)) as
        | ShopifySyncResult
        | { detail?: string }
        | null;

      if (!response.ok) {
        setMessage({
          kind: "error",
          text:
            payload && "detail" in payload && payload.detail
              ? payload.detail
              : action === "import"
                ? "No se pudo importar el historico de Shopify."
                : "No se pudo sincronizar Shopify.",
        });
        return;
      }

      setResult(payload as ShopifySyncResult);
      setMessage({
        kind: "success",
        text:
          action === "import"
            ? "Importacion historica completada."
            : "Sincronizacion incremental completada.",
      });
      startTransition(() => {
        router.refresh();
      });
    } finally {
      setPendingAction(null);
    }
  }

  const panelClassName = compact ? "card stack sync-panel sync-panel-compact" : "card stack sync-panel";
  const activeIntegration = integrations.find((integration) => String(integration.shop_id) === shopId) ?? null;
  const lastSummary = activeIntegration?.last_sync_summary ?? null;

  return (
    <section className={panelClassName}>
      <div>
        <span className="eyebrow">Shopify</span>
        <h3 className="section-title section-title-small">Tienda conectada</h3>
        <p className="subtitle">
          Lanza una sincronización incremental para cambios recientes o una importación histórica para recuperar los últimos pedidos.
        </p>
      </div>

      <div className={compact ? "sync-panel-row" : "grid grid-2"}>
        {shops.length > 1 || defaultShopId === null ? (
          <div className="field">
            <label htmlFor="shopify-sync-shop">Tienda</label>
            <select
              id="shopify-sync-shop"
              onChange={(event) => setShopId(event.target.value)}
              value={shopId}
            >
              {shops.map((shop) => (
                <option key={shop.id} value={shop.id}>
                  {shop.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="info-banner">
            Sincronizacion configurada para <strong>{shops[0]?.name ?? `shop #${shopId}`}</strong>.
          </div>
        )}

        <div className="actions-row">
          <button
            className="button button-secondary"
            disabled={isPending || pendingAction !== null || !shopId || shops.length === 0}
            onClick={() => void runAction("sync")}
            type="button"
          >
            {pendingAction === "sync" ? "Sincronizando..." : "Sincronizar cambios recientes"}
          </button>

          <button
            className="button"
            disabled={isPending || pendingAction !== null || !shopId || shops.length === 0}
            onClick={() => void runAction("import")}
            type="button"
          >
            {pendingAction === "import" ? "Importando..." : "Importar últimos pedidos"}
          </button>
        </div>
      </div>

      {message ? <div className={`feedback feedback-${message.kind}`}>{message.text}</div> : null}

      {activeIntegration ? (
        <div className="summary-grid">
          <div className="summary-tile">
            <span className="kv-label">Última sync</span>
            <div className="table-primary">{activeIntegration.last_synced_at ?? "Nunca"}</div>
          </div>
          <div className="summary-tile">
            <span className="kv-label">Estado</span>
            <div className="table-primary">{activeIntegration.last_sync_status ?? "Sin ejecutar"}</div>
          </div>
          <div className="summary-tile">
            <span className="kv-label">Shopify</span>
            <div className="table-primary">{activeIntegration.shop_domain}</div>
          </div>
          <div className="summary-tile">
            <span className="kv-label">Resumen</span>
            <div className="table-secondary">
              {lastSummary ? JSON.stringify(lastSummary) : "Sin resumen disponible"}
            </div>
          </div>
          <div className="summary-tile">
            <span className="kv-label">Último error</span>
            <div className="table-secondary">
              {activeIntegration.last_error_message ?? "Sin errores recientes"}
            </div>
          </div>
        </div>
      ) : null}

      {result ? (
        <div className="summary-grid">
          <div className="summary-tile">
            <span className="kv-label">Pedidos importados</span>
            <div className="table-primary">{result.imported_count}</div>
          </div>
          <div className="summary-tile">
            <span className="kv-label">Pedidos actualizados</span>
            <div className="table-primary">{result.updated_count}</div>
          </div>
          {typeof result.skipped_count === "number" ? (
            <div className="summary-tile">
              <span className="kv-label">Pedidos omitidos</span>
              <div className="table-primary">{result.skipped_count}</div>
            </div>
          ) : null}
          <div className="summary-tile">
            <span className="kv-label">Shipments creados</span>
            <div className="table-primary">{result.shipments_created_count}</div>
          </div>
          {typeof result.customers_created_count === "number" ? (
            <div className="summary-tile">
              <span className="kv-label">Clientes creados</span>
              <div className="table-primary">{result.customers_created_count}</div>
            </div>
          ) : null}
          {typeof result.customers_updated_count === "number" ? (
            <div className="summary-tile">
              <span className="kv-label">Clientes actualizados</span>
              <div className="table-primary">{result.customers_updated_count}</div>
            </div>
          ) : null}
          <div className="summary-tile">
            <span className="kv-label">Shipments completados</span>
            <div className="table-primary">{result.shipments_updated_count}</div>
          </div>
          <div className="summary-tile">
            <span className="kv-label">IDs migrados</span>
            <div className="table-primary">{result.external_ids_migrated_count}</div>
          </div>
          <div className="summary-tile">
            <span className="kv-label">Eventos tracking</span>
            <div className="table-primary">{result.tracking_events_created_count}</div>
          </div>
          <div className="summary-tile">
            <span className="kv-label">Incidencias auto</span>
            <div className="table-primary">{result.incidents_created_count}</div>
          </div>
          <div className="summary-tile">
            <span className="kv-label">Pedidos leidos</span>
            <div className="table-primary">{result.total_fetched}</div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
