import { PageHeader } from "@/components/page-header";
import { PortalInventoryPanel } from "@/components/portal-inventory-panel";
import { PortalTenantControl } from "@/components/portal-tenant-control";
import { fetchInventoryItems, fetchInboundShipments, fetchInventoryAlerts } from "@/lib/api";
import { fetchMyShops, requirePortalUser } from "@/lib/auth";
import { resolveTenantScope } from "@/lib/tenant-scope";
import { KpiCard } from "@/components/kpi-card";

type PortalInventoryPageProps = {
  searchParams?: Promise<{ shop_id?: string }>;
};

export default async function PortalInventoryPage({ searchParams }: PortalInventoryPageProps) {
  await requirePortalUser();
  const params = (await searchParams) ?? {};
  const shops = await fetchMyShops();
  const tenantScope = resolveTenantScope(shops, params.shop_id);
  const shopId = tenantScope.selectedShopId
    ? Number(tenantScope.selectedShopId)
    : tenantScope.shops[0]?.id ?? null;

  const [itemsResult, inboundResult, alertsResult] = await Promise.allSettled([
    shopId ? fetchInventoryItems({ shop_id: shopId, per_page: 200 }) : Promise.resolve({ items: [], total: 0 }),
    shopId ? fetchInboundShipments({ shop_id: shopId, per_page: 50 }) : Promise.resolve({ shipments: [], total: 0 }),
    shopId ? fetchInventoryAlerts({ shop_id: shopId }) : Promise.resolve({ items: [], total: 0 }),
  ]);

  const items = itemsResult.status === "fulfilled" ? itemsResult.value.items : [];
  const inboundShipments = inboundResult.status === "fulfilled" ? inboundResult.value.shipments : [];
  const alerts = alertsResult.status === "fulfilled" ? alertsResult.value.items : [];

  const totalStock = items.reduce((s, i) => s + i.stock_on_hand, 0);
  const pendingInbound = inboundShipments.filter(s => s.status === "sent" || s.status === "in_transit").length;

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Mi inventario"
        title="Stock en almacén Brandeate"
        description="Gestiona tu mercancía, crea notas de envío y sigue el estado de tus entradas en tiempo real."
      />

      <PortalTenantControl
        action="/portal/inventory"
        selectedShopId={tenantScope.selectedShopId}
        shops={tenantScope.shops}
        submitLabel="Ver"
      />

      <section className="portal-returns-kpis">
        <KpiCard label="SKUs en almacén" tone="accent" value={String(items.length)} delta="referencias activas" />
        <KpiCard label="Unidades totales" tone="default" value={String(totalStock)} delta="stock disponible" />
        <KpiCard label="Alertas reposición" tone={alerts.length > 0 ? "danger" : "success"} value={String(alerts.length)} delta="por debajo del mínimo" />
        <KpiCard label="Entradas en curso" tone={pendingInbound > 0 ? "warning" : "default"} value={String(pendingInbound)} delta="enviadas o en tránsito" />
      </section>

      {shopId ? (
        <PortalInventoryPanel
          alerts={alerts}
          inboundShipments={inboundShipments}
          items={items}
          shopId={shopId}
        />
      ) : (
        <div className="sga-empty">
          <div className="sga-empty-icon">🏪</div>
          <p className="sga-empty-title">Sin tienda seleccionada</p>
          <p className="sga-empty-sub">Selecciona una tienda para ver el inventario.</p>
        </div>
      )}
    </div>
  );
}
