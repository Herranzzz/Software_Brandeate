import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { apiUrl } from "@/lib/api";


export async function GET(request: NextRequest) {
  const token = (await cookies()).get("auth_token")?.value;
  const qs = request.nextUrl.searchParams.toString();

  const response = await fetch(apiUrl(`/shipments/labels-archive${qs ? `?${qs}` : ""}`), {
    method: "GET",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    cache: "no-store",
  });

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
