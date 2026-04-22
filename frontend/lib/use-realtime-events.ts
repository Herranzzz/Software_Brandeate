"use client";

import { useEffect, useRef, useState } from "react";

export type RealtimeActivityEvent = {
  type: "activity";
  action: string;
  entity_type: string;
  entity_id: number;
  summary: string;
  actor_id: number | null;
  actor_name: string | null;
  shop_id: number | null;
  detail: Record<string, unknown>;
  created_at: number;
  received_at: number;
};

export type RealtimePresenceEvent = {
  type: "presence";
  user_id: number;
  user_name: string | null;
  entity_type: string;
  entity_id: number;
  phase: "viewing" | "editing" | "leaving";
  at: number;
  received_at: number;
};

export type RealtimeJobProgressEvent = {
  type: "job_progress";
  job_id: string;
  job_kind: string;
  user_id: number | null;
  status: "queued" | "running" | "done" | "failed" | string;
  progress_done: number;
  progress_total: number;
  detail: Record<string, unknown>;
  at: number;
  received_at: number;
};

export type RealtimeEvent =
  | RealtimeActivityEvent
  | RealtimePresenceEvent
  | RealtimeJobProgressEvent;

type Listener = (event: RealtimeEvent) => void;

type ConnectionState = "idle" | "connecting" | "open" | "reconnecting" | "closed";

// Module-level singleton: exactly one EventSource per tab even if multiple
// components use the hook. Reconnects with exponential backoff (up to 15s)
// on error; the browser's EventSource auto-reconnect is too aggressive and
// doesn't respect transient 5xx.
class RealtimeClient {
  private source: EventSource | null = null;
  private listeners = new Set<Listener>();
  private stateListeners = new Set<(state: ConnectionState) => void>();
  private state: ConnectionState = "idle";
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;

  addListener(fn: Listener): () => void {
    this.listeners.add(fn);
    this.ensureOpen();
    return () => {
      this.listeners.delete(fn);
      if (this.listeners.size === 0) this.close();
    };
  }

  addStateListener(fn: (state: ConnectionState) => void): () => void {
    this.stateListeners.add(fn);
    fn(this.state);
    return () => {
      this.stateListeners.delete(fn);
    };
  }

  private setState(next: ConnectionState) {
    this.state = next;
    for (const fn of this.stateListeners) fn(next);
  }

  private ensureOpen() {
    if (this.source || this.state === "connecting") return;
    this.open();
  }

  private open() {
    this.setState("connecting");
    const src = new EventSource("/api/events/stream");
    this.source = src;

    src.onopen = () => {
      this.reconnectAttempts = 0;
      this.setState("open");
    };

    src.addEventListener("activity", (ev) => {
      this.dispatch(ev as MessageEvent, "activity");
    });
    src.addEventListener("presence", (ev) => {
      this.dispatch(ev as MessageEvent, "presence");
    });
    src.addEventListener("job_progress", (ev) => {
      this.dispatch(ev as MessageEvent, "job_progress");
    });

    src.onerror = () => {
      src.close();
      this.source = null;
      if (this.listeners.size === 0) {
        this.setState("closed");
        return;
      }
      this.setState("reconnecting");
      const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 15_000);
      this.reconnectAttempts++;
      this.reconnectTimer = window.setTimeout(() => this.open(), delay);
    };
  }

  private dispatch(
    ev: MessageEvent,
    type: "activity" | "presence" | "job_progress",
  ) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== "object") return;
    const event = { type, received_at: Date.now(), ...(parsed as object) } as RealtimeEvent;
    for (const fn of this.listeners) {
      try {
        fn(event);
      } catch (err) {
        console.error("realtime listener error", err);
      }
    }
  }

  private close() {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.source?.close();
    this.source = null;
    this.setState("closed");
  }
}

let _client: RealtimeClient | null = null;
function getClient() {
  if (typeof window === "undefined") return null;
  if (!_client) _client = new RealtimeClient();
  return _client;
}

export function useRealtimeEvents(
  onEvent: (event: RealtimeEvent) => void,
) {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    const client = getClient();
    if (!client) return;
    return client.addListener((event) => handlerRef.current(event));
  }, []);
}

export function useRealtimeState(): ConnectionState {
  const [state, setState] = useState<ConnectionState>("idle");
  useEffect(() => {
    const client = getClient();
    if (!client) return;
    return client.addStateListener(setState);
  }, []);
  return state;
}

/** Fire-and-forget presence ping. `phase` is "viewing" on mount,
 * "leaving" on unmount. Uses sendBeacon on unload so it survives tab close. */
export function emitPresence(params: {
  entity_type: string;
  entity_id: number;
  phase: "viewing" | "editing" | "leaving";
  shop_id?: number | null;
  useBeacon?: boolean;
}): void {
  if (typeof window === "undefined") return;
  const qs = new URLSearchParams({
    entity_type: params.entity_type,
    entity_id: String(params.entity_id),
    phase: params.phase,
  });
  if (params.shop_id != null) qs.set("shop_id", String(params.shop_id));
  const url = `/api/events/presence?${qs.toString()}`;

  if (params.useBeacon && navigator.sendBeacon) {
    try {
      navigator.sendBeacon(url);
      return;
    } catch {
      // fall through to fetch
    }
  }
  fetch(url, { method: "POST", credentials: "include", keepalive: true }).catch(
    () => {
      // best effort
    },
  );
}
