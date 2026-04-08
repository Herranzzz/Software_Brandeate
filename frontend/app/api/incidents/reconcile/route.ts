import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { apiUrl } from "@/lib/api";


export async function POST(request: NextRequest) {
  const token = (await cookies()).get("auth_token")?.value;
  const search = request.nextUrl.search;
  const response = await fetch(apiUrl(`/incidents/reconcile${search}`), {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
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
