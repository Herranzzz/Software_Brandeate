import {
  SharedShipmentsView,
  getDefaultShipmentDateRange,
  getShipmentDateRange,
  type ShipmentPeriod,
} from "@/components/shared-shipments-view";
import { fetchAnalyticsOverview, fetchShopifyIntegrations, fetchOrders } from "@/lib/api";
import { fetchMyShops, requirePortalUser } from "@/lib/auth";
import { resolveTenantScope } from "@/lib/tenant-scope";
import { PortalOrderSearch } from "@/components/portal-order-search";

type PortalShipmentsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function PortalShipmentsPage({ searchParams }: PortalShipmentsPageProps) {
  const [userResult, shopsResult] = await Promise.allSettled([requirePortalUser(), fetchMyShops()]);
  if (userResult.status === "rejected") throw userResult.reason;
  const shops = shopsResult.status === "fulfilled" ? shopsResult.value : [];
  const params = (await searchParams) ?? {};
  const tenantScope = resolveTenantScope(shops, readValue(params.shop_id));
  const period = (readValue(params.period) === "30d" || readValue(params.period) === "ytd" || readValue(params.period) === "custom"
    ? readValue(params.period)
    : "7d") as ShipmentPeriod;
  const shippingStatusRaw = readValue(params.shipping_status);
  const shippingStatus =
    shippingStatusRaw === "picked_up" ||
    shippingStatusRaw === "in_transit" ||
    shippingStatusRaw === "out_for_delivery" ||
    shippingStatusRaw === "delivered"
      ? shippingStatusRaw
      : "all";
  const defaults = period === "custom" ? getDefaultShipmentDateRange() : getShipmentDateRange(period);
  const dateFrom = readValue(params.date_from) ?? defaults.dateFrom;
  const dateTo = readValue(params.date_to) ?? defaults.dateTo;
  const tenantShopIds = tenantScope.shops.map((shop) => shop.id);

  // Order search query
  const searchQuery = readValue(params.q)?.trim() ?? "";

  const [integrationsResult, analyticsResult, searchResult] = await Promise.allSettled([
    fetchShopifyIntegrations(),
    fetchAnalyticsOverview({
      date_from: dateFrom,
      date_to: dateTo,
      shop_id: tenantScope.selectedShopId,
      shipping_status: shippingStatus === "all" ? undefined : shippingStatus,
    }),
    searchQuery
      ? fetchOrders({
          page: 1,
          per_page: 20,
          q: searchQuery,
          ...(tenantScope.selectedShopId ? { shop_id: tenantScope.selectedShopId } : {}),
        })
      : Promise.resolve(null),
  ]);
  const integrations = integrationsResult.status === "fulfilled" ? integrationsResult.value : [];
  const analytics = analyticsResult.status === "fulfilled" ? analyticsResult.value : null;
  const searchOrders = searchResult.status === "fulfilled" && searchResult.value
    ? searchResult.value.orders
    : null;

  return (
    <div className="stack">
      {/* Order search panel */}
      <PortalOrderSearch
        basePath="/portal/shipments"
        initialQuery={searchQuery}
        orders={searchOrders}
        selectedShopId={tenantScope.selectedShopId ? Number(tenantScope.selectedShopId) : null}
      />

      {/* Analytics view */}
      <SharedShipmentsView
        analytics={analytics}
        basePath="/portal/shipments"
        dateFrom={dateFrom}
        dateTo={dateTo}
        heroEyebrow="Analítica"
        integrations={integrations.filter((integration) => tenantShopIds.includes(integration.shop_id))}
        period={period}
        selectedShopId={tenantScope.selectedShopId}
        selectedShippingStatus={shippingStatus}
        shops={tenantScope.shops}
        subtitle="Visión global de la salud logística de tu cuenta: entrega, aging, incidencias y pedidos retrasados."
        title="Analítica de envíos"
      />
    </div>
  );
}
