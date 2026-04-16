import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { apiUrl } from "@/lib/api";

type RouteContext = { params: Promise<{ poId: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { poId } = await context.params;
  const body = await request.json();
  const token = (await cookies()).get("auth_token")?.value;

  const response = await fetch(apiUrl(`/purchase-orders/${poId}`), {
    method: "PATCH",
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

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { poId } = await context.params;
  const token = (await cookies()).get("auth_token")?.value;

  const response = await fetch(apiUrl(`/purchase-orders/${poId}`), {
    method: "DELETE",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: "no-store",
  });

  if (response.status === 204) return new NextResponse(null, { status: 204 });
  const payload = await response.json();
  return NextResponse.json(payload, { status: response.status });
}
