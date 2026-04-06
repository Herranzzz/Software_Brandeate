import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { apiUrl } from "@/lib/api";


type RouteContext = {
  params: Promise<{ shopId: string }>;
};


export async function PATCH(request: NextRequest, context: RouteContext) {
  const { shopId } = await context.params;
  const token = (await cookies()).get("auth_token")?.value;
  const body = await request.json();

  const response = await fetch(apiUrl(`/shops/${shopId}`), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const text = await response.text();
  return new NextResponse(text, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("Content-Type") ?? "application/json",
    },
  });
}

export async function GET(_: NextRequest, context: RouteContext) {
  const { shopId } = await context.params;
  const token = (await cookies()).get("auth_token")?.value;

  const response = await fetch(apiUrl(`/shops/${shopId}`), {
    method: "GET",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    cache: "no-store",
  });

  const text = await response.text();
  return new NextResponse(text, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("Content-Type") ?? "application/json",
    },
  });
}
