import { Card } from "@/components/card";
import { EmptyState } from "@/components/empty-state";
import { KpiCard } from "@/components/kpi-card";
import { PageHeader } from "@/components/page-header";
import { SearchInput } from "@/components/search-input";
import { fetchOrders, fetchShopCatalogProducts, fetchShops } from "@/lib/api";
import { requireAdminUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";


type CatalogPageProps = {
  searchParams: Promise<{
    shop_id?: string;
    q?: string;
    is_personalizable?: string;
  }>;
};


function normalize(value?: string | null) {
  return (value ?? "").trim().toLowerCase();
}


function matchesCatalogSearch(
  product: Awaited<ReturnType<typeof fetchShopCatalogProducts>>[number],
  query?: string,
) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    return true;
  }

  const haystack = [
    product.title,
    product.handle ?? "",
    product.vendor ?? "",
    product.product_type ?? "",
    ...((product.variants_json ?? []).flatMap((variant) => [variant.title ?? "", variant.sku ?? ""])),
  ].join(" ").toLowerCase();

  return haystack.includes(normalizedQuery);
}


function matchesPersonalizable(
  product: Awaited<ReturnType<typeof fetchShopCatalogProducts>>[number],
  rawValue?: string,
) {
  if (rawValue === "true") {
    return product.is_personalizable;
  }
  if (rawValue === "false") {
    return !product.is_personalizable;
  }
  return true;
}


export default async function CatalogPage({ searchParams }: CatalogPageProps) {
  await requireAdminUser();
  const params = await searchParams;
  const [shops, products, orders] = await Promise.all([
    fetchShops(),
    fetchShopCatalogProducts(params.shop_id),
    fetchOrders({ shop_id: params.shop_id, per_page: 500 }),
  ]);

  const filteredProducts = products.filter(
    (product) => matchesCatalogSearch(product, params.q) && matchesPersonalizable(product, params.is_personalizable),
  );
  const shopMap = new Map(shops.map((shop) => [shop.id, shop.name]));
  const personalizedProducts = filteredProducts.filter((product) => product.is_personalizable).length;
  const syncedProducts = filteredProducts.filter((product) => product.synced_at).length;
  const totalVariants = filteredProducts.reduce((sum, product) => sum + (product.variants_json?.length ?? 0), 0);

  return (
    <div className="stack">
      <Card className="stack panel-hero">
        <PageHeader
          eyebrow="Catálogo"
          title="Base de producto Shopify"
          description="Opera por producto, variante y SKU con visión clara de personalización y demanda real."
        />

        <form className="filters filter-bar" method="get">
          <SearchInput
            defaultValue={params.q ?? ""}
            placeholder="Producto, variante, SKU o vendor"
          />

          <div className="field">
            <label htmlFor="shop_id">Tienda</label>
            <select defaultValue={params.shop_id ?? ""} id="shop_id" name="shop_id">
              <option value="">Todas</option>
              {shops.map((shop) => (
                <option key={shop.id} value={shop.id}>
                  {shop.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="is_personalizable">Personalización</label>
            <select defaultValue={params.is_personalizable ?? ""} id="is_personalizable" name="is_personalizable">
              <option value="">Todos</option>
              <option value="true">Personalizables</option>
              <option value="false">Estándar</option>
            </select>
          </div>

          <button className="button" type="submit">
            Aplicar filtros
          </button>
        </form>
      </Card>

      <section className="kpi-grid">
        <KpiCard label="Productos visibles" value={String(filteredProducts.length)} tone="accent" />
        <KpiCard label="Variantes visibles" value={String(totalVariants)} tone="default" />
        <KpiCard label="Personalizables" value={String(personalizedProducts)} tone="warning" />
        <KpiCard label="Sincronizados" value={String(syncedProducts)} tone="success" />
      </section>

      <Card className="stack table-card">
        <div className="table-header">
          <div>
            <span className="eyebrow">Operación por producto</span>
            <h3 className="section-title section-title-small">Catálogo sincronizado</h3>
          </div>
          <div className="muted">{filteredProducts.length} resultados</div>
        </div>

        {filteredProducts.length === 0 ? (
          <EmptyState
            title="Sin productos en esta vista"
            description="Sincroniza el catálogo desde Shopify o ajusta los filtros."
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Tienda</th>
                  <th>Variantes / SKU</th>
                  <th>Tipo</th>
                  <th>Demanda 500 pedidos</th>
                  <th>Sync</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((product) => {
                  const variants = product.variants_json ?? [];
                  const relatedItems = orders.flatMap((order) =>
                    order.items.filter((item) =>
                      item.product_id === product.external_product_id ||
                      variants.some((variant) => variant.id && variant.id === item.variant_id) ||
                      variants.some((variant) => variant.sku && variant.sku === item.sku),
                    ),
                  );
                  const relatedOrders = orders.filter((order) =>
                    order.items.some((item) =>
                      item.product_id === product.external_product_id ||
                      variants.some((variant) => variant.id && variant.id === item.variant_id) ||
                      variants.some((variant) => variant.sku && variant.sku === item.sku),
                    ),
                  );
                  const variantPreview = variants.slice(0, 3).map((variant) => variant.title || variant.sku || "Variante").join(" · ");
                  const skuPreview = variants.map((variant) => variant.sku).filter(Boolean).slice(0, 3).join(", ");

                  return (
                    <tr className="table-row" key={product.id}>
                      <td>
                        <div className="table-primary">{product.title}</div>
                        <div className="table-secondary">
                          {product.vendor ?? "Sin vendor"}
                          {product.product_type ? ` · ${product.product_type}` : ""}
                        </div>
                      </td>
                      <td>{shopMap.get(product.shop_id) ?? `Shop #${product.shop_id}`}</td>
                      <td>
                        <div className="table-primary">{variants.length} variantes</div>
                        <div className="table-secondary">{variantPreview || skuPreview || "Sin variantes visibles"}</div>
                      </td>
                      <td>
                        <span className={`badge ${product.is_personalizable ? "badge-personalized" : "badge-standard"}`}>
                          {product.is_personalizable ? "Personalizable" : "Estándar"}
                        </span>
                      </td>
                      <td>
                        <div className="table-primary">{relatedOrders.length} pedidos</div>
                        <div className="table-secondary">{relatedItems.length} líneas en los últimos 500</div>
                      </td>
                      <td>
                        <div className="table-primary">{product.status ?? "Sin estado"}</div>
                        <div className="table-secondary">{product.synced_at ? formatDateTime(product.synced_at) : "Sin sync"}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
