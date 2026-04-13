import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { apiUrl } from "@/lib/api";


const BACKEND_TIMEOUT_MS = 30_000;


export async function POST(request: NextRequest) {
  const token = (await cookies()).get("auth_token")?.value;
  const body = await request.text();

  let response: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);
    response = await fetch(apiUrl("/orders/bulk/download-designs/jobs"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body,
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timer);
  } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === "AbortError";
    return NextResponse.json(
      { detail: isTimeout
          ? "El backend tardó demasiado en crear el job de descarga."
          : "No se pudo contactar el backend para crear el job de descarga."
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
