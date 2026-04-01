import Link from "next/link";

import { Card } from "@/components/card";
import { KpiCard } from "@/components/kpi-card";
import { fetchIncidents, fetchOrders, fetchShops } from "@/lib/api";
import { requireAdminUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";

type DashboardPageProps = {
  searchParams: Promise<{
    shop_id?: string;
  }>;
};

function buildChart(orders: import("@/lib/types").Order[]) {
  const today = new Date();
  const points = Array.from({ length: 7 }).map((_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (6 - index));
    const dayKey = date.toISOString().slice(0, 10);

    return {
      dayKey,
      day: date.toLocaleDateString("es-ES", { weekday: "short" }),
      value: orders.filter((order) => order.created_at.slice(0, 10) === dayKey).length,
    };
  });

  return points;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  await requireAdminUser();
  const params = await searchParams;
  const [shops, orders, incidents] = await Promise.all([
    fetchShops(),
    fetchOrders({ shop_id: params.shop_id }).then(({ orders }) => orders),
    fetchIncidents({ shop_id: params.shop_id }),
  ]);

  const activeShop = shops.find((shop) => String(shop.id) === params.shop_id);
  const chart = buildChart(orders);
  const maxValue = Math.max(1, ...chart.map((item) => item.value));

  const pendingOrders = orders.filter((order) => order.status === "pending").length;
  const inProductionOrders = orders.filter((order) => order.production_status === "in_production").length;
  const shippedOrders = orders.filter((order) => order.status === "shipped").length;
  const deliveredOrders = orders.filter((order) => order.status === "delivered").length;
  const withShipment = orders.filter((order) => order.shipment).length;
  const personalizedOrders = orders.filter((order) => order.is_personalized).length;
  const openIncidents = incidents.filter((incident) => incident.status !== "resolved").length;
  const urgentIncidents = incidents.filter((incident) => incident.priority === "urgent" || incident.priority === "high").length;

  const fulfillmentHealth = [
    { label: "Pendientes", value: pendingOrders, hint: "esperando revisión" },
    { label: "En producción", value: inProductionOrders, hint: "flujo activo" },
    { label: "Con envío", value: withShipment, hint: "ya etiquetados" },
    { label: "Entregados", value: deliveredOrders, hint: "cerrados correctamente" },
  ];

  return (
    <div className="stack admin-dashboard">
      <section className="admin-dashboard-hero">
        <div className="admin-dashboard-hero-copy">
          <span className="eyebrow">Brandeate operations</span>
          <h1 className="admin-dashboard-title">
            {activeShop ? `Control de ${activeShop.name}` : "Bienvenido de nuevo"}
          </h1>
          <p className="admin-dashboard-subtitle">
            Sigue el volumen de pedidos, el estado operativo y los puntos de atención más urgentes desde una sola vista.
          </p>
        </div>

        <div className="admin-dashboard-hero-actions">
          <form className="admin-dashboard-filter" method="get">
            <label className="admin-dashboard-filter-label" htmlFor="shop_id">
              Tienda
            </label>
            <select defaultValue={params.shop_id ?? ""} id="shop_id" name="shop_id">
              <option value="">Todas las tiendas</option>
              {shops.map((shop) => (
                <option key={shop.id} value={shop.id}>
                  {shop.name}
                </option>
              ))}
            </select>
            <button className="button button-secondary" type="submit">
              Aplicar
            </button>
          </form>

          {activeShop ? (
            <Link className="button" href={`/tenant/${activeShop.id}/dashboard/overview`}>
              Ver portal cliente
            </Link>
          ) : (
            <Link className="button" href="/orders">
              Ver pedidos
            </Link>
          )}
        </div>
      </section>

      <section className="admin-dashboard-kpis">
        <KpiCard label="Pedidos entrantes" value={String(orders.length)} delta={`${pendingOrders} pendientes`} tone="accent" />
        <KpiCard label="Personalizados" value={String(personalizedOrders)} delta={`${orders.length - personalizedOrders} estándar`} tone="warning" />
        <KpiCard label="Incidencias abiertas" value={String(openIncidents)} delta={`${urgentIncidents} prioritarias`} tone="danger" />
        <KpiCard label="Enviados" value={String(shippedOrders)} delta={`${withShipment} con tracking`} tone="default" />
        <KpiCard label="Tiendas activas" value={String(activeShop ? 1 : shops.length)} delta={activeShop ? "vista filtrada" : "operando ahora"} tone="success" />
      </section>

      <section className="admin-dashboard-columns">
        <div className="stack admin-dashboard-column">
          <Card className="stack admin-dashboard-panel admin-dashboard-panel-primary">
            <div className="admin-dashboard-panel-head">
              <div>
                <span className="eyebrow">Volumen</span>
                <h3 className="section-title section-title-small">Pedidos últimos 7 días</h3>
              </div>
              <Link className="admin-dashboard-inline-link" href="/orders">
                Ir a pedidos
              </Link>
            </div>

            <div className="chart-card admin-dashboard-chart-card">
              {chart.map((point) => (
                <div className="chart-bar-group" key={point.dayKey}>
                  <div className="admin-dashboard-chart-plot">
                    <div className="chart-bar admin-dashboard-chart-bar" style={{ height: `${Math.max(12, (point.value / maxValue) * 100)}%` }} />
                  </div>
                  <div className="chart-value">{point.value}</div>
                  <div className="chart-label">{point.day}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="stack admin-dashboard-panel">
            <div className="admin-dashboard-panel-head">
              <div>
                <span className="eyebrow">Actividad</span>
                <h3 className="section-title section-title-small">Últimos pedidos</h3>
              </div>
              <Link className="admin-dashboard-inline-link" href="/orders">
                Ver todos
              </Link>
            </div>

            <div className="admin-orders-list">
              {orders.slice(0, 6).map((order) => (
                <Link className="admin-orders-row" href={`/orders/${order.id}`} key={order.id}>
                  <div className="admin-orders-main">
                    <div className="activity-title">{order.external_id}</div>
                    <div className="table-secondary">
                      {order.customer_name} · {order.customer_email}
                    </div>
                  </div>
                  <div className="admin-orders-meta">
                    <span className="admin-orders-status">{order.status}</span>
                    <span className="admin-orders-time">{formatDateTime(order.created_at)}</span>
                  </div>
                </Link>
              ))}
            </div>
          </Card>
        </div>

        <div className="stack admin-dashboard-column">
          <Card className="stack admin-dashboard-panel">
            <div className="admin-dashboard-panel-head">
              <div>
                <span className="eyebrow">Salud operativa</span>
                <h3 className="section-title section-title-small">Estado de la cuenta</h3>
              </div>
            </div>

            <div className="admin-health-grid">
              {fulfillmentHealth.map((item) => (
                <article className="admin-health-card" key={item.label}>
                  <span className="admin-health-label">{item.label}</span>
                  <strong className="admin-health-value">{item.value}</strong>
                  <span className="admin-health-hint">{item.hint}</span>
                </article>
              ))}
            </div>
          </Card>

          <Card className="stack admin-dashboard-panel">
            <div className="admin-dashboard-panel-head">
              <div>
                <span className="eyebrow">Atención prioritaria</span>
                <h3 className="section-title section-title-small">Incidencias recientes</h3>
              </div>
              <Link className="admin-dashboard-inline-link" href="/incidencias">
                Ver incidencias
              </Link>
            </div>

            <div className="incident-list incident-list-rich">
              {incidents.slice(0, 4).map((incident) => (
                <article className="incident-item incident-item-rich" key={incident.id}>
                  <div className="incident-content">
                    <div className="incident-topline">
                      <div className="activity-title">{incident.title}</div>
                      <span className={`incident-priority incident-priority-${incident.priority}`}>
                        {incident.priority}
                      </span>
                    </div>
                    <div className="table-secondary">
                      {incident.order.external_id} · {incident.order.customer_name}
                    </div>
                    <div className="incident-meta-row">
                      <span>{incident.status}</span>
                      <span>{formatDateTime(incident.updated_at)}</span>
                    </div>
                  </div>
                </article>
              ))}

              {incidents.length === 0 ? (
                <div className="admin-dashboard-empty">
                  No hay incidencias abiertas ahora mismo.
                </div>
              ) : null}
            </div>
          </Card>

          <Card className="stack admin-dashboard-panel admin-dashboard-panel-note">
            <div className="admin-dashboard-panel-head">
              <div>
                <span className="eyebrow">Siguiente paso</span>
                <h3 className="section-title section-title-small">Empuja la operativa</h3>
              </div>
            </div>

            <div className="admin-dashboard-note">
              <p>
                Usa este panel como centro de control de Brandeate: revisa pedidos nuevos, detecta bloqueos antes de packing
                y salta rápido al portal del cliente cuando necesites validar cómo lo está viendo la tienda.
              </p>
              <div className="admin-dashboard-note-actions">
                <Link className="button button-secondary" href="/shipments">
                  Ver expediciones
                </Link>
                <Link className="button button-secondary" href="/orders">
                  Ver pedidos
                </Link>
              </div>
            </div>
          </Card>
        </div>
      </section>
    </div>
  );
}
