import { NextRequest, NextResponse } from "next/server";

import { apiUrl } from "@/lib/api";
import type { LoginResponse } from "@/lib/types";


export async function POST(request: NextRequest) {
  const body = await request.json();

  const response = await fetch(apiUrl("/auth/login"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const payload = (await response.json()) as LoginResponse | { detail?: string };

  if (!response.ok) {
    return NextResponse.json(payload, { status: response.status });
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
