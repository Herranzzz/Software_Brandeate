import { PortalSyncButton } from "@/components/portal-sync-button";
import {
  SharedShipmentsView,
  getDefaultShipmentDateRange,
  getShipmentDateRange,
  type ShipmentPeriod,
  type ShipmentQuickFilter,
} from "@/components/shared-shipments-view";
import { fetchAnalyticsOverview, fetchOrders, fetchShopifyIntegrations, fetchShops } from "@/lib/api";
import { requireAdminUser } from "@/lib/auth";
import type { AnalyticsOverview } from "@/lib/types";

type ShipmentsPageProps = {
  searchParams: Promise<{
    shop_id?: string;
    per_page?: string;
    q?: string;
    quick?: string;
    period?: string;
    date_from?: string;
    date_to?: string;
    selected?: string;
  }>;
};

export default async function ShipmentsPage({ searchParams }: ShipmentsPageProps) {
  const params = await searchParams;
  const period = (params.period === "30d" || params.period === "ytd" || params.period === "custom" ? params.period : "7d") as ShipmentPeriod;
  const defaultRange = period === "custom" ? getDefaultShipmentDateRange() : getShipmentDateRange(period);
  const dateFrom = params.date_from ?? defaultRange.dateFrom;
  const dateTo = params.date_to ?? defaultRange.dateTo;
  const q = params.q?.trim() ?? "";
  const quick = params.quick ?? "all";
  const perPage = Math.min(Math.max(Number(params.per_page ?? "100") || 100, 1), 500);

  const [userResult, ordersResult, shopsResult, integrationsResult, analyticsResult] = await Promise.allSettled([
    requireAdminUser(),
    fetchOrders({
      shop_id: params.shop_id,
      per_page: perPage,
    }).then(({ orders }) => orders),
    fetchShops(),
    fetchShopifyIntegrations(),
    fetchAnalyticsOverview({
      shop_id: params.shop_id,
      date_from: dateFrom,
      date_to: dateTo,
    }),
  ]);
  if (userResult.status === "rejected") throw userResult.reason;
  const orders = ordersResult.status === "fulfilled" ? ordersResult.value : [];
  const shops = shopsResult.status === "fulfilled" ? shopsResult.value : [];
  const integrations = integrationsResult.status === "fulfilled" ? integrationsResult.value : [];
  const analytics = analyticsResult.status === "fulfilled" ? analyticsResult.value : null;

  return (
    <SharedShipmentsView
      allowAllShops
      analytics={analytics}
      basePath="/shipments"
      dateFrom={dateFrom}
      dateTo={dateTo}
      detailBasePath="/orders"
      heroEyebrow="Expediciones"
      integrations={integrations}
      orders={orders}
      perPage={perPage}
      period={period}
      q={q}
      quick={quick as ShipmentQuickFilter}
      selected={params.selected}
      selectedShopId={params.shop_id ?? ""}
      shops={shops}
      syncHint="Selecciona una tienda para sincronizar."
      syncSlot={params.shop_id ? <PortalSyncButton shopId={Number(params.shop_id)} /> : undefined}
      subtitle="Seguimiento, atención y control de expediciones centrado en CTT Express, con una única vista operativa."
      title="Expediciones"
    />
  );
}
