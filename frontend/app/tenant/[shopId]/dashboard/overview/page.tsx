import { Card } from "@/components/card";
import { KpiCard } from "@/components/kpi-card";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { fetchIncidents, fetchOrders, fetchShopById } from "@/lib/api";
import { formatDateTime } from "@/lib/format";


type TenantDashboardPageProps = {
  params: Promise<{ shopId: string }>;
};


export default async function TenantDashboardPage({ params }: TenantDashboardPageProps) {
  const { shopId } = await params;
  const [shop, orders, incidents] = await Promise.all([
    fetchShopById(shopId),
    fetchOrders({ shop_id: shopId }, { cacheSeconds: 30 }).then(({ orders }) => orders),
    fetchIncidents({ shop_id: shopId, status: "open", recent_days: 30, include_historical: false }),
  ]);

  if (!shop) {
    return null;
  }

  const shipped = orders.filter((order) => order.status === "shipped").length;
  const delivered = orders.filter((order) => order.status === "delivered").length;
  const personalized = orders.filter((order) => order.is_personalized).length;

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Tu dashboard"
        title={`Operativa de ${shop.name}`}
        description="Resumen simple de tus pedidos, envios e incidencias."
      />

      <section className="kpi-grid">
        <KpiCard label="Pedidos" value={String(orders.length)} tone="accent" />
        <KpiCard label="Personalizados" value={String(personalized)} tone="warning" />
        <KpiCard label="Enviados" value={String(shipped)} tone="default" />
        <KpiCard label="Entregados" value={String(delivered)} tone="success" />
        <KpiCard label="Incidencias" value={String(incidents.length)} tone="danger" />
      </section>

      <section className="dashboard-grid">
        <Card className="stack">
          <SectionTitle eyebrow="Pedidos recientes" title="Ultimos movimientos" />
          <div className="activity-list">
            {orders.slice(0, 6).map((order) => (
              <article className="activity-item" key={order.id}>
                <div className="activity-title">{order.external_id}</div>
                <div className="table-secondary">
                  {order.customer_name} · {order.is_personalized ? "Personalizado" : "Estandar"}
                </div>
                <div className="activity-time">{formatDateTime(order.created_at)}</div>
              </article>
            ))}
          </div>
        </Card>

        <Card className="stack">
          <SectionTitle eyebrow="Incidencias" title="Atención prioritaria" />
          <div className="incident-list">
            {incidents.slice(0, 5).map((incident) => (
              <article className="incident-item" key={incident.id}>
                <div>
                  <div className="activity-title">{incident.title}</div>
                  <div className="table-secondary">{incident.order.external_id}</div>
                </div>
                <div className={`incident-priority incident-priority-${incident.priority}`}>
                  {incident.priority}
                </div>
              </article>
            ))}
          </div>
        </Card>
      </section>
    </div>
  );
}
