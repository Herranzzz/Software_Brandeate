import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { apiUrl } from "@/lib/api";


type RouteContext = {
  params: Promise<{
    jobId: string;
  }>;
};


const BACKEND_TIMEOUT_MS = 15_000;


export async function GET(_request: NextRequest, context: RouteContext) {
  const token = (await cookies()).get("auth_token")?.value;
  const { jobId } = await context.params;

  let response: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);
    response = await fetch(apiUrl(`/orders/bulk/download-designs/jobs/${jobId}`), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timer);
  } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === "AbortError";
    return NextResponse.json(
      { detail: isTimeout
          ? "El backend tardó demasiado en responder al consultar el estado del job."
          : "No se pudo contactar el backend para consultar el estado del job."
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


export async function DELETE(_request: NextRequest, context: RouteContext) {
  const token = (await cookies()).get("auth_token")?.value;
  const { jobId } = await context.params;

  let response: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);
    response = await fetch(apiUrl(`/orders/bulk/download-designs/jobs/${jobId}`), {
      method: "DELETE",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timer);
  } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === "AbortError";
    return NextResponse.json(
      { detail: isTimeout
          ? "El backend tardó demasiado en cancelar el job."
          : "No se pudo contactar el backend para cancelar el job."
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
