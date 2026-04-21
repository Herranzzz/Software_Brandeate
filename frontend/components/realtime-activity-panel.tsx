"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useToast } from "@/components/toast";
import {
  useRealtimeEvents,
  useRealtimeState,
  type RealtimeActivityEvent,
  type RealtimeEvent,
} from "@/lib/use-realtime-events";

const MAX_FEED_ITEMS = 50;
// Peer actions in the last N seconds surface as toasts so the user notices
// teammates working in parallel. Older ones are only in the feed.
const TOAST_WINDOW_SECONDS = 10;

type FeedItem = RealtimeActivityEvent & { local_id: number };

type Props = {
  currentUserId: number;
};

function formatRelative(seconds: number): string {
  if (seconds < 60) return "ahora";
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.floor(hours / 24)} d`;
}

function entityHref(event: RealtimeActivityEvent): string | null {
  if (event.entity_type === "order") return `/portal/orders/${event.entity_id}`;
  if (event.entity_type === "incident") return `/portal/incidencias/${event.entity_id}`;
  if (event.entity_type === "return") return `/portal/returns/${event.entity_id}`;
  return null;
}

export function RealtimeActivityPanel({ currentUserId }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const connection = useRealtimeState();
  const nextIdRef = useRef(0);
  // Remember if we've already shown a toast for this event so rapid-fire
  // bursts don't spam the UI.
  const toastedRef = useRef<Set<number>>(new Set());

  useRealtimeEvents((event: RealtimeEvent) => {
    if (event.type !== "activity") return;
    const ev = event;
    if (ev.actor_id === currentUserId) {
      // Don't notify the user of their own actions; still recorded in the
      // regular activity log and visible elsewhere.
      return;
    }
    const localId = nextIdRef.current++;
    setFeed((prev) => [{ ...ev, local_id: localId }, ...prev].slice(0, MAX_FEED_ITEMS));
    setUnreadCount((c) => (open ? 0 : c + 1));

    const ageSeconds = (Date.now() - ev.received_at) / 1000;
    if (ageSeconds <= TOAST_WINDOW_SECONDS && !toastedRef.current.has(localId)) {
      toastedRef.current.add(localId);
      const who = ev.actor_name || "Alguien";
      toast(`${who}: ${ev.summary}`, "info");
    }

    // Soft refresh order-related screens so the list reflects the peer's
    // change without a full page reload.
    if (ev.entity_type === "order") {
      try { router.refresh(); } catch { /* ignore */ }
    }
  });

  useEffect(() => {
    if (open) setUnreadCount(0);
  }, [open]);

  const connectionLabel = useMemo(() => {
    switch (connection) {
      case "open": return "En vivo";
      case "connecting": return "Conectando…";
      case "reconnecting": return "Reconectando…";
      case "closed": return "Desconectado";
      default: return "Inactivo";
    }
  }, [connection]);

  return (
    <div className={`realtime-panel${open ? " realtime-panel-open" : ""}`}>
      <button
        type="button"
        className={`realtime-bell${unreadCount > 0 ? " has-unread" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-label={`Actividad del equipo (${unreadCount} nuevas)`}
        title={connectionLabel}
      >
        <span className="realtime-bell-icon" aria-hidden="true">🔔</span>
        {unreadCount > 0 ? (
          <span className="realtime-bell-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>
        ) : null}
        <span className={`realtime-bell-dot realtime-bell-dot-${connection}`} aria-hidden="true" />
      </button>

      {open ? (
        <div className="realtime-dropdown" role="dialog" aria-label="Actividad del equipo">
          <div className="realtime-dropdown-header">
            <strong>Actividad del equipo</strong>
            <span className={`realtime-status realtime-status-${connection}`}>
              {connectionLabel}
            </span>
          </div>
          {feed.length === 0 ? (
            <div className="realtime-empty">
              Aún no hay actividad reciente de tu equipo.
            </div>
          ) : (
            <ul className="realtime-feed">
              {feed.map((item) => {
                const href = entityHref(item);
                const ageSeconds = Math.floor((Date.now() - item.received_at) / 1000);
                const content = (
                  <>
                    <div className="realtime-feed-summary">
                      <strong>{item.actor_name ?? "Alguien"}</strong>{" "}
                      <span>{item.summary}</span>
                    </div>
                    <div className="realtime-feed-meta">
                      {item.entity_type} #{item.entity_id} · {formatRelative(ageSeconds)}
                    </div>
                  </>
                );
                return (
                  <li key={item.local_id} className="realtime-feed-item">
                    {href ? (
                      <a href={href} onClick={() => setOpen(false)}>{content}</a>
                    ) : (
                      content
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
