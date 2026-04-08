import { NextRequest, NextResponse } from "next/server";

import { apiUrl } from "@/lib/api";


type RouteContext = {
  params: Promise<{
    jobId: string;
  }>;
};


export async function GET(request: NextRequest, context: RouteContext) {
  const { jobId } = await context.params;
  const token = request.nextUrl.searchParams.get("token")?.trim();
  if (!token) {
    return NextResponse.json({ detail: "Missing download token." }, { status: 400 });
  }

  const target = apiUrl(`/orders/bulk/download-designs/jobs/${jobId}/download?token=${encodeURIComponent(token)}`);
  return NextResponse.redirect(target, 307);
}
