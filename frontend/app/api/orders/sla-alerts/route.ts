import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { apiUrl } from "@/lib/api";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const shopId = searchParams.get("shop_id");
  const token = (await cookies()).get("auth_token")?.value;

  const params = new URLSearchParams();
  if (shopId) params.set("shop_id", shopId);

  const backendUrl = apiUrl(`/orders/sla-alerts${params.toString() ? `?${params}` : ""}`);
  const response = await fetch(backendUrl, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    cache: "no-store",
  });

  const payload = await response.json();
  return NextResponse.json(payload, { status: response.status });
}
