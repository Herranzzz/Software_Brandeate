import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { apiUrl } from "@/lib/api";


export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ tracking_code: string }> },
) {
  const { tracking_code } = await params;
  const token = (await cookies()).get("auth_token")?.value;

  const response = await fetch(
    apiUrl(`/ctt/shippings/${tracking_code}/label?label_type=PDF`),
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
  return new NextResponse(pdfBytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="label-${tracking_code}.pdf"`,
    },
  });
}
