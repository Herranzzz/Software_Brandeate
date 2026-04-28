import Link from "next/link";

import {
  SharedShipmentsView,
  getDefaultShipmentDateRange,
  getShipmentDateRange,
  type ShipmentPeriod,
} from "@/components/shared-shipments-view";
import { ProductionFunnel } from "@/components/production-funnel";
import { ShipmentGlobe } from "@/components/shipment-globe";
import { fetchAnalyticsOverview, fetchOrders, fetchShopifyIntegrations, fetchShops } from "@/lib/api";
import { requireAdminUser } from "@/lib/auth";
import type { Order } from "@/lib/types";

type ShipmentsPageProps = {
  searchParams: Promise<{
    shop_id?: string;
    period?: string;
    date_from?: string;
    date_to?: string;
    shipping_status?: string;
    q?: string;
    page?: string;
  }>;
};

function formatCompact(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
}

function getShippingLabel(status?: string | null) {
  const map: Record<string, { label: string; tone: string }> = {
    label_created:    { label: "Etiqueta",    tone: "slate" },
    picked_up:        { label: "Recogido",    tone: "blue" },
    in_transit:       { label: "En tránsito", tone: "blue" },
    out_for_delivery: { label: "En reparto",  tone: "orange" },
    delivered:        { label: "Entregado",   tone: "green" },
    exception:        { label: "Excepción",   tone: "red" },
  };
  return map[status ?? ""] ?? { label: "Sin envío", tone: "muted" };
}

export default async function ShipmentsPage({ searchParams }: ShipmentsPageProps) {
  const params = await searchParams;
  const VALID_STATUSES = ["label_created", "picked_up", "in_transit", "out_for_delivery", "delivered", "exception"] as const;
  type ValidStatus = typeof VALID_STATUSES[number];
  const shippingStatus: ValidStatus | "all" = VALID_STATUSES.includes(params.shipping_status as ValidStatus)
    ? (params.shipping_status as ValidStatus)
    : "all";
  const period = (["1d", "ayer", "7d", "30d", "ytd", "custom"].includes(params.period ?? "") ? params.period : "7d") as ShipmentPeriod;
  const defaultRange = period === "custom" ? getDefaultShipmentDateRange() : getShipmentDateRange(period);
  const dateFrom = params.date_from ?? defaultRange.dateFrom;
  const dateTo = params.date_to ?? defaultRange.dateTo;
  const searchQuery = params.q?.trim() ?? "";
  const ordersPage = Math.max(Number(params.page ?? "1") || 1, 1);

  const [userResult, shopsResult, integrationsResult, analyticsResult, ordersResult] = await Promise.allSettled([
    requireAdminUser(),
    fetchShops(),
    fetchShopifyIntegrations(),
    fetchAnalyticsOverview({
      shop_id: params.shop_id,
      date_from: dateFrom,
      date_to: dateTo,
      shipping_status: shippingStatus === "all" ? undefined : shippingStatus,
    }),
    fetchOrders({
      page: ordersPage,
      per_page: 50,
      q: searchQuery || undefined,
      shipping_status: shippingStatus === "all" ? undefined : shippingStatus,
      ...(params.shop_id ? { shop_id: Number(params.shop_id) } : {}),
    }),
  ]);
  if (userResult.status === "rejected") throw userResult.reason;
  const shops = shopsResult.status === "fulfilled" ? shopsResult.value : [];
  const integrations = integrationsResult.status === "fulfilled" ? integrationsResult.value : [];
  const analytics = analyticsResult.status === "fulfilled" ? analyticsResult.value : null;
  const ordersPayload = ordersResult.status === "fulfilled" ? ordersResult.value : { orders: [], totalCount: 0 };
  const orders: Order[] = ordersPayload.orders;
  const totalOrderCount = ordersPayload.totalCount;

  // Compute criticalCount for the banner (same logic as SharedShipmentsView)
  const attentionData = analytics?.attention;
  const operationalData = analytics?.operational as Record<string, number> | undefined;
  const criticalCount = attentionData
    ? (attentionData.carrier_exception ?? 0) + (attentionData.outside_sla ?? 0) + (attentionData.tracking_stalled ?? 0)
    : ((operationalData?.stalled_tracking_orders ?? 0) + (operationalData?.outside_sla_orders ?? 0) + ((analytics?.shipping as Record<string, number> | undefined)?.exception_orders ?? 0));

  const pageCount = Math.max(1, Math.ceil(totalOrderCount / 50));
  const safePage = Math.min(ordersPage, pageCount);

  function buildOrderListUrl(overrides: Record<string, string | undefined>) {
    const sp = new URLSearchParams();
    if (params.shop_id) sp.set("shop_id", params.shop_id);
    sp.set("period", period);
    if (params.date_from) sp.set("date_from", params.date_from);
    if (params.date_to) sp.set("date_to", params.date_to);
    if (shippingStatus !== "all") sp.set("shipping_status", shippingStatus);
    for (const [k, v] of Object.entries(overrides)) {
      if (v) sp.set(k, v); else sp.delete(k);
    }
    return `/shipments?${sp.toString()}`;
  }

  return (
    <div className="stack">
      {/* Analytics view — no banner, no cola operativa */}
      <SharedShipmentsView
        allowAllShops
        analytics={analytics}
        basePath="/shipments"
        dateFrom={dateFrom}
        dateTo={dateTo}
        heroEyebrow="Analítica"
        hideBanner
        hideAttentionTable
        integrations={integrations}
        period={period}
        selectedShopId={params.shop_id ?? ""}
        selectedShippingStatus={shippingStatus}
        shops={shops}
        syncHint="Selecciona una tienda para sincronizar."
        subtitle="Panorama global de envíos, SLA, aging y puntos de fricción."
        title="Analítica de expediciones"
      />

      {/* Production funnel */}
      {analytics?.flow && (
        <div className="card stack">
          <div>
            <span className="eyebrow">Producción</span>
            <h3 className="section-title section-title-small">Funnel de producción</h3>
          </div>
          <ProductionFunnel flow={analytics.flow} />
        </div>
      )}

      {/* Shipment globe */}
      <div className="card stack sglobe-card">
        <div>
          <span className="eyebrow">Distribución geográfica</span>
          <h3 className="section-title section-title-small">Globo interactivo de pedidos</h3>
          <p className="table-secondary">Los arcos muestran el flujo desde el almacén hasta cada provincia. Arrastra para rotar.</p>
        </div>
        <ShipmentGlobe dateFrom={dateFrom} dateTo={dateTo} shopId={params.shop_id} />
        <div className="smap-legend">
          <span className="smap-legend-item"><span className="smap-dot" style={{ background: "#ef4444" }} /> Excepción</span>
          <span className="smap-legend-item"><span className="smap-dot" style={{ background: "#f59e0b" }} /> En reparto</span>
          <span className="smap-legend-item"><span className="smap-dot" style={{ background: "#3b82f6" }} /> En tránsito</span>
          <span className="smap-legend-item"><span className="smap-dot" style={{ background: "#22c55e" }} /> Entregado</span>
          <span className="smap-legend-item"><span className="smap-dot" style={{ background: "#a78bfa" }} /> Sin envío activo</span>
        </div>
      </div>

      {/* Alert banner — moved below analytics */}
      {criticalCount > 0 && (
        <div className={`exp-alert-banner${criticalCount >= 10 ? " is-critical" : " is-warning"}`}>
          <span className="exp-alert-banner-icon">{criticalCount >= 10 ? "🚨" : "⚠️"}</span>
          <div className="exp-alert-banner-content">
            <strong>{criticalCount} expedición{criticalCount !== 1 ? "es" : ""} requieren acción inmediata</strong>
          </div>
        </div>
      )}

      {/* Order list — portal style */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {/* Search toolbar */}
        <div className="sh-orders-toolbar">
          <form action="/shipments" className="sh-orders-search-form" method="get">
            {params.shop_id && <input name="shop_id" type="hidden" value={params.shop_id} />}
            <input name="period" type="hidden" value={period} />
            {params.date_from && <input name="date_from" type="hidden" value={params.date_from} />}
            {params.date_to && <input name="date_to" type="hidden" value={params.date_to} />}
            {shippingStatus !== "all" && <input name="shipping_status" type="hidden" value={shippingStatus} />}
            <input name="page" type="hidden" value="1" />
            <input
              className="sh-orders-search-input"
              defaultValue={searchQuery}
              name="q"
              placeholder="Buscar pedido, cliente, SKU, tracking…"
              type="search"
            />
            <button className="sh-orders-search-btn" type="submit">Buscar</button>
            {searchQuery && (
              <Link className="sh-orders-clear-btn" href={buildOrderListUrl({ q: undefined, page: "1" })}>
                Limpiar
              </Link>
            )}
          </form>
          <span className="sh-orders-count">
            {searchQuery
              ? `${totalOrderCount} resultado${totalOrderCount !== 1 ? "s" : ""} para «${searchQuery}»`
              : `${totalOrderCount} pedidos`}
          </span>
        </div>

        {/* Status filter pills */}
        <div className="sh-status-filters">
          {([
            { key: "all",              label: "Todos",        emoji: "📦" },
            { key: "label_created",    label: "Etiqueta",     emoji: "🏷️" },
            { key: "picked_up",        label: "Recogido",     emoji: "🚚" },
            { key: "in_transit",       label: "En tránsito",  emoji: "📡" },
            { key: "out_for_delivery", label: "En reparto",   emoji: "🚛" },
            { key: "delivered",        label: "Entregado",    emoji: "✅" },
            { key: "exception",        label: "Incidencia",   emoji: "🚨" },
          ] as const).map((s) => (
            <Link
              key={s.key}
              href={buildOrderListUrl({ shipping_status: s.key === "all" ? undefined : s.key, page: "1" })}
              className={`sh-status-pill${shippingStatus === s.key ? " is-active" : ""}`}
            >
              <span>{s.emoji}</span>
              <span>{s.label}</span>
            </Link>
          ))}
        </div>

        {/* Table */}
        {orders.length === 0 ? (
          <div className="sh-orders-empty">
            {searchQuery ? `Sin resultados para «${searchQuery}»` : "Sin pedidos disponibles."}
          </div>
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
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => {
                const shippingMeta = getShippingLabel(order.shipment?.shipping_status);
                const trackingNum = order.shipment?.tracking_number ?? null;
                const rawId = String(order.external_id ?? "");
                const displayId = rawId.startsWith("#") ? rawId : `#${rawId}`;
                const primaryItem = order.items[0];
                const productName = primaryItem?.title ?? primaryItem?.name ?? "—";
                const variantName = primaryItem?.variant_title ?? "";

                return (
                  <tr className="po-row" key={order.id}>
                    <td className="po-td po-td-id">
                      <Link className="po-link" href={`/orders/${order.id}`}>{displayId}</Link>
                    </td>
                    <td className="po-td po-td-customer">
                      <span className="po-customer-name">{order.customer_name}</span>
                    </td>
                    <td className="po-td po-td-date">{formatCompact(order.created_at)}</td>
                    <td className="po-td po-td-product">
                      <div className="po-product-lines">
                        <div className="po-product-line">
                          <span className="po-product-name">{productName.length > 44 ? `${productName.slice(0, 42)}…` : productName}</span>
                          {variantName && <span className="po-product-variant">{variantName}</span>}
                        </div>
                        {order.items.length > 1 && (
                          <span className="muted" style={{ fontSize: "0.75rem" }}>+{order.items.length - 1} más</span>
                        )}
                      </div>
                    </td>
                    <td className="po-td">
                      <span className="badge" style={{ fontSize: "0.7rem", padding: "2px 8px" }}>
                        {order.status}
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {pageCount > 1 && (
          <div className="po-pagination" style={{ borderTop: "1px solid var(--border)", padding: "12px 20px" }}>
            <Link
              className={`po-page-btn${safePage <= 1 ? " po-page-disabled" : ""}`}
              href={buildOrderListUrl({ page: String(Math.max(safePage - 1, 1)), q: searchQuery || undefined })}
            >
              ← Anterior
            </Link>
            <span className="po-page-info">
              {safePage}/{pageCount} · <strong>{totalOrderCount}</strong> pedidos
            </span>
            <Link
              className={`po-page-btn${safePage >= pageCount ? " po-page-disabled" : ""}`}
              href={buildOrderListUrl({ page: String(Math.min(safePage + 1, pageCount)), q: searchQuery || undefined })}
            >
              Siguiente →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
