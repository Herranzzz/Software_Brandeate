import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { apiUrl } from "@/lib/api";

type RouteContext = { params: Promise<{ supplierId: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const { supplierId } = await context.params;
  const token = (await cookies()).get("auth_token")?.value;

  const response = await fetch(apiUrl(`/suppliers/${supplierId}/products`), {
    method: "GET",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: "no-store",
  });

  const payload = await response.json();
  return NextResponse.json(payload, { status: response.status });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { supplierId } = await context.params;
  const body = await request.json();
  const token = (await cookies()).get("auth_token")?.value;

  const response = await fetch(apiUrl(`/suppliers/${supplierId}/products`), {
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
