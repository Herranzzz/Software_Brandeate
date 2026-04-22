"use client";

import { useEffect, useRef } from "react";

import { useRealtimeEvents, type RealtimeEvent } from "@/lib/use-realtime-events";

const DEFAULT_DEBOUNCE_MS = 400;

const ORDER_ACTIONS = new Set([
  "status_changed",
  "production_status_changed",
  "priority_changed",
  "updated",
  "created",
  "prepared",
  "shipped",
  "cancelled",
  "incident_created",
]);

type EntityRefreshOptions = {
  entityTypes: string[];
  actions?: string[]; // when omitted, every action triggers
  debounceMs?: number;
};

/**
 * Generic version of `useOrderRealtimeRefresh`. Subscribes to the SSE stream
 * and fires `onChange` whenever an activity event for any of the configured
 * entity types arrives. Bursts are collapsed via debounce so a bulk action on
 * 50 rows results in a single re-fetch.
 */
export function useEntityRealtimeRefresh(
  options: EntityRefreshOptions,
  onChange: () => void,
): void {
  const handlerRef = useRef(onChange);
  handlerRef.current = onChange;

  const timerRef = useRef<number | null>(null);
  const entityTypes = useRef(new Set(options.entityTypes));
  entityTypes.current = new Set(options.entityTypes);
  const actions = useRef(options.actions ? new Set(options.actions) : null);
  actions.current = options.actions ? new Set(options.actions) : null;
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  useRealtimeEvents((event: RealtimeEvent) => {
    if (event.type !== "activity") return;
    if (!entityTypes.current.has(event.entity_type)) return;
    if (actions.current && event.action && !actions.current.has(event.action)) {
      return;
    }

    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      handlerRef.current();
    }, debounceMs);
  });

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);
}

/**
 * Subscribes to realtime activity events and fires `onOrderChange` whenever an
 * order mutation arrives. Bursts (e.g. bulk "preparar" of 50 orders) are
 * collapsed into a single callback with a short debounce so we re-fetch once
 * instead of fifty times.
 */
export function useOrderRealtimeRefresh(onOrderChange: () => void): void {
  useEntityRealtimeRefresh(
    { entityTypes: ["order"], actions: Array.from(ORDER_ACTIONS) },
    onOrderChange,
  );
}
