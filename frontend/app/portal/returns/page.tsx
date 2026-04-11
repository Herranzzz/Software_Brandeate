import Link from "next/link";

import { Card } from "@/components/card";
import { EmptyState } from "@/components/empty-state";
import { KpiCard } from "@/components/kpi-card";
import { PageHeader } from "@/components/page-header";
import { PortalReturnWizard } from "@/components/portal-return-wizard";
import { PortalTenantControl } from "@/components/portal-tenant-control";
import { fetchIncidents, fetchOrders } from "@/lib/api";
import { fetchMyShops, requirePortalUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { resolveTenantScope } from "@/lib/tenant-scope";

type PortalReturnsPageProps = {
  searchParams: Promise<{
    shop_id?: string;
  }>;
};

const incidentStatusMeta = {
  open: {
    label: "Abierta",
    badge: "badge badge-status badge-status-exception",
    icon: "🔴",
    nextStep: "Pendiente de revisión por el equipo",
  },
  in_progress: {
    label: "En revisión",
    badge: "badge badge-status badge-status-in-progress",
    icon: "🟡",
    nextStep: "Ya en curso — te contactaremos si necesitamos más datos",
  },
  resolved: {
    label: "Resuelta",
    badge: "badge badge-status badge-status-delivered",
    icon: "🟢",
    nextStep: "Caso cerrado con solución confirmada",
  },
} as const;

export default async function PortalReturnsPage({ searchParams }: PortalReturnsPageProps) {
  await requirePortalUser();
  const params = await searchParams;
  const shops = await fetchMyShops();
  const tenantScope = resolveTenantScope(shops, params.shop_id);
  const [incidentsResult, ordersResult] = await Promise.allSettled([
    fetchIncidents(
      tenantScope.selectedShopId
        ? { shop_id: tenantScope.selectedShopId, page: 1, per_page: 200 }
        : { page: 1, per_page: 200 },
    ),
    fetchOrders({
      page: 1,
      per_page: 100,
      ...(tenantScope.selectedShopId ? { shop_id: tenantScope.selectedShopId } : {}),
    }).then(({ orders }) => orders),
  ]);
  const incidents = incidentsResult.status === "fulfilled" ? incidentsResult.value : [];
  const orders = ordersResult.status === "fulfilled" ? ordersResult.value : [];

  const openCases = incidents.filter((i) => i.status === "open");
  const inProgressCases = incidents.filter((i) => i.status === "in_progress");
  const resolvedCases = incidents.filter((i) => i.status === "resolved");
  const shopQuery = tenantScope.selectedShopId ? `?shop_id=${tenantScope.selectedShopId}` : "";

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Devoluciones"
        title="Devoluciones y solicitudes"
        description="Abre una solicitud en tres pasos, sigue el estado de tus casos y entiende el siguiente paso sin fricción."
      />

      <PortalTenantControl
        action="/portal/returns"
        selectedShopId={tenantScope.selectedShopId}
        shops={tenantScope.shops}
        submitLabel="Ver"
      />

      <section className="portal-returns-kpis">
        <KpiCard label="Abiertas" tone="danger" value={String(openCases.length)} delta="requieren revisión" />
        <KpiCard label="En revisión" tone="warning" value={String(inProgressCases.length)} delta="ya en curso" />
        <KpiCard label="Resueltas" tone="success" value={String(resolvedCases.length)} delta="casos cerrados" />
        <KpiCard label="Pedidos elegibles" tone="accent" value={String(orders.length)} delta="para nueva solicitud" />
      </section>

      <Card className="portal-glass-card">
        <div className="portal-dashboard-section-head">
          <div>
            <span className="eyebrow">Casos activos</span>
            <h3 className="section-title section-title-small">Tus devoluciones</h3>
            <p className="subtitle">
              Estados claros y siguiente paso definido para cada caso. Sin correos ni formularios largos.
            </p>
          </div>
          <div className="portal-returns-actions">
            {orders.length > 0 ? (
              <PortalReturnWizard orders={orders} shopId={tenantScope.selectedShopId} />
            ) : null}
            <Link className="button-secondary" href={`/portal/orders${shopQuery}`}>
              Ver pedidos
            </Link>
          </div>
        </div>

        {incidents.length === 0 ? (
          <EmptyState
            title="Sin devoluciones abiertas"
            description="Cuando abras un caso, verás aquí el estado, la prioridad y el siguiente paso. Usa el botón de arriba para crear tu primera solicitud."
          />
        ) : (
          <div className="rwiz-case-list">
            {incidents.map((incident) => {
              const meta = incidentStatusMeta[incident.status];
              return (
                <article className="rwiz-case-card" key={incident.id}>
                  <div className="rwiz-case-card-left">
                    <div className="rwiz-case-card-top">
                      <Link className="table-link table-link-strong" href={`/portal/returns/${incident.id}`}>
                        {incident.title}
                      </Link>
                      <span className={meta.badge}>{meta.label}</span>
                    </div>
                    <div className="rwiz-case-card-meta">
                      <span>Pedido <strong>{incident.order.external_id}</strong></span>
                      <span className="rwiz-meta-sep">·</span>
                      <span>{incident.order.customer_name}</span>
                      <span className="rwiz-meta-sep">·</span>
                      <span>Actualizado {formatDateTime(incident.updated_at)}</span>
                    </div>
                  </div>
                  <div className="rwiz-case-card-right">
                    <div className="rwiz-case-next-step">
                      <span className="rwiz-case-next-icon">{meta.icon}</span>
                      <span>{meta.nextStep}</span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Card>

      {/* How it works */}
      <Card className="portal-glass-card">
        <div className="portal-dashboard-section-head">
          <div>
            <span className="eyebrow">Proceso</span>
            <h3 className="section-title section-title-small">Cómo funciona una solicitud</h3>
          </div>
        </div>
        <div className="rwiz-how-it-works">
          <div className="rwiz-how-step">
            <div className="rwiz-how-num">1</div>
            <div className="rwiz-how-copy">
              <strong>Elige el pedido</strong>
              <span>Busca por referencia, nombre o email y selecciónalo en un clic.</span>
            </div>
          </div>
          <div className="rwiz-how-connector" />
          <div className="rwiz-how-step">
            <div className="rwiz-how-num">2</div>
            <div className="rwiz-how-copy">
              <strong>Selecciona el motivo</strong>
              <span>Envío, personalización, entrega, producto o material. Tarjetas visuales y claras.</span>
            </div>
          </div>
          <div className="rwiz-how-connector" />
          <div className="rwiz-how-step">
            <div className="rwiz-how-num">3</div>
            <div className="rwiz-how-copy">
              <strong>Describe y envía</strong>
              <span>Añade contexto e imágenes. El equipo lo revisa y te contacta si necesita más datos.</span>
            </div>
          </div>
          <div className="rwiz-how-connector" />
          <div className="rwiz-how-step">
            <div className="rwiz-how-num">✓</div>
            <div className="rwiz-how-copy">
              <strong>Sigue el estado</strong>
              <span>Desde esta página ves si está abierta, en revisión o resuelta en tiempo real.</span>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
