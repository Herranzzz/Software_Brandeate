import { PageHeader } from "@/components/page-header";
import { PortalPerformanceView } from "@/components/portal-performance-view";
import { PortalTenantControl } from "@/components/portal-tenant-control";
import { fetchAnalyticsOverview } from "@/lib/api";
import { fetchMyShops, requirePortalUser } from "@/lib/auth";
import { resolveTenantScope } from "@/lib/tenant-scope";

type RangePreset = "7d" | "14d" | "30d" | "90d";

type PortalPerformancePageProps = {
  searchParams?: Promise<{ shop_id?: string; range?: string }>;
};

function resolveRange(value?: string): RangePreset {
  if (value === "14d" || value === "30d" || value === "90d") return value;
  return "7d";
}

function rangeDays(r: RangePreset): number {
  return r === "14d" ? 14 : r === "30d" ? 30 : r === "90d" ? 90 : 7;
}

function rangeLabel(r: RangePreset): string {
  return r === "14d" ? "Últimos 14 días" : r === "30d" ? "Últimos 30 días" : r === "90d" ? "Últimos 90 días" : "Últimos 7 días";
}

function buildRangeLinks(current: RangePreset, shopId?: string | null) {
  const options: Array<{ value: RangePreset; label: string }> = [
    { value: "7d", label: "7 días" },
    { value: "14d", label: "14 días" },
    { value: "30d", label: "30 días" },
    { value: "90d", label: "90 días" },
  ];
  return options.map((opt) => {
    const params = new URLSearchParams();
    params.set("range", opt.value);
    if (shopId) params.set("shop_id", shopId);
    return {
      label: opt.label,
      href: `/portal/performance?${params.toString()}`,
      active: opt.value === current,
    };
  });
}

export default async function PortalPerformancePage({ searchParams }: PortalPerformancePageProps) {
  await requirePortalUser();
  const params = (await searchParams) ?? {};
  const range = resolveRange(params.range);
  const days = rangeDays(range);
  const shops = await fetchMyShops();
  const tenantScope = resolveTenantScope(shops, params.shop_id);
  const shopId = tenantScope.selectedShopId;

  const to = new Date();
  const from = new Date(to);
  from.setDate(to.getDate() - (days - 1));

  const analyticsResult = await fetchAnalyticsOverview({
    ...(shopId ? { shop_id: shopId } : {}),
    date_from: from.toISOString().slice(0, 10),
    date_to: to.toISOString().slice(0, 10),
  }).catch(() => null);

  const shopQuery = shopId ? `?shop_id=${shopId}` : "";
  const rangeLinks = buildRangeLinks(range, shopId);

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Rendimiento"
        title="Calidad de entrega y SLA"
        description="Monitoriza on-time delivery, tiempos medios, carriers y etapas del flujo para tomar decisiones basadas en datos."
      />
      <PortalTenantControl
        action="/portal/performance"
        selectedShopId={tenantScope.selectedShopId}
        shops={tenantScope.shops}
        submitLabel="Ver"
        description="Los indicadores se filtran por la tienda seleccionada."
      />
      <div className="filter-pills">
        {rangeLinks.map((l) => (
          <a key={l.href} href={l.href} className={`filter-pill${l.active ? " filter-pill-active" : ""}`}>
            {l.label}
          </a>
        ))}
      </div>
      <PortalPerformanceView analytics={analyticsResult} shopQuery={shopQuery} rangeLabel={rangeLabel(range)} />
    </div>
  );
}
