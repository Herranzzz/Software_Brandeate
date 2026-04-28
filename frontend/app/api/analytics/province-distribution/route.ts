import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { apiUrl } from "@/lib/api";

export async function GET(request: NextRequest) {
  const token = (await cookies()).get("auth_token")?.value;
  const search = request.nextUrl.search;

  const response = await fetch(apiUrl(`/analytics/province-distribution${search}`), {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    cache: "no-store",
  });

  const payload = await response.json();
  return NextResponse.json(payload, { status: response.status });
}
