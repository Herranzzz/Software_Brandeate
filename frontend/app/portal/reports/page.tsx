import { Card } from "@/components/card";
import { PageHeader } from "@/components/page-header";
import { PortalReportsPanel } from "@/components/portal-reports-panel";
import { PortalTenantControl } from "@/components/portal-tenant-control";
import { fetchIncidents, fetchOrders } from "@/lib/api";
import { fetchMyShops, requirePortalUser } from "@/lib/auth";
import { resolveTenantScope } from "@/lib/tenant-scope";

type PortalReportsPageProps = {
  searchParams?: Promise<{ shop_id?: string }>;
};

export default async function PortalReportsPage({ searchParams }: PortalReportsPageProps) {
  await requirePortalUser();
  const params = (await searchParams) ?? {};
  const shops = await fetchMyShops();
  const tenantScope = resolveTenantScope(shops, params.shop_id);

  const shopFilter = tenantScope.selectedShopId ? { shop_id: tenantScope.selectedShopId } : {};

  const [ordersResult, incidentsResult] = await Promise.allSettled([
    fetchOrders({ page: 1, per_page: 500, ...shopFilter }).then((r) => r.orders),
    fetchIncidents({ page: 1, per_page: 500, ...shopFilter }),
  ]);

  const orders = ordersResult.status === "fulfilled" ? ordersResult.value : [];
  const incidents = incidentsResult.status === "fulfilled" ? incidentsResult.value : [];

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Informes"
        title="Reporting y exportaciones"
        description="Informes predefinidos para fulfillment, costes, devoluciones y comparativa mensual. Exporta a CSV con un clic."
      />

      <PortalTenantControl
        action="/portal/reports"
        selectedShopId={tenantScope.selectedShopId}
        shops={tenantScope.shops}
        submitLabel="Ver"
      />

      <Card className="stack settings-section-card portal-glass-card">
        <PortalReportsPanel orders={orders} incidents={incidents} />
      </Card>
    </div>
  );
}
