import { AdminInventoryPanel } from "@/components/admin-inventory-panel";
import { PageHeader } from "@/components/page-header";
import { requireAdminUser } from "@/lib/auth";
import {
  fetchInventoryItems,
  fetchInboundShipments,
  fetchStockMovements,
  fetchInventoryAlerts,
  fetchShops,
} from "@/lib/api";

type AdminInventarioPageProps = {
  searchParams?: Promise<{ shop_id?: string }>;
};

export default async function AdminInventarioPage({
  searchParams,
}: AdminInventarioPageProps) {
  await requireAdminUser();
  const params = (await searchParams) ?? {};
  const shopId = params.shop_id ? Number(params.shop_id) : undefined;

  const [
    itemsResult,
    inboundResult,
    movementsResult,
    alertsResult,
    shopsResult,
  ] = await Promise.allSettled([
    fetchInventoryItems({ shop_id: shopId, per_page: 200 }),
    fetchInboundShipments({ shop_id: shopId, per_page: 50 }),
    fetchStockMovements({ shop_id: shopId, per_page: 100 }),
    fetchInventoryAlerts({ shop_id: shopId }),
    fetchShops(),
  ]);

  const items =
    itemsResult.status === "fulfilled" ? itemsResult.value.items : [];
  const inboundShipments =
    inboundResult.status === "fulfilled"
      ? inboundResult.value.shipments
      : [];
  const movements =
    movementsResult.status === "fulfilled"
      ? movementsResult.value.movements
      : [];
  const alerts =
    alertsResult.status === "fulfilled" ? alertsResult.value.items : [];
  const shops =
    shopsResult.status === "fulfilled" ? shopsResult.value : [];

  return (
    <div className="stack">
      <PageHeader
        description="Control de stock en tiempo real, recepción de mercancía y trazabilidad completa de movimientos."
        eyebrow="SGA"
        title="Sistema de Gestión de Almacén"
      />

      {/* Shop filter */}
      {shops.length > 1 && (
        <form className="portal-filter-row" method="get">
          <label className="field" style={{ maxWidth: 280 }}>
            <span>Filtrar por cliente</span>
            <select defaultValue={params.shop_id ?? ""} name="shop_id">
              <option value="">Todos los clientes</option>
              {shops.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <button className="button-secondary" type="submit">
            Ver
          </button>
        </form>
      )}

      <AdminInventoryPanel
        alerts={alerts}
        inboundShipments={inboundShipments}
        isAdmin={true}
        items={items}
        movements={movements}
      />
    </div>
  );
}
