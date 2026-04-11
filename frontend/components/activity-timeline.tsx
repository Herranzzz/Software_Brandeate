"use client";

import { useEffect, useState } from "react";

import type { ActivityLog } from "@/lib/types";

/* ─── Helpers ────────────────────────────────────────────────────────────── */

const ACTION_COLORS: Record<string, string> = {
  created: "var(--success)",
  status_changed: "#2563eb",
  updated: "#2563eb",
  assigned: "#8b5cf6",
  note_added: "var(--muted)",
  label_created: "#0891b2",
  escalated: "var(--warning)",
  cancelled: "var(--danger)",
  sent: "#2563eb",
  paid: "var(--success)",
};

function getActionColor(action: string) {
  return ACTION_COLORS[action] ?? "var(--muted)";
}

function getInitials(name: string | null): string {
  if (!name) return "S";
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? `${parts[0][0]}${parts[1][0]}`.toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

function relativeTime(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return "ahora";
  if (diffMin < 60) return `hace ${diffMin}min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `hace ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `hace ${diffD}d`;

  return date.toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
}

/* ─── Component ──────────────────────────────────────────────────────────── */

type ActivityTimelineProps = {
  entityType: string;
  entityId: number;
  items?: ActivityLog[];
  maxVisible?: number;
};

export function ActivityTimeline({
  items,
  maxVisible = 10,
}: ActivityTimelineProps) {
  const [expanded, setExpanded] = useState(false);

  const visible = expanded ? items : items?.slice(0, maxVisible);
  const hasMore = (items?.length ?? 0) > maxVisible;

  if (!items || items.length === 0) {
    return (
      <div className="activity-timeline-empty">Sin actividad registrada</div>
    );
  }

  return (
    <div className="activity-timeline">
      {visible?.map((entry) => (
        <div key={entry.id} className="activity-entry">
          <div
            className="activity-dot"
            style={{ backgroundColor: getActionColor(entry.action) }}
          />
          <div className="activity-content">
            <div className="activity-avatar" title={entry.actor_name ?? "Sistema"}>
              {getInitials(entry.actor_name)}
            </div>
            <div className="activity-body">
              <span className="activity-summary">{entry.summary}</span>
              <span className="activity-time">{relativeTime(entry.created_at)}</span>
            </div>
          </div>
        </div>
      ))}
      {hasMore && !expanded && (
        <button
          className="activity-expand"
          onClick={() => setExpanded(true)}
          type="button"
        >
          Ver todo ({items.length})
        </button>
      )}
    </div>
  );
}

/* ─── Wrapper that fetches data client-side ──────────────────────────────── */

export function ActivityTimelineLoader({
  entityType,
  entityId,
  maxVisible = 10,
}: {
  entityType: string;
  entityId: number;
  maxVisible?: number;
}) {
  const [items, setItems] = useState<ActivityLog[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { fetchActivityLog } = await import("@/lib/api");
        const data = await fetchActivityLog(entityType, entityId);
        if (!cancelled) setItems(data);
      } catch {
        if (!cancelled) setItems([]);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [entityType, entityId]);

  if (items === null) {
    return <div className="activity-timeline-empty">Cargando actividad…</div>;
  }

  return (
    <ActivityTimeline
      entityType={entityType}
      entityId={entityId}
      items={items}
      maxVisible={maxVisible}
    />
  );
}
