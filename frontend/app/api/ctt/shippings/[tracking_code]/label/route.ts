import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { apiUrl } from "@/lib/api";


export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tracking_code: string }> },
) {
  const { tracking_code } = await params;
  const shouldDownload = request.nextUrl.searchParams.get("download") === "1";
  const labelType = request.nextUrl.searchParams.get("label_type") ?? "PDF";
  const modelType = request.nextUrl.searchParams.get("model_type") ?? "SINGLE";
  const token = (await cookies()).get("auth_token")?.value;

  const response = await fetch(
    apiUrl(`/ctt/shippings/${tracking_code}/label?label_type=${encodeURIComponent(labelType)}&model_type=${encodeURIComponent(modelType)}`),
    {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ detail: "Error obteniendo la etiqueta" }));
    return NextResponse.json(payload, { status: response.status });
  }

  const pdfBytes = await response.arrayBuffer();
  const normalizedType = labelType.toUpperCase();
  const isPdf = normalizedType === "PDF" || normalizedType === "PDF2";
  const extension = isPdf ? "pdf" : normalizedType.toLowerCase();
  return new NextResponse(pdfBytes, {
    status: 200,
    headers: {
      "Content-Type": isPdf ? "application/pdf" : "text/plain; charset=utf-8",
      "Content-Disposition": `${shouldDownload ? "attachment" : "inline"}; filename="label-${tracking_code}.${extension}"`,
    },
  });
}
