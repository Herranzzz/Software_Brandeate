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
