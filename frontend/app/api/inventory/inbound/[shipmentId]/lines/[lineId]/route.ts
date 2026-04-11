import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { apiUrl } from "@/lib/api";


type RouteContext = { params: Promise<{ shipmentId: string; lineId: string }> };

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { shipmentId, lineId } = await context.params;
  const token = (await cookies()).get("auth_token")?.value;

  const response = await fetch(
    apiUrl(`/inventory/inbound/${shipmentId}/lines/${lineId}`),
    {
      method: "DELETE",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      cache: "no-store",
    },
  );

  if (response.status === 204) {
    return new NextResponse(null, { status: 204 });
  }
  const payload = await response.json();
  return NextResponse.json(payload, { status: response.status });
}
