import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { PurchaseOrderDetailPanel } from "@/components/purchase-order-detail-panel";
import { fetchPurchaseOrder, fetchShops, fetchSupplier } from "@/lib/api";
import { requireAdminUser } from "@/lib/auth";

type PurchaseOrderDetailPageProps = {
  params: Promise<{ poId: string }>;
};

export default async function PurchaseOrderDetailPage({
  params,
}: PurchaseOrderDetailPageProps) {
  await requireAdminUser();
  const { poId } = await params;
  const id = Number(poId);
  if (!Number.isFinite(id)) notFound();

  let purchaseOrder;
  try {
    purchaseOrder = await fetchPurchaseOrder(id);
  } catch {
    notFound();
  }

  const [shopsResult, supplierResult] = await Promise.allSettled([
    fetchShops(),
    fetchSupplier(purchaseOrder.supplier_id),
  ]);

  const shops = shopsResult.status === "fulfilled" ? shopsResult.value : [];
  const supplier =
    supplierResult.status === "fulfilled" ? supplierResult.value : null;
  const shop = shops.find((s) => s.id === purchaseOrder.shop_id) ?? null;

  return (
    <div className="stack">
      <div>
        <Link className="breadcrumb-link" href="/purchase-orders">
          ← Órdenes de compra
        </Link>
      </div>
      <PageHeader
        description={`Cliente: ${shop?.name ?? `#${purchaseOrder.shop_id}`} · Proveedor: ${
          supplier?.name ?? purchaseOrder.supplier_name ?? `#${purchaseOrder.supplier_id}`
        }`}
        eyebrow="SGA"
        title={purchaseOrder.po_number}
      />

      <PurchaseOrderDetailPanel
        initialPO={purchaseOrder}
        shop={shop}
        supplier={supplier}
      />
    </div>
  );
}
