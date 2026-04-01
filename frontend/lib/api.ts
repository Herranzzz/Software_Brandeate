import { cookies } from "next/headers";

import type {
  AnalyticsOverview,
  Incident,
  Order,
  PickBatch,
  PublicTracking,
  Shop,
  ShopCustomer,
  ShopCatalogProduct,
  ShopIntegration,
  ShopifyCatalogSyncResult,
  AdminUser,
} from "@/lib/types";


const DEFAULT_API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  (process.env.NODE_ENV === "development" ? "http://localhost:8000" : "");


export function getApiBaseUrl() {
  if (!DEFAULT_API_URL) {
    throw new Error("NEXT_PUBLIC_API_URL is required in production.");
  }

  return DEFAULT_API_URL.replace(/\/$/, "");
}


export function apiUrl(path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${getApiBaseUrl()}${normalizedPath}`;
}


async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail: string | null = null;

    try {
      const contentType = response.headers.get("Content-Type") ?? "";
      if (contentType.includes("application/json")) {
        const payload = (await response.json()) as { detail?: unknown } | null;
        if (payload && typeof payload.detail === "string" && payload.detail.trim()) {
          detail = payload.detail.trim();
        } else if (payload && payload.detail !== undefined) {
          detail = JSON.stringify(payload.detail);
        }
      } else {
        const text = (await response.text()).trim();
        if (text) {
          detail = text;
        }
      }
    } catch {
      detail = null;
    }

    throw new Error(detail || `API request failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
}


async function buildAuthHeaders(): Promise<Record<string, string>> {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;
  if (!token) {
    return {};
  }

  return { Authorization: `Bearer ${token}` };
}


export async function fetchOrders(params?: {
  status?: string;
  production_status?: string;
  design_status?: string;
  has_pending_asset?: boolean;
  is_prepared?: boolean;
  priority?: string;
  shop_id?: string | number;
  is_personalized?: string | boolean;
  has_incident?: string | boolean;
  sku?: string;
  variant_title?: string;
  channel?: string;
  carrier?: string;
  q?: string;
  page?: string | number;
  per_page?: string | number;
}): Promise<{ orders: Order[]; totalCount: number }> {
  const searchParams = new URLSearchParams();
  if (params?.status) {
    searchParams.set("status", String(params.status));
  }
  if (params?.production_status) {
    searchParams.set("production_status", String(params.production_status));
  }
  if (params?.design_status) {
    searchParams.set("design_status", String(params.design_status));
  }
  if (params?.has_pending_asset !== undefined) {
    searchParams.set("has_pending_asset", String(params.has_pending_asset));
  }
  if (params?.is_prepared !== undefined) {
    searchParams.set("is_prepared", String(params.is_prepared));
  }
  if (params?.priority) {
    searchParams.set("priority", String(params.priority));
  }
  if (params?.shop_id !== undefined && params.shop_id !== "") {
    searchParams.set("shop_id", String(params.shop_id));
  }
  if (params?.is_personalized !== undefined && params.is_personalized !== "") {
    searchParams.set("is_personalized", String(params.is_personalized));
  }
  if (params?.has_incident !== undefined && params.has_incident !== "") {
    searchParams.set("has_incident", String(params.has_incident));
  }
  if (params?.sku) {
    searchParams.set("sku", params.sku);
  }
  if (params?.variant_title) {
    searchParams.set("variant_title", params.variant_title);
  }
  if (params?.channel) {
    searchParams.set("channel", String(params.channel));
  }
  if (params?.carrier) {
    searchParams.set("carrier", String(params.carrier));
  }
  if (params?.q) {
    searchParams.set("q", params.q);
  }
  if (params?.page !== undefined && params.page !== "") {
    searchParams.set("page", String(params.page));
  }
  if (params?.per_page !== undefined && params.per_page !== "") {
    searchParams.set("per_page", String(params.per_page));
  }

  const query = searchParams.toString();
  const headers = await buildAuthHeaders();
  const response = await fetch(apiUrl(`/orders${query ? `?${query}` : ""}`), {
    cache: "no-store",
    headers,
  });

  if (!response.ok) {
    await parseResponse<Order[]>(response); // throws the error
  }

  const totalCount = Number(response.headers.get("X-Total-Count") ?? "0");
  const orders = await response.json() as Order[];
  return { orders, totalCount };
}


export async function fetchPickBatches(params?: {
  shop_id?: string | number;
}) {
  const searchParams = new URLSearchParams();
  if (params?.shop_id !== undefined && params.shop_id !== "") {
    searchParams.set("shop_id", String(params.shop_id));
  }

  const query = searchParams.toString();
  const headers = await buildAuthHeaders();
  const response = await fetch(apiUrl(`/orders/batches${query ? `?${query}` : ""}`), {
    cache: "no-store",
    headers,
  });

  return parseResponse<PickBatch[]>(response);
}


export async function fetchShopCustomers(params?: {
  shop_id?: string | number;
  q?: string;
}) {
  const searchParams = new URLSearchParams();
  if (params?.shop_id !== undefined && params.shop_id !== "") {
    searchParams.set("shop_id", String(params.shop_id));
  }
  if (params?.q) {
    searchParams.set("q", params.q);
  }

  const headers = await buildAuthHeaders();
  const query = searchParams.toString();
  const response = await fetch(apiUrl(`/customers${query ? `?${query}` : ""}`), {
    cache: "no-store",
    headers,
  });

  const payload = await parseResponse<{ customers: ShopCustomer[] }>(response);
  return payload.customers;
}


export async function fetchAdminUsers(params?: {
  role?: string;
}) {
  const searchParams = new URLSearchParams();
  if (params?.role) {
    searchParams.set("role", params.role);
  }

  const query = searchParams.toString();
  const headers = await buildAuthHeaders();
  const response = await fetch(apiUrl(`/users${query ? `?${query}` : ""}`), {
    cache: "no-store",
    headers,
  });

  const payload = await parseResponse<{ users: AdminUser[] }>(response);
  return payload.users;
}


export async function fetchIncidents(params?: {
  status?: string;
  priority?: string;
  type?: string;
  shop_id?: string | number;
}) {
  const searchParams = new URLSearchParams();
  if (params?.status) {
    searchParams.set("status", params.status);
  }
  if (params?.priority) {
    searchParams.set("priority", params.priority);
  }
  if (params?.type) {
    searchParams.set("type", params.type);
  }
  if (params?.shop_id !== undefined && params.shop_id !== "") {
    searchParams.set("shop_id", String(params.shop_id));
  }

  const query = searchParams.toString();
  const headers = await buildAuthHeaders();
  const response = await fetch(apiUrl(`/incidents${query ? `?${query}` : ""}`), {
    cache: "no-store",
    headers,
  });

  return parseResponse<Incident[]>(response);
}


export async function fetchOrderById(id: string) {
  const headers = await buildAuthHeaders();
  const response = await fetch(apiUrl(`/orders/${id}`), {
    cache: "no-store",
    headers,
  });

  if (response.status === 404) {
    return null;
  }

  return parseResponse<Order>(response);
}


export async function fetchOrderIncidents(id: string) {
  const headers = await buildAuthHeaders();
  const response = await fetch(apiUrl(`/orders/${id}/incidents`), {
    cache: "no-store",
    headers,
  });

  if (response.status === 404) {
    return null;
  }

  return parseResponse<Incident[]>(response);
}

export async function fetchIncidentById(id: string) {
  const headers = await buildAuthHeaders();
  const response = await fetch(apiUrl(`/incidents/${id}`), {
    cache: "no-store",
    headers,
  });

  if (response.status === 404) {
    return null;
  }

  return parseResponse<Incident>(response);
}


export async function fetchPublicTracking(token: string) {
  const response = await fetch(apiUrl(`/t/${token}`), {
    cache: "no-store",
  });

  if (response.status === 404) {
    return null;
  }

  return parseResponse<PublicTracking>(response);
}


export async function fetchShops() {
  const headers = await buildAuthHeaders();
  const response = await fetch(apiUrl("/shops"), {
    cache: "no-store",
    headers,
  });

  return parseResponse<Shop[]>(response);
}


export async function fetchShopById(id: string | number) {
  const headers = await buildAuthHeaders();
  const response = await fetch(apiUrl(`/shops/${id}`), {
    cache: "no-store",
    headers,
  });

  if (response.status === 404) {
    return null;
  }

  return parseResponse<Shop>(response);
}


export async function fetchShopifyIntegrations() {
  const headers = await buildAuthHeaders();
  const response = await fetch(apiUrl("/integrations/shopify"), {
    cache: "no-store",
    headers,
  });

  const payload = await parseResponse<{ integrations: ShopIntegration[] }>(response);
  return payload.integrations;
}


export async function fetchShopCatalogProducts(shopId?: string | number) {
  const headers = await buildAuthHeaders();
  const query =
    shopId !== undefined && shopId !== ""
      ? `?${new URLSearchParams({ shop_id: String(shopId) }).toString()}`
      : "";
  const response = await fetch(apiUrl(`/catalog/products${query}`), {
    cache: "no-store",
    headers,
  });

  const payload = await parseResponse<{ products: ShopCatalogProduct[] }>(response);
  return payload.products;
}


export async function syncShopCatalogProducts(shopId: string | number) {
  const headers = await buildAuthHeaders();
  const response = await fetch(apiUrl(`/catalog/shopify/${shopId}/sync-products`), {
    method: "POST",
    cache: "no-store",
    headers,
  });

  return parseResponse<ShopifyCatalogSyncResult>(response);
}


export async function fetchAnalyticsOverview(params?: {
  date_from?: string;
  date_to?: string;
  shop_id?: string | number;
  channel?: string;
  is_personalized?: string | boolean;
  status?: string;
  production_status?: string;
  carrier?: string;
}) {
  const searchParams = new URLSearchParams();
  if (params?.date_from) {
    searchParams.set("date_from", params.date_from);
  }
  if (params?.date_to) {
    searchParams.set("date_to", params.date_to);
  }
  if (params?.shop_id !== undefined && params.shop_id !== "") {
    searchParams.set("shop_id", String(params.shop_id));
  }
  if (params?.channel) {
    searchParams.set("channel", params.channel);
  }
  if (params?.is_personalized !== undefined && params.is_personalized !== "") {
    searchParams.set("is_personalized", String(params.is_personalized));
  }
  if (params?.status) {
    searchParams.set("status", params.status);
  }
  if (params?.production_status) {
    searchParams.set("production_status", params.production_status);
  }
  if (params?.carrier) {
    searchParams.set("carrier", params.carrier);
  }

  const headers = await buildAuthHeaders();
  const query = searchParams.toString();
  const response = await fetch(apiUrl(`/analytics/overview${query ? `?${query}` : ""}`), {
    cache: "no-store",
    headers,
  });

  return parseResponse<AnalyticsOverview>(response);
}
