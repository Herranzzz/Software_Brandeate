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


export function TrackingTimeline({
  events,
  emptyTitle = "Sin eventos todavia",
  emptyDescription = "Aun no hay actualizaciones de tracking disponibles.",
}: TrackingTimelineProps) {
  if (events.length === 0) {
    return (
      <div className="empty-state">
        <h3 className="empty-title">{emptyTitle}</h3>
        <p className="empty-description">{emptyDescription}</p>
      </div>
    );
  }

  return (
    <div className="timeline">
      {events.map((event, index) => (
        <article
          className={`timeline-item ${index === 0 ? "timeline-item-latest" : ""}`}
          key={event.id}
        >
          <div className="timeline-dot" />
          <div className="timeline-content">
            <div className="timeline-header">
              <div className="timeline-status-block">
                <strong className="timeline-status">{event.status_norm}</strong>
                {index === 0 ? <span className="timeline-pill">Mas reciente</span> : null}
              </div>
              <span className="muted">{formatDateTime(event.occurred_at)}</span>
            </div>
            <div className="muted timeline-copy">
              {event.status_raw ?? "Actualizacion sin texto adicional"}
              {event.location ? ` · ${event.location}` : ""}
              {event.source ? ` · ${event.source.toUpperCase()}` : ""}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
