import { NextRequest, NextResponse } from "next/server";

import { apiUrl } from "@/lib/api";
import type { LoginResponse } from "@/lib/types";


export async function POST(request: NextRequest) {
  const body = await request.json();

  const response = await fetch(apiUrl("/auth/register-tenant"), {
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

  const registerPayload = payload as LoginResponse;
  const nextResponse = NextResponse.json(registerPayload, { status: response.status });
  nextResponse.cookies.set("auth_token", registerPayload.access_token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  return nextResponse;
}
