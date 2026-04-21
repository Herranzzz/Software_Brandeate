import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { apiUrl } from "@/lib/api";

// Accepts presence pings from the browser (including sendBeacon on unload)
// and forwards them to the backend with the HttpOnly token.
export async function POST(request: NextRequest) {
  const token = (await cookies()).get("auth_token")?.value;
  if (!token) {
    return new Response(null, { status: 401 });
  }

  const url = new URL(request.url);
  const params = new URLSearchParams(url.searchParams);
  params.set("token", token);

  const upstream = await fetch(
    apiUrl(`/events/presence?${params.toString()}`),
    { method: "POST", cache: "no-store" },
  );

  return new NextResponse(null, { status: upstream.status });
}
