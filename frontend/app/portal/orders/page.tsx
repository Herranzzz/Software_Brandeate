import Link from "next/link";

import { Card } from "@/components/card";
import { EmptyState } from "@/components/empty-state";
import { fetchOrders } from "@/lib/api";
import {
  clientOrderStageMeta,
  getClientOrderStage,
  getLatestTrackingEvent,
  type PortalOrderQuickFilter,
} from "@/lib/client-hub";
import { fetchMyShops, requirePortalUser } from "@/lib/auth";
import type { Order } from "@/lib/types";
import { resolveTenantScope } from "@/lib/tenant-scope";

type PortalOrdersPageProps = {
  searchParams: Promise<{
    page?: string;
    per_page?: string;
    shop_id?: string;
    q?: string;
    quick?: string;
  }>;
};

const quickFilterOptions: Array<{ key: PortalOrderQuickFilter; label: string; icon: string }> = [
  { key: "all",              label: "Todos",       icon: "📋" },
  { key: "personalized",     label: "Personaliz.", icon: "🎨" },
  { key: "standard",         label: "Estándar",    icon: "📦" },
  { key: "design_available", label: "Diseño OK",   icon: "✅" },
  { key: "pending_asset",    label: "Pend. asset",  icon: "⏳" },
  { key: "incident",         label: "Incidencia",  icon: "⚠️" },
  { key: "not_prepared",     label: "No preparado", icon: "🔧" },
];

function quickFilterToApiParams(filter: PortalOrderQuickFilter) {
  switch (filter) {
    case "personalized":     return { is_personalized: true };
    case "standard":         return { is_personalized: false };
    case "design_available": return { design_status: "design_available" };
    case "pending_asset":    return { has_pending_asset: true };
    case "incident":         return { has_incident: true };
    case "not_prepared":     return { is_prepared: false };
    default:                 return {};
  }
}

function formatCompact(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
}

function getFirstProduct(order: Order) {
  const item = order.items[0];
  if (!item) return { name: "—", variant: "" };
  const name = item.title ?? item.name ?? "—";
  const variant = item.variant_title ?? "";
  return { name: name.length > 40 ? `${name.slice(0, 38)}…` : name, variant };
}

function getShippingStatusMeta(order: Order) {
  const status = order.shipment?.shipping_status;
  if (!status) return { label: "Sin envío", tone: "muted" };
  const map: Record<string, { label: string; tone: string }> = {
    label_created:    { label: "Etiqueta",     tone: "slate" },
    picked_up:        { label: "Recogido",     tone: "blue" },
    in_transit:       { label: "En tránsito",  tone: "blue" },
    out_for_delivery: { label: "En reparto",   tone: "orange" },
    delivered:        { label: "Entregado",    tone: "green" },
    exception:        { label: "Excepción",    tone: "red" },
  };
  return map[status] ?? { label: status, tone: "slate" };
}

export default async function PortalOrdersPage({ searchParams }: PortalOrdersPageProps) {
  const [userResult, shopsResult] = await Promise.allSettled([requirePortalUser(), fetchMyShops()]);
  if (userResult.status === "rejected") throw userResult.reason;
  const shops = shopsResult.status === "fulfilled" ? shopsResult.value : [];
  const params = await searchParams;
  const page = Math.max(Number(params.page ?? "1") || 1, 1);
  const perPage = Math.min(Math.max(Number(params.per_page ?? "100") || 100, 1), 250);
  const query = (params.q ?? "").trim();
  const quickFilter = quickFilterOptions.some((item) => item.key === params.quick)
    ? (params.quick as PortalOrderQuickFilter)
    : "all";
  const tenantScope = resolveTenantScope(shops, params.shop_id);

  let orders: Order[] = [];
  let totalCount = 0;
  try {
    const result = await fetchOrders({
      page,
      per_page: perPage,
      q: query || undefined,
      ...(tenantScope.selectedShopId ? { shop_id: tenantScope.selectedShopId } : {}),
      ...quickFilterToApiParams(quickFilter),
    }, { cacheSeconds: 20 });
    orders = result.orders;
    totalCount = result.totalCount;
  } catch {
    // Backend unavailable
  }

  const pageCount = Math.max(1, Math.ceil(totalCount / perPage));
  const safePage = Math.min(page, pageCount);

  function buildQ(overrides: Record<string, string | undefined>) {
    return {
      ...(tenantScope.selectedShopId ? { shop_id: tenantScope.selectedShopId } : {}),
      per_page: String(perPage),
      ...overrides,
    };
  }

  return (
    <div className="po-page">
      {/* ── Toolbar: search + filters ──────────────────────────── */}
      <div className="po-toolbar">
        <form action="/portal/orders" className="po-search-form" method="get">
          {tenantScope.selectedShopId && <input name="shop_id" type="hidden" value={tenantScope.selectedShopId} />}
          <input name="per_page" type="hidden" value={String(perPage)} />
          <input name="quick" type="hidden" value={quickFilter} />
          <input
            className="po-search-input"
            defaultValue={query}
            name="q"
            placeholder="Buscar pedido, cliente, SKU, tracking…"
            type="search"
          />
          <button className="po-search-btn" type="submit">Buscar</button>
        </form>

        <div className="po-filters">
          {quickFilterOptions.map((item) => (
            <Link
              className={`po-filter${quickFilter === item.key ? " po-filter-on" : ""}`}
              href={{ pathname: "/portal/orders", query: buildQ({
                q: query || undefined,
                quick: item.key === "all" ? undefined : item.key,
                page: "1",
              }) }}
              key={item.key}
            >
              <span className="po-filter-icon">{item.icon}</span>
              <span className="po-filter-label">{item.label}</span>
              {quickFilter === item.key && totalCount > 0 && (
                <span className="po-filter-count">{totalCount}</span>
              )}
            </Link>
          ))}
        </div>
      </div>

      {/* ── Table ──────────────────────────────────────────────── */}
      <div className="po-table-wrap">
        {orders.length === 0 ? (
          <Card>
            <EmptyState
              title="Sin resultados"
              description="No hay pedidos con esos filtros. Prueba otra búsqueda."
            />
          </Card>
        ) : (
          <table className="po-table">
            <thead>
              <tr>
                <th className="po-th">Pedido</th>
                <th className="po-th">Cliente</th>
                <th className="po-th">Fecha</th>
                <th className="po-th po-th-product">Producto</th>
                <th className="po-th">Estado</th>
                <th className="po-th">Envío</th>
                <th className="po-th">Tracking</th>
                <th className="po-th po-th-center">Incid.</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => {
                const stage = clientOrderStageMeta[getClientOrderStage(order)];
                const product = getFirstProduct(order);
                const shippingMeta = getShippingStatusMeta(order);
                const trackingNum = order.shipment?.tracking_number ?? null;
                const hasIncident = order.has_open_incident || order.open_incidents_count > 0;
                const extraItems = order.items.length - 1;

                return (
                  <tr className={`po-row${hasIncident ? " po-row-alert" : ""}`} key={order.id}>
                    <td className="po-td po-td-id">
                      <Link className="po-link" href={`/portal/orders/${order.id}`}>
                        #{order.external_id}
                      </Link>
                    </td>
                    <td className="po-td po-td-customer">
                      <span className="po-customer-name">{order.customer_name}</span>
                    </td>
                    <td className="po-td po-td-date">{formatCompact(order.created_at)}</td>
                    <td className="po-td po-td-product">
                      <span className="po-product-name">{product.name}</span>
                      {product.variant && <span className="po-product-variant">{product.variant}</span>}
                      {extraItems > 0 && <span className="po-product-extra">+{extraItems}</span>}
                    </td>
                    <td className="po-td">
                      <span className={stage.badgeClassName} style={{ fontSize: "0.7rem", padding: "2px 8px" }}>
                        {stage.label}
                      </span>
                    </td>
                    <td className="po-td">
                      <span className={`po-ship-pill po-ship-${shippingMeta.tone}`}>
                        {shippingMeta.label}
                      </span>
                    </td>
                    <td className="po-td po-td-tracking">
                      {trackingNum ? (
                        order.shipment?.tracking_url ? (
                          <a className="po-tracking-link" href={order.shipment.tracking_url} rel="noreferrer" target="_blank">
                            {trackingNum}
                          </a>
                        ) : (
                          <span className="po-tracking-num">{trackingNum}</span>
                        )
                      ) : (
                        <span className="po-no-data">—</span>
                      )}
                    </td>
                    <td className="po-td po-td-center">
                      {hasIncident ? (
                        <span className="po-incident-dot" title={`${order.open_incidents_count} incidencia(s)`}>
                          {order.open_incidents_count || "!"}
                        </span>
                      ) : (
                        <span className="po-ok-dot">✓</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Pagination ─────────────────────────────────────────── */}
      <div className="po-pagination">
        <Link
          className={`po-page-btn${safePage <= 1 ? " po-page-disabled" : ""}`}
          href={{ pathname: "/portal/orders", query: buildQ({
            q: query || undefined,
            quick: quickFilter === "all" ? undefined : quickFilter,
            page: String(Math.max(safePage - 1, 1)),
          }) }}
        >
          ← Anterior
        </Link>
        <span className="po-page-info">
          {safePage}/{pageCount} · <strong>{totalCount}</strong> pedidos
        </span>
        <Link
          className={`po-page-btn${safePage >= pageCount ? " po-page-disabled" : ""}`}
          href={{ pathname: "/portal/orders", query: buildQ({
            q: query || undefined,
            quick: quickFilter === "all" ? undefined : quickFilter,
            page: String(Math.min(safePage + 1, pageCount)),
          }) }}
        >
          Siguiente →
        </Link>
      </div>
    </div>
  );
}
