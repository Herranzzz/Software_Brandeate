import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { apiUrl } from "@/lib/api";


export async function GET(request: NextRequest) {
  const token = (await cookies()).get("auth_token")?.value;
  const search = request.nextUrl.search;

  const response = await fetch(apiUrl(`/shipping-rules${search}`), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: "no-store",
  });

  const payload = await response.text();
  return new NextResponse(payload, {
    status: response.status,
    headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/json" },
  });
}


export async function POST(request: NextRequest) {
  const token = (await cookies()).get("auth_token")?.value;
  const body = await request.text();

  const response = await fetch(apiUrl("/shipping-rules"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body,
    cache: "no-store",
  });

  const payload = await response.text();
  return new NextResponse(payload, {
    status: response.status,
    headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/json" },
  });
}
