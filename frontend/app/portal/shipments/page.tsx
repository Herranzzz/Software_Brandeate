import {
  SharedShipmentsView,
  getDefaultShipmentDateRange,
  getShipmentDateRange,
  type ShipmentPeriod,
  type ShipmentQuickFilter,
} from "@/components/shared-shipments-view";
import { fetchAnalyticsOverview, fetchOrders, fetchShopifyIntegrations } from "@/lib/api";
import { fetchMyShops, requirePortalUser } from "@/lib/auth";
import { resolveTenantScope } from "@/lib/tenant-scope";

type PortalShipmentsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function PortalShipmentsPage({ searchParams }: PortalShipmentsPageProps) {
  await requirePortalUser();
  const params = (await searchParams) ?? {};
  const shops = await fetchMyShops();
  const tenantScope = resolveTenantScope(shops, readValue(params.shop_id));
  const period = (readValue(params.period) === "30d" || readValue(params.period) === "ytd" || readValue(params.period) === "custom"
    ? readValue(params.period)
    : "7d") as ShipmentPeriod;
  const defaults = period === "custom" ? getDefaultShipmentDateRange() : getShipmentDateRange(period);
  const dateFrom = readValue(params.date_from) ?? defaults.dateFrom;
  const dateTo = readValue(params.date_to) ?? defaults.dateTo;
  const q = (readValue(params.q) ?? "").trim();
  const quick = readValue(params.quick) ?? "all";
  const perPage = Math.min(Math.max(Number(readValue(params.per_page) ?? "100") || 100, 1), 500);
  const tenantShopIds = tenantScope.shops.map((shop) => shop.id);

  const [orders, integrations, analytics] = await Promise.all([
    fetchOrders(tenantScope.selectedShopId ? { shop_id: tenantScope.selectedShopId, per_page: perPage } : { per_page: perPage })
      .then(({ orders }) => orders),
    fetchShopifyIntegrations(),
    fetchAnalyticsOverview({
      date_from: dateFrom,
      date_to: dateTo,
      shop_id: tenantScope.selectedShopId,
    }),
  ]);

  return (
    <SharedShipmentsView
      analytics={analytics}
      basePath="/portal/shipments"
      dateFrom={dateFrom}
      dateTo={dateTo}
      detailBasePath="/portal/orders"
      heroEyebrow="Expediciones"
      integrations={integrations.filter((integration) => tenantShopIds.includes(integration.shop_id))}
      orders={orders}
      perPage={perPage}
      period={period}
      q={q}
      quick={quick as ShipmentQuickFilter}
      selectedShopId={tenantScope.selectedShopId}
      shops={tenantScope.shops}
      subtitle="La misma vista de expediciones que en admin, limitada automáticamente a tu cuenta."
      title="Expediciones"
    />
  );
}
