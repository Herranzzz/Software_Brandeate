import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { apiUrl } from "@/lib/api";


export async function POST(request: NextRequest) {
  const token = (await cookies()).get("auth_token")?.value;
  const body = await request.text();

  const response = await fetch(apiUrl("/shops"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body,
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
