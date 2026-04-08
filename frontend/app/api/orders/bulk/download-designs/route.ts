import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { apiUrl } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 300;


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
    const contentType = response.headers.get("Content-Type") ?? "text/plain; charset=utf-8";
    return new NextResponse(text, {
      status: response.status,
      headers: {
        "Content-Type": contentType,
      },
    });
  }

  if (!response.body) {
    return NextResponse.json(
      { detail: "La descarga no devolvió ningún archivo." },
      { status: 502 },
    );
  }

  return new NextResponse(response.body, {
    status: 200,
    headers: {
      "Content-Type": response.headers.get("Content-Type") ?? "application/zip",
      "Content-Disposition": response.headers.get("Content-Disposition") ?? 'attachment; filename="diseños-bulk.zip"',
      "X-Design-Results": response.headers.get("X-Design-Results") ?? "0",
      "X-Design-Failures": response.headers.get("X-Design-Failures") ?? "0",
      "X-Design-No-Design": response.headers.get("X-Design-No-Design") ?? "0",
    },
  });
}
