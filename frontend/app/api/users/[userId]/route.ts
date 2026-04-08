import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { apiUrl } from "@/lib/api";


type RouteContext = {
  params: Promise<{
    userId: string;
  }>;
};


export async function GET(_request: NextRequest, context: RouteContext) {
  const token = (await cookies()).get("auth_token")?.value;
  const { userId } = await context.params;
  const response = await fetch(apiUrl(`/users/${userId}`), {
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


export async function PATCH(request: NextRequest, context: RouteContext) {
  const token = (await cookies()).get("auth_token")?.value;
  const { userId } = await context.params;
  const body = await request.text();
  const response = await fetch(apiUrl(`/users/${userId}`), {
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


export async function DELETE(_request: NextRequest, context: RouteContext) {
  const token = (await cookies()).get("auth_token")?.value;
  const { userId } = await context.params;
  const response = await fetch(apiUrl(`/users/${userId}`), {
    method: "DELETE",
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
