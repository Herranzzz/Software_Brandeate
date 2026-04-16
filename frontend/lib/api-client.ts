/**
 * Browser-safe API helpers for use inside "use client" components.
 *
 * All calls go through Next.js API route handlers (/api/inventory/...)
 * so the httpOnly auth_token cookie is forwarded automatically by the browser
 * without any JavaScript access to the cookie.
 */

import type {
  InventoryItem,
  InboundShipment,
  InboundShipmentLine,
  Supplier,
  SupplierProduct,
  PurchaseOrder,
  PurchaseOrderStatus,
  ReplenishmentGenerateResponse,
} from "@/lib/types";

export type CatalogSyncResult = {
  created: number;
  already_existed: number;
  skipped_no_sku: number;
  total_variants: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function parseClientResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail: string | null = null;
    try {
      const ct = res.headers.get("Content-Type") ?? "";
      if (ct.includes("application/json")) {
        const payload = (await res.json()) as { detail?: unknown } | null;
        if (payload && typeof payload.detail === "string") detail = payload.detail;
        else if (payload?.detail !== undefined) detail = JSON.stringify(payload.detail);
      } else {
        const text = (await res.text()).trim();
        if (text) detail = text;
      }
    } catch { /* ignore */ }
    throw new Error(detail ?? `API error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Inventory items ───────────────────────────────────────────────────────────

export async function adjustInventoryStock(
  id: number,
  data: { qty_delta: number; movement_type: string; notes?: string | null },
): Promise<InventoryItem> {
  const res = await fetch(`/api/inventory/items/${id}/adjust`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return parseClientResponse<InventoryItem>(res);
}

export async function updateInventoryItemClient(
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
  }>,
): Promise<InventoryItem> {
  const res = await fetch(`/api/inventory/items/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return parseClientResponse<InventoryItem>(res);
}

// ── Inbound shipments ─────────────────────────────────────────────────────────

export async function createInboundShipment(data: {
  shop_id: number;
  reference: string;
  expected_arrival?: string | null;
  carrier?: string | null;
  tracking_number?: string | null;
  notes?: string | null;
}): Promise<InboundShipment> {
  const res = await fetch("/api/inventory/inbound", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return parseClientResponse<InboundShipment>(res);
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
  }>,
): Promise<InboundShipment> {
  const res = await fetch(`/api/inventory/inbound/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return parseClientResponse<InboundShipment>(res);
}

export async function addInboundShipmentLine(
  shipmentId: number,
  data: { sku: string; name?: string | null; qty_expected: number; notes?: string | null },
): Promise<InboundShipmentLine> {
  const res = await fetch(`/api/inventory/inbound/${shipmentId}/lines`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return parseClientResponse<InboundShipmentLine>(res);
}

export async function deleteInboundShipmentLine(
  shipmentId: number,
  lineId: number,
): Promise<void> {
  await fetch(`/api/inventory/inbound/${shipmentId}/lines/${lineId}`, {
    method: "DELETE",
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
  },
): Promise<InboundShipment> {
  const res = await fetch(`/api/inventory/inbound/${shipmentId}/receive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return parseClientResponse<InboundShipment>(res);
}

// ── Catalog → Inventory sync ──────────────────────────────────────────────────

export async function syncInventoryFromCatalog(
  shopId: number,
): Promise<CatalogSyncResult> {
  const res = await fetch(
    `/api/inventory/sync-from-catalog?shop_id=${shopId}`,
    { method: "POST" },
  );
  return parseClientResponse<CatalogSyncResult>(res);
}

// ── Shopify → Inventory stock sync ───────────────────────────────────────────

export type ShopifyInventorySyncResult = {
  shop_id: number;
  synced: number;
  created: number;
  skipped: number;
  errors: number;
  error_details: string[];
  sync_status: string;
  synced_at: string;
};

export async function syncInventoryFromShopify(
  shopId?: number,
): Promise<ShopifyInventorySyncResult> {
  const url = shopId
    ? `/api/inventory/sync-from-shopify?shop_id=${shopId}`
    : `/api/inventory/sync-from-shopify`;
  const res = await fetch(url, { method: "POST" });
  return parseClientResponse<ShopifyInventorySyncResult>(res);
}

// ── SGA / Suppliers ───────────────────────────────────────────────────────────

export async function createSupplierClient(payload: {
  shop_id: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  contact_name?: string | null;
  lead_time_days?: number;
  currency?: string;
  notes?: string | null;
  [k: string]: unknown;
}): Promise<Supplier> {
  const res = await fetch("/api/suppliers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseClientResponse<Supplier>(res);
}

export async function updateSupplierClient(
  id: number,
  payload: Partial<Supplier>,
): Promise<Supplier> {
  const res = await fetch(`/api/suppliers/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseClientResponse<Supplier>(res);
}

export async function deleteSupplierClient(id: number): Promise<void> {
  const res = await fetch(`/api/suppliers/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Failed to delete supplier (${res.status})`);
  }
}

export async function createSupplierProductClient(
  supplierId: number,
  payload: {
    supplier_id: number;
    inventory_item_id: number;
    cost_price?: string | number | null;
    supplier_sku?: string | null;
    moq?: number;
    pack_size?: number;
    is_primary?: boolean;
  },
): Promise<SupplierProduct> {
  const res = await fetch(`/api/suppliers/${supplierId}/products`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseClientResponse<SupplierProduct>(res);
}

export async function updateSupplierProductClient(
  supplierId: number,
  productId: number,
  payload: Partial<SupplierProduct>,
): Promise<SupplierProduct> {
  const res = await fetch(`/api/suppliers/${supplierId}/products/${productId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseClientResponse<SupplierProduct>(res);
}

export async function deleteSupplierProductClient(
  supplierId: number,
  productId: number,
): Promise<void> {
  const res = await fetch(`/api/suppliers/${supplierId}/products/${productId}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Failed to delete (${res.status})`);
  }
}

// ── SGA / Purchase Orders ─────────────────────────────────────────────────────

export async function createPurchaseOrderClient(payload: {
  shop_id: number;
  supplier_id: number;
  expected_arrival_date?: string | null;
  notes?: string | null;
  lines: Array<{
    inventory_item_id?: number | null;
    sku: string;
    name?: string | null;
    quantity_ordered: number;
    unit_cost: string | number;
  }>;
}): Promise<PurchaseOrder> {
  const res = await fetch("/api/purchase-orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseClientResponse<PurchaseOrder>(res);
}

export async function updatePurchaseOrderClient(
  id: number,
  payload: Partial<PurchaseOrder>,
): Promise<PurchaseOrder> {
  const res = await fetch(`/api/purchase-orders/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseClientResponse<PurchaseOrder>(res);
}

export async function deletePurchaseOrderClient(id: number): Promise<void> {
  const res = await fetch(`/api/purchase-orders/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Failed to delete (${res.status})`);
  }
}

export async function transitionPurchaseOrderStatusClient(
  id: number,
  status: PurchaseOrderStatus,
  notes?: string,
): Promise<PurchaseOrder> {
  const res = await fetch(`/api/purchase-orders/${id}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, notes }),
  });
  return parseClientResponse<PurchaseOrder>(res);
}

export async function receivePurchaseOrderClient(
  id: number,
  payload: {
    lines: Array<{ line_id: number; quantity_received: number }>;
    notes?: string | null;
  },
): Promise<PurchaseOrder> {
  const res = await fetch(`/api/purchase-orders/${id}/receive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseClientResponse<PurchaseOrder>(res);
}

// ── SGA / Replenishment ───────────────────────────────────────────────────────

export async function generateReplenishmentPOsClient(
  shopId: number,
  inventoryItemIds?: number[],
): Promise<ReplenishmentGenerateResponse> {
  const res = await fetch("/api/replenishment/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      shop_id: shopId,
      inventory_item_ids: inventoryItemIds ?? null,
    }),
  });
  return parseClientResponse<ReplenishmentGenerateResponse>(res);
}
