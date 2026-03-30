"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { Shop, ShopCatalogProduct, ShopifyCatalogSyncResult } from "@/lib/types";


type ShopCatalogManagerProps = {
  products: ShopCatalogProduct[];
  shop: Shop;
};


export function ShopCatalogManager({ products, shop }: ShopCatalogManagerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function handleSyncCatalog() {
    setMessage(null);
    const response = await fetch(`/api/catalog/shopify/${shop.id}/sync-products`, {
      method: "POST",
    });

    const payload = (await response.json().catch(() => null)) as ShopifyCatalogSyncResult | { detail?: string } | null;
    if (!response.ok) {
      setMessage({ kind: "error", text: payload && "detail" in payload && payload.detail ? payload.detail : "No se pudo sincronizar el catálogo." });
      return;
    }

    const result = payload as ShopifyCatalogSyncResult;
    setMessage({
      kind: "success",
      text: `Catálogo actualizado. Leídos ${result.fetched_count}, creados ${result.created_count}, actualizados ${result.updated_count}.`,
    });
    startTransition(() => router.refresh());
  }

  async function handleToggle(productId: number, nextValue: boolean) {
    setMessage(null);
    const response = await fetch(`/api/catalog/products/${productId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ is_personalizable: nextValue }),
    });

    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    if (!response.ok) {
      setMessage({ kind: "error", text: payload?.detail ?? "No se pudo actualizar el producto." });
      return;
    }

    startTransition(() => router.refresh());
  }

  return (
    <div className="stack">
      <div className="table-header">
        <div>
          <span className="eyebrow">Catálogo</span>
          <h3 className="section-title section-title-small">Productos Shopify</h3>
          <p className="subtitle">
            Marca qué productos del catálogo deben tratarse como personalizables para operaciones y reporting.
          </p>
        </div>
        <button className="button" disabled={isPending} onClick={() => void handleSyncCatalog()} type="button">
          {isPending ? "Sincronizando..." : "Sincronizar catálogo"}
        </button>
      </div>

      {message ? <div className={`feedback feedback-${message.kind}`}>{message.text}</div> : null}

      {products.length === 0 ? (
        <div className="info-banner">Todavía no hay productos cargados. Conecta Shopify y sincroniza el catálogo para empezar.</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Vendor</th>
                <th>Tipo</th>
                <th>Variantes</th>
                <th>Personalizable</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr className="table-row" key={product.id}>
                  <td>
                    <div className="table-primary">{product.title}</div>
                    <div className="table-secondary">{product.handle ?? product.external_product_id}</div>
                  </td>
                  <td>{product.vendor ?? "-"}</td>
                  <td>{product.product_type ?? "-"}</td>
                  <td>{product.variants_json?.length ?? 0}</td>
                  <td>
                    <label className="catalog-toggle">
                      <input
                        checked={product.is_personalizable}
                        onChange={(event) => void handleToggle(product.id, event.target.checked)}
                        type="checkbox"
                      />
                      <span>{product.is_personalizable ? "Sí" : "No"}</span>
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
