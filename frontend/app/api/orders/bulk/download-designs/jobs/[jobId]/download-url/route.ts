import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { apiUrl } from "@/lib/api";


type RouteContext = {
  params: Promise<{
    jobId: string;
  }>;
};


const BACKEND_TIMEOUT_MS = 15_000;


export async function POST(_request: NextRequest, context: RouteContext) {
  const token = (await cookies()).get("auth_token")?.value;
  const { jobId } = await context.params;

  let response: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);
    response = await fetch(apiUrl(`/orders/bulk/download-designs/jobs/${jobId}/download-url`), {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timer);
  } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === "AbortError";
    return NextResponse.json(
      { detail: isTimeout
          ? "El backend tardó demasiado en generar la URL de descarga."
          : "No se pudo contactar el backend para generar la URL de descarga."
      },
      { status: 502 },
    );
  }

  const text = await response.text();
  return new NextResponse(text, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("Content-Type") ?? "application/json",
    },
  });
}
