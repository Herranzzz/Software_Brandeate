import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { apiUrl } from "@/lib/api";
import type { Shop, User } from "@/lib/types";


export async function getAuthToken() {
  const cookieStore = await cookies();
  return cookieStore.get("auth_token")?.value ?? null;
}


export async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await getAuthToken();
  if (!token) {
    return {};
  }

  return { Authorization: `Bearer ${token}` };
}


export async function fetchCurrentUser(): Promise<User | null> {
  const headers = await getAuthHeaders();
  if (!("Authorization" in headers)) {
    return null;
  }

  const response = await fetch(apiUrl("/auth/me"), {
    headers,
    cache: "no-store",
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as { user: User };
  return payload.user;
}


export async function fetchMyShops(): Promise<Shop[]> {
  const headers = await getAuthHeaders();
  if (!("Authorization" in headers)) {
    return [];
  }

  const response = await fetch(apiUrl("/users/me/shops"), {
    headers,
    cache: "no-store",
  });

  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as { shops: Shop[] };
  return payload.shops;
}


export async function requireAdminUser() {
  const user = await fetchCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (!["super_admin", "ops_admin"].includes(user.role)) {
    redirect("/portal");
  }
  return user;
}


export async function requirePortalUser() {
  const user = await fetchCurrentUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}
