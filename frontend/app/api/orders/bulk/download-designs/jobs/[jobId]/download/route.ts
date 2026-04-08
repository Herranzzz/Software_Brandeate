import { NextRequest, NextResponse } from "next/server";

import { apiUrl } from "@/lib/api";


export const runtime = "nodejs";
export const maxDuration = 300;


type RouteContext = {
  params: Promise<{
    jobId: string;
  }>;
};


const RETRYABLE_STATUS = new Set([502, 503, 504]);
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;


function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


function formatDownloadError(status: number, contentType: string, payloadText: string): string {
  const text = payloadText.trim();
  if (!text) {
    return `No se pudo descargar el ZIP (HTTP ${status}).`;
  }

  if (contentType.includes("application/json")) {
    try {
      const payload = JSON.parse(text) as { detail?: unknown };
      if (typeof payload.detail === "string" && payload.detail.trim()) {
        return payload.detail.trim();
      }
      if (payload.detail !== undefined) {
        return String(payload.detail);
      }
    } catch {
      // ignore malformed JSON
    }
  }

  if (contentType.includes("text/html") || /^<!doctype html/i.test(text) || /<html/i.test(text)) {
    const requestId = text.match(/Request ID:\s*([A-Za-z0-9-]+)/i)?.[1];
    if (requestId) {
      return `El servicio de descargas está temporalmente no disponible (HTTP ${status}, Request ID: ${requestId}).`;
    }
    return `El servicio de descargas está temporalmente no disponible (HTTP ${status}).`;
  }

  return text.slice(0, 400);
}


export async function GET(request: NextRequest, context: RouteContext) {
  const { jobId } = await context.params;
  const token = request.nextUrl.searchParams.get("token")?.trim();
  if (!token) {
    return NextResponse.json({ detail: "Missing download token." }, { status: 400 });
  }

  const target = apiUrl(`/orders/bulk/download-designs/jobs/${jobId}/download?token=${encodeURIComponent(token)}`);
  let response: Response | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      response = await fetch(target, {
        cache: "no-store",
      });
    } catch {
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
      return NextResponse.json(
        { detail: "No se pudo contactar el servicio de descargas. Inténtalo de nuevo en unos segundos." },
        { status: 502 },
      );
    }

    if (response.ok) {
      break;
    }

    if (RETRYABLE_STATUS.has(response.status) && attempt < MAX_RETRIES) {
      await sleep(RETRY_DELAY_MS * (attempt + 1));
      continue;
    }

    break;
  }

  if (!response) {
    return NextResponse.json({ detail: "No se pudo iniciar la descarga." }, { status: 502 });
  }

  if (!response.ok) {
    const contentType = response.headers.get("Content-Type") ?? "";
    const payloadText = await response.text();
    return NextResponse.json(
      { detail: formatDownloadError(response.status, contentType, payloadText) },
      { status: response.status },
    );
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
