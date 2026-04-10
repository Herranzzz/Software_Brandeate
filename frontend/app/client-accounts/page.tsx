import { ClientAccountsPanel } from "@/components/client-accounts-panel";
import { fetchAdminUsers, fetchShops } from "@/lib/api";
import { requireAdminUser } from "@/lib/auth";


export default async function ClientAccountsPage() {
  const [userResult, usersResult, shopsResult] = await Promise.allSettled([
    requireAdminUser(),
    fetchAdminUsers(),
    fetchShops(),
  ]);

  if (userResult.status === "rejected") throw userResult.reason;
  const currentUser = userResult.value;

  const allUsers = usersResult.status === "fulfilled" ? usersResult.value : [];
  const shops = shopsResult.status === "fulfilled" ? shopsResult.value : [];

  // Only show client portal accounts (shop_admin, shop_viewer)
  const clientAccounts = allUsers.filter(
    (u) => u.role === "shop_admin" || u.role === "shop_viewer",
  );

  return (
    <ClientAccountsPanel
      accounts={clientAccounts}
      currentUser={{ id: currentUser.id, role: currentUser.role }}
      shops={shops}
    />
  );
}
