import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { apiUrl } from "@/lib/api";


export async function POST() {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get("refresh_token")?.value;

  if (!refreshToken) {
    return NextResponse.json({ detail: "No refresh token" }, { status: 401 });
  }

  const response = await fetch(apiUrl("/auth/refresh"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
    cache: "no-store",
  });

  if (!response.ok) {
    // Refresh token inválido o expirado — limpiar cookies
    const errorResponse = NextResponse.json({ detail: "Session expired" }, { status: 401 });
    errorResponse.cookies.delete("auth_token");
    errorResponse.cookies.delete("refresh_token");
    return errorResponse;
  }

  const payload = (await response.json()) as { access_token: string; refresh_token: string };
  const nextResponse = NextResponse.json({ ok: true });
  nextResponse.cookies.set("auth_token", payload.access_token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  nextResponse.cookies.set("refresh_token", payload.refresh_token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  return nextResponse;
}
