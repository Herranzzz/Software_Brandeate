import { PrintQueuePanel } from "@/components/print-queue-panel";
import { fetchOrders, fetchShops } from "@/lib/api";
import { requireAdminUser } from "@/lib/auth";


export const dynamic = "force-dynamic";


type PrintQueuePageProps = {
  searchParams: Promise<{
    shop_id?: string;
  }>;
};


export default async function PrintQueuePage({ searchParams }: PrintQueuePageProps) {
  await requireAdminUser();

  const params = await searchParams;
  const shopId = params.shop_id && params.shop_id.trim() !== "" ? params.shop_id : undefined;

  const [ordersResult, shopsResult] = await Promise.allSettled([
    // Prepared + no shipment yet = the exact set that still needs a label.
    // per_page bumped to 250 so a busy day still fits in a single request;
    // the panel handles pagination/refresh client-side for anything beyond.
    fetchOrders({
      is_prepared: true,
      has_shipment: false,
      shop_id: shopId,
      per_page: 250,
    }),
    fetchShops(),
  ]);

  const initialOrders = ordersResult.status === "fulfilled" ? ordersResult.value.orders : [];
  const initialTotal = ordersResult.status === "fulfilled" ? ordersResult.value.totalCount : 0;
  const shops = shopsResult.status === "fulfilled" ? shopsResult.value : [];

  return (
    <PrintQueuePanel
      initialOrders={initialOrders}
      initialTotal={initialTotal}
      shops={shops}
      activeShopId={shopId ?? ""}
    />
  );
}
