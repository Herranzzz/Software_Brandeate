import { PageHeader } from "@/components/page-header";
import { SuppliersPanel } from "@/components/suppliers-panel";
import { fetchInventoryItems, fetchShops, fetchSuppliers } from "@/lib/api";
import { requireAdminUser } from "@/lib/auth";

type SuppliersPageProps = {
  searchParams?: Promise<{ shop_id?: string }>;
};

export default async function SuppliersPage({ searchParams }: SuppliersPageProps) {
  await requireAdminUser();
  const params = (await searchParams) ?? {};
  const shopId = params.shop_id ? Number(params.shop_id) : undefined;

  const [suppliersResult, shopsResult, itemsResult] = await Promise.allSettled([
    fetchSuppliers({ shop_id: shopId, per_page: 200 }),
    fetchShops(),
    fetchInventoryItems({ shop_id: shopId, per_page: 500 }),
  ]);

  const suppliers =
    suppliersResult.status === "fulfilled" ? suppliersResult.value.suppliers : [];
  const shops = shopsResult.status === "fulfilled" ? shopsResult.value : [];
  const items =
    itemsResult.status === "fulfilled" ? itemsResult.value.items : [];

  return (
    <div className="stack">
      <PageHeader
        description="Gestiona proveedores, productos vinculados, precios y plazos de entrega."
        eyebrow="SGA"
        title="Proveedores"
      />

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

      <SuppliersPanel
        initialSuppliers={suppliers}
        inventoryItems={items}
        shopId={shopId}
        shops={shops}
      />
    </div>
  );
}
