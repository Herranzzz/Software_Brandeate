import { OrdersWorkbench } from "@/components/orders-workbench";
import { fetchAdminUsers, fetchOrders, fetchPickBatches, fetchShops } from "@/lib/api";
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

// Every quick filter pill must translate into server-side query params so the
// backend returns the correct *paginated* set. Client-side filtering on top
// only sees the current page (250 orders out of potentially thousands) and
// silently wipes results when the recent slice doesn't contain matches.
function quickFilterToApiParams(quick?: string): {
  status?: string;
  production_status?: string;
  is_prepared?: boolean;
  has_shipment?: boolean;
  has_incident?: boolean;
  shipping_status?: string;
} {
  switch (quick) {
    case "has_incident":
      return { has_incident: true };
    case "in_production":
      return { production_status: "in_production" };
    case "not_prepared":
      return { is_prepared: false };
    case "prepared":
      return { is_prepared: true };
    case "not_downloaded":
      return { production_status: "pending_personalization", has_shipment: false };
    case "delivered":
      return { status: "delivered" };
    case "shipping_in_transit":
      return {
        shipping_status: "in_transit,picked_up,pickup_available,attempted_delivery",
      };
    case "shipping_out_for_delivery":
      return { shipping_status: "out_for_delivery" };
    case "shipping_exception":
      return { shipping_status: "exception" };
    case "label_no_update":
      // No precise backend filter (requires event-history inspection). Returning
      // no server filter keeps the pill working as a client-side narrowing on
      // whichever page the user is looking at.
      return {};
    default:
      return {};
  }
}


export default async function OrdersPage({ searchParams }: OrdersPageProps) {
  const params = await searchParams;
  const page = Math.max(Number(params.page ?? "1") || 1, 1);
  const perPage = Math.min(Math.max(Number(params.per_page ?? "100") || 100, 1), 250);
  const view = params.view === "batches" ? "batches" : "queue";

  const quickParams = quickFilterToApiParams(params.quick);

  const [userResult, ordersResult, shopsResult, batchesResult, employeesResult] = await Promise.allSettled([
    requireAdminUser(),
    fetchOrders({
      shop_id: params.shop_id,
      is_personalized: readBooleanParam(params.is_personalized),
      design_status: params.design_status,
      production_status: params.production_status ?? quickParams.production_status,
      status: params.status ?? quickParams.status,
      has_incident:
        params.has_incident !== undefined
          ? readBooleanParam(params.has_incident)
          : quickParams.has_incident,
      is_prepared:
        params.is_prepared !== undefined
          ? readBooleanParam(params.is_prepared)
          : quickParams.is_prepared,
      has_shipment: quickParams.has_shipment,
      shipping_status: quickParams.shipping_status,
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
    fetchAdminUsers(),
  ]);
  if (userResult.status === "rejected") throw userResult.reason;

  const { orders, totalCount } =
    ordersResult.status === "fulfilled"
      ? ordersResult.value
      : { orders: [], totalCount: 0 };
  const shops = shopsResult.status === "fulfilled" ? shopsResult.value : [];
  const batches = batchesResult.status === "fulfilled" ? batchesResult.value : [];
  const employees = employeesResult.status === "fulfilled"
    ? employeesResult.value.map((u) => ({ id: u.id, name: u.name }))
    : [];

  return (
    <div className="stack orders-page">
      <OrdersWorkbench
        batches={batches}
        employees={employees}
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
