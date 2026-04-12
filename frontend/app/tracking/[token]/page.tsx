import { notFound } from "next/navigation";
import type { CSSProperties } from "react";

import { TrackingTimeline } from "@/components/tracking-timeline";
import { TrackingCTASection } from "@/components/tracking-cta-section";
import { fetchPublicTracking } from "@/lib/api";
import { sortTrackingEvents } from "@/lib/format";
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
  { key: "received",         label: "Recibido",     icon: "📦" },
  { key: "prepared",         label: "Preparado",    icon: "🏷️" },
  { key: "in_transit",       label: "En tránsito",  icon: "🚚" },
  { key: "out_for_delivery", label: "En reparto",   icon: "📍" },
  { key: "delivered",        label: "Entregado",    icon: "✓"  },
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

type StatusConfig = {
  title: string;
  subtitle: string;
  label: string;
  heroClass: string;
  accentOverride?: string;
};

function getStatusConfig(status: FlowStatus): StatusConfig {
  switch (status) {
    case "delivered":
      return {
        label: "Entregado",
        title: "¡Tu pedido ha llegado!",
        subtitle: "La entrega ha sido confirmada. Esperamos que estés disfrutando de tu compra.",
        heroClass: "trk-hero-delivered",
        accentOverride: "#16a34a",
      };
    case "out_for_delivery":
      return {
        label: "En reparto",
        title: "Tu pedido está de camino",
        subtitle: "El repartidor está en ruta hacia tu dirección. Prepárate para recibirlo.",
        heroClass: "trk-hero-ofd",
      };
    case "in_transit":
      return {
        label: "En tránsito",
        title: "Tu pedido está viajando",
        subtitle: "El paquete está en movimiento y se acerca a su destino.",
        heroClass: "trk-hero-transit",
      };
    case "prepared":
      return {
        label: "Preparado",
        title: "Pedido listo para envío",
        subtitle: "Tu pedido ha sido preparado y está a la espera de ser recogido por el carrier.",
        heroClass: "trk-hero-prepared",
      };
    case "exception":
      return {
        label: "Incidencia",
        title: "Hay una incidencia en tu envío",
        subtitle: "Estamos trabajando para resolver la situación. Si tienes dudas, contáctanos.",
        heroClass: "trk-hero-exception",
        accentOverride: "#d97706",
      };
    default:
      return {
        label: "Recibido",
        title: "Pedido recibido",
        subtitle: "Hemos recibido tu pedido y estamos preparándolo. Pronto tendrás más novedades.",
        heroClass: "",
      };
  }
}

function formatDateShort(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function TrackingPage({ params }: TrackingPageProps) {
  const { token } = await params;
  const tracking = await fetchPublicTracking(token);

  if (!tracking) notFound();

  const sortedEvents = sortTrackingEvents(tracking.tracking_events);
  const latestEvent = sortedEvents[0] ?? null;
  const flowStatus = getFlowStatus(tracking.order.status, latestEvent?.status_norm);
  const statusConfig = getStatusConfig(flowStatus);
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

  // Branding
  const shopData = tracking.shop ?? null;
  const trackingConfig = shopData?.tracking_config ?? null;
  const branding = getTenantBranding(
    shopData ? { id: shopData.id, name: shopData.name, slug: shopData.slug } : null,
    trackingConfig,
  );
  const shopSlug = shopData?.slug ?? "";

  // Clean up order ID — remove leading # if present to avoid ##
  const rawId = String(tracking.order.external_id ?? "");
  const cleanId = rawId.startsWith("#") ? rawId : `#${rawId}`;

  const estimatedDelivery = tracking.shipment.expected_delivery_date
    ? new Date(tracking.shipment.expected_delivery_date + "T12:00:00").toLocaleDateString("es-ES", {
        weekday: "long",
        day: "numeric",
        month: "long",
      })
    : null;

  const accent = statusConfig.accentOverride ?? branding.accentColor;

  const style: CSSProperties & Record<string, string> = {
    "--trk-accent": accent,
    "--trk-accent-rgb": hexToRgb(accent),
  };

  return (
    <div className="trk2-page" style={style}>

      {/* ── Top bar ── */}
      <header className="trk2-topbar">
        <div className="trk2-topbar-brand">
          {branding.logoUrl ? (
            <img alt={branding.displayName} className="trk2-topbar-logo" src={branding.logoUrl} />
          ) : (
            <div className="trk2-topbar-mark">{branding.logoMark}</div>
          )}
          <span className="trk2-topbar-name">{branding.displayName}</span>
        </div>
        <div className="trk2-topbar-order">
          <span className="trk2-order-chip">{cleanId}</span>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className={`trk2-hero ${statusConfig.heroClass}`}>
        <div className="trk2-hero-inner">
          {/* Status pill */}
          <div className="trk2-status-pill-wrap">
            <span className={`trk2-status-pill trk2-status-${flowStatus}${!isDelivered && !isException ? " trk2-status-pulse" : ""}`}>
              <span className="trk2-status-dot" />
              {statusConfig.label}
            </span>
            {latestEvent && (
              <span className="trk2-hero-ts">{formatDateShort(latestEvent.occurred_at)}</span>
            )}
          </div>

          <h1 className="trk2-hero-title">{statusConfig.title}</h1>
          <p className="trk2-hero-sub">{statusConfig.subtitle}</p>

          {/* Estimated delivery */}
          {estimatedDelivery && !isDelivered && !isException && (
            <div className="trk2-eta-badge">
              <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
                <rect height="18" rx="2" stroke="currentColor" strokeWidth="2" width="18" x="3" y="4"/>
                <path d="M3 9h18M8 2v4M16 2v4" stroke="currentColor" strokeLinecap="round" strokeWidth="2"/>
              </svg>
              <span className="trk2-eta-label">Entrega estimada</span>
              <span className="trk2-eta-date">{estimatedDelivery}</span>
            </div>
          )}
        </div>
      </section>

      {/* ── Progress stepper ── */}
      {!isException && (
        <div className="trk2-progress-wrap">
          <div className="trk2-progress-inner">
            {FLOW_STEPS.map((step, idx) => {
              const state = getStepState(step.key, flowStatus, lastKnownStep);
              const isDone = state === "done";
              const isActive = state === "active";
              const isLast = idx === FLOW_STEPS.length - 1;
              return (
                <div className="trk2-step" key={step.key}>
                  <div className="trk2-step-track">
                    {/* Left connector */}
                    {idx > 0 && (
                      <div className={`trk2-step-conn trk2-step-conn-left${isDone || isActive ? " trk2-conn-filled" : ""}`} />
                    )}
                    {/* Node */}
                    <div className={`trk2-step-node trk2-step-node-${state}`}>
                      {isDone ? (
                        <svg fill="none" height="12" viewBox="0 0 24 24" width="12">
                          <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
                        </svg>
                      ) : (
                        <span className="trk2-step-icon">{step.icon}</span>
                      )}
                    </div>
                    {/* Right connector */}
                    {!isLast && (
                      <div className={`trk2-step-conn trk2-step-conn-right${isDone ? " trk2-conn-filled" : ""}`} />
                    )}
                  </div>
                  <span className={`trk2-step-label trk2-step-label-${state}`}>{step.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Exception banner */}
      {isException && (
        <div className="trk2-exception-banner">
          <svg fill="none" height="18" viewBox="0 0 24 24" width="18">
            <path d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"/>
          </svg>
          <span>Ha surgido una incidencia con tu envío. El equipo está revisando el caso. Si necesitas ayuda, contacta con nosotros.</span>
        </div>
      )}

      {/* ── Main content ── */}
      <main className="trk2-main">

        {/* Shipment info card */}
        <div className="trk2-info-card">
          <div className="trk2-info-rows">
            <div className="trk2-info-row">
              <span className="trk2-info-emoji">🚚</span>
              <div className="trk2-info-row-body">
                <span className="trk2-info-label">Transportista</span>
                <span className="trk2-info-value trk2-info-carrier">{tracking.shipment.carrier}</span>
              </div>
            </div>
            {trackingNumber && (
              <div className="trk2-info-row">
                <span className="trk2-info-emoji">🔍</span>
                <div className="trk2-info-row-body">
                  <span className="trk2-info-label">Nº de seguimiento</span>
                  <span className="trk2-info-value">
                    {tracking.shipment.tracking_url ? (
                      <a className="trk2-tracking-link" href={tracking.shipment.tracking_url} rel="noreferrer" target="_blank">
                        {trackingNumber}
                        <svg fill="none" height="11" viewBox="0 0 24 24" width="11">
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5"/>
                        </svg>
                      </a>
                    ) : trackingNumber}
                  </span>
                </div>
              </div>
            )}
            {latestEvent && (
              <div className="trk2-info-row">
                <span className="trk2-info-emoji">🕐</span>
                <div className="trk2-info-row-body">
                  <span className="trk2-info-label">Última actualización</span>
                  <span className="trk2-info-value">{formatDateShort(latestEvent.occurred_at)}</span>
                </div>
              </div>
            )}
            {tracking.order.customer_name && (
              <div className="trk2-info-row trk2-info-row-last">
                <span className="trk2-info-emoji">📍</span>
                <div className="trk2-info-row-body">
                  <span className="trk2-info-label">Destinatario</span>
                  <span className="trk2-info-value">{tracking.order.customer_name}</span>
                </div>
              </div>
            )}
          </div>
          {tracking.shipment.tracking_url && (
            <a
              className="trk2-carrier-btn"
              href={tracking.shipment.tracking_url}
              rel="noreferrer"
              target="_blank"
            >
              🚛 Ver seguimiento en {tracking.shipment.carrier}
            </a>
          )}
        </div>

        {/* Timeline */}
        {sortedEvents.length > 0 && (
          <div className="trk2-timeline-card">
            <div className="trk2-timeline-head">
              <span>📋 Historial de envío</span>
              <span className="trk2-tl-count">{sortedEvents.length} evento{sortedEvents.length !== 1 ? "s" : ""}</span>
            </div>
            <TrackingTimeline
              emptyDescription="El carrier aún no ha reportado movimientos."
              emptyTitle="Sin eventos todavía"
              events={sortedEvents}
            />
          </div>
        )}

        {sortedEvents.length === 0 && (
          <div className="trk2-empty-timeline">
            <div className="trk2-empty-icon-wrap">📦</div>
            <p className="trk2-empty-text">El carrier aún no ha reportado movimientos.<br/>Vuelve más tarde para ver las novedades.</p>
          </div>
        )}

      </main>

      {/* ── CTA ── */}
      <div className="trk2-cta-wrap">
        <TrackingCTASection
          accentColor={accent}
          branding={branding.tracking ?? null}
          isDelivered={isDelivered}
          shopName={branding.displayName}
          shopSlug={shopSlug ?? ""}
        />
      </div>

      {/* ── Footer ── */}
      <footer className="trk2-footer">
        <span>Logística gestionada por <strong>Brandeate</strong></span>
        <span className="trk2-footer-dot" />
        <span>{branding.displayName}</span>
      </footer>
    </div>
  );
}

/** Convert #rrggbb to "r, g, b" for use in rgba() */
function hexToRgb(hex: string): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return "99, 102, 241";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}
