import { Card } from "@/components/card";
import { PageHeader } from "@/components/page-header";
import { PortalSustainabilityPanel } from "@/components/portal-sustainability-panel";
import { PortalTenantControl } from "@/components/portal-tenant-control";
import { fetchOrders } from "@/lib/api";
import { fetchMyShops, requirePortalUser } from "@/lib/auth";
import { resolveTenantScope } from "@/lib/tenant-scope";

type PortalSustainabilityPageProps = {
  searchParams?: Promise<{ shop_id?: string }>;
};

export default async function PortalSustainabilityPage({ searchParams }: PortalSustainabilityPageProps) {
  await requirePortalUser();
  const params = (await searchParams) ?? {};
  const shops = await fetchMyShops();
  const tenantScope = resolveTenantScope(shops, params.shop_id);

  const ordersResult = await fetchOrders({
    page: 1,
    per_page: 500,
    ...(tenantScope.selectedShopId ? { shop_id: tenantScope.selectedShopId } : {}),
  }).catch(() => ({ orders: [] }));

  const orders = ordersResult.orders ?? [];

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Sostenibilidad"
        title="Huella de carbono logística"
        description="Estimación de emisiones CO₂ por envío, comparativa de carriers y badge Brandeate Green para marcas que superan los umbrales de eficiencia."
      />

      <PortalTenantControl
        action="/portal/sustainability"
        selectedShopId={tenantScope.selectedShopId}
        shops={tenantScope.shops}
        submitLabel="Ver"
      />

      <Card className="stack settings-section-card portal-glass-card">
        <PortalSustainabilityPanel orders={orders} />
      </Card>
    </div>
  );
}
