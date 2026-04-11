import { formatDateTime } from "@/lib/format";

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

function getEventStyle(statusNorm: string, isLatest: boolean): { dot: string; icon: string } {
  const s = statusNorm.toLowerCase();
  if (s === "delivered") return { dot: "trk-tl-dot-delivered", icon: "✓" };
  if (s === "out_for_delivery") return { dot: "trk-tl-dot-ofd", icon: "→" };
  if (s === "in_transit" || s === "pickup_available" || s === "attempted_delivery") return { dot: "trk-tl-dot-transit", icon: "→" };
  if (s === "exception") return { dot: "trk-tl-dot-exception", icon: "!" };
  if (s === "label_created") return { dot: "trk-tl-dot-label", icon: "◎" };
  return { dot: isLatest ? "trk-tl-dot-active" : "trk-tl-dot-default", icon: "·" };
}

function getNormLabel(statusNorm: string): string {
  const labels: Record<string, string> = {
    delivered: "Entregado",
    out_for_delivery: "En reparto",
    in_transit: "En tránsito",
    pickup_available: "Disponible para recogida",
    attempted_delivery: "Intento de entrega fallido",
    exception: "Incidencia",
    label_created: "Etiqueta creada",
  };
  return labels[statusNorm.toLowerCase()] ?? statusNorm;
}

function relTime(dateStr: string): string {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60) return "ahora mismo";
  if (diff < 3600) return `hace ${Math.floor(diff / 60)}min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)}h`;
  const days = Math.floor(diff / 86400);
  if (days < 7) return `hace ${days}d`;
  return new Date(dateStr).toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
}

export function TrackingTimeline({
  events,
  emptyTitle = "Sin eventos todavía",
  emptyDescription = "Aún no hay actualizaciones de tracking disponibles.",
}: TrackingTimelineProps) {
  if (events.length === 0) {
    return (
      <div className="trk-tl-empty">
        <div className="trk-tl-empty-icon">📡</div>
        <div className="trk-tl-empty-title">{emptyTitle}</div>
        <div className="trk-tl-empty-desc">{emptyDescription}</div>
      </div>
    );
  }

  return (
    <div className="trk-tl">
      {events.map((event, index) => {
        const isLatest = index === 0;
        const { dot, icon } = getEventStyle(event.status_norm, isLatest);
        return (
          <div className={`trk-tl-item${isLatest ? " trk-tl-item-latest" : ""}`} key={event.id}>
            <div className="trk-tl-aside">
              <div className={`trk-tl-dot ${dot}`}>{icon}</div>
              {index < events.length - 1 && <div className="trk-tl-connector" />}
            </div>
            <div className="trk-tl-body">
              <div className="trk-tl-row1">
                <span className="trk-tl-norm">{getNormLabel(event.status_norm)}</span>
                {isLatest && <span className="trk-tl-badge-latest">Último estado</span>}
              </div>
              {event.status_raw && event.status_raw !== event.status_norm && (
                <div className="trk-tl-raw">{event.status_raw}</div>
              )}
              <div className="trk-tl-meta">
                {event.location && (
                  <span className="trk-tl-location">📍 {event.location}</span>
                )}
                <span className="trk-tl-time" title={formatDateTime(event.occurred_at)}>
                  {relTime(event.occurred_at)} · {formatDateTime(event.occurred_at)}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
