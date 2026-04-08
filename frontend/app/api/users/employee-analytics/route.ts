import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { apiUrl } from "@/lib/api";


export async function GET(request: NextRequest) {
  const token = (await cookies()).get("auth_token")?.value;
  const response = await fetch(apiUrl(`/users/employee-analytics${request.nextUrl.search}`), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  const text = await response.text();
  return new NextResponse(text, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("Content-Type") ?? "application/json",
    },
  });
}
