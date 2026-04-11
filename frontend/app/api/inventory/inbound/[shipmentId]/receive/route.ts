import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { apiUrl } from "@/lib/api";


type RouteContext = { params: Promise<{ shipmentId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const { shipmentId } = await context.params;
  const body = await request.json();
  const token = (await cookies()).get("auth_token")?.value;

  const response = await fetch(apiUrl(`/inventory/inbound/${shipmentId}/receive`), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const payload = await response.json();
  return NextResponse.json(payload, { status: response.status });
}
