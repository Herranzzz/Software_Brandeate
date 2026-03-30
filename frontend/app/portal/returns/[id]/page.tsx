import Link from "next/link";
import { notFound } from "next/navigation";

import { Card } from "@/components/card";
import { EmptyState } from "@/components/empty-state";
import { fetchIncidentById, fetchOrderById } from "@/lib/api";
import { fetchMyShops, requirePortalUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";

type PortalReturnDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
};

const statusMeta = {
  open: {
    label: "Solicitud enviada",
    description: "Hemos recibido el caso y está pendiente de revisión inicial.",
    className: "badge badge-status badge-status-exception",
  },
  in_progress: {
    label: "En revisión",
    description: "El equipo está revisando la solicitud y preparando el siguiente paso.",
    className: "badge badge-status badge-status-in-progress",
  },
  resolved: {
    label: "Resuelta",
    description: "El caso está cerrado y la revisión ha terminado.",
    className: "badge badge-status badge-status-delivered",
  },
} as const;

export default async function PortalReturnDetailPage({ params }: PortalReturnDetailPageProps) {
  await requirePortalUser();
  await fetchMyShops();

  const { id } = await params;
  const incident = await fetchIncidentById(id);
  if (!incident) {
    notFound();
  }

  const order = await fetchOrderById(String(incident.order.id));
  const meta = statusMeta[incident.status];
  const timeline = [
    {
      id: "created",
      label: "Solicitud enviada",
      date: incident.created_at,
      description: "La solicitud ha quedado registrada correctamente.",
    },
    {
      id: "updated",
      label: meta.label,
      date: incident.updated_at,
      description: meta.description,
    },
  ];

  return (
    <div className="stack">
      <Card className="portal-glass-card portal-return-detail-hero">
        <div className="portal-return-case-head">
          <div>
            <span className="eyebrow">Devolución</span>
            <h1 className="section-title">{incident.title}</h1>
            <p className="subtitle">
              Pedido {incident.order.external_id} · {incident.order.customer_name}
            </p>
          </div>
          <span className={meta.className}>{meta.label}</span>
        </div>
        <div className="portal-return-detail-actions">
          <Link className="button button-secondary" href="/portal/returns">Volver a devoluciones</Link>
          {order ? <Link className="button button-secondary" href={`/portal/orders/${order.id}`}>Ver pedido</Link> : null}
        </div>
      </Card>

      <section className="portal-returns-layout">
        <Card className="portal-glass-card">
          <div className="portal-dashboard-section-head">
            <div>
              <span className="eyebrow">Estado del caso</span>
              <h3 className="section-title section-title-small">Qué está pasando ahora</h3>
            </div>
          </div>

          <div className="portal-return-reason-hint">
            <strong>{meta.label}</strong>
            <span>{meta.description}</span>
          </div>

          <div className="portal-activity-timeline">
            {timeline.map((item) => (
              <article className="portal-activity-row" key={item.id}>
                <div className="portal-activity-dot" />
                <div className="portal-activity-copy">
                  <div className="portal-activity-head">
                    <span className="portal-soft-pill">{item.label}</span>
                    <span className="table-secondary">{formatDateTime(item.date)}</span>
                  </div>
                  <div className="table-secondary">{item.description}</div>
                </div>
              </article>
            ))}
          </div>
        </Card>

        <div className="portal-return-side">
          <Card className="portal-glass-card">
            <div className="portal-dashboard-section-head">
              <div>
                <span className="eyebrow">Resumen</span>
                <h3 className="section-title section-title-small">Detalle del caso</h3>
              </div>
            </div>
            <div className="portal-order-row-grid">
              <div>
                <span className="portal-summary-label">Prioridad</span>
                <strong>{incident.priority}</strong>
              </div>
              <div>
                <span className="portal-summary-label">Última actualización</span>
                <strong>{formatDateTime(incident.updated_at)}</strong>
              </div>
              <div>
                <span className="portal-summary-label">Pedido relacionado</span>
                <strong>{incident.order.external_id}</strong>
              </div>
            </div>
            <div className="portal-return-case-copy">
              {incident.description || "Sin descripción adicional. Te avisaremos aquí cuando haya un siguiente paso o una resolución."}
            </div>
          </Card>

          <Card className="portal-glass-card">
            <div className="portal-dashboard-section-head">
              <div>
                <span className="eyebrow">Siguiente paso</span>
                <h3 className="section-title section-title-small">Qué debes esperar</h3>
              </div>
            </div>
            {incident.status === "resolved" ? (
              <div className="portal-return-step">
                <strong>Caso cerrado</strong>
                <span>La devolución o incidencia ya ha sido revisada. Si necesitas ampliar información, abre un nuevo caso desde devoluciones.</span>
              </div>
            ) : (
              <div className="portal-return-step">
                <strong>Seguimiento en curso</strong>
                <span>Estamos revisando este caso. Si necesitamos más información o material, la referencia aparecerá en este mismo detalle.</span>
              </div>
            )}
          </Card>

          {!order ? (
            <Card className="portal-glass-card">
              <EmptyState title="Pedido no disponible" description="No hemos podido cargar el pedido relacionado para esta devolución." />
            </Card>
          ) : null}
        </div>
      </section>
    </div>
  );
}
