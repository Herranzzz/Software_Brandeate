import { type NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { apiUrl } from "@/lib/api";

type RouteContext = {
  params: Promise<{ flowId: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { flowId } = await context.params;
  const token = (await cookies()).get("auth_token")?.value;
  const body = await request.json();

  const response = await fetch(apiUrl(`/email-flows/${flowId}`), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const text = await response.text();
  return new NextResponse(text, {
    status: response.status,
    headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/json" },
  });
}
