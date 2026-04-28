import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { apiUrl } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const token = (await cookies()).get("auth_token")?.value;
  if (!token) return new NextResponse("Unauthorized", { status: 401 });

  const body = await request.json();
  const targetUrl = apiUrl(`/orders/${id}/assign`);
  console.log("[assign] POST →", targetUrl, "body:", JSON.stringify(body));
  const response = await fetch(targetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    console.error("[assign] backend non-JSON response", response.status, await response.text().catch(() => ""));
    return NextResponse.json({ detail: `Backend error ${response.status}` }, { status: response.status });
  }
  if (!response.ok) {
    console.error("[assign] backend error", response.status, JSON.stringify(payload));
  }
  return NextResponse.json(payload, { status: response.status });
}
