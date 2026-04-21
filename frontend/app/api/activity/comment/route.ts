import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { apiUrl } from "@/lib/api";

export async function POST(request: NextRequest) {
  const token = (await cookies()).get("auth_token")?.value;
  if (!token) return new NextResponse("Unauthorized", { status: 401 });

  const body = await request.json();
  const response = await fetch(apiUrl("/activity/comment"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const payload = await response.json();
  return NextResponse.json(payload, { status: response.status });
}
