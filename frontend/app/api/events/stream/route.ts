import { NextRequest } from "next/server";
import { cookies } from "next/headers";

import { apiUrl } from "@/lib/api";

// Proxies the backend SSE stream. The auth_token cookie is HttpOnly so the
// browser cannot read it; we forward it to the backend as ?token=... because
// EventSource can't set Authorization headers.
export async function GET(request: NextRequest) {
  const token = (await cookies()).get("auth_token")?.value;
  if (!token) {
    return new Response("Unauthorized", { status: 401 });
  }

  const upstream = await fetch(
    apiUrl(`/events/stream?token=${encodeURIComponent(token)}`),
    {
      method: "GET",
      headers: { Accept: "text/event-stream" },
      // Propagate the client abort (tab close, navigation) upstream so the
      // backend generator exits and frees the subscription slot.
      signal: request.signal,
      cache: "no-store",
    },
  );

  // When the backend says the token is expired, signal the client via a
  // named SSE event instead of returning a 401 HTTP status (EventSource
  // doesn't expose the HTTP status code in its onerror callback, so the
  // client can't distinguish auth failures from network errors).
  if (upstream.status === 401) {
    const authErrorBody = 'event: auth_error\ndata: {"code":401}\n\n';
    return new Response(authErrorBody, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  }

  if (!upstream.ok || upstream.body === null) {
    return new Response("Upstream unavailable", { status: upstream.status || 502 });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
