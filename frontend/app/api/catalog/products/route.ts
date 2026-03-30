import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { apiUrl } from "@/lib/api";


export async function GET(request: Request) {
  const token = (await cookies()).get("auth_token")?.value;
  const url = new URL(request.url);
  const shopId = url.searchParams.get("shop_id");
  const query = shopId ? `?${new URLSearchParams({ shop_id: shopId }).toString()}` : "";

  const response = await fetch(apiUrl(`/catalog/products${query}`), {
    cache: "no-store",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  const text = await response.text();
  return new NextResponse(text, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("Content-Type") ?? "application/json",
    },
  });
}
