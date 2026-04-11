import { Card } from "@/components/card";
import { KpiCard } from "@/components/kpi-card";
import { PageHeader } from "@/components/page-header";
import { PortalInventoryPanel } from "@/components/portal-inventory-panel";
import { PortalTenantControl } from "@/components/portal-tenant-control";
import { fetchOrders } from "@/lib/api";
import { fetchMyShops, requirePortalUser } from "@/lib/auth";
import { resolveTenantScope } from "@/lib/tenant-scope";

type PortalInventoryPageProps = {
  searchParams?: Promise<{ shop_id?: string }>;
};

export default async function PortalInventoryPage({ searchParams }: PortalInventoryPageProps) {
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

  // Server-side derived metrics
  const now = Date.now();
  const ms30 = 30 * 24 * 60 * 60 * 1000;
  const skuSet = new Set<string>();
  let totalUnits30 = 0;

  for (const order of orders) {
    const inLast30 = now - new Date(order.created_at).getTime() <= ms30;
    for (const item of order.items) {
      if (item.sku?.trim()) skuSet.add(item.sku.trim());
      if (inLast30) totalUnits30 += item.quantity;
    }
  }

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Inventario"
        title="Previsión de demanda"
        description="Velocidad de consumo por SKU, días de stock restantes y alertas tempranas para evitar roturas antes de que ocurran."
      />

      <PortalTenantControl
        action="/portal/inventory"
        selectedShopId={tenantScope.selectedShopId}
        shops={tenantScope.shops}
        submitLabel="Ver"
      />

      <section className="portal-returns-kpis">
        <KpiCard label="SKUs activos" tone="accent" value={String(skuSet.size)} delta="referencias detectadas" />
        <KpiCard label="Unidades vendidas" tone="success" value={String(totalUnits30)} delta="últimos 30 días" />
        <KpiCard label="Pedidos analizados" tone="default" value={String(orders.length)} delta="para calcular velocidad" />
      </section>

      <Card className="stack settings-section-card portal-glass-card">
        <div className="settings-section-head">
          <div>
            <span className="eyebrow">📦 Stock</span>
            <h3 className="section-title section-title-small">Niveles de inventario por SKU</h3>
            <p className="subtitle">
              Haz clic en el stock de cualquier SKU para actualizarlo. La previsión se recalcula al momento.
            </p>
          </div>
        </div>
        <PortalInventoryPanel orders={orders} />
      </Card>
    </div>
  );
}
