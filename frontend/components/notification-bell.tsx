"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Notification = {
  id: number;
  action: string;
  summary: string;
  entity_type: string;
  entity_id: number;
  created_at: string | null;
  actor_name: string | null;
};

const ACTION_ICONS: Record<string, string> = {
  status_changed: "\u{1F504}",
  created: "\u2728",
  blocked: "\u{1F6AB}",
  unblocked: "\u2705",
  note_added: "\u{1F4DD}",
  label_created: "\u{1F3F7}\uFE0F",
  assigned: "\u{1F464}",
  default: "\u{1F4CC}",
};

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  return `hace ${days}d`;
}

export function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lastSeenId, setLastSeenId] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/activity/notifications?limit=15");
      if (res.status === 401) {
        // Token expired — ask AuthRefresher to handle it; don't thrash.
        window.dispatchEvent(new CustomEvent("auth:401"));
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setNotifications(data);
      }
    } catch {
      // silent — network error, retry next tick
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + poll every 60s.
  // On auth:refreshed, fetch immediately so the bell catches up.
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000);

    function onRefreshed() {
      void fetchData();
    }
    window.addEventListener("auth:refreshed", onRefreshed);

    return () => {
      clearInterval(interval);
      window.removeEventListener("auth:refreshed", onRefreshed);
    };
  }, [fetchData]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleOpen() {
    setOpen((prev) => !prev);
    if (!open && notifications.length > 0) {
      setLastSeenId(notifications[0].id);
    }
  }

  const unreadCount = notifications.filter((n) => n.id > lastSeenId).length;

  return (
    <div className="notif-bell-wrap" ref={ref}>
      <button
        className="notif-bell-btn"
        type="button"
        onClick={handleOpen}
        aria-label={`Notificaciones${unreadCount > 0 ? ` (${unreadCount} nuevas)` : ""}`}
      >
        <svg fill="none" height="20" viewBox="0 0 24 24" width="20">
          <path d="M18 8A6 6 0 1 0 6 8c0 7-3 9-3 9h18s-3-2-3-9Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"/>
        </svg>
        {unreadCount > 0 && <span className="notif-bell-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
      </button>

      {open && (
        <div className="notif-panel">
          <div className="notif-panel-header">
            <strong>Notificaciones</strong>
            {loading && <span className="notif-loading">&hellip;</span>}
          </div>
          <div className="notif-panel-list">
            {notifications.length === 0 ? (
              <div className="notif-empty">Sin actividad reciente</div>
            ) : (
              notifications.map((n) => (
                <div key={n.id} className={`notif-item${n.id > lastSeenId ? " notif-unread" : ""}`}>
                  <span className="notif-item-icon">
                    {ACTION_ICONS[n.action] ?? ACTION_ICONS.default}
                  </span>
                  <div className="notif-item-body">
                    <div className="notif-item-summary">{n.summary}</div>
                    <div className="notif-item-meta">
                      {n.actor_name && <span>{n.actor_name}</span>}
                      <span>{timeAgo(n.created_at)}</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
