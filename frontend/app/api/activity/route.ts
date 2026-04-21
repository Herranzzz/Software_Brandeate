import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { apiUrl } from "@/lib/api";

export async function GET(request: NextRequest) {
  const token = (await cookies()).get("auth_token")?.value;
  if (!token) return new NextResponse("Unauthorized", { status: 401 });

  const search = new URL(request.url).search;
  const response = await fetch(apiUrl(`/activity${search}`), {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const payload = await response.json();
  return NextResponse.json(payload, { status: response.status });
}
