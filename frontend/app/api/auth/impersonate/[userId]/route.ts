import { NextRequest, NextResponse } from "next/server";

import { apiUrl } from "@/lib/api";
import type { LoginResponse } from "@/lib/types";

type RouteContext = {
  params: Promise<{
    userId: string;
  }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { userId } = await context.params;
  const authToken = request.cookies.get("auth_token")?.value;
  const response = await fetch(apiUrl(`/auth/impersonate/${userId}`), {
    method: "POST",
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => null)) as LoginResponse | { detail?: string } | null;
  if (!response.ok || !payload) {
    return NextResponse.json(payload ?? { detail: "No se pudo impersonar la cuenta cliente." }, { status: response.status || 500 });
  }

  const loginPayload = payload as LoginResponse;
  const isSecure = request.nextUrl.protocol === "https:";
  const nextResponse = NextResponse.json(loginPayload, { status: response.status });
  nextResponse.cookies.set("auth_token", loginPayload.access_token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecure,
    path: "/",
  });
  nextResponse.cookies.set("refresh_token", loginPayload.refresh_token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecure,
    path: "/",
  });
  return nextResponse;
}
