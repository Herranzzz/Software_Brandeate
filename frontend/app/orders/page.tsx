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
    is_prepared?: string;
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

function quickFilterToApiParams(quick?: string): Record<string, string | boolean | undefined> {
  switch (quick) {
    case "has_incident":      return { has_incident: true };
    case "in_production":     return { production_status: "in_production" };
    case "not_prepared":      return { is_prepared: false };
    case "delivered":         return { status: "delivered" };
    default:                  return {};
  }
}


export default async function OrdersPage({ searchParams }: OrdersPageProps) {
  const params = await searchParams;
  const page = Math.max(Number(params.page ?? "1") || 1, 1);
  const perPage = Math.min(Math.max(Number(params.per_page ?? "100") || 100, 1), 250);
  const view = params.view === "batches" ? "batches" : "queue";

  const quickParams = quickFilterToApiParams(params.quick);

  const [userResult, ordersResult, shopsResult, batchesResult] = await Promise.allSettled([
    requireAdminUser(),
    fetchOrders({
      shop_id: params.shop_id,
      is_personalized: readBooleanParam(params.is_personalized),
      design_status: params.design_status,
      production_status: (params.production_status ?? quickParams.production_status) as string | undefined,
      status: (params.status ?? quickParams.status) as string | undefined,
      has_incident: params.has_incident !== undefined ? readBooleanParam(params.has_incident) : quickParams.has_incident as boolean | undefined,
      is_prepared: params.is_prepared !== undefined ? readBooleanParam(params.is_prepared) : quickParams.is_prepared as boolean | undefined,
      priority: params.priority,
      sku: params.sku,
      variant_title: params.variant_title,
      carrier: params.carrier,
      q: params.q,
      page,
      per_page: perPage,
    }, { cacheSeconds: 20 }),
    fetchShops(),
    fetchPickBatches({ shop_id: params.shop_id }),
  ]);
  if (userResult.status === "rejected") throw userResult.reason;

  const { orders, totalCount } =
    ordersResult.status === "fulfilled"
      ? ordersResult.value
      : { orders: [], totalCount: 0 };
  const shops = shopsResult.status === "fulfilled" ? shopsResult.value : [];
  const batches = batchesResult.status === "fulfilled" ? batchesResult.value : [];

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
