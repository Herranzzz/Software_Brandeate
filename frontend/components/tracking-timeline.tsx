type TimelineEvent = {
  id: number;
  status_norm: string;
  status_raw: string | null;
  source: string | null;
  location: string | null;
  occurred_at: string;
};

type TrackingTimelineProps = {
  events: TimelineEvent[];
  emptyTitle?: string;
  emptyDescription?: string;
};

const NORM_LABELS: Record<string, string> = {
  delivered:          "Entregado",
  out_for_delivery:   "En reparto",
  in_transit:         "En tránsito",
  pickup_available:   "Disponible para recogida",
  attempted_delivery: "Intento de entrega",
  exception:          "Incidencia",
  label_created:      "Etiqueta generada",
  picked_up:          "Recogido por el carrier",
  stalled:            "Sin novedades recientes",
};

function getNormLabel(statusNorm: string): string {
  return NORM_LABELS[statusNorm.toLowerCase()] ?? "Actualización";
}

/** Returns true if the string looks like an internal code (e.g. "shopify:IN_TRANSIT", "ctt:LABEL_CREATED") */
function isInternalCode(s: string): boolean {
  return /^[a-z0-9_]+:[A-Z_]+$/.test(s.trim()) || /^[A-Z_]{5,}$/.test(s.trim());
}

/** Returns a human-friendly description for the event, hiding internal codes */
function getEventDescription(event: TimelineEvent): string | null {
  const raw = event.status_raw?.trim();
  if (!raw) return null;
  if (isInternalCode(raw)) return null;
  if (raw === event.status_norm) return null;
  // If identical to the norm label after normalisation, skip
  if (raw.toLowerCase().replace(/_/g, " ") === event.status_norm.replace(/_/g, " ")) return null;
  return raw;
}

type DotVariant = "delivered" | "ofd" | "transit" | "exception" | "label" | "active" | "default";

function getDotVariant(statusNorm: string, isLatest: boolean): DotVariant {
  const s = statusNorm.toLowerCase();
  if (s === "delivered") return "delivered";
  if (s === "out_for_delivery") return "ofd";
  if (s === "in_transit" || s === "picked_up" || s === "pickup_available" || s === "attempted_delivery") return "transit";
  if (s === "exception") return "exception";
  if (s === "label_created") return "label";
  if (isLatest) return "active";
  return "default";
}

function relTime(dateStr: string): string {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60) return "ahora mismo";
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  const days = Math.floor(diff / 86400);
  if (days === 1) return "ayer";
  if (days < 7) return `hace ${days} días`;
  return new Date(dateStr).toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

function formatDateFull(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("es-ES", {
    weekday: "short", day: "numeric", month: "short",
  });
}

export function TrackingTimeline({
  events,
  emptyTitle = "Sin eventos todavía",
  emptyDescription = "Aún no hay actualizaciones de tracking disponibles.",
}: TrackingTimelineProps) {
  if (events.length === 0) {
    return (
      <div className="trk2-tl-empty">
        <div className="trk2-tl-empty-icon">📡</div>
        <div className="trk2-tl-empty-title">{emptyTitle}</div>
        <div className="trk2-tl-empty-desc">{emptyDescription}</div>
      </div>
    );
  }

  return (
    <div className="trk2-tl">
      {events.map((event, index) => {
        const isLatest = index === 0;
        const dotVariant = getDotVariant(event.status_norm, isLatest);
        const description = getEventDescription(event);

        return (
          <div className={`trk2-tl-item${isLatest ? " trk2-tl-item-latest" : ""}`} key={event.id}>
            {/* Timeline spine */}
            <div className="trk2-tl-spine">
              <div className={`trk2-tl-dot trk2-tl-dot-${dotVariant}`}>
                {dotVariant === "delivered" && (
                  <svg fill="none" height="10" viewBox="0 0 24 24" width="10">
                    <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
                  </svg>
                )}
              </div>
              {index < events.length - 1 && <div className="trk2-tl-line" />}
            </div>

            {/* Content */}
            <div className="trk2-tl-content">
              <div className="trk2-tl-top">
                <span className="trk2-tl-label">{getNormLabel(event.status_norm)}</span>
                {isLatest && <span className="trk2-tl-now-badge">Ahora</span>}
              </div>

              {description && (
                <p className="trk2-tl-desc">{description}</p>
              )}

              <div className="trk2-tl-meta">
                {event.location && (
                  <span className="trk2-tl-location">
                    <svg fill="none" height="10" viewBox="0 0 24 24" width="10">
                      <path d="M12 2a7 7 0 0 1 7 7c0 5.25-7 13-7 13S5 14.25 5 9a7 7 0 0 1 7-7z" stroke="currentColor" strokeWidth="2"/>
                      <circle cx="12" cy="9" r="2.5" stroke="currentColor" strokeWidth="2"/>
                    </svg>
                    {event.location}
                  </span>
                )}
                <span className="trk2-tl-time">
                  <span className="trk2-tl-reltime">{relTime(event.occurred_at)}</span>
                  <span className="trk2-tl-abstime">{formatDateFull(event.occurred_at)} · {formatTime(event.occurred_at)}</span>
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
