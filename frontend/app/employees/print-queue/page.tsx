import { PrintQueuePanel } from "@/components/print-queue-panel";
import { fetchOrders, fetchShops } from "@/lib/api";
import { requireAdminUser } from "@/lib/auth";


export const dynamic = "force-dynamic";


type PrintQueuePageProps = {
  searchParams: Promise<{
    shop_id?: string;
    scope?: string;
  }>;
};


export default async function PrintQueuePage({ searchParams }: PrintQueuePageProps) {
  const currentUser = await requireAdminUser();

  const params = await searchParams;
  const shopId = params.shop_id && params.shop_id.trim() !== "" ? params.shop_id : undefined;
  // "mine" (default) → only labels this employee prepared.
  // "all" → the whole team's pile, useful if someone is printing for a teammate.
  const scope = params.scope === "all" ? "all" : "mine";

  const [ordersResult, shopsResult] = await Promise.allSettled([
    // Queue = prepared orders still in `packed` production_status (not yet
    // shipped/completed). Includes both labels that already exist (just need
    // printing) and the rare case of prepared-without-label (panel handles
    // both). Scoped to this employee by default so each person sees only
    // their own pile.
    fetchOrders({
      is_prepared: true,
      production_status: "packed",
      shop_id: shopId,
      prepared_by_employee_id: scope === "mine" ? currentUser.id : undefined,
      per_page: 250,
    }),
    fetchShops(),
  ]);

  const initialOrders = ordersResult.status === "fulfilled" ? ordersResult.value.orders : [];
  const initialTotal = ordersResult.status === "fulfilled" ? ordersResult.value.totalCount : 0;
  const shops = shopsResult.status === "fulfilled" ? shopsResult.value : [];

  return (
    <PrintQueuePanel
      activeShopId={shopId ?? ""}
      currentUserId={currentUser.id}
      currentUserName={currentUser.name}
      initialOrders={initialOrders}
      initialTotal={initialTotal}
      scope={scope}
      shops={shops}
    />
  );
}
