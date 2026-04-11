import { notFound } from "next/navigation";
import type { CSSProperties } from "react";

import { TrackingTimeline } from "@/components/tracking-timeline";
import { TrackingCTASection } from "@/components/tracking-cta-section";
import { fetchPublicTracking } from "@/lib/api";
import { formatDateTime, sortTrackingEvents } from "@/lib/format";
import { getTenantBranding } from "@/lib/tenant-branding";

type TrackingPageProps = {
  params: Promise<{ token: string }>;
};

type FlowStatus = "received" | "prepared" | "in_transit" | "out_for_delivery" | "delivered" | "exception";

function getFlowStatus(orderStatus: string, latestEventNorm?: string | null): FlowStatus {
  const s = latestEventNorm?.toLowerCase() ?? orderStatus;
  if (s === "delivered" || orderStatus === "delivered") return "delivered";
  if (s === "out_for_delivery") return "out_for_delivery";
  if (s === "picked_up" || s === "pickup_available") return "in_transit";
  if (s === "in_transit") return "in_transit";
  if (s === "exception" || orderStatus === "exception") return "exception";
  if (s === "label_created" || orderStatus === "shipped" || orderStatus === "ready_to_ship") return "prepared";
  return "received";
}

const FLOW_STEPS = [
  { key: "received",         label: "Recibido",     icon: "📦", description: "Pedido confirmado." },
  { key: "prepared",         label: "Preparado",    icon: "🏷️", description: "Etiqueta creada." },
  { key: "in_transit",       label: "En tránsito",  icon: "🚚", description: "Recogido por el carrier." },
  { key: "out_for_delivery", label: "En reparto",   icon: "📍", description: "Repartidor en ruta." },
  { key: "delivered",        label: "Entregado",    icon: "✅", description: "Entrega confirmada." },
] as const;

type FlowStepKey = (typeof FLOW_STEPS)[number]["key"];

function getStepState(stepKey: FlowStepKey, currentStatus: FlowStatus, lastKnownStep?: FlowStepKey): "done" | "active" | "pending" {
  const order: FlowStepKey[] = ["received", "prepared", "in_transit", "out_for_delivery", "delivered"];
  const stepIdx = order.indexOf(stepKey);
  if (currentStatus === "exception") {
    const pivotIdx = order.indexOf(lastKnownStep ?? "in_transit");
    if (stepIdx < pivotIdx) return "done";
    if (stepIdx === pivotIdx) return "active";
    return "pending";
  }
  const currentIdx = order.indexOf(currentStatus);
  if (stepIdx < currentIdx) return "done";
  if (stepIdx === currentIdx) return "active";
  return "pending";
}

function getStatusHeadline(status: FlowStatus, latestRaw?: string | null): { title: string; subtitle: string; emoji: string } {
  switch (status) {
    case "delivered":
      return { emoji: "🎉", title: "¡Tu pedido ha llegado!", subtitle: "La entrega ha sido confirmada por el carrier. ¡Gracias por confiar en nosotros!" };
    case "out_for_delivery":
      return { emoji: "📍", title: "En reparto activo", subtitle: "El repartidor está en camino. Prepárate para recibirlo en breve." };
    case "in_transit":
      return { emoji: "🚚", title: "En tránsito", subtitle: latestRaw ?? "Tu pedido está en camino hacia su destino." };
    case "prepared":
      return { emoji: "🏷️", title: "Pedido preparado", subtitle: "La etiqueta está creada y el pedido espera recogida por el carrier." };
    case "exception":
      return { emoji: "⚠️", title: "Incidencia de envío", subtitle: latestRaw ?? "Ha surgido un problema con tu envío. El equipo está revisando el caso." };
    default:
      return { emoji: "📦", title: "Pedido recibido", subtitle: "Tu pedido está registrado y en proceso de preparación." };
  }
}

export default async function TrackingPage({ params }: TrackingPageProps) {
  const { token } = await params;
  const tracking = await fetchPublicTracking(token);

  if (!tracking) notFound();

  const sortedEvents = sortTrackingEvents(tracking.tracking_events);
  const latestEvent = sortedEvents[0] ?? null;
  const flowStatus = getFlowStatus(tracking.order.status, latestEvent?.status_norm);
  const headline = getStatusHeadline(flowStatus, latestEvent?.status_raw);
  const isException = flowStatus === "exception";
  const isDelivered = flowStatus === "delivered";

  const lastKnownStep: FlowStepKey | undefined = isException
    ? (() => {
        const preExceptionStatus = getFlowStatus(
          tracking.order.status,
          sortedEvents.find((e) => e.status_norm !== "exception")?.status_norm,
        );
        const steps: FlowStepKey[] = ["received", "prepared", "in_transit", "out_for_delivery", "delivered"];
        return steps.includes(preExceptionStatus as FlowStepKey) ? (preExceptionStatus as FlowStepKey) : "in_transit";
      })()
    : undefined;

  const trackingNumber =
    tracking.shipment.tracking_number?.trim() &&
    tracking.shipment.tracking_number !== tracking.order.external_id
      ? tracking.shipment.tracking_number
      : null;

  // Extract shop from API response (not in type but backend sends it)
  const raw = tracking as Record<string, unknown>;
  const shopRecord = typeof raw.shop === "object" && raw.shop !== null ? (raw.shop as Record<string, unknown>) : null;
  const shopName = typeof shopRecord?.name === "string" ? shopRecord.name : null;
  const shopSlug = typeof shopRecord?.slug === "string" ? shopRecord.slug : null;

  // Branding
  const branding = getTenantBranding(
    shopSlug || shopName
      ? { id: 0, name: shopName ?? "", slug: shopSlug ?? "" }
      : null,
  );

  const style: CSSProperties & Record<string, string> = {
    "--tracking-accent": branding.accentColor,
    "--tracking-accent-soft": `${branding.accentColor}18`,
  };

  return (
    <div className="trk-page" style={style}>

      {/* ── Brand header ── */}
      <header className="trk-header">
        <div className="trk-header-inner">
          {branding.logoUrl ? (
            <img alt={branding.displayName} className="trk-logo-img" src={branding.logoUrl} />
          ) : (
            <div className="trk-logo-mark">{branding.logoMark}</div>
          )}
          <div className="trk-header-copy">
            <span className="trk-brand-name">{branding.displayName}</span>
            <span className="trk-brand-sub">Seguimiento de pedido</span>
          </div>
        </div>
        <div className="trk-header-order">
          <span className="trk-header-order-label">Pedido</span>
          <span className="trk-header-order-id">#{tracking.order.external_id}</span>
        </div>
      </header>

      {/* ── Status hero ── */}
      <section className={`trk-hero${isException ? " trk-hero-exception" : isDelivered ? " trk-hero-delivered" : ""}`}>
        <div className="trk-hero-inner">
          <div className="trk-hero-emoji">{headline.emoji}</div>
          <div className="trk-hero-copy">
            <span className={`trk-status-badge trk-status-${isException ? "exception" : flowStatus}`}>
              {isException ? "Incidencia" : FLOW_STEPS.find((s) => s.key === flowStatus)?.label ?? "En proceso"}
            </span>
            {latestEvent && (
              <span className="trk-status-ts">{formatDateTime(latestEvent.occurred_at)}</span>
            )}
            <h1 className="trk-hero-title">{headline.title}</h1>
            <p className="trk-hero-subtitle">{headline.subtitle}</p>
          </div>
        </div>
      </section>

      {/* ── Flow stepper ── */}
      {!isException && (
        <div className="trk-stepper-wrap">
          <div className="trk-stepper">
            {FLOW_STEPS.map((step) => {
              const state = getStepState(step.key, flowStatus, lastKnownStep);
              return (
                <div className={`trk-step trk-step-${state}`} key={step.key}>
                  <div className="trk-step-node">
                    {state === "done" ? (
                      <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
                        <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
                      </svg>
                    ) : (
                      <span>{step.icon}</span>
                    )}
                  </div>
                  <span className="trk-step-label">{step.label}</span>
                  {step.key !== "delivered" && <div className="trk-step-line" />}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Main grid ── */}
      <div className="trk-grid">

        {/* Info card */}
        <div className="trk-card">
          <div className="trk-card-head">
            <span className="trk-card-eyebrow">Resumen del envío</span>
          </div>
          <div className="trk-kv">
            <div className="trk-kv-row">
              <span className="trk-kv-label">Carrier</span>
              <span className="trk-kv-value trk-kv-bold">{tracking.shipment.carrier}</span>
            </div>
            {trackingNumber && (
              <div className="trk-kv-row">
                <span className="trk-kv-label">Nº seguimiento</span>
                <span className="trk-kv-value">
                  {tracking.shipment.tracking_url ? (
                    <a className="trk-external-link" href={tracking.shipment.tracking_url} rel="noreferrer" target="_blank">
                      {trackingNumber} ↗
                    </a>
                  ) : (
                    trackingNumber
                  )}
                </span>
              </div>
            )}
            <div className="trk-kv-row">
              <span className="trk-kv-label">Última actualización</span>
              <span className="trk-kv-value">
                {latestEvent ? formatDateTime(latestEvent.occurred_at) : "Sin novedades aún"}
              </span>
            </div>
            <div className="trk-kv-row">
              <span className="trk-kv-label">Envío creado</span>
              <span className="trk-kv-value">{formatDateTime(tracking.shipment.created_at)}</span>
            </div>
            {tracking.order.customer_name && (
              <div className="trk-kv-row">
                <span className="trk-kv-label">Destinatario</span>
                <span className="trk-kv-value">{tracking.order.customer_name}</span>
              </div>
            )}
          </div>
          {tracking.shipment.tracking_url && (
            <a
              className="trk-carrier-btn"
              href={tracking.shipment.tracking_url}
              rel="noreferrer"
              target="_blank"
            >
              Seguimiento oficial {tracking.shipment.carrier} ↗
            </a>
          )}
        </div>

        {/* Timeline card */}
        <div className="trk-card">
          <div className="trk-card-head">
            <span className="trk-card-eyebrow">Historial del carrier</span>
          </div>
          <TrackingTimeline
            emptyDescription="El carrier aún no ha reportado movimientos."
            emptyTitle="Sin eventos todavía"
            events={sortedEvents}
          />
        </div>
      </div>

      {/* ── CTA section (client, reads branding config + localStorage) ── */}
      <TrackingCTASection
        accentColor={branding.accentColor}
        branding={branding.tracking ?? null}
        isDelivered={isDelivered}
        shopName={branding.displayName}
        shopSlug={shopSlug ?? ""}
      />

      {/* ── Footer ── */}
      <footer className="trk-footer">
        <div className="trk-footer-inner">
          <span className="trk-footer-brand">{branding.displayName}</span>
          <span className="trk-footer-sep">·</span>
          <span className="trk-footer-powered">Logística gestionada por <strong>Brandeate</strong></span>
        </div>
      </footer>
    </div>
  );
}
