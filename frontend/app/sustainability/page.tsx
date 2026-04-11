import { Card } from "@/components/card";
import { PageHeader } from "@/components/page-header";
import { PortalSustainabilityPanel } from "@/components/portal-sustainability-panel";
import { fetchOrders, fetchShops } from "@/lib/api";
import { requireAdminUser } from "@/lib/auth";

type AdminSustainabilityPageProps = {
  searchParams?: Promise<{ shop_id?: string }>;
};

export default async function AdminSustainabilityPage({ searchParams }: AdminSustainabilityPageProps) {
  await requireAdminUser();
  const params = (await searchParams) ?? {};

  const [shopsResult, ordersResult] = await Promise.allSettled([
    fetchShops(),
    fetchOrders({
      page: 1,
      per_page: 500,
      ...(params.shop_id ? { shop_id: params.shop_id } : {}),
    }).then((r) => r.orders),
  ]);

  const shops = shopsResult.status === "fulfilled" ? shopsResult.value : [];
  const orders = ordersResult.status === "fulfilled" ? ordersResult.value : [];

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Sostenibilidad"
        title="Huella de carbono logística"
        description="Estimación de CO₂ por envío, comparativa de carriers y badge Brandeate Green por cliente."
      />

      {shops.length > 1 && (
        <form className="portal-filter-row" method="get">
          <label className="field" style={{ maxWidth: 280 }}>
            <span>Filtrar por tienda</span>
            <select defaultValue={params.shop_id ?? ""} name="shop_id">
              <option value="">Todas las tiendas</option>
              {shops.map((s) => (
                <option key={s.id} value={String(s.id)}>{s.name}</option>
              ))}
            </select>
          </label>
          <button className="button-secondary" type="submit">Ver</button>
        </form>
      )}

      <Card className="stack settings-section-card">
        <PortalSustainabilityPanel orders={orders} />
      </Card>
    </div>
  );
}
