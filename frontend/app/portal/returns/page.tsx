import Link from "next/link";

import { Card } from "@/components/card";
import { EmptyState } from "@/components/empty-state";
import { KpiCard } from "@/components/kpi-card";
import { PageHeader } from "@/components/page-header";
import { PortalReturnRequestForm } from "@/components/portal-return-request-form";
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
  open: { label: "Abierta", className: "badge badge-status badge-status-exception", description: "esperando revisión" },
  in_progress: { label: "En revisión", className: "badge badge-status badge-status-in-progress", description: "ya en curso con el equipo" },
  resolved: { label: "Resuelta", className: "badge badge-status badge-status-delivered", description: "cierre confirmado" },
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

  const openCases = incidents.filter((incident) => incident.status === "open");
  const inProgressCases = incidents.filter((incident) => incident.status === "in_progress");
  const resolvedCases = incidents.filter((incident) => incident.status === "resolved");
  const shopQuery = tenantScope.selectedShopId ? `?shop_id=${tenantScope.selectedShopId}` : "";

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Devoluciones"
        title="Devoluciones y solicitudes"
        description="Un espacio simple para revisar casos abiertos, crear una nueva solicitud y entender el siguiente paso sin fricción."
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
        <KpiCard label="Pedidos elegibles" tone="accent" value={String(orders.length)} delta="para crear una solicitud" />
      </section>

      <section className="portal-returns-layout">
        <Card className="portal-glass-card portal-return-case-list-card">
          <div className="portal-dashboard-section-head">
            <div>
              <span className="eyebrow">Casos</span>
              <h3 className="section-title section-title-small">Qué está pasando con tus devoluciones</h3>
              <p className="subtitle">Estados sencillos y siguientes pasos claros para que sepas siempre en qué punto está cada caso.</p>
            </div>
          </div>

          {incidents.length === 0 ? (
            <EmptyState title="Sin devoluciones abiertas" description="Cuando abras un caso, aquí verás el estado, la prioridad y el siguiente paso." />
          ) : (
            <div className="portal-return-case-list">
              {incidents.map((incident) => {
                const meta = incidentStatusMeta[incident.status];
                return (
                  <article className="portal-return-case" key={incident.id}>
                    <div className="portal-return-case-head">
                      <div>
                        <Link className="table-link table-link-strong" href={`/portal/returns/${incident.id}`}>
                          {incident.title}
                        </Link>
                        <div className="table-secondary">
                          {incident.order.external_id} · {incident.order.customer_name}
                        </div>
                      </div>
                      <span className={meta.className}>{meta.label}</span>
                    </div>
                    <p className="portal-return-case-copy">
                      {incident.description || "Estamos revisando esta solicitud. Verás aquí cualquier novedad importante."}
                    </p>
                    <div className="portal-return-case-foot">
                      <span>{meta.description}</span>
                      <span>Actualizado {formatDateTime(incident.updated_at)}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </Card>

        <div className="portal-return-side">
          <Card className="portal-glass-card">
            <div className="portal-dashboard-section-head">
              <div>
                <span className="eyebrow">Nueva solicitud</span>
                <h3 className="section-title section-title-small">Crear una devolución guiada</h3>
              </div>
            </div>
            {orders.length > 0 ? (
              <PortalReturnRequestForm orders={orders} shopId={tenantScope.selectedShopId} />
            ) : (
              <EmptyState title="Sin pedidos visibles" description="Necesitas al menos un pedido visible para crear una solicitud desde el portal." />
            )}
          </Card>

          <Card className="portal-glass-card">
            <div className="portal-dashboard-section-head">
              <div>
                <span className="eyebrow">Cómo funciona</span>
                <h3 className="section-title section-title-small">Proceso simple y claro</h3>
              </div>
            </div>
            <div className="portal-return-steps">
              <article className="portal-return-step">
                <strong>1. Elige el pedido</strong>
                <span>Selecciona el pedido afectado y el motivo principal sin formularios largos.</span>
              </article>
              <article className="portal-return-step">
                <strong>2. Añade contexto</strong>
                <span>Describe el problema y pega enlaces a imágenes si quieres compartir pruebas rápidamente.</span>
              </article>
              <article className="portal-return-step">
                <strong>3. Sigue el estado</strong>
                <span>Verás si está abierta, en revisión o resuelta y cuál es el siguiente paso.</span>
              </article>
            </div>
            <div className="portal-return-cta-row">
              <Link className="button button-secondary" href={`/portal/orders${shopQuery}`}>Ver pedidos</Link>
              <Link className="button button-secondary" href={`/portal/help${shopQuery}`}>Contactar soporte</Link>
            </div>
          </Card>
        </div>
      </section>
    </div>
  );
}
