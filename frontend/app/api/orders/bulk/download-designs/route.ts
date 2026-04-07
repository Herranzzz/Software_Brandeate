import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { apiUrl } from "@/lib/api";


export async function POST(request: NextRequest) {
  const body = await request.json();
  const token = (await cookies()).get("auth_token")?.value;

  const response = await fetch(apiUrl("/orders/bulk/download-designs"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    return new NextResponse(text, { status: response.status });
  }

  const blob = await response.blob();
  const okCount = response.headers.get("X-Design-Results") ?? "0";

  return new NextResponse(blob, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="diseños-bulk.zip"',
      "X-Design-Results": okCount,
    },
  });
}
