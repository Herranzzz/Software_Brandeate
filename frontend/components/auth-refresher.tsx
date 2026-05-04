"use client";

/**
 * AuthRefresher — mounts once in the app shell and keeps the session alive.
 *
 * Strategy:
 *  • Proactive: calls /api/auth/refresh every REFRESH_INTERVAL_MS so the
 *    access token (8 h TTL) never expires while the operator is working.
 *  • Reactive: listens for a global "auth:401" CustomEvent that any fetch
 *    helper can dispatch on a 401 response. On that event it attempts one
 *    refresh; if it succeeds it dispatches "auth:refreshed" so SSE/notifications
 *    reconnect; if it fails it redirects to /login with a friendly message.
 *  • Visibility: re-checks on tab focus so tokens renew even after a long
 *    idle period (browser tabs sleeping, screen locked, etc.).
 */

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";

// Refresh every 90 min — safely within the 8 h access-token TTL.
const REFRESH_INTERVAL_MS = 90 * 60 * 1000;

// Minimum gap between two refresh attempts (avoid hammering on rapid 401s).
let lastRefreshAttempt = 0;
const MIN_REFRESH_GAP_MS = 30_000;

export function AuthRefresher() {
  const router = useRouter();

  const tryRefresh = useCallback(
    async (opts: { hardReload?: boolean } = {}): Promise<boolean> => {
      const now = Date.now();
      if (now - lastRefreshAttempt < MIN_REFRESH_GAP_MS) return false;
      lastRefreshAttempt = now;

      try {
        const res = await fetch("/api/auth/refresh", {
          method: "POST",
          cache: "no-store",
        });

        if (res.ok) {
          // Signal all subsystems (SSE, notifications, etc.) that a fresh
          // token is available so they can reconnect / refetch.
          window.dispatchEvent(new CustomEvent("auth:refreshed"));
          // Don't call router.refresh() on every auth cycle — it shows a
          // loading state and is unnecessary if the page is already working.
          // Only hard-reload on visibility-based proactive refresh where SSR
          // data might be genuinely stale (handled at call site via opts).
          if (opts.hardReload) {
            window.location.reload();
          }
          return true;
        }

        // Refresh token itself expired → hard redirect to login
        router.replace("/login?reason=session_expired");
        return false;
      } catch {
        // Network error — don't kick the user out, just try again next interval.
        return false;
      }
    },
    [router],
  );

  // ── Proactive interval ───────────────────────────────────────────────────
  useEffect(() => {
    const id = window.setInterval(() => {
      void tryRefresh();
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [tryRefresh]);

  // ── Visibility-based re-check ────────────────────────────────────────────
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") {
        // Only refresh proactively if the tab was hidden for a while.
        // We use lastRefreshAttempt as a rough proxy.
        if (Date.now() - lastRefreshAttempt > REFRESH_INTERVAL_MS) {
          void tryRefresh();
        }
      }
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [tryRefresh]);

  // ── Reactive 401 listener ────────────────────────────────────────────────
  // Any fetch helper can dispatch new CustomEvent("auth:401") when it gets a
  // 401 response and wants the session layer to handle it.
  useEffect(() => {
    function on401() {
      void tryRefresh();
    }
    window.addEventListener("auth:401", on401);
    return () => window.removeEventListener("auth:401", on401);
  }, [tryRefresh]);

  return null;
}
