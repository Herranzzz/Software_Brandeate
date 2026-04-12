import { PortalOrderSearch } from "@/components/portal-order-search";
import { PortalSyncButton } from "@/components/portal-sync-button";
import {
  SharedShipmentsView,
  getDefaultShipmentDateRange,
  getShipmentDateRange,
  type ShipmentPeriod,
} from "@/components/shared-shipments-view";
import { fetchAnalyticsOverview, fetchOrders, fetchShopifyIntegrations, fetchShops } from "@/lib/api";
import { requireAdminUser } from "@/lib/auth";

type ShipmentsPageProps = {
  searchParams: Promise<{
    shop_id?: string;
    period?: string;
    date_from?: string;
    date_to?: string;
    shipping_status?: string;
    q?: string;
  }>;
};

export default async function ShipmentsPage({ searchParams }: ShipmentsPageProps) {
  const params = await searchParams;
  const shippingStatus =
    params.shipping_status === "picked_up" ||
    params.shipping_status === "in_transit" ||
    params.shipping_status === "out_for_delivery" ||
    params.shipping_status === "delivered"
      ? params.shipping_status
      : "all";
  const period = (params.period === "30d" || params.period === "ytd" || params.period === "custom" ? params.period : "7d") as ShipmentPeriod;
  const defaultRange = period === "custom" ? getDefaultShipmentDateRange() : getShipmentDateRange(period);
  const dateFrom = params.date_from ?? defaultRange.dateFrom;
  const dateTo = params.date_to ?? defaultRange.dateTo;
  const searchQuery = params.q?.trim() ?? "";

  const [userResult, shopsResult, integrationsResult, analyticsResult, searchResult] = await Promise.allSettled([
    requireAdminUser(),
    fetchShops(),
    fetchShopifyIntegrations(),
    fetchAnalyticsOverview({
      shop_id: params.shop_id,
      date_from: dateFrom,
      date_to: dateTo,
      shipping_status: shippingStatus === "all" ? undefined : shippingStatus,
    }),
    searchQuery
      ? fetchOrders({
          page: 1,
          per_page: 20,
          q: searchQuery,
          ...(params.shop_id ? { shop_id: Number(params.shop_id) } : {}),
        })
      : Promise.resolve(null),
  ]);
  if (userResult.status === "rejected") throw userResult.reason;
  const shops = shopsResult.status === "fulfilled" ? shopsResult.value : [];
  const integrations = integrationsResult.status === "fulfilled" ? integrationsResult.value : [];
  const analytics = analyticsResult.status === "fulfilled" ? analyticsResult.value : null;
  const searchOrders =
    searchResult.status === "fulfilled" && searchResult.value
      ? searchResult.value.orders
      : null;

  return (
    <div className="stack">
      {/* Order search panel */}
      <PortalOrderSearch
        basePath="/shipments"
        initialQuery={searchQuery}
        orders={searchOrders}
        selectedShopId={params.shop_id ? Number(params.shop_id) : null}
      />

      {/* Analytics view */}
      <SharedShipmentsView
        allowAllShops
        analytics={analytics}
        basePath="/shipments"
        dateFrom={dateFrom}
        dateTo={dateTo}
        heroEyebrow="Analítica"
        integrations={integrations}
        period={period}
        selectedShopId={params.shop_id ?? ""}
        selectedShippingStatus={shippingStatus}
        shops={shops}
        syncHint="Selecciona una tienda para sincronizar."
        syncSlot={params.shop_id ? <PortalSyncButton shopId={Number(params.shop_id)} /> : undefined}
        subtitle="Panorama global de envíos, SLA, aging y puntos de fricción, sin mesa operativa ni sesgo por muestreo."
        title="Analítica de expediciones"
      />
    </div>
  );
}
