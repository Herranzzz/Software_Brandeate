import { ClientAccountsPanel } from "@/components/client-accounts-panel";
import { fetchAdminUsers, fetchShops } from "@/lib/api";
import { requireAdminUser } from "@/lib/auth";
import type { AdminUser } from "@/lib/types";

function isClientAccount(user: AdminUser) {
  return user.role === "shop_admin" || user.role === "shop_viewer";
}

export default async function EmployeesPage() {
  const [userResult, shopsResult, usersResult] = await Promise.allSettled([
    requireAdminUser(),
    fetchShops(),
    fetchAdminUsers(),
  ]);
  if (userResult.status === "rejected") throw userResult.reason;
  const currentUser = userResult.value;

  const shops = shopsResult.status === "fulfilled" ? shopsResult.value : [];
  const accounts = usersResult.status === "fulfilled" ? usersResult.value.filter(isClientAccount) : [];

  return (
    <ClientAccountsPanel
      currentUser={{
        id: currentUser.id,
        role: currentUser.role,
      }}
      accounts={accounts}
      shops={shops}
    />
  );
}
