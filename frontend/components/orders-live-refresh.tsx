"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { useRealtimeEvents, type RealtimeEvent } from "@/lib/use-realtime-events";

/**
 * Mounted on the orders list. When a peer creates a label, updates shipping,
 * posts a comment, or otherwise changes an order, trigger a soft router refresh
 * so the table reflects the change without a full reload. Throttled so bursts
 * of events don't spam refresh().
 */
export function OrdersLiveRefresh() {
  const router = useRouter();
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (pendingRef.current) clearTimeout(pendingRef.current);
    };
  }, []);

  useRealtimeEvents((event: RealtimeEvent) => {
    if (event.type !== "activity") return;
    if (event.entity_type !== "order") return;
    if (pendingRef.current) return;
    pendingRef.current = setTimeout(() => {
      pendingRef.current = null;
      router.refresh();
    }, 1500);
  });

  return null;
}
