import Link from "next/link";

import { ProductionKanban } from "@/components/production-kanban";
import { fetchOrders, fetchShops } from "@/lib/api";
import { requireAdminUser } from "@/lib/auth";

type ProductionPageProps = {
  searchParams: Promise<{
    shop_id?: string;
    q?: string;
  }>;
};

export default async function ProductionPage({ searchParams }: ProductionPageProps) {
  const params = await searchParams;

  const [userResult, ordersResult, shopsResult] = await Promise.allSettled([
    requireAdminUser(),
    fetchOrders({
      shop_id: params.shop_id,
      q: params.q,
      per_page: 250,
      // Fetch all non-delivered, non-cancelled orders for the Kanban
    }, { cacheSeconds: 15 }),
    fetchShops(),
  ]);

  if (userResult.status === "rejected") throw userResult.reason;

  const { orders } = ordersResult.status === "fulfilled"
    ? ordersResult.value
    : { orders: [] };
  const shops = shopsResult.status === "fulfilled" ? shopsResult.value : [];

  // Only show production-relevant statuses on the Kanban
  const kanbanOrders = orders.filter(
    (o) =>
      o.status !== "cancelled" &&
      o.status !== "delivered" &&
      !o.cancelled_at,
  );

  const selectedShop = shops.find((s) => String(s.id) === params.shop_id);

  return (
    <div className="production-page">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="production-page-header">
        <div className="production-page-title-row">
          <div>
            <span className="eyebrow">Producción</span>
            <h1 className="section-title">Cola de producción</h1>
          </div>
          <div className="production-page-header-actions">
            <Link className="button-secondary" href="/orders">
              Vista tabla
            </Link>
          </div>
        </div>

        {/* Shop + search filter */}
        <form className="production-filters" method="get">
          <div className="field">
            <label htmlFor="shop_id">Tienda</label>
            <select defaultValue={params.shop_id ?? ""} id="shop_id" name="shop_id">
              <option value="">Todas</option>
              {shops.map((shop) => (
                <option key={shop.id} value={String(shop.id)}>
                  {shop.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="q">Buscar</label>
            <input
              defaultValue={params.q ?? ""}
              id="q"
              name="q"
              placeholder="Pedido, cliente, SKU…"
              type="search"
            />
          </div>
          <button className="button-secondary" type="submit">
            Filtrar
          </button>
          {(params.shop_id || params.q) && (
            <Link className="button-ghost" href="/production">
              Limpiar
            </Link>
          )}
        </form>

        <div className="production-page-meta">
          <span>
            {kanbanOrders.length} pedido{kanbanOrders.length !== 1 ? "s" : ""} en producción
            {selectedShop ? ` · ${selectedShop.name}` : ""}
          </span>
          <span className="production-page-tip">
            💡 Arrastra las tarjetas entre columnas para actualizar el estado
          </span>
        </div>
      </div>

      {/* ── Kanban board ────────────────────────────────────────────── */}
      <ProductionKanban initialOrders={kanbanOrders} />
    </div>
  );
}
