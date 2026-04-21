"use client";

import { useEffect, useState } from "react";

import {
  emitPresence,
  useRealtimeEvents,
  type RealtimeEvent,
} from "@/lib/use-realtime-events";

// How long a "viewing" ping remains valid before we consider the user gone.
// The heartbeat re-sends every HEARTBEAT_MS; PRESENCE_TTL_MS > HEARTBEAT_MS so
// a single dropped heartbeat doesn't flicker avatars off.
const HEARTBEAT_MS = 25_000;
const PRESENCE_TTL_MS = 60_000;

export type Viewer = {
  user_id: number;
  user_name: string | null;
  last_seen: number;
};

/**
 * Mark the current user as "viewing" this entity and observe who else is
 * viewing the same entity. Returns the list of other viewers (current user
 * excluded).
 */
export function useEntityPresence(
  entityType: string,
  entityId: number | null | undefined,
  currentUserId: number,
  shopId?: number | null,
): Viewer[] {
  const [viewers, setViewers] = useState<Viewer[]>([]);

  // Heartbeat: tell the backend we're here, and keep saying so every ~25s.
  useEffect(() => {
    if (!entityId) return;
    emitPresence({ entity_type: entityType, entity_id: entityId, phase: "viewing", shop_id: shopId });
    const id = window.setInterval(() => {
      emitPresence({ entity_type: entityType, entity_id: entityId, phase: "viewing", shop_id: shopId });
    }, HEARTBEAT_MS);

    const beaconLeave = () => {
      emitPresence({
        entity_type: entityType,
        entity_id: entityId,
        phase: "leaving",
        shop_id: shopId,
        useBeacon: true,
      });
    };
    window.addEventListener("pagehide", beaconLeave);
    window.addEventListener("beforeunload", beaconLeave);

    return () => {
      window.clearInterval(id);
      window.removeEventListener("pagehide", beaconLeave);
      window.removeEventListener("beforeunload", beaconLeave);
      emitPresence({ entity_type: entityType, entity_id: entityId, phase: "leaving", shop_id: shopId });
    };
  }, [entityType, entityId, shopId]);

  // Garbage-collect stale viewers on a timer — if a peer crashes, their
  // heartbeat stops and we'll drop them within PRESENCE_TTL_MS.
  useEffect(() => {
    const id = window.setInterval(() => {
      const cutoff = Date.now() - PRESENCE_TTL_MS;
      setViewers((prev) => prev.filter((v) => v.last_seen >= cutoff));
    }, 10_000);
    return () => window.clearInterval(id);
  }, []);

  useRealtimeEvents((event: RealtimeEvent) => {
    if (event.type !== "presence") return;
    if (event.entity_type !== entityType) return;
    if (event.entity_id !== entityId) return;
    if (event.user_id === currentUserId) return;

    setViewers((prev) => {
      if (event.phase === "leaving") {
        return prev.filter((v) => v.user_id !== event.user_id);
      }
      const existing = prev.find((v) => v.user_id === event.user_id);
      if (existing) {
        return prev.map((v) =>
          v.user_id === event.user_id ? { ...v, last_seen: event.received_at } : v,
        );
      }
      return [
        ...prev,
        { user_id: event.user_id, user_name: event.user_name, last_seen: event.received_at },
      ];
    });
  });

  return viewers;
}
