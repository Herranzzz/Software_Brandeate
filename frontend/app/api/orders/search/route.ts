import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { apiUrl } from "@/lib/api";


/**
 * Lightweight order search for the command palette.
 * Proxies ?q= to the backend and returns a slim list.
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const token = (await cookies()).get("auth_token")?.value;

  if (!q.trim()) {
    return NextResponse.json([]);
  }

  const backendUrl = apiUrl(`/orders?q=${encodeURIComponent(q)}&per_page=6`);
  const response = await fetch(backendUrl, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: "no-store",
  });

  if (!response.ok) {
    return NextResponse.json([], { status: 200 }); // silent fail in the palette
  }

  type SlimOrder = {
    id: number;
    external_id: string;
    customer_name: string;
    status: string;
    production_status: string | null;
    shop_id: number;
  };

  const orders = (await response.json()) as SlimOrder[];
  // Return only the fields the palette needs (trim payload)
  const slim = Array.isArray(orders)
    ? orders.slice(0, 6).map((o) => ({
        id: o.id,
        external_id: o.external_id,
        customer_name: o.customer_name,
        status: o.status,
        production_status: o.production_status,
      }))
    : [];

  return NextResponse.json(slim);
}
