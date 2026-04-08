import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { apiUrl } from "@/lib/api";


type RouteContext = {
  params: Promise<{
    incidentId: string;
  }>;
};


export async function PATCH(request: NextRequest, context: RouteContext) {
  const token = (await cookies()).get("auth_token")?.value;
  const { incidentId } = await context.params;
  const body = await request.text();

  const response = await fetch(apiUrl(`/incidents/${incidentId}`), {
    method: "PATCH",
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
