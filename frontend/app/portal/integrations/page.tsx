import { PortalIntegrationsHub } from "@/components/portal-integrations-hub";
import { fetchShopifyIntegrations } from "@/lib/api";
import { fetchMyShops, requirePortalUser } from "@/lib/auth";
import { resolveTenantScope } from "@/lib/tenant-scope";

type Props = {
  searchParams?: Promise<{ shop_id?: string }>;
};

export default async function PortalIntegrationsPage({ searchParams }: Props) {
  const user = await requirePortalUser();
  const params = (await searchParams) ?? {};
  const shops = await fetchMyShops();
  const tenantScope = resolveTenantScope(shops, params.shop_id);
  const primaryShop = tenantScope.selectedShop ?? shops[0] ?? null;

  const integrationsResult = await fetchShopifyIntegrations().catch(() => []);
  const activeIntegration = primaryShop
    ? (integrationsResult.find((i) => i.shop_id === primaryShop.id) ?? null)
    : null;

  return (
    <PortalIntegrationsHub
      currentUser={{ id: user.id, role: user.role }}
      shops={shops}
      primaryShop={primaryShop}
      shopifyIntegration={activeIntegration}
      allIntegrations={integrationsResult}
    />
  );
}
