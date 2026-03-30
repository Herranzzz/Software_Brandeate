import { notFound } from "next/navigation";

import { Card } from "@/components/card";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { StatusBadge } from "@/components/status-badge";
import { TrackingTimeline } from "@/components/tracking-timeline";
import { fetchPublicTracking } from "@/lib/api";
import { formatDateTime, getTrackingHeadline, sortTrackingEvents } from "@/lib/format";


type TrackingPageProps = {
  params: Promise<{ token: string }>;
};


export default async function TrackingPage({ params }: TrackingPageProps) {
  const { token } = await params;
  const tracking = await fetchPublicTracking(token);

  if (!tracking) {
    notFound();
  }

  const sortedEvents = sortTrackingEvents(tracking.tracking_events);
  const latestEvent = sortedEvents[0] ?? null;
  const headline = getTrackingHeadline(tracking.order.status, latestEvent?.status_norm);
  const trackingNumber =
    tracking.shipment.tracking_number?.trim() &&
    tracking.shipment.tracking_number !== tracking.order.external_id
      ? tracking.shipment.tracking_number
      : null;

  return (
    <div className="stack">
      <section className="tracking-hero tracking-hero-premium">
        <span className="eyebrow tracking-eyebrow">
          Seguimiento publico
        </span>
        <h1>{trackingNumber ?? "Seguimiento pendiente"}</h1>
        <p className="tracking-copy">
          Hola {tracking.order.customer_name}, aqui puedes revisar el estado actual del envio y su
          progreso reciente.
        </p>
        <div className="muted">
          Pedido {tracking.order.external_id}
        </div>
        <div className="tracking-callout">
          <div>
            <span className="eyebrow tracking-eyebrow">Estado principal</span>
            <h2 className="tracking-status-title">{headline.title}</h2>
            <p className="tracking-copy tracking-copy-compact">{headline.description}</p>
          </div>
          <div className="tracking-status-badge">
            <StatusBadge status={tracking.order.status} />
          </div>
        </div>
        <div className="tracking-meta">
          <span className="tracking-chip">{tracking.shipment.carrier}</span>
          <span className="tracking-chip">{trackingNumber ?? "Sin numero de seguimiento"}</span>
          <span className="tracking-chip">{latestEvent?.status_norm ?? tracking.order.status}</span>
        </div>
      </section>

      <section className="grid grid-2">
        <Card className="stack">
          <SectionTitle eyebrow="Resumen" title="Estado del envio" />
          <div className="kv">
            <div className="kv-row">
              <span className="kv-label">Pedido</span>
              <div>{tracking.order.external_id}</div>
            </div>
            <div className="kv-row">
              <span className="kv-label">Cliente</span>
              <div>{tracking.order.customer_name}</div>
            </div>
            <div className="kv-row">
              <span className="kv-label">Status</span>
              <div>
                <StatusBadge status={tracking.order.status} />
              </div>
            </div>
            <div className="kv-row">
              <span className="kv-label">Carrier</span>
              <div>{tracking.shipment.carrier}</div>
            </div>
            <div className="kv-row">
              <span className="kv-label">Tracking number</span>
              <div>
                {trackingNumber && tracking.shipment.tracking_url ? (
                  <a className="table-link table-link-strong" href={tracking.shipment.tracking_url} rel="noreferrer" target="_blank">
                    {trackingNumber}
                  </a>
                ) : trackingNumber ? (
                  trackingNumber
                ) : (
                  "Pendiente"
                )}
              </div>
            </div>
            <div className="kv-row">
              <span className="kv-label">Tracking oficial</span>
              <div>
                {tracking.shipment.tracking_url ? (
                  <a className="table-link" href={tracking.shipment.tracking_url} rel="noreferrer" target="_blank">
                    Abrir seguimiento
                  </a>
                ) : (
                  "No disponible"
                )}
              </div>
            </div>
            <div className="kv-row">
              <span className="kv-label">Ultima actualizacion</span>
              <div>{latestEvent ? formatDateTime(latestEvent.occurred_at) : "Sin novedades aun"}</div>
            </div>
          </div>
        </Card>

        <Card className="stack card-spotlight">
          <div>
            <span className="eyebrow">Estado mas reciente</span>
            <h2 className="section-title section-title-small">
              {latestEvent?.status_norm ?? "Pendiente de actualizaciones"}
            </h2>
          </div>
          <p className="subtitle">
            {latestEvent?.status_raw ?? "Todavia no hay eventos de tracking disponibles para este envio."}
          </p>
          <div className="muted">
            {latestEvent ? formatDateTime(latestEvent.occurred_at) : "Sin fecha disponible"}
          </div>
        </Card>
      </section>

      <Card className="stack">
        <SectionTitle
          description="Actualizaciones recientes del carrier ordenadas de la mas nueva a la mas antigua."
          eyebrow="Timeline"
          title="Eventos recientes"
        />
        <TrackingTimeline
          emptyDescription="El carrier todavia no ha reportado movimientos para este envio."
          emptyTitle="Sin eventos todavia"
          events={sortedEvents}
        />
      </Card>
    </div>
  );
}
