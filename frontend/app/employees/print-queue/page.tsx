import { PrintQueuePanel } from "@/components/print-queue-panel";
import { fetchAdminUsers, fetchOrders, fetchShops } from "@/lib/api";
import { requireAdminUser } from "@/lib/auth";


export const dynamic = "force-dynamic";


type PrintQueuePageProps = {
  searchParams: Promise<{
    shop_id?: string;
    // Canonical filter: "me" (default), "all", or a numeric user id as string.
    preparer?: string;
    // Backwards-compat with previous URLs that used `?scope=all|mine`.
    scope?: string;
  }>;
};


/**
 * Resolve the `?preparer` param to a single shape used by the rest of the
 * page. Falls back to the legacy `?scope` param so old bookmarks keep working.
 */
function resolvePreparer(
  preparer: string | undefined,
  scope: string | undefined,
  currentUserId: number,
): { selection: "me" | "all" | number; preparedById: number | undefined } {
  const raw = preparer ?? (scope === "all" ? "all" : scope === "mine" ? "me" : undefined);
  if (raw === "all") return { selection: "all", preparedById: undefined };
  if (raw && /^\d+$/.test(raw)) {
    const id = Number.parseInt(raw, 10);
    if (id === currentUserId) return { selection: "me", preparedById: currentUserId };
    return { selection: id, preparedById: id };
  }
  return { selection: "me", preparedById: currentUserId };
}


export default async function PrintQueuePage({ searchParams }: PrintQueuePageProps) {
  const currentUser = await requireAdminUser();

  const params = await searchParams;
  const shopId = params.shop_id && params.shop_id.trim() !== "" ? params.shop_id : undefined;
  const { selection, preparedById } = resolvePreparer(params.preparer, params.scope, currentUser.id);

  const [ordersResult, shopsResult, opsResult, superResult] = await Promise.allSettled([
    fetchOrders({
      is_prepared: true,
      production_status: "packed",
      shop_id: shopId,
      prepared_by_employee_id: preparedById,
      // FIFO: lo primero preparado es lo primero impreso. La UI y el merge
      // del PDF respetan este orden, así lo que se ve en pantalla coincide
      // con la pila que sale de la impresora.
      sort_by: "prepared_asc",
      per_page: 250,
    }),
    fetchShops(),
    fetchAdminUsers({ role: "ops_admin" }),
    fetchAdminUsers({ role: "super_admin" }),
  ]);

  const initialOrders = ordersResult.status === "fulfilled" ? ordersResult.value.orders : [];
  const initialTotal = ordersResult.status === "fulfilled" ? ordersResult.value.totalCount : 0;
  const shops = shopsResult.status === "fulfilled" ? shopsResult.value : [];

  // Lista canónica de preparadores. Combinamos ops_admin + super_admin (los
  // únicos roles que pueden marcar pedidos como preparados) y filtramos los
  // inactivos. Así el desplegable ofrece SIEMPRE la lista completa, no solo
  // la gente que tenga pedidos en la cola en este instante.
  const opsUsers = opsResult.status === "fulfilled" ? opsResult.value : [];
  const superUsers = superResult.status === "fulfilled" ? superResult.value : [];
  const preparersById = new Map<number, { id: number; name: string }>();
  for (const user of [...opsUsers, ...superUsers]) {
    if (!user.is_active) continue;
    preparersById.set(user.id, { id: user.id, name: user.name });
  }
  const preparers = Array.from(preparersById.values()).sort((a, b) =>
    a.name.localeCompare(b.name, "es"),
  );

  return (
    <PrintQueuePanel
      activeShopId={shopId ?? ""}
      currentUserId={currentUser.id}
      currentUserName={currentUser.name}
      initialOrders={initialOrders}
      initialTotal={initialTotal}
      preparerSelection={selection}
      preparers={preparers}
      shops={shops}
    />
  );
}
