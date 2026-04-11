/**
 * Browser-safe API helpers for use inside "use client" components.
 *
 * Unlike lib/api.ts (which uses next/headers and only runs on the server),
 * this module reads the auth_token from document.cookie so it can be bundled
 * and executed in the browser.
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

function clientApiUrl(path: string): string {
  const base = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

function getAuthToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)auth_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function buildClientHeaders(): Record<string, string> {
  const token = getAuthToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

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
  const res = await fetch(clientApiUrl(`/inventory/items/${id}/adjust`), {
    method: "POST",
    headers: buildClientHeaders(),
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
  const res = await fetch(clientApiUrl("/inventory/inbound"), {
    method: "POST",
    headers: buildClientHeaders(),
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
  const res = await fetch(clientApiUrl(`/inventory/inbound/${id}`), {
    method: "PATCH",
    headers: buildClientHeaders(),
    body: JSON.stringify(data),
  });
  return parseClientResponse<InboundShipment>(res);
}

export async function addInboundShipmentLine(
  shipmentId: number,
  data: { sku: string; name?: string | null; qty_expected: number; notes?: string | null },
): Promise<InboundShipmentLine> {
  const res = await fetch(clientApiUrl(`/inventory/inbound/${shipmentId}/lines`), {
    method: "POST",
    headers: buildClientHeaders(),
    body: JSON.stringify(data),
  });
  return parseClientResponse<InboundShipmentLine>(res);
}

export async function deleteInboundShipmentLine(
  shipmentId: number,
  lineId: number,
): Promise<void> {
  const headers = buildClientHeaders();
  delete headers["Content-Type"]; // no body on DELETE
  await fetch(clientApiUrl(`/inventory/inbound/${shipmentId}/lines/${lineId}`), {
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
  },
): Promise<InboundShipment> {
  const res = await fetch(clientApiUrl(`/inventory/inbound/${shipmentId}/receive`), {
    method: "POST",
    headers: buildClientHeaders(),
    body: JSON.stringify(data),
  });
  return parseClientResponse<InboundShipment>(res);
}

// ── Catalog → Inventory sync ──────────────────────────────────────────────────

export async function syncInventoryFromCatalog(
  shopId: number,
): Promise<CatalogSyncResult> {
  const headers = buildClientHeaders();
  delete headers["Content-Type"];
  const res = await fetch(
    clientApiUrl(`/inventory/sync-from-catalog?shop_id=${shopId}`),
    { method: "POST", headers },
  );
  return parseClientResponse<CatalogSyncResult>(res);
}
