import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { apiUrl } from "@/lib/api";


type RouteContext = {
  params: Promise<{ ruleId: string }>;
};


export async function PATCH(request: NextRequest, context: RouteContext) {
  const { ruleId } = await context.params;
  const token = (await cookies()).get("auth_token")?.value;
  const body = await request.text();

  const response = await fetch(apiUrl(`/shipping-rules/${ruleId}`), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body,
    cache: "no-store",
  });

  const payload = await response.text();
  return new NextResponse(payload, {
    status: response.status,
    headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/json" },
  });
}


export async function DELETE(_: NextRequest, context: RouteContext) {
  const { ruleId } = await context.params;
  const token = (await cookies()).get("auth_token")?.value;

  const response = await fetch(apiUrl(`/shipping-rules/${ruleId}`), {
    method: "DELETE",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: "no-store",
  });

  return new NextResponse(null, { status: response.status });
}
