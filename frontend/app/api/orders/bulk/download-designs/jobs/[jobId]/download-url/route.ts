import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { apiUrl } from "@/lib/api";


type RouteContext = {
  params: Promise<{
    jobId: string;
  }>;
};


export async function POST(_request: NextRequest, context: RouteContext) {
  const token = (await cookies()).get("auth_token")?.value;
  const { jobId } = await context.params;
  const response = await fetch(apiUrl(`/orders/bulk/download-designs/jobs/${jobId}/download-url`), {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
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
