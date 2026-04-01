import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { apiUrl } from "@/lib/api";


/**
 * Proxy de exportación CSV.
 * Lee el token httpOnly y lo reenvía al backend para generar el CSV.
 */
export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;
  if (!token) {
    return NextResponse.json({ detail: "Authentication required" }, { status: 401 });
  }

  // Reenviar todos los query params tal cual al backend
  const backendUrl = apiUrl("/orders/export");
  const search = request.nextUrl.search;
  const targetUrl = `${backendUrl}${search}`;

  const response = await fetch(targetUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return NextResponse.json(
      { detail: "Export failed" },
      { status: response.status },
    );
  }

  const csvBytes = await response.arrayBuffer();
  return new NextResponse(csvBytes, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=pedidos.csv",
    },
  });
}
