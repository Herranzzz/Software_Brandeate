import { OrdersWorkbench } from "@/components/orders-workbench";
import { fetchOrders, fetchPickBatches, fetchShops } from "@/lib/api";
import { requireAdminUser } from "@/lib/auth";


type OrdersPageProps = {
  searchParams: Promise<{
    q?: string;
    quick?: string;
    shop_id?: string;
    is_personalized?: string;
    design_status?: string;
    production_status?: string;
    status?: string;
    has_incident?: string;
    priority?: string;
    sku?: string;
    variant_title?: string;
    carrier?: string;
    page?: string;
    view?: string;
    per_page?: string;
  }>;
};


function readBooleanParam(value?: string) {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return undefined;
}


export default async function OrdersPage({ searchParams }: OrdersPageProps) {
  await requireAdminUser();
  const params = await searchParams;
  const page = Math.max(Number(params.page ?? "1") || 1, 1);
  const perPage = Math.min(Math.max(Number(params.per_page ?? "100") || 100, 1), 500);
  const view = params.view === "batches" ? "batches" : "queue";

  const [{ orders, totalCount }, shops, batches] = await Promise.all([
    fetchOrders({
      shop_id: params.shop_id,
      is_personalized: readBooleanParam(params.is_personalized),
      design_status: params.design_status,
      production_status: params.production_status,
      status: params.status,
      has_incident: readBooleanParam(params.has_incident),
      priority: params.priority,
      sku: params.sku,
      variant_title: params.variant_title,
      carrier: params.carrier,
      q: params.q,
      page,
      per_page: perPage,
    }),
    fetchShops(),
    fetchPickBatches({ shop_id: params.shop_id }),
  ]);

  return (
    <div className="stack orders-page">
      <OrdersWorkbench
        batches={batches}
        initialOrders={orders}
        initialTotalCount={totalCount}
        initialPage={page}
        initialPerPage={perPage}
        initialQuery={params.q ?? ""}
        initialQuickFilter={params.quick ?? ""}
        initialShopId={params.shop_id ?? ""}
        initialView={view}
        shops={shops}
      />
    </div>
  );
}
