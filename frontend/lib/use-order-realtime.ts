"use client";

import { useEffect, useRef } from "react";

import { useRealtimeEvents, type RealtimeEvent } from "@/lib/use-realtime-events";

const DEBOUNCE_MS = 400;

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

/**
 * Subscribes to realtime activity events and fires `onOrderChange` whenever an
 * order mutation arrives. Bursts (e.g. bulk "preparar" of 50 orders) are
 * collapsed into a single callback with a short debounce so we re-fetch once
 * instead of fifty times.
 */
export function useOrderRealtimeRefresh(onOrderChange: () => void): void {
  const handlerRef = useRef(onOrderChange);
  handlerRef.current = onOrderChange;

  const timerRef = useRef<number | null>(null);

  useRealtimeEvents((event: RealtimeEvent) => {
    if (event.type !== "activity") return;
    if (event.entity_type !== "order") return;
    if (event.action && !ORDER_ACTIONS.has(event.action)) return;

    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      handlerRef.current();
    }, DEBOUNCE_MS);
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
