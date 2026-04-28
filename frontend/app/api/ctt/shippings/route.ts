import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { apiUrl } from "@/lib/api";


export async function POST(request: NextRequest) {
  const body = await request.json();
  const token = (await cookies()).get("auth_token")?.value;

  const response = await fetch(apiUrl("/ctt/shippings"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  // Forward the body verbatim. If upstream returned non-JSON (Render 502 HTML,
  // empty body on gateway timeout, etc.) we used to blow up here with
  // "Unexpected end of JSON input"; the caller now sees the real status and a
  // useful error string.
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "application/json";
  if (contentType.includes("application/json")) {
    return new NextResponse(text || "{}", {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  }
  const detail = text.trim().slice(0, 500) || `Upstream ${response.status}`;
  return NextResponse.json({ detail }, { status: response.status || 502 });
}
