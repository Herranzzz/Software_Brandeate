import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { apiUrl } from "@/lib/api";


export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const shopId = searchParams.get("shop_id");
  const token = (await cookies()).get("auth_token")?.value;

  const backendUrl = apiUrl(
    `/inventory/sync-from-catalog${shopId ? `?shop_id=${shopId}` : ""}`,
  );
  const response = await fetch(backendUrl, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    cache: "no-store",
  });

  const payload = await response.json();
  return NextResponse.json(payload, { status: response.status });
}
