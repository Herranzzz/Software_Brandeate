import { PageHeader } from "@/components/page-header";
import { PurchaseOrdersPanel } from "@/components/purchase-orders-panel";
import {
  fetchInventoryItems,
  fetchPurchaseOrders,
  fetchShops,
  fetchSuppliers,
} from "@/lib/api";
import { requireAdminUser } from "@/lib/auth";
import type { PurchaseOrderStatus } from "@/lib/types";

type PurchaseOrdersPageProps = {
  searchParams?: Promise<{
    shop_id?: string;
    status?: string;
    supplier_id?: string;
  }>;
};

function resolveStatus(value?: string): PurchaseOrderStatus | undefined {
  const valid: PurchaseOrderStatus[] = [
    "draft",
    "sent",
    "confirmed",
    "partially_received",
    "received",
    "cancelled",
  ];
  return valid.includes(value as PurchaseOrderStatus)
    ? (value as PurchaseOrderStatus)
    : undefined;
}

export default async function PurchaseOrdersPage({
  searchParams,
}: PurchaseOrdersPageProps) {
  await requireAdminUser();
  const params = (await searchParams) ?? {};
  const shopId = params.shop_id ? Number(params.shop_id) : undefined;
  const supplierId = params.supplier_id ? Number(params.supplier_id) : undefined;
  const status = resolveStatus(params.status);

  const [poResult, shopsResult, suppliersResult, itemsResult] =
    await Promise.allSettled([
      fetchPurchaseOrders({
        shop_id: shopId,
        supplier_id: supplierId,
        status,
        per_page: 200,
      }),
      fetchShops(),
      fetchSuppliers({ shop_id: shopId, per_page: 500 }),
      fetchInventoryItems({ shop_id: shopId, per_page: 500 }),
    ]);

  const purchaseOrders =
    poResult.status === "fulfilled" ? poResult.value.purchase_orders : [];
  const shops = shopsResult.status === "fulfilled" ? shopsResult.value : [];
  const suppliers =
    suppliersResult.status === "fulfilled"
      ? suppliersResult.value.suppliers
      : [];
  const items =
    itemsResult.status === "fulfilled" ? itemsResult.value.items : [];

  return (
    <div className="stack">
      <PageHeader
        description="Crea órdenes de compra, sigue su estado y recibe la mercancía en almacén."
        eyebrow="SGA"
        title="Órdenes de compra"
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

      <PurchaseOrdersPanel
        initialPurchaseOrders={purchaseOrders}
        initialStatus={status}
        initialSupplierId={supplierId}
        inventoryItems={items}
        shopId={shopId}
        shops={shops}
        suppliers={suppliers}
      />
    </div>
  );
}
