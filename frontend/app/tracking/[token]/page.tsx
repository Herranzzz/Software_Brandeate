import { notFound } from "next/navigation";

import { TrackingTimeline } from "@/components/tracking-timeline";
import { fetchPublicTracking } from "@/lib/api";
import { formatDateTime, sortTrackingEvents } from "@/lib/format";

type TrackingPageProps = {
  params: Promise<{ token: string }>;
};

type FlowStatus = "received" | "prepared" | "in_transit" | "out_for_delivery" | "delivered" | "exception";

function getFlowStatus(orderStatus: string, latestEventNorm?: string | null): FlowStatus {
  const s = latestEventNorm?.toLowerCase() ?? orderStatus;
  if (s === "delivered" || orderStatus === "delivered") return "delivered";
  if (s === "out_for_delivery") return "out_for_delivery";
  if (s === "in_transit") return "in_transit";
  if (s === "exception" || orderStatus === "exception") return "exception";
  if (s === "label_created" || orderStatus === "shipped" || orderStatus === "ready_to_ship") return "prepared";
  return "received";
}

const FLOW_STEPS = [
  { key: "received", label: "Recibido", icon: "📦", description: "Pedido confirmado y registrado en el sistema." },
  { key: "prepared", label: "Preparado", icon: "🏷️", description: "Etiqueta creada, listo para recogida." },
  { key: "in_transit", label: "En tránsito", icon: "🚚", description: "Recogido por el carrier y en camino." },
  { key: "out_for_delivery", label: "En reparto", icon: "📍", description: "El repartidor está en ruta hacia ti." },
  { key: "delivered", label: "Entregado", icon: "✅", description: "Entrega confirmada por el carrier." },
] as const;

type FlowStepKey = (typeof FLOW_STEPS)[number]["key"];

function getStepState(stepKey: FlowStepKey, currentStatus: FlowStatus): "done" | "active" | "pending" {
  if (currentStatus === "exception") {
    const order = ["received", "prepared", "in_transit", "out_for_delivery", "delivered"];
    const stepIdx = order.indexOf(stepKey);
    const currentIdx = order.indexOf("in_transit");
    if (stepIdx < currentIdx) return "done";
    if (stepIdx === currentIdx) return "active";
    return "pending";
  }

  const order: FlowStepKey[] = ["received", "prepared", "in_transit", "out_for_delivery", "delivered"];
  const stepIdx = order.indexOf(stepKey);
  const currentIdx = order.indexOf(currentStatus);
  if (stepIdx < currentIdx) return "done";
  if (stepIdx === currentIdx) return "active";
  return "pending";
}

function getStatusHeadline(status: FlowStatus, latestRaw?: string | null): { title: string; subtitle: string } {
  switch (status) {
    case "delivered":
      return { title: "¡Tu pedido ha llegado!", subtitle: "La entrega ha sido confirmada por el carrier." };
    case "out_for_delivery":
      return { title: "En reparto activo", subtitle: "El repartidor está en camino. Prepárate para recibirlo." };
    case "in_transit":
      return { title: "En tránsito", subtitle: latestRaw ?? "Tu pedido está en camino hacia su destino." };
    case "prepared":
      return { title: "Pedido preparado", subtitle: "La etiqueta está creada y el pedido espera recogida por el carrier." };
    case "exception":
      return { title: "Incidencia de envío", subtitle: latestRaw ?? "Ha surgido un problema con tu envío. El equipo está revisando el caso." };
    default:
      return { title: "Pedido recibido", subtitle: "Tu pedido está registrado y en proceso de preparación." };
  }
}

export default async function TrackingPage({ params }: TrackingPageProps) {
  const { token } = await params;
  const tracking = await fetchPublicTracking(token);

  if (!tracking) {
    notFound();
  }

  const sortedEvents = sortTrackingEvents(tracking.tracking_events);
  const latestEvent = sortedEvents[0] ?? null;
  const flowStatus = getFlowStatus(tracking.order.status, latestEvent?.status_norm);
  const headline = getStatusHeadline(flowStatus, latestEvent?.status_raw);
  const isException = flowStatus === "exception";

  const trackingNumber =
    tracking.shipment.tracking_number?.trim() &&
    tracking.shipment.tracking_number !== tracking.order.external_id
      ? tracking.shipment.tracking_number
      : null;

  const shopName = (tracking as any).shop?.name ?? null;

  return (
    <div className="tracking-premium-page">

      {/* ── Brand header ── */}
      <header className="tracking-brand-header">
        <div className="tracking-brand-inner">
          <div className="tracking-brand-logo">
            {shopName ? shopName.slice(0, 2).toUpperCase() : "BR"}
          </div>
          <div className="tracking-brand-copy">
            <span className="tracking-brand-name">{shopName ?? "Brandeate"}</span>
            <span className="tracking-brand-tagline">Seguimiento de tu pedido</span>
          </div>
        </div>
      </header>

      {/* ── Hero status ── */}
      <section className={`tracking-status-hero${isException ? " tracking-status-hero-exception" : flowStatus === "delivered" ? " tracking-status-hero-delivered" : ""}`}>
        <div className="tracking-status-hero-inner">
          <div className="tracking-status-icon">
            {FLOW_STEPS.find((s) => s.key === (isException ? "in_transit" : flowStatus))?.icon ?? "📦"}
          </div>
          <div className="tracking-status-copy">
            <div className="tracking-status-badge-row">
              <span className={`tracking-flow-badge tracking-flow-badge-${isException ? "exception" : flowStatus}`}>
                {isException ? "Incidencia" : FLOW_STEPS.find((s) => s.key === flowStatus)?.label ?? "En proceso"}
              </span>
              {latestEvent && (
                <span className="tracking-status-ts">{formatDateTime(latestEvent.occurred_at)}</span>
              )}
            </div>
            <h1 className="tracking-status-title">{headline.title}</h1>
            <p className="tracking-status-subtitle">{headline.subtitle}</p>
          </div>
        </div>
      </section>

      {/* ── Flow stepper ── */}
      {!isException && (
        <div className="tracking-flow-stepper-wrap">
          <div className="tracking-flow-stepper">
            {FLOW_STEPS.map((step) => {
              const state = getStepState(step.key, flowStatus);
              return (
                <div className={`tracking-flow-step tracking-flow-step-${state}`} key={step.key}>
                  <div className="tracking-flow-step-dot">
                    {state === "done" ? "✓" : <span className="tracking-flow-step-icon">{step.icon}</span>}
                  </div>
                  <div className="tracking-flow-step-label">{step.label}</div>
                  {step.key !== "delivered" && <div className="tracking-flow-connector" />}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Content grid ── */}
      <div className="tracking-content-grid">

        {/* Shipment info card */}
        <div className="tracking-info-card">
          <div className="tracking-info-section">
            <span className="eyebrow">📦 Resumen del envío</span>
            <div className="tracking-kv">
              <div className="tracking-kv-row">
                <span className="tracking-kv-label">Pedido</span>
                <span className="tracking-kv-value">{tracking.order.external_id}</span>
              </div>
              <div className="tracking-kv-row">
                <span className="tracking-kv-label">Carrier</span>
                <span className="tracking-kv-value">{tracking.shipment.carrier}</span>
              </div>
              {trackingNumber && (
                <div className="tracking-kv-row">
                  <span className="tracking-kv-label">Nº de seguimiento</span>
                  <span className="tracking-kv-value">
                    {tracking.shipment.tracking_url ? (
                      <a
                        className="tracking-external-link"
                        href={tracking.shipment.tracking_url}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {trackingNumber} ↗
                      </a>
                    ) : (
                      trackingNumber
                    )}
                  </span>
                </div>
              )}
              <div className="tracking-kv-row">
                <span className="tracking-kv-label">Última actualización</span>
                <span className="tracking-kv-value">
                  {latestEvent ? formatDateTime(latestEvent.occurred_at) : "Sin novedades aún"}
                </span>
              </div>
              <div className="tracking-kv-row">
                <span className="tracking-kv-label">Envío creado</span>
                <span className="tracking-kv-value">{formatDateTime(tracking.shipment.created_at)}</span>
              </div>
            </div>
          </div>

          {tracking.shipment.tracking_url && (
            <div className="tracking-carrier-action">
              <a
                className="button button-secondary"
                href={tracking.shipment.tracking_url}
                rel="noreferrer"
                target="_blank"
              >
                Seguimiento oficial {tracking.shipment.carrier} ↗
              </a>
            </div>
          )}
        </div>

        {/* Timeline */}
        <div className="tracking-timeline-card">
          <div className="tracking-info-section">
            <span className="eyebrow">📜 Historial</span>
            <h2 className="tracking-section-title">Eventos del carrier</h2>
          </div>
          <TrackingTimeline
            emptyDescription="El carrier aún no ha reportado movimientos para este envío."
            emptyTitle="Sin eventos todavía"
            events={sortedEvents}
          />
        </div>
      </div>

      {/* ── Footer ── */}
      <footer className="tracking-footer">
        <span>Seguimiento gestionado por {shopName ?? "Brandeate"} · Powered by Brandeate Logistics</span>
      </footer>
    </div>
  );
}
