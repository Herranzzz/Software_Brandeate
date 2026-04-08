import { PortalSyncButton } from "@/components/portal-sync-button";
import {
  SharedShipmentsView,
  getDefaultShipmentDateRange,
  getShipmentDateRange,
  type ShipmentPeriod,
} from "@/components/shared-shipments-view";
import { fetchAnalyticsOverview, fetchShopifyIntegrations, fetchShops } from "@/lib/api";
import { requireAdminUser } from "@/lib/auth";

type ShipmentsPageProps = {
  searchParams: Promise<{
    shop_id?: string;
    period?: string;
    date_from?: string;
    date_to?: string;
  }>;
};

export default async function ShipmentsPage({ searchParams }: ShipmentsPageProps) {
  const params = await searchParams;
  const period = (params.period === "30d" || params.period === "ytd" || params.period === "custom" ? params.period : "7d") as ShipmentPeriod;
  const defaultRange = period === "custom" ? getDefaultShipmentDateRange() : getShipmentDateRange(period);
  const dateFrom = params.date_from ?? defaultRange.dateFrom;
  const dateTo = params.date_to ?? defaultRange.dateTo;

  const [userResult, shopsResult, integrationsResult, analyticsResult] = await Promise.allSettled([
    requireAdminUser(),
    fetchShops(),
    fetchShopifyIntegrations(),
    fetchAnalyticsOverview({
      shop_id: params.shop_id,
      date_from: dateFrom,
      date_to: dateTo,
    }),
  ]);
  if (userResult.status === "rejected") throw userResult.reason;
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
      heroEyebrow="Expediciones"
      integrations={integrations}
      period={period}
      selectedShopId={params.shop_id ?? ""}
      shops={shops}
      syncHint="Selecciona una tienda para sincronizar."
      syncSlot={params.shop_id ? <PortalSyncButton shopId={Number(params.shop_id)} /> : undefined}
      subtitle="Panorama global de envíos, SLA, aging y puntos de fricción, sin mesa operativa ni sesgo por muestreo."
      title="Analytics de expediciones"
    />
  );
}
