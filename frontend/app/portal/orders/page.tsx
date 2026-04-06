import Link from "next/link";

import { Card } from "@/components/card";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PortalTenantControl } from "@/components/portal-tenant-control";
import { fetchOrders } from "@/lib/api";
import {
  clientOrderStageMeta,
  getClientOrderStage,
  getLatestTrackingEvent,
  type PortalOrderQuickFilter,
} from "@/lib/client-hub";
import { fetchMyShops, requirePortalUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import type { Order } from "@/lib/types";
import { getTenantBranding } from "@/lib/tenant-branding";
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

const quickFilterOptions: Array<{ key: PortalOrderQuickFilter; label: string }> = [
  { key: "all", label: "📋 Todos" },
  { key: "personalized", label: "🎨 Personalizados" },
  { key: "standard", label: "📦 Estándar" },
  { key: "design_available", label: "✅ Diseño disponible" },
  { key: "pending_asset", label: "⏳ Pendiente de asset" },
  { key: "incident", label: "⚠️ Con incidencia" },
  { key: "not_prepared", label: "🔧 No preparados" },
];

/** Traduce el quick filter del portal a los parámetros de la API. */
function quickFilterToApiParams(filter: PortalOrderQuickFilter) {
  switch (filter) {
    case "personalized":
      return { is_personalized: true };
    case "standard":
      return { is_personalized: false };
    case "design_available":
      return { design_status: "design_available" };
    case "pending_asset":
      return { has_pending_asset: true };
    case "incident":
      return { has_incident: true };
    case "not_prepared":
      return { is_prepared: false };
    default:
      return {};
  }
}

function getOrderItems(order: Order) {
  return order.items ?? [];
}

export default async function PortalOrdersPage({ searchParams }: PortalOrdersPageProps) {
  await requirePortalUser();
  const params = await searchParams;
  const page = Math.max(Number(params.page ?? "1") || 1, 1);
  const perPage = Math.min(Math.max(Number(params.per_page ?? "50") || 50, 1), 500);
  const query = (params.q ?? "").trim();
  const quickFilter = quickFilterOptions.some((item) => item.key === params.quick)
    ? (params.quick as PortalOrderQuickFilter)
    : "all";

  const shops = await fetchMyShops();
  const tenantScope = resolveTenantScope(shops, params.shop_id);
  const branding = getTenantBranding(tenantScope.selectedShop ?? shops[0]);

  // Todos los filtros se resuelven en el servidor
  const { orders, totalCount } = await fetchOrders({
    page,
    per_page: perPage,
    q: query || undefined,
    ...(tenantScope.selectedShopId ? { shop_id: tenantScope.selectedShopId } : {}),
    ...quickFilterToApiParams(quickFilter),
  });

  const pageCount = Math.max(1, Math.ceil(totalCount / perPage));
  const safePage = Math.min(page, pageCount);

  return (
    <div className="stack portal-orders-page">
      <PageHeader
        eyebrow="Pedidos"
        title={`Pedidos · ${branding.displayName}`}
        description="Consulta clara de pedidos, fases de trabajo y tracking para entender la operativa de tu tienda sin fricción."
      />

      <PortalTenantControl
        action="/portal/orders"
        hiddenFields={{ page: 1, per_page: perPage, q: query, quick: quickFilter }}
        selectedShopId={tenantScope.selectedShopId}
        shops={tenantScope.shops}
        submitLabel="Ver"
      />

      <Card className="portal-glass-card portal-orders-toolbar-card">
        <form action="/portal/orders" className="portal-orders-search-row" method="get">
          {tenantScope.selectedShopId ? <input name="shop_id" type="hidden" value={tenantScope.selectedShopId} /> : null}
          <input name="per_page" type="hidden" value={String(perPage)} />
          <input name="quick" type="hidden" value={quickFilter} />
          <label className="field portal-orders-search-field">
            <span>Buscar</span>
            <input defaultValue={query} name="q" placeholder="Pedido, cliente, email, SKU o tracking" type="search" />
          </label>
          <button className="button" type="submit">Buscar</button>
          <Link
            className="button button-secondary"
            href={{
              pathname: "/portal/orders",
              query: {
                per_page: String(perPage),
                ...(tenantScope.selectedShopId ? { shop_id: tenantScope.selectedShopId } : {}),
              },
            }}
          >
            Limpiar
          </Link>
        </form>

        <div className="portal-orders-pill-row">
          {quickFilterOptions.map((item) => (
            <Link
              className={`portal-soft-pill portal-filter-pill ${quickFilter === item.key ? "portal-filter-pill-active" : ""}`}
              href={{
                pathname: "/portal/orders",
                query: {
                  q: query || undefined,
                  quick: item.key === "all" ? undefined : item.key,
                  per_page: String(perPage),
                  page: "1",
                  ...(tenantScope.selectedShopId ? { shop_id: tenantScope.selectedShopId } : {}),
                },
              }}
              key={item.key}
            >
              <span>{item.label}</span>
              {quickFilter === item.key && <strong>{totalCount}</strong>}
            </Link>
          ))}
        </div>
      </Card>

      <Card className="portal-glass-card portal-orders-table-card">
        <div className="portal-dashboard-section-head">
          <div>
            <span className="eyebrow">📋 Pedidos</span>
            <h3 className="section-title section-title-small">Vista operativa del cliente</h3>
            <p className="subtitle">Estados claros, tracking visible y acceso rápido al detalle para transmitir confianza y control.</p>
          </div>
          <div className="portal-orders-table-meta">
            <span className="table-secondary">
              {totalCount === 0
                ? "Sin resultados"
                : `Mostrando ${orders.length} de ${totalCount} pedidos`}
            </span>
            <form className="field portal-per-page-field" method="get">
              {tenantScope.selectedShopId ? <input name="shop_id" type="hidden" value={tenantScope.selectedShopId} /> : null}
              {query ? <input name="q" type="hidden" value={query} /> : null}
              {quickFilter !== "all" ? <input name="quick" type="hidden" value={quickFilter} /> : null}
              <label htmlFor="portal-orders-per-page">Por página</label>
              <select defaultValue={String(perPage)} id="portal-orders-per-page" name="per_page">
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="250">250</option>
                <option value="500">500</option>
              </select>
              <input name="page" type="hidden" value="1" />
              <button className="button button-secondary" type="submit">Aplicar</button>
            </form>
          </div>
        </div>

        {orders.length === 0 ? (
          <EmptyState title="Sin pedidos visibles" description="No hemos encontrado pedidos con esos filtros. Prueba otro estado o limpia la búsqueda." />
        ) : (
          <div className="portal-orders-list">
            {orders.map((order) => {
              const items = getOrderItems(order);
              const stage = clientOrderStageMeta[getClientOrderStage(order)];
              const latestEvent = getLatestTrackingEvent(order);
              return (
                <article className="portal-order-row" key={order.id}>
                  <div className="portal-order-row-main">
                    <div className="portal-order-row-top">
                      <div>
                        <Link className="table-link table-link-strong" href={`/portal/orders/${order.id}`}>
                          {order.external_id}
                        </Link>
                        <div className="table-secondary">
                          {order.customer_name} · {formatDateTime(order.created_at)}
                        </div>
                      </div>
                      <span className={stage.badgeClassName}>{stage.label}</span>
                    </div>

                    <div className="portal-order-row-grid">
                      <div>
                        <span className="portal-summary-label">Productos</span>
                        {items.length > 0 ? (
                          <div className="portal-order-items-list">
                            {items.map((item) => (
                              <div className="portal-order-item-line" key={item.id}>
                                <div className="portal-order-item-top">
                                  <strong>{item.title ?? item.name}</strong>
                                  {(item.quantity ?? 0) > 1 ? (
                                    <span className="badge badge-quantity">x{item.quantity}</span>
                                  ) : null}
                                </div>
                                <div className="table-secondary">
                                  {item.variant_title ?? "Sin variante"}
                                  {(item.quantity ?? 0) > 1 ? " · misma línea de Shopify" : ""}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <>
                            <strong>Sin producto</strong>
                            <div className="table-secondary">No hay líneas disponibles</div>
                          </>
                        )}
                      </div>
                      <div>
                        <span className="portal-summary-label">Tracking</span>
                        {order.shipment?.tracking_number ? (
                          <>
                            <strong>
                              {order.shipment.tracking_url ? (
                                <a className="table-link" href={order.shipment.tracking_url} rel="noreferrer" target="_blank">
                                  {order.shipment.tracking_number}
                                </a>
                              ) : (
                                order.shipment.tracking_number
                              )}
                            </strong>
                            <div className="table-secondary">{order.shipment.carrier || "Carrier asignado"}</div>
                          </>
                        ) : (
                          <>
                            <strong>Pendiente</strong>
                            <div className="table-secondary">Todavía sin número de seguimiento</div>
                          </>
                        )}
                      </div>
                      <div>
                        <span className="portal-summary-label">Última actualización</span>
                        <strong>{formatDateTime(latestEvent?.occurred_at ?? order.shipment?.created_at ?? order.created_at)}</strong>
                        <div className="table-secondary">{latestEvent?.status_raw ?? stage.description}</div>
                      </div>
                    </div>
                  </div>

                  <div className="portal-order-row-actions">
                    <Link className="button button-secondary" href={`/portal/orders/${order.id}`}>
                      Ver detalle
                    </Link>
                    {order.shipment?.tracking_url ? (
                      <a className="button button-secondary" href={order.shipment.tracking_url} rel="noreferrer" target="_blank">
                        Ver tracking
                      </a>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <div className="pagination-row">
          <Link
            className={`button-secondary ${safePage <= 1 ? "button-disabled" : ""}`}
            href={{
              pathname: "/portal/orders",
              query: {
                q: query || undefined,
                quick: quickFilter === "all" ? undefined : quickFilter,
                per_page: String(perPage),
                page: String(Math.max(safePage - 1, 1)),
                ...(tenantScope.selectedShopId ? { shop_id: tenantScope.selectedShopId } : {}),
              },
            }}
          >
            Anterior
          </Link>
          <div className="table-secondary">Página {safePage} de {pageCount} · {totalCount} pedidos</div>
          <Link
            className={`button-secondary ${safePage >= pageCount ? "button-disabled" : ""}`}
            href={{
              pathname: "/portal/orders",
              query: {
                q: query || undefined,
                quick: quickFilter === "all" ? undefined : quickFilter,
                per_page: String(perPage),
                page: String(Math.min(safePage + 1, pageCount)),
                ...(tenantScope.selectedShopId ? { shop_id: tenantScope.selectedShopId } : {}),
              },
            }}
          >
            Siguiente
          </Link>
        </div>
      </Card>
    </div>
  );
}
