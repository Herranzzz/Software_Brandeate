import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { apiUrl } from "@/lib/api";

async function proxyUsersRequest(method: "GET" | "POST", request?: NextRequest) {
  const token = (await cookies()).get("auth_token")?.value;
  const body = request ? await request.text() : undefined;
  const search = request?.nextUrl.search ?? "";

  const response = await fetch(apiUrl(`/users${search}`), {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body,
  });

  const text = await response.text();

  return new NextResponse(text, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("Content-Type") ?? "application/json",
    },
  });
}

export async function GET(request: NextRequest) {
  return proxyUsersRequest("GET", request);
}

export async function POST(request: NextRequest) {
  return proxyUsersRequest("POST", request);
}
