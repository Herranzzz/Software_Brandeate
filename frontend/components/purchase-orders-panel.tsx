"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

import { AppModal } from "@/components/app-modal";
import { Card } from "@/components/card";
import { useToast } from "@/components/toast";
import {
  createPurchaseOrderClient,
  deletePurchaseOrderClient,
} from "@/lib/api-client";
import type {
  InventoryItem,
  PurchaseOrder,
  PurchaseOrderStatus,
  Shop,
  Supplier,
  SupplierProduct,
} from "@/lib/types";

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

function fmt(value: string | number, currency = "EUR") {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (!Number.isFinite(num)) return "—";
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency,
  }).format(num);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export const PO_STATUS_META: Record<
  PurchaseOrderStatus,
  { label: string; className: string }
> = {
  draft: { label: "Borrador", className: "invoice-badge invoice-badge-draft" },
  sent: { label: "Enviada", className: "invoice-badge invoice-badge-sent" },
  confirmed: {
    label: "Confirmada",
    className: "invoice-badge invoice-badge-sent",
  },
  partially_received: {
    label: "Recepción parcial",
    className: "invoice-badge invoice-badge-sent",
  },
  received: { label: "Recibida", className: "invoice-badge invoice-badge-paid" },
  cancelled: {
    label: "Cancelada",
    className: "invoice-badge invoice-badge-cancelled",
  },
};

/* ─── New PO modal ────────────────────────────────────────────────────────── */

type LineDraft = {
  inventory_item_id: string;
  sku: string;
  name: string;
  supplier_sku: string;
  quantity_ordered: string;
  unit_cost: string;
};

const BLANK_LINE: LineDraft = {
  inventory_item_id: "",
  sku: "",
  name: "",
  supplier_sku: "",
  quantity_ordered: "1",
  unit_cost: "0",
};

function NewPOModal({
  defaultShopId,
  inventoryItems,
  shops,
  suppliers,
  onClose,
  onSaved,
}: {
  defaultShopId?: number;
  inventoryItems: InventoryItem[];
  shops: Shop[];
  suppliers: Supplier[];
  onClose: () => void;
  onSaved: (po: PurchaseOrder) => void;
}) {
  const [shopId, setShopId] = useState<string>(
    defaultShopId ? String(defaultShopId) : shops[0] ? String(shops[0].id) : "",
  );
  const [supplierId, setSupplierId] = useState<string>("");
  const [expectedArrival, setExpectedArrival] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([{ ...BLANK_LINE }]);
  const [supplierProducts, setSupplierProducts] = useState<SupplierProduct[]>(
    [],
  );
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const shopSuppliers = useMemo(
    () =>
      shopId
        ? suppliers.filter((s) => s.shop_id === Number(shopId))
        : suppliers,
    [suppliers, shopId],
  );

  // Load supplier products to prefill cost/SKU/pack when user picks an item
  useEffect(() => {
    if (!supplierId) {
      setSupplierProducts([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/suppliers/${supplierId}/products`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          products: SupplierProduct[];
          total: number;
        };
        if (!cancelled) setSupplierProducts(data.products);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supplierId]);

  const shopItems = useMemo(
    () => inventoryItems.filter((it) => String(it.shop_id) === shopId),
    [inventoryItems, shopId],
  );

  function updateLine(idx: number, field: keyof LineDraft, value: string) {
    setLines((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };

      // When inventory_item_id changes: prefill sku/name + cost/supplier_sku from supplier_product
      if (field === "inventory_item_id" && value) {
        const item = inventoryItems.find((i) => String(i.id) === value);
        if (item) {
          next[idx].sku = item.sku;
          next[idx].name = item.name;
        }
        const sp = supplierProducts.find(
          (p) => String(p.inventory_item_id) === value,
        );
        if (sp) {
          if (sp.cost_price) next[idx].unit_cost = sp.cost_price;
          if (sp.supplier_sku) next[idx].supplier_sku = sp.supplier_sku;
          if (sp.moq && Number(next[idx].quantity_ordered) < sp.moq) {
            next[idx].quantity_ordered = String(sp.moq);
          }
        }
      }
      return next;
    });
  }

  function addLine() {
    setLines((prev) => [...prev, { ...BLANK_LINE }]);
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  const subtotal = lines.reduce(
    (s, l) =>
      s + (parseFloat(l.quantity_ordered) || 0) * (parseFloat(l.unit_cost) || 0),
    0,
  );

  function handleCreate() {
    if (!shopId) {
      setError("Selecciona un cliente.");
      return;
    }
    if (!supplierId) {
      setError("Selecciona un proveedor.");
      return;
    }
    const validLines = lines.filter(
      (l) => l.sku.trim() && Number(l.quantity_ordered) > 0,
    );
    if (validLines.length === 0) {
      setError("Añade al menos una línea con SKU y cantidad.");
      return;
    }
    setError(null);

    startTransition(async () => {
      try {
        const po = await createPurchaseOrderClient({
          shop_id: Number(shopId),
          supplier_id: Number(supplierId),
          expected_arrival_date: expectedArrival || null,
          notes: notes.trim() || null,
          lines: validLines.map((l) => ({
            inventory_item_id: l.inventory_item_id
              ? Number(l.inventory_item_id)
              : null,
            sku: l.sku.trim(),
            name: l.name.trim() || null,
            quantity_ordered: Number(l.quantity_ordered),
            unit_cost: l.unit_cost,
          })),
        });
        onSaved(po);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al crear");
      }
    });
  }

  const selectedSupplier = suppliers.find((s) => String(s.id) === supplierId);
  const currency = selectedSupplier?.currency ?? "EUR";

  return (
    <AppModal onClose={onClose} open title="Nueva orden de compra" width="wide">
      <div className="invoice-form-body">
        <div className="invoice-form-section">
          <span className="eyebrow">Datos</span>
          <div className="invoice-form-grid">
            <div className="form-field">
              <label className="form-label">Cliente *</label>
              <select
                className="form-input form-select"
                onChange={(e) => {
                  setShopId(e.target.value);
                  setSupplierId("");
                }}
                value={shopId}
              >
                <option value="">Selecciona…</option>
                {shops.map((s) => (
                  <option key={s.id} value={String(s.id)}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label className="form-label">Proveedor *</label>
              <select
                className="form-input form-select"
                onChange={(e) => setSupplierId(e.target.value)}
                value={supplierId}
              >
                <option value="">Selecciona…</option>
                {shopSuppliers.map((s) => (
                  <option key={s.id} value={String(s.id)}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label className="form-label">Llegada prevista</label>
              <input
                className="form-input"
                onChange={(e) => setExpectedArrival(e.target.value)}
                type="date"
                value={expectedArrival}
              />
            </div>
            <div className="form-field invoice-form-full">
              <label className="form-label">Notas</label>
              <textarea
                className="form-input"
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                value={notes}
              />
            </div>
          </div>
        </div>

        <div className="invoice-form-section">
          <span className="eyebrow">Líneas</span>
          <div className="invoice-lines-table">
            <div className="invoice-lines-header">
              <span>SKU</span>
              <span>Cant.</span>
              <span>Coste uds.</span>
              <span>Subtotal</span>
              <span />
            </div>
            {lines.map((l, idx) => {
              const lineTotal =
                (parseFloat(l.quantity_ordered) || 0) *
                (parseFloat(l.unit_cost) || 0);
              return (
                <div className="invoice-line-row" key={idx}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {shopItems.length > 0 ? (
                      <select
                        className="form-input"
                        onChange={(e) =>
                          updateLine(idx, "inventory_item_id", e.target.value)
                        }
                        value={l.inventory_item_id}
                      >
                        <option value="">— Selecciona SKU —</option>
                        {shopItems.map((it) => (
                          <option key={it.id} value={String(it.id)}>
                            {it.sku} — {it.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="form-input"
                        onChange={(e) => updateLine(idx, "sku", e.target.value)}
                        placeholder="SKU"
                        value={l.sku}
                      />
                    )}
                    {l.name && (
                      <span className="table-secondary" style={{ fontSize: 12 }}>
                        {l.name}
                      </span>
                    )}
                  </div>
                  <input
                    className="form-input invoice-line-num"
                    min="1"
                    onChange={(e) =>
                      updateLine(idx, "quantity_ordered", e.target.value)
                    }
                    step="1"
                    type="number"
                    value={l.quantity_ordered}
                  />
                  <input
                    className="form-input invoice-line-num"
                    min="0"
                    onChange={(e) => updateLine(idx, "unit_cost", e.target.value)}
                    step="0.01"
                    type="number"
                    value={l.unit_cost}
                  />
                  <span className="invoice-line-total">
                    {fmt(lineTotal, currency)}
                  </span>
                  <button
                    aria-label="Eliminar línea"
                    className="invoice-line-remove"
                    disabled={lines.length === 1}
                    onClick={() => removeLine(idx)}
                    type="button"
                  >
                    ×
                  </button>
                </div>
              );
            })}
            <button
              className="invoice-add-line-btn"
              onClick={addLine}
              type="button"
            >
              + Añadir línea
            </button>
          </div>

          <div className="invoice-form-totals">
            <div className="invoice-form-total-row invoice-form-total-grand">
              <span>Total estimado</span>
              <strong>{fmt(subtotal, currency)}</strong>
            </div>
          </div>
        </div>

        {error && <p className="form-error">{error}</p>}

        <div className="modal-actions">
          <button className="button-secondary" onClick={onClose} type="button">
            Cancelar
          </button>
          <button
            className="button-primary"
            disabled={isPending}
            onClick={handleCreate}
            type="button"
          >
            {isPending ? "Creando…" : "Crear orden"}
          </button>
        </div>
      </div>
    </AppModal>
  );
}

/* ─── Main panel ──────────────────────────────────────────────────────────── */

type PurchaseOrdersPanelProps = {
  initialPurchaseOrders: PurchaseOrder[];
  initialStatus?: PurchaseOrderStatus;
  initialSupplierId?: number;
  inventoryItems: InventoryItem[];
  shopId?: number;
  shops: Shop[];
  suppliers: Supplier[];
};

export function PurchaseOrdersPanel({
  initialPurchaseOrders,
  initialStatus,
  initialSupplierId,
  inventoryItems,
  shopId,
  shops,
  suppliers,
}: PurchaseOrdersPanelProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [orders, setOrders] = useState<PurchaseOrder[]>(initialPurchaseOrders);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<PurchaseOrderStatus | "">(
    initialStatus ?? "",
  );
  const [supplierFilter, setSupplierFilter] = useState<string>(
    initialSupplierId ? String(initialSupplierId) : "",
  );
  const [, startTransition] = useTransition();

  const supplierMap = useMemo(
    () => new Map(suppliers.map((s) => [s.id, s.name])),
    [suppliers],
  );
  const shopMap = useMemo(
    () => new Map(shops.map((s) => [s.id, s.name])),
    [shops],
  );

  const filtered = useMemo(() => {
    let list = orders;
    if (status) list = list.filter((po) => po.status === status);
    if (supplierFilter) {
      const sid = Number(supplierFilter);
      list = list.filter((po) => po.supplier_id === sid);
    }
    const lower = search.trim().toLowerCase();
    if (lower) {
      list = list.filter(
        (po) =>
          po.po_number.toLowerCase().includes(lower) ||
          (supplierMap.get(po.supplier_id) ?? "")
            .toLowerCase()
            .includes(lower) ||
          (po.supplier_reference ?? "").toLowerCase().includes(lower),
      );
    }
    return list;
  }, [orders, status, supplierFilter, search, supplierMap]);

  // KPIs
  const kpiDraft = orders.filter((o) => o.status === "draft").length;
  const kpiOpen = orders.filter(
    (o) =>
      o.status === "sent" ||
      o.status === "confirmed" ||
      o.status === "partially_received",
  ).length;
  const kpiOpenValue = orders
    .filter(
      (o) =>
        o.status === "sent" ||
        o.status === "confirmed" ||
        o.status === "partially_received",
    )
    .reduce((s, o) => s + parseFloat(o.total), 0);

  function handleCreated(po: PurchaseOrder) {
    setOrders((prev) => [po, ...prev]);
    setCreating(false);
    toast("Orden creada", "success");
    router.refresh();
  }

  function handleDelete(po: PurchaseOrder) {
    if (po.status !== "draft") {
      toast(
        "Solo se pueden eliminar órdenes en borrador. Cancélala primero.",
        "warning",
      );
      return;
    }
    if (!confirm(`¿Eliminar ${po.po_number}?`)) return;
    startTransition(async () => {
      try {
        await deletePurchaseOrderClient(po.id);
        setOrders((prev) => prev.filter((x) => x.id !== po.id));
        toast("Orden eliminada", "info");
        router.refresh();
      } catch (e) {
        toast(e instanceof Error ? e.message : "Error", "error");
      }
    });
  }

  return (
    <>
      <div className="invoice-kpi-strip">
        <div className="invoice-kpi-card">
          <span className="invoice-kpi-label">Borradores</span>
          <strong className="invoice-kpi-value">{kpiDraft}</strong>
        </div>
        <div className="invoice-kpi-card invoice-kpi-card-accent">
          <span className="invoice-kpi-label">Abiertas</span>
          <strong className="invoice-kpi-value">{kpiOpen}</strong>
        </div>
        <div className="invoice-kpi-card invoice-kpi-card-green">
          <span className="invoice-kpi-label">Valor comprometido</span>
          <strong className="invoice-kpi-value">{fmt(kpiOpenValue)}</strong>
        </div>
      </div>

      <Card className="stack table-card">
        <div className="table-header">
          <div className="table-filters">
            <input
              className="form-input table-search"
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por número, proveedor…"
              type="search"
              value={search}
            />
            <select
              className="form-input form-select"
              onChange={(e) =>
                setStatus(e.target.value as PurchaseOrderStatus | "")
              }
              value={status}
            >
              <option value="">Todos los estados</option>
              <option value="draft">Borrador</option>
              <option value="sent">Enviada</option>
              <option value="confirmed">Confirmada</option>
              <option value="partially_received">Parcial</option>
              <option value="received">Recibida</option>
              <option value="cancelled">Cancelada</option>
            </select>
            {suppliers.length > 0 && (
              <select
                className="form-input form-select"
                onChange={(e) => setSupplierFilter(e.target.value)}
                value={supplierFilter}
              >
                <option value="">Todos los proveedores</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={String(s.id)}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <span className="table-count">{filtered.length} órdenes</span>
            <button
              className="button-primary"
              onClick={() => setCreating(true)}
              type="button"
            >
              Nueva orden
            </button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="table-empty">
            <p>No hay órdenes de compra.</p>
            <button
              className="button-primary"
              onClick={() => setCreating(true)}
              type="button"
            >
              Crear primera orden
            </button>
          </div>
        ) : (
          <div className="sga-table-wrap">
            <table className="sga-table">
              <thead>
                <tr>
                  <th>Número</th>
                  <th>Proveedor</th>
                  <th>Cliente</th>
                  <th>Llegada</th>
                  <th className="num">Uds.</th>
                  <th className="num">Total</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((po) => {
                  const meta = PO_STATUS_META[po.status];
                  return (
                    <tr key={po.id}>
                      <td>
                        <Link
                          className="table-link table-primary"
                          href={`/purchase-orders/${po.id}`}
                        >
                          {po.po_number}
                        </Link>
                        {po.auto_generated && (
                          <div
                            className="table-secondary"
                            style={{ fontSize: 11 }}
                          >
                            Generada auto.
                          </div>
                        )}
                      </td>
                      <td>
                        {po.supplier_name ??
                          supplierMap.get(po.supplier_id) ??
                          `#${po.supplier_id}`}
                      </td>
                      <td>
                        <span className="table-secondary">
                          {shopMap.get(po.shop_id) ?? `#${po.shop_id}`}
                        </span>
                      </td>
                      <td>{formatDate(po.expected_arrival_date)}</td>
                      <td className="num">
                        {po.total_quantity_received}/{po.total_quantity_ordered}
                      </td>
                      <td className="num">{fmt(po.total, po.currency)}</td>
                      <td>
                        <span className={meta.className}>{meta.label}</span>
                      </td>
                      <td className="actions">
                        <Link
                          className="button-secondary table-action"
                          href={`/purchase-orders/${po.id}`}
                        >
                          Abrir
                        </Link>
                        {po.status === "draft" && (
                          <button
                            className="button-ghost table-action"
                            onClick={() => handleDelete(po)}
                            type="button"
                          >
                            Eliminar
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {creating && (
        <NewPOModal
          defaultShopId={shopId}
          inventoryItems={inventoryItems}
          onClose={() => setCreating(false)}
          onSaved={handleCreated}
          shops={shops}
          suppliers={suppliers}
        />
      )}
    </>
  );
}
