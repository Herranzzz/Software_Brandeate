import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { apiUrl } from "@/lib/api";

export async function GET() {
  const token = (await cookies()).get("auth_token")?.value;
  const response = await fetch(apiUrl("/users/me"), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  const text = await response.text();
  return new NextResponse(text, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("Content-Type") ?? "application/json",
    },
  });
}

export async function PATCH(request: NextRequest) {
  const token = (await cookies()).get("auth_token")?.value;
  const body = await request.text();
  const response = await fetch(apiUrl("/users/me/account"), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
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
