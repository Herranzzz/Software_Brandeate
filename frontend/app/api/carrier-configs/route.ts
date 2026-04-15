import { type NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { apiUrl } from "@/lib/api";


async function getAuthHeader(): Promise<Record<string, string>> {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const shopId = searchParams.get("shop_id");
  const url = shopId
    ? apiUrl(`/carrier-configs?shop_id=${shopId}`)
    : apiUrl("/carrier-configs");

  const res = await fetch(url, {
    headers: await getAuthHeader(),
    cache: "no-store",
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const res = await fetch(apiUrl("/carrier-configs"), {
    method: "PUT",
    headers: { ...(await getAuthHeader()), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
