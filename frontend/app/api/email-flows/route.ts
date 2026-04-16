import { type NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { apiUrl } from "@/lib/api";

export async function GET(request: NextRequest) {
  const token = (await cookies()).get("auth_token")?.value;
  const { searchParams } = new URL(request.url);
  const shopId = searchParams.get("shop_id");

  const response = await fetch(apiUrl(`/email-flows?shop_id=${shopId}`), {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    cache: "no-store",
  });

  const text = await response.text();
  return new NextResponse(text, {
    status: response.status,
    headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/json" },
  });
}
