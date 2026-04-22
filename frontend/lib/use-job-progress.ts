"use client";

import { useRef } from "react";

import {
  useRealtimeEvents,
  type RealtimeEvent,
  type RealtimeJobProgressEvent,
} from "@/lib/use-realtime-events";

/**
 * Subscribe to `job_progress` SSE events for a single background job.
 * Returns nothing — the caller updates its own state from `onProgress`.
 *
 * Pass `null` as `jobId` to disarm the subscription (e.g. before the job has
 * been created or after it finishes). The hook itself is always mounted so
 * the subscription set in the SSE client stays stable.
 */
export function useJobProgress(
  jobId: string | null,
  onProgress: (event: RealtimeJobProgressEvent) => void,
): void {
  const handlerRef = useRef(onProgress);
  handlerRef.current = onProgress;
  const jobIdRef = useRef(jobId);
  jobIdRef.current = jobId;

  useRealtimeEvents((event: RealtimeEvent) => {
    if (event.type !== "job_progress") return;
    if (!jobIdRef.current) return;
    if (event.job_id !== jobIdRef.current) return;
    handlerRef.current(event);
  });
}
