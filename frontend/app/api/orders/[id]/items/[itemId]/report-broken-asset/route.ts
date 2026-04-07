import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { apiUrl } from "@/lib/api";


type RouteContext = {
  params: Promise<{ id: string; itemId: string }>;
};


export async function POST(_request: NextRequest, context: RouteContext) {
  const { id, itemId } = await context.params;
  const token = (await cookies()).get("auth_token")?.value;

  const response = await fetch(apiUrl(`/orders/${id}/items/${itemId}/report-broken-asset`), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    cache: "no-store",
  });

  const payload = await response.json();
  return NextResponse.json(payload, { status: response.status });
}
