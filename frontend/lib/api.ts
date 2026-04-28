import type {
  ActivityLog,
  AdminUser,
  WebhookEndpoint,
  WebhookEndpointCreate,
  AnalyticsOverview,
  EmployeeAnalyticsResponse,
  EmployeeWorkspace,
  Incident,
  Invoice,
  InvoiceCreatePayload,
  InvoiceSendPayload,
  InvoiceStatus,
  InventoryItem,
  InventoryItemListResponse,
  InboundShipment,
  InboundShipmentLine,
  InboundShipmentListResponse,
  StockMovement,
  StockMovementListResponse,
  InventoryAlertsRead,
  Order,
  PickBatch,
  PublicTracking,
  Return,
  Shop,
  ShopCustomer,
  ShopCatalogProduct,
  ShopIntegration,
  ShopifyCatalogSyncResult,
  CarrierInfo,
  CarrierConfig,
  EmailFlow,
  Supplier,
  SupplierListResponse,
  SupplierProduct,
  SupplierProductListResponse,
  PurchaseOrder,
  PurchaseOrderListResponse,
  PurchaseOrderStatus,
  ReplenishmentRecommendationsResponse,
  ReplenishmentGenerateResponse,
} from "@/lib/types";


const DEFAULT_API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  (process.env.NODE_ENV === "development" ? "http://localhost:8000" : "");
const DEFAULT_ORDERS_PER_PAGE = 100;
const MAX_ORDERS_PER_PAGE = 250;


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
  if (typeof window !== "undefined") {
    // Client context: auth token is httpOnly and cannot be read here.
    // Mutations from client components must go through Next.js API routes.
    return {};
  }
  // Server context (Server Components, Route Handlers, Server Actions)
  const { cookies } = await import("next/headers");
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
  has_shipment?: boolean;
  priority?: string;
  shop_id?: string | number;
  is_personalized?: string | boolean;
  has_incident?: string | boolean;
  sku?: string;
  variant_title?: string;
  channel?: string;
  carrier?: string;
  shipping_status?: string;
  prepared_by_employee_id?: number;
  sort_by?: "created_desc" | "prepared_asc" | "prepared_desc";
  q?: string;
  page?: string | number;
  per_page?: string | number;
}, options?: {
  cacheSeconds?: number;
}): Promise<{ orders: Order[]; totalCount: number }> {
  const searchParams = new URLSearchParams();
  const safePage = Math.max(Number(params?.page ?? 1) || 1, 1);
  const requestedPerPage = Number(params?.per_page ?? DEFAULT_ORDERS_PER_PAGE) || DEFAULT_ORDERS_PER_PAGE;
  const safePerPage = Math.min(Math.max(requestedPerPage, 1), MAX_ORDERS_PER_PAGE);
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
  if (params?.has_shipment !== undefined) {
    searchParams.set("has_shipment", String(params.has_shipment));
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
  if (params?.shipping_status) {
    searchParams.set("shipping_status", String(params.shipping_status));
  }
  if (params?.prepared_by_employee_id !== undefined) {
    searchParams.set("prepared_by_employee_id", String(params.prepared_by_employee_id));
  }
  if (params?.sort_by) {
    searchParams.set("sort_by", params.sort_by);
  }
  if (params?.q) {
    searchParams.set("q", params.q);
  }
  searchParams.set("page", String(safePage));
  searchParams.set("per_page", String(safePerPage));

  const query = searchParams.toString();
  const headers = await buildAuthHeaders();
  const cacheSeconds = Math.max(Number(options?.cacheSeconds ?? 0), 0);
  const fetchOptions: RequestInit & { next?: { revalidate: number } } = {
    headers,
  };
  if (cacheSeconds > 0) {
    fetchOptions.cache = "force-cache";
    fetchOptions.next = { revalidate: cacheSeconds };
  } else {
    fetchOptions.cache = "no-store";
  }
  const response = await fetch(apiUrl(`/orders${query ? `?${query}` : ""}`), {
    ...fetchOptions,
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
  page?: string | number;
  per_page?: string | number;
}) {
  const searchParams = new URLSearchParams();
  if (params?.shop_id !== undefined && params.shop_id !== "") {
    searchParams.set("shop_id", String(params.shop_id));
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


export async function fetchMyClientAccounts() {
  const headers = await buildAuthHeaders();
  const response = await fetch(apiUrl("/users/me/client-accounts"), {
    cache: "no-store",
    headers,
  });

  const payload = await parseResponse<{ users: AdminUser[] }>(response);
  return payload.users;
}


export async function fetchMyAccount() {
  const headers = await buildAuthHeaders();
  const response = await fetch(apiUrl("/users/me"), {
    cache: "no-store",
    headers,
  });

  return parseResponse<AdminUser>(response);
}


export async function fetchEmployeeAnalytics(params?: {
  period?: "day" | "week";
  role?: string;
  shop_id?: string | number;
}) {
  const searchParams = new URLSearchParams();
  if (params?.period) {
    searchParams.set("period", params.period);
  }
  if (params?.role) {
    searchParams.set("role", params.role);
  }
  if (params?.shop_id !== undefined && params.shop_id !== "") {
    searchParams.set("shop_id", String(params.shop_id));
  }

  const query = searchParams.toString();
  const headers = await buildAuthHeaders();
  const response = await fetch(apiUrl(`/users/employee-analytics${query ? `?${query}` : ""}`), {
    cache: "no-store",
    headers,
  });

  return parseResponse<EmployeeAnalyticsResponse>(response);
}


export async function fetchEmployeeWorkspace() {
  const headers = await buildAuthHeaders();
  const response = await fetch(apiUrl("/users/me/workspace"), {
    cache: "no-store",
    headers,
  });

  return parseResponse<EmployeeWorkspace>(response);
}


export async function fetchIncidents(params?: {
  status?: string;
  priority?: string;
  type?: string;
  shop_id?: string | number;
  recent_days?: string | number;
  include_historical?: boolean;
  page?: string | number;
  per_page?: string | number;
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
  if (params?.recent_days !== undefined && params.recent_days !== "") {
    searchParams.set("recent_days", String(params.recent_days));
  }
  if (params?.include_historical !== undefined) {
    searchParams.set("include_historical", String(params.include_historical));
  }
  if (params?.page !== undefined && params.page !== "") {
    searchParams.set("page", String(params.page));
  }
  if (params?.per_page !== undefined && params.per_page !== "") {
    searchParams.set("per_page", String(params.per_page));
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


export async function updateShopTrackingConfig(
  shopId: number,
  config: Record<string, unknown>,
): Promise<Shop> {
  const headers = await buildAuthHeaders();
  headers["Content-Type"] = "application/json";
  const res = await fetch(apiUrl(`/shops/${shopId}/tracking-config`), {
    method: "PATCH",
    headers,
    body: JSON.stringify(config),
  });
  return parseResponse<Shop>(res);
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
  shipping_status?: string;
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
  if (params?.shipping_status) {
    searchParams.set("shipping_status", params.shipping_status);
  }

  const headers = await buildAuthHeaders();
  const query = searchParams.toString();
  const response = await fetch(apiUrl(`/analytics/overview${query ? `?${query}` : ""}`), {
    cache: "no-store",
    headers,
  });

  return parseResponse<AnalyticsOverview>(response);
}


export async function fetchReturns(params?: {
  shop_id?: string | number;
  status?: string;
  page?: string | number;
  per_page?: string | number;
}): Promise<Return[]> {
  const searchParams = new URLSearchParams();
  if (params?.shop_id !== undefined && params.shop_id !== "") {
    searchParams.set("shop_id", String(params.shop_id));
  }
  if (params?.status) {
    searchParams.set("status", params.status);
  }
  if (params?.page !== undefined && params.page !== "") {
    searchParams.set("page", String(params.page));
  }
  if (params?.per_page !== undefined && params.per_page !== "") {
    searchParams.set("per_page", String(params.per_page));
  }
  const query = searchParams.toString();
  const headers = await buildAuthHeaders();
  const response = await fetch(apiUrl(`/returns${query ? `?${query}` : ""}`), {
    cache: "no-store",
    headers,
  });
  return parseResponse<Return[]>(response);
}


export async function fetchReturnById(id: string | number): Promise<Return | null> {
  const headers = await buildAuthHeaders();
  const response = await fetch(apiUrl(`/returns/${id}`), {
    cache: "no-store",
    headers,
  });
  if (response.status === 404) return null;
  return parseResponse<Return>(response);
}


export async function bulkUpdateReturnStatus(ids: number[], returnStatus: string): Promise<{ updated: number[]; not_found: number[] }> {
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl("/returns/bulk/status"), {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ ids, status: returnStatus }),
  });
  return parseResponse(res);
}

export async function blockOrder(orderId: number, reason?: string): Promise<Order> {
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl(`/orders/${orderId}/block`), {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ reason: reason || null }),
  });
  return parseResponse<Order>(res);
}

export async function unblockOrder(orderId: number): Promise<Order> {
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl(`/orders/${orderId}/unblock`), {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  return parseResponse<Order>(res);
}


export async function updateOrderInternalNote(orderId: number, note: string | null): Promise<void> {
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl(`/orders/${orderId}/internal-note`), {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ internal_note: note }),
  });
  if (!res.ok) throw new Error(await res.text());
}


// ── SGA / Inventory ──────────────────────────────────────────────────────────

export async function fetchInventoryItems(params?: {
  shop_id?: string | number;
  low_stock?: boolean;
  page?: number;
  per_page?: number;
}): Promise<InventoryItemListResponse> {
  const query = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) query.append(k, String(v));
    });
  }
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl(`/inventory/items?${query}`), { headers });
  return parseResponse<InventoryItemListResponse>(res);
}

export async function createInventoryItem(data: {
  shop_id: number;
  sku: string;
  name: string;
  stock_on_hand?: number;
  reorder_point?: number | null;
  reorder_qty?: number | null;
  location?: string | null;
  notes?: string | null;
}): Promise<InventoryItem> {
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl("/inventory/items"), {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return parseResponse<InventoryItem>(res);
}

export async function updateInventoryItem(
  id: number,
  data: Partial<{
    name: string;
    reorder_point: number | null;
    reorder_qty: number | null;
    location: string | null;
    notes: string | null;
    is_active: boolean;
    primary_supplier_id: number | null;
    cost_price: string | number | null;
    lead_time_days: number | null;
    replenishment_auto_enabled: boolean;
    target_days_of_cover: number;
    safety_stock_days: number;
    consumption_lookback_days: number;
  }>
): Promise<InventoryItem> {
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl(`/inventory/items/${id}`), {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return parseResponse<InventoryItem>(res);
}

export async function adjustInventoryStock(
  id: number,
  data: { qty_delta: number; movement_type: string; notes?: string | null }
): Promise<InventoryItem> {
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl(`/inventory/items/${id}/adjust`), {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return parseResponse<InventoryItem>(res);
}

export async function fetchInboundShipments(params?: {
  shop_id?: string | number;
  status?: string;
  page?: number;
  per_page?: number;
}): Promise<InboundShipmentListResponse> {
  const query = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) query.append(k, String(v));
    });
  }
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl(`/inventory/inbound?${query}`), { headers });
  return parseResponse<InboundShipmentListResponse>(res);
}

export async function createInboundShipment(data: {
  shop_id: number;
  reference: string;
  expected_arrival?: string | null;
  carrier?: string | null;
  tracking_number?: string | null;
  notes?: string | null;
}): Promise<InboundShipment> {
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl("/inventory/inbound"), {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return parseResponse<InboundShipment>(res);
}

export async function updateInboundShipment(
  id: number,
  data: Partial<{
    reference: string;
    status: string;
    expected_arrival: string | null;
    carrier: string | null;
    tracking_number: string | null;
    notes: string | null;
  }>
): Promise<InboundShipment> {
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl(`/inventory/inbound/${id}`), {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return parseResponse<InboundShipment>(res);
}

export async function addInboundShipmentLine(
  shipmentId: number,
  data: { sku: string; name?: string | null; qty_expected: number; notes?: string | null }
): Promise<InboundShipmentLine> {
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl(`/inventory/inbound/${shipmentId}/lines`), {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return parseResponse<InboundShipmentLine>(res);
}

export async function deleteInboundShipmentLine(
  shipmentId: number,
  lineId: number
): Promise<void> {
  const headers = await buildAuthHeaders();
  await fetch(apiUrl(`/inventory/inbound/${shipmentId}/lines/${lineId}`), {
    method: "DELETE",
    headers,
  });
}

export async function receiveInboundShipment(
  shipmentId: number,
  data: {
    lines: Array<{
      line_id: number;
      qty_received: number;
      qty_accepted: number;
      qty_rejected: number;
      rejection_reason?: string | null;
    }>;
    notes?: string | null;
  }
): Promise<InboundShipment> {
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl(`/inventory/inbound/${shipmentId}/receive`), {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return parseResponse<InboundShipment>(res);
}

export async function fetchStockMovements(params?: {
  shop_id?: string | number;
  sku?: string;
  item_id?: number;
  page?: number;
  per_page?: number;
}): Promise<StockMovementListResponse> {
  const query = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) query.append(k, String(v));
    });
  }
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl(`/inventory/movements?${query}`), { headers });
  return parseResponse<StockMovementListResponse>(res);
}

export async function fetchInventoryAlerts(params?: {
  shop_id?: string | number;
}): Promise<InventoryAlertsRead> {
  const query = new URLSearchParams();
  if (params?.shop_id !== undefined) query.append("shop_id", String(params.shop_id));
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl(`/inventory/alerts?${query}`), { headers });
  return parseResponse<InventoryAlertsRead>(res);
}


/* ─── Invoices ────────────────────────────────────────────────────────────── */

export async function fetchInvoices(params?: {
  status?: InvoiceStatus;
  shop_id?: number;
  q?: string;
  page?: number;
  per_page?: number;
}): Promise<Invoice[]> {
  const query = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) query.append(k, String(v));
    });
  }
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl(`/invoices?${query}`), { headers, cache: "no-store" });
  return parseResponse<Invoice[]>(res);
}

export async function fetchInvoiceById(id: number): Promise<Invoice> {
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl(`/invoices/${id}`), { headers, cache: "no-store" });
  return parseResponse<Invoice>(res);
}

export async function createInvoice(payload: InvoiceCreatePayload): Promise<Invoice> {
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl("/invoices"), {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseResponse<Invoice>(res);
}

export async function updateInvoice(id: number, payload: Partial<InvoiceCreatePayload>): Promise<Invoice> {
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl(`/invoices/${id}`), {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseResponse<Invoice>(res);
}

export async function deleteInvoice(id: number): Promise<void> {
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl(`/invoices/${id}`), { method: "DELETE", headers });
  if (!res.ok && res.status !== 204) await parseResponse<void>(res);
}

export async function sendInvoice(id: number, payload?: InvoiceSendPayload): Promise<Invoice> {
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl(`/invoices/${id}/send`), {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
  return parseResponse<Invoice>(res);
}

export async function markInvoicePaid(id: number): Promise<Invoice> {
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl(`/invoices/${id}/mark-paid`), { method: "POST", headers });
  return parseResponse<Invoice>(res);
}

export async function cancelInvoice(id: number): Promise<Invoice> {
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl(`/invoices/${id}/cancel`), { method: "POST", headers });
  return parseResponse<Invoice>(res);
}


/* ─── Activity Log ──────────────────────────────────────────────────────── */

export async function fetchActivityLog(
  entityType: string,
  entityId: number | string,
  limit = 50,
): Promise<ActivityLog[]> {
  const headers = await buildAuthHeaders();
  const res = await fetch(
    apiUrl(`/activity?entity_type=${entityType}&entity_id=${entityId}&limit=${limit}`),
    { headers, cache: "no-store" },
  );
  return parseResponse<ActivityLog[]>(res);
}


/* ─── Webhook Endpoints ─────────────────────────────────────────────────── */

export async function fetchWebhookEndpoints(shopId?: number): Promise<WebhookEndpoint[]> {
  const headers = await buildAuthHeaders();
  const qs = shopId ? `?shop_id=${shopId}` : "";
  const res = await fetch(apiUrl(`/webhook-endpoints${qs}`), { headers, cache: "no-store" });
  return parseResponse<WebhookEndpoint[]>(res);
}

export async function createWebhookEndpoint(body: WebhookEndpointCreate): Promise<WebhookEndpoint> {
  const headers = await buildAuthHeaders();
  headers["Content-Type"] = "application/json";
  const res = await fetch(apiUrl("/webhook-endpoints"), {
    method: "POST", headers, body: JSON.stringify(body),
  });
  return parseResponse<WebhookEndpoint>(res);
}

export async function updateWebhookEndpoint(
  id: number,
  body: Partial<WebhookEndpointCreate>,
): Promise<WebhookEndpoint> {
  const headers = await buildAuthHeaders();
  headers["Content-Type"] = "application/json";
  const res = await fetch(apiUrl(`/webhook-endpoints/${id}`), {
    method: "PATCH", headers, body: JSON.stringify(body),
  });
  return parseResponse<WebhookEndpoint>(res);
}

export async function deleteWebhookEndpoint(id: number): Promise<void> {
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl(`/webhook-endpoints/${id}`), { method: "DELETE", headers });
  if (!res.ok) throw new Error("Error al eliminar webhook endpoint");
}

export async function testWebhookEndpoint(id: number): Promise<{ success: boolean; status_code?: number; error?: string }> {
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl(`/webhook-endpoints/${id}/test`), { method: "POST", headers });
  return parseResponse(res);
}


// ---------------------------------------------------------------------------
// Inventory — Shopify sync
// ---------------------------------------------------------------------------

export async function syncInventoryFromShopify(shopId?: number): Promise<{
  shop_id: number;
  synced: number;
  created: number;
  skipped: number;
  errors: number;
  error_details: string[];
  sync_status: string;
  synced_at: string;
}> {
  const headers = await buildAuthHeaders();
  const url = shopId
    ? apiUrl(`/inventory/sync-from-shopify?shop_id=${shopId}`)
    : apiUrl("/inventory/sync-from-shopify");
  const res = await fetch(url, { method: "POST", headers });
  return parseResponse(res);
}

export async function fetchInventorySyncStatus(): Promise<
  Array<{
    shop_id: number;
    shop_name: string;
    last_synced_at: string | null;
    last_sync_status: string | null;
    last_sync_summary: Record<string, unknown> | null;
    last_error_message: string | null;
  }>
> {
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl("/inventory/sync-status"), { headers });
  return parseResponse(res);
}

// Carriers
export async function fetchAvailableCarriers(): Promise<CarrierInfo[]> {
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl("/carrier-configs/available"), { headers, cache: "no-store" });
  return parseResponse<CarrierInfo[]>(res);
}

export async function fetchCarrierConfigs(shopId?: number): Promise<CarrierConfig[]> {
  const headers = await buildAuthHeaders();
  const url = shopId ? apiUrl(`/carrier-configs?shop_id=${shopId}`) : apiUrl("/carrier-configs");
  const res = await fetch(url, { headers, cache: "no-store" });
  return parseResponse<CarrierConfig[]>(res);
}

export async function upsertCarrierConfig(body: {
  shop_id: number;
  carrier_code: string;
  is_enabled: boolean;
  config_json?: Record<string, unknown> | null;
}): Promise<CarrierConfig> {
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl("/carrier-configs"), {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return parseResponse<CarrierConfig>(res);
}


// Notifications
export async function fetchNotifications(limit = 20): Promise<Array<{
  id: number;
  action: string;
  summary: string;
  entity_type: string;
  entity_id: number;
  created_at: string | null;
  actor_name: string | null;
}>> {
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl(`/activity/notifications?limit=${limit}`), { headers, cache: "no-store" });
  return parseResponse(res);
}


// Email flows
export async function fetchEmailFlows(shopId: number): Promise<EmailFlow[]> {
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl(`/email-flows?shop_id=${shopId}`), { headers, cache: "no-store" });
  return parseResponse<EmailFlow[]>(res);
}


/* ─── SGA / Suppliers ─────────────────────────────────────────────────────── */

export async function fetchSuppliers(params?: {
  shop_id?: number;
  is_active?: boolean;
  page?: number;
  per_page?: number;
}): Promise<SupplierListResponse> {
  const query = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) query.append(k, String(v));
    });
  }
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl(`/suppliers?${query}`), { headers, cache: "no-store" });
  return parseResponse<SupplierListResponse>(res);
}

export async function fetchSupplier(id: number): Promise<Supplier> {
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl(`/suppliers/${id}`), { headers, cache: "no-store" });
  return parseResponse<Supplier>(res);
}

export async function createSupplier(payload: Partial<Supplier> & { shop_id: number; name: string }): Promise<Supplier> {
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl(`/suppliers`), {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseResponse<Supplier>(res);
}

export async function updateSupplier(id: number, payload: Partial<Supplier>): Promise<Supplier> {
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl(`/suppliers/${id}`), {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseResponse<Supplier>(res);
}

export async function deleteSupplier(id: number): Promise<void> {
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl(`/suppliers/${id}`), { method: "DELETE", headers });
  if (!res.ok) throw new Error(`Failed to delete supplier: ${res.status}`);
}

export async function fetchSupplierProducts(supplierId: number): Promise<SupplierProductListResponse> {
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl(`/suppliers/${supplierId}/products`), { headers, cache: "no-store" });
  return parseResponse<SupplierProductListResponse>(res);
}

export async function createSupplierProduct(
  supplierId: number,
  payload: Partial<SupplierProduct> & { supplier_id: number; inventory_item_id: number }
): Promise<SupplierProduct> {
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl(`/suppliers/${supplierId}/products`), {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseResponse<SupplierProduct>(res);
}

export async function updateSupplierProduct(
  supplierId: number,
  productId: number,
  payload: Partial<SupplierProduct>
): Promise<SupplierProduct> {
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl(`/suppliers/${supplierId}/products/${productId}`), {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseResponse<SupplierProduct>(res);
}

export async function deleteSupplierProduct(supplierId: number, productId: number): Promise<void> {
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl(`/suppliers/${supplierId}/products/${productId}`), {
    method: "DELETE",
    headers,
  });
  if (!res.ok) throw new Error(`Failed to delete supplier product: ${res.status}`);
}


/* ─── SGA / Purchase Orders ───────────────────────────────────────────────── */

export async function fetchPurchaseOrders(params?: {
  shop_id?: number;
  supplier_id?: number;
  status?: PurchaseOrderStatus;
  page?: number;
  per_page?: number;
}): Promise<PurchaseOrderListResponse> {
  const query = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) query.append(k, String(v));
    });
  }
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl(`/purchase-orders?${query}`), { headers, cache: "no-store" });
  return parseResponse<PurchaseOrderListResponse>(res);
}

export async function fetchPurchaseOrder(id: number): Promise<PurchaseOrder> {
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl(`/purchase-orders/${id}`), { headers, cache: "no-store" });
  return parseResponse<PurchaseOrder>(res);
}

export async function createPurchaseOrder(payload: {
  shop_id: number;
  supplier_id: number;
  expected_arrival_date?: string | null;
  notes?: string | null;
  supplier_reference?: string | null;
  currency?: string;
  tax_amount?: string | number;
  shipping_cost?: string | number;
  lines: Array<{
    inventory_item_id?: number | null;
    sku: string;
    name?: string | null;
    supplier_sku?: string | null;
    quantity_ordered: number;
    unit_cost: string | number;
    notes?: string | null;
  }>;
}): Promise<PurchaseOrder> {
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl(`/purchase-orders`), {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseResponse<PurchaseOrder>(res);
}

export async function updatePurchaseOrder(id: number, payload: Partial<PurchaseOrder>): Promise<PurchaseOrder> {
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl(`/purchase-orders/${id}`), {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseResponse<PurchaseOrder>(res);
}

export async function deletePurchaseOrder(id: number): Promise<void> {
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl(`/purchase-orders/${id}`), { method: "DELETE", headers });
  if (!res.ok) throw new Error(`Failed to delete purchase order: ${res.status}`);
}

export async function transitionPurchaseOrderStatus(
  id: number,
  status: PurchaseOrderStatus,
  notes?: string
): Promise<PurchaseOrder> {
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl(`/purchase-orders/${id}/status`), {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ status, notes }),
  });
  return parseResponse<PurchaseOrder>(res);
}

export async function receivePurchaseOrder(
  id: number,
  payload: { lines: Array<{ line_id: number; quantity_received: number }>; notes?: string | null }
): Promise<PurchaseOrder> {
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl(`/purchase-orders/${id}/receive`), {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseResponse<PurchaseOrder>(res);
}


/* ─── SGA / Replenishment ─────────────────────────────────────────────────── */

export async function fetchReplenishmentRecommendations(
  shopId: number
): Promise<ReplenishmentRecommendationsResponse> {
  const headers = await buildAuthHeaders();
  const res = await fetch(
    apiUrl(`/replenishment/recommendations?shop_id=${shopId}`),
    { headers, cache: "no-store" }
  );
  return parseResponse<ReplenishmentRecommendationsResponse>(res);
}

export async function generateReplenishmentPOs(
  shopId: number,
  inventoryItemIds?: number[]
): Promise<ReplenishmentGenerateResponse> {
  const headers = await buildAuthHeaders();
  const res = await fetch(apiUrl(`/replenishment/generate`), {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      shop_id: shopId,
      inventory_item_ids: inventoryItemIds ?? null,
    }),
  });
  return parseResponse<ReplenishmentGenerateResponse>(res);
}
