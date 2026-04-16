"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { AppModal } from "@/components/app-modal";
import { Card } from "@/components/card";
import { useToast } from "@/components/toast";
import {
  createSupplierClient,
  createSupplierProductClient,
  deleteSupplierClient,
  deleteSupplierProductClient,
  updateSupplierClient,
  updateSupplierProductClient,
} from "@/lib/api-client";
import type {
  InventoryItem,
  Shop,
  Supplier,
  SupplierProduct,
} from "@/lib/types";

/* ─── Types ───────────────────────────────────────────────────────────────── */

type SupplierFormState = {
  shop_id: string;
  name: string;
  email: string;
  phone: string;
  contact_name: string;
  website: string;
  tax_id: string;
  address_line1: string;
  address_line2: string;
  city: string;
  province: string;
  postal_code: string;
  country_code: string;
  lead_time_days: string;
  payment_terms: string;
  currency: string;
  minimum_order_value: string;
  notes: string;
  is_active: boolean;
};

type ProductFormState = {
  inventory_item_id: string;
  supplier_sku: string;
  cost_price: string;
  moq: string;
  pack_size: string;
  lead_time_days_override: string;
  is_primary: boolean;
  notes: string;
};

const BLANK_SUPPLIER: SupplierFormState = {
  shop_id: "",
  name: "",
  email: "",
  phone: "",
  contact_name: "",
  website: "",
  tax_id: "",
  address_line1: "",
  address_line2: "",
  city: "",
  province: "",
  postal_code: "",
  country_code: "",
  lead_time_days: "7",
  payment_terms: "",
  currency: "EUR",
  minimum_order_value: "",
  notes: "",
  is_active: true,
};

const BLANK_PRODUCT: ProductFormState = {
  inventory_item_id: "",
  supplier_sku: "",
  cost_price: "",
  moq: "1",
  pack_size: "1",
  lead_time_days_override: "",
  is_primary: false,
  notes: "",
};

function supplierToForm(s: Supplier): SupplierFormState {
  return {
    shop_id: String(s.shop_id),
    name: s.name,
    email: s.email ?? "",
    phone: s.phone ?? "",
    contact_name: s.contact_name ?? "",
    website: s.website ?? "",
    tax_id: s.tax_id ?? "",
    address_line1: s.address_line1 ?? "",
    address_line2: s.address_line2 ?? "",
    city: s.city ?? "",
    province: s.province ?? "",
    postal_code: s.postal_code ?? "",
    country_code: s.country_code ?? "",
    lead_time_days: String(s.lead_time_days ?? 7),
    payment_terms: s.payment_terms ?? "",
    currency: s.currency ?? "EUR",
    minimum_order_value: s.minimum_order_value ?? "",
    notes: s.notes ?? "",
    is_active: s.is_active,
  };
}

/* ─── Supplier form modal ─────────────────────────────────────────────────── */

function SupplierFormModal({
  editing,
  defaultShopId,
  shops,
  onClose,
  onSaved,
}: {
  editing: Supplier | null;
  defaultShopId?: number;
  shops: Shop[];
  onClose: () => void;
  onSaved: (s: Supplier) => void;
}) {
  const [form, setForm] = useState<SupplierFormState>(() => {
    if (editing) return supplierToForm(editing);
    return {
      ...BLANK_SUPPLIER,
      shop_id: defaultShopId
        ? String(defaultShopId)
        : shops[0]
          ? String(shops[0].id)
          : "",
    };
  });
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isEditing = editing !== null;

  function setField<K extends keyof SupplierFormState>(
    key: K,
    value: SupplierFormState[K],
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    if (!form.name.trim()) {
      setError("El nombre es obligatorio.");
      return;
    }
    if (!form.shop_id) {
      setError("Selecciona un cliente.");
      return;
    }
    setError(null);

    startTransition(async () => {
      try {
        const basePayload = {
          name: form.name.trim(),
          email: form.email.trim() || null,
          phone: form.phone.trim() || null,
          contact_name: form.contact_name.trim() || null,
          website: form.website.trim() || null,
          tax_id: form.tax_id.trim() || null,
          address_line1: form.address_line1.trim() || null,
          address_line2: form.address_line2.trim() || null,
          city: form.city.trim() || null,
          province: form.province.trim() || null,
          postal_code: form.postal_code.trim() || null,
          country_code: form.country_code.trim() || null,
          lead_time_days: parseInt(form.lead_time_days, 10) || 7,
          payment_terms: form.payment_terms.trim() || null,
          currency: form.currency.trim().toUpperCase() || "EUR",
          minimum_order_value: form.minimum_order_value.trim() || null,
          notes: form.notes.trim() || null,
          is_active: form.is_active,
        };

        const saved = isEditing
          ? await updateSupplierClient(editing.id, basePayload)
          : await createSupplierClient({
              shop_id: Number(form.shop_id),
              ...basePayload,
            });

        onSaved(saved);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al guardar");
      }
    });
  }

  return (
    <AppModal
      onClose={onClose}
      open
      title={isEditing ? `Editar ${editing.name}` : "Nuevo proveedor"}
      width="wide"
    >
      <div className="invoice-form-body">
        <div className="invoice-form-section">
          <span className="eyebrow">Datos básicos</span>
          <div className="invoice-form-grid">
            {!isEditing && (
              <div className="form-field">
                <label className="form-label">Cliente *</label>
                <select
                  className="form-input form-select"
                  onChange={(e) => setField("shop_id", e.target.value)}
                  value={form.shop_id}
                >
                  <option value="">Selecciona un cliente…</option>
                  {shops.map((s) => (
                    <option key={s.id} value={String(s.id)}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="form-field">
              <label className="form-label">Nombre *</label>
              <input
                className="form-input"
                onChange={(e) => setField("name", e.target.value)}
                value={form.name}
              />
            </div>
            <div className="form-field">
              <label className="form-label">Contacto</label>
              <input
                className="form-input"
                onChange={(e) => setField("contact_name", e.target.value)}
                value={form.contact_name}
              />
            </div>
            <div className="form-field">
              <label className="form-label">Email</label>
              <input
                className="form-input"
                onChange={(e) => setField("email", e.target.value)}
                type="email"
                value={form.email}
              />
            </div>
            <div className="form-field">
              <label className="form-label">Teléfono</label>
              <input
                className="form-input"
                onChange={(e) => setField("phone", e.target.value)}
                value={form.phone}
              />
            </div>
            <div className="form-field">
              <label className="form-label">Web</label>
              <input
                className="form-input"
                onChange={(e) => setField("website", e.target.value)}
                placeholder="https://"
                value={form.website}
              />
            </div>
            <div className="form-field">
              <label className="form-label">NIF/CIF</label>
              <input
                className="form-input"
                onChange={(e) => setField("tax_id", e.target.value)}
                value={form.tax_id}
              />
            </div>
          </div>
        </div>

        <div className="invoice-form-section">
          <span className="eyebrow">Dirección</span>
          <div className="invoice-form-grid">
            <div className="form-field invoice-form-full">
              <label className="form-label">Dirección</label>
              <input
                className="form-input"
                onChange={(e) => setField("address_line1", e.target.value)}
                value={form.address_line1}
              />
            </div>
            <div className="form-field invoice-form-full">
              <label className="form-label">Dirección 2</label>
              <input
                className="form-input"
                onChange={(e) => setField("address_line2", e.target.value)}
                value={form.address_line2}
              />
            </div>
            <div className="form-field">
              <label className="form-label">Ciudad</label>
              <input
                className="form-input"
                onChange={(e) => setField("city", e.target.value)}
                value={form.city}
              />
            </div>
            <div className="form-field">
              <label className="form-label">Provincia</label>
              <input
                className="form-input"
                onChange={(e) => setField("province", e.target.value)}
                value={form.province}
              />
            </div>
            <div className="form-field">
              <label className="form-label">Código postal</label>
              <input
                className="form-input"
                onChange={(e) => setField("postal_code", e.target.value)}
                value={form.postal_code}
              />
            </div>
            <div className="form-field">
              <label className="form-label">País (ISO 2)</label>
              <input
                className="form-input"
                maxLength={2}
                onChange={(e) =>
                  setField("country_code", e.target.value.toUpperCase())
                }
                placeholder="ES"
                value={form.country_code}
              />
            </div>
          </div>
        </div>

        <div className="invoice-form-section">
          <span className="eyebrow">Condiciones comerciales</span>
          <div className="invoice-form-grid">
            <div className="form-field">
              <label className="form-label">Plazo de entrega (días)</label>
              <input
                className="form-input"
                min="0"
                onChange={(e) => setField("lead_time_days", e.target.value)}
                type="number"
                value={form.lead_time_days}
              />
            </div>
            <div className="form-field">
              <label className="form-label">Moneda</label>
              <input
                className="form-input"
                maxLength={3}
                onChange={(e) =>
                  setField("currency", e.target.value.toUpperCase())
                }
                value={form.currency}
              />
            </div>
            <div className="form-field">
              <label className="form-label">Condiciones de pago</label>
              <input
                className="form-input"
                onChange={(e) => setField("payment_terms", e.target.value)}
                placeholder="30 días, contado…"
                value={form.payment_terms}
              />
            </div>
            <div className="form-field">
              <label className="form-label">Pedido mínimo</label>
              <input
                className="form-input"
                min="0"
                onChange={(e) =>
                  setField("minimum_order_value", e.target.value)
                }
                step="0.01"
                type="number"
                value={form.minimum_order_value}
              />
            </div>
            <div className="form-field invoice-form-full">
              <label
                className="form-label"
                style={{ display: "flex", gap: 8, alignItems: "center" }}
              >
                <input
                  checked={form.is_active}
                  onChange={(e) => setField("is_active", e.target.checked)}
                  type="checkbox"
                />
                <span>Proveedor activo</span>
              </label>
            </div>
            <div className="form-field invoice-form-full">
              <label className="form-label">Notas</label>
              <textarea
                className="form-input"
                onChange={(e) => setField("notes", e.target.value)}
                rows={3}
                value={form.notes}
              />
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
            onClick={handleSave}
            type="button"
          >
            {isPending
              ? "Guardando…"
              : isEditing
                ? "Guardar cambios"
                : "Crear proveedor"}
          </button>
        </div>
      </div>
    </AppModal>
  );
}

/* ─── Product-link modal ──────────────────────────────────────────────────── */

function ProductFormModal({
  supplier,
  editing,
  inventoryItems,
  onClose,
  onSaved,
}: {
  supplier: Supplier;
  editing: SupplierProduct | null;
  inventoryItems: InventoryItem[];
  onClose: () => void;
  onSaved: (p: SupplierProduct) => void;
}) {
  const [form, setForm] = useState<ProductFormState>(() =>
    editing
      ? {
          inventory_item_id: String(editing.inventory_item_id),
          supplier_sku: editing.supplier_sku ?? "",
          cost_price: editing.cost_price ?? "",
          moq: String(editing.moq ?? 1),
          pack_size: String(editing.pack_size ?? 1),
          lead_time_days_override:
            editing.lead_time_days_override != null
              ? String(editing.lead_time_days_override)
              : "",
          is_primary: editing.is_primary,
          notes: editing.notes ?? "",
        }
      : BLANK_PRODUCT,
  );
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const shopItems = useMemo(
    () => inventoryItems.filter((it) => it.shop_id === supplier.shop_id),
    [inventoryItems, supplier.shop_id],
  );

  const isEditing = editing !== null;

  function setField<K extends keyof ProductFormState>(
    key: K,
    value: ProductFormState[K],
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    if (!form.inventory_item_id) {
      setError("Selecciona un SKU.");
      return;
    }
    setError(null);

    const invId = Number(form.inventory_item_id);

    startTransition(async () => {
      try {
        const basePayload = {
          supplier_sku: form.supplier_sku.trim() || null,
          cost_price: form.cost_price.trim() || null,
          moq: parseInt(form.moq, 10) || 1,
          pack_size: parseInt(form.pack_size, 10) || 1,
          lead_time_days_override: form.lead_time_days_override.trim()
            ? parseInt(form.lead_time_days_override, 10)
            : null,
          is_primary: form.is_primary,
          notes: form.notes.trim() || null,
        };

        const saved = isEditing
          ? await updateSupplierProductClient(
              supplier.id,
              editing.id,
              basePayload,
            )
          : await createSupplierProductClient(supplier.id, {
              supplier_id: supplier.id,
              inventory_item_id: invId,
              ...basePayload,
            });

        onSaved(saved);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al guardar");
      }
    });
  }

  return (
    <AppModal
      onClose={onClose}
      open
      title={isEditing ? "Editar producto" : "Vincular producto"}
    >
      <div className="stack" style={{ gap: 16 }}>
        <div className="form-field">
          <label className="form-label">SKU *</label>
          {isEditing ? (
            <input
              className="form-input"
              disabled
              value={editing.inventory_item_sku ?? String(editing.inventory_item_id)}
            />
          ) : (
            <select
              className="form-input form-select"
              onChange={(e) => setField("inventory_item_id", e.target.value)}
              value={form.inventory_item_id}
            >
              <option value="">Selecciona un SKU…</option>
              {shopItems.map((it) => (
                <option key={it.id} value={String(it.id)}>
                  {it.sku} — {it.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="invoice-form-grid">
          <div className="form-field">
            <label className="form-label">SKU del proveedor</label>
            <input
              className="form-input"
              onChange={(e) => setField("supplier_sku", e.target.value)}
              value={form.supplier_sku}
            />
          </div>
          <div className="form-field">
            <label className="form-label">Precio de compra</label>
            <input
              className="form-input"
              min="0"
              onChange={(e) => setField("cost_price", e.target.value)}
              step="0.01"
              type="number"
              value={form.cost_price}
            />
          </div>
          <div className="form-field">
            <label className="form-label">MOQ (pedido mínimo uds.)</label>
            <input
              className="form-input"
              min="1"
              onChange={(e) => setField("moq", e.target.value)}
              type="number"
              value={form.moq}
            />
          </div>
          <div className="form-field">
            <label className="form-label">Múltiplo de pack</label>
            <input
              className="form-input"
              min="1"
              onChange={(e) => setField("pack_size", e.target.value)}
              type="number"
              value={form.pack_size}
            />
          </div>
          <div className="form-field">
            <label className="form-label">Plazo override (días)</label>
            <input
              className="form-input"
              min="0"
              onChange={(e) =>
                setField("lead_time_days_override", e.target.value)
              }
              placeholder={`Usa ${supplier.lead_time_days}`}
              type="number"
              value={form.lead_time_days_override}
            />
          </div>
          <div className="form-field">
            <label
              className="form-label"
              style={{ display: "flex", gap: 8, alignItems: "center" }}
            >
              <input
                checked={form.is_primary}
                onChange={(e) => setField("is_primary", e.target.checked)}
                type="checkbox"
              />
              <span>Proveedor principal para este SKU</span>
            </label>
          </div>
        </div>
        <div className="form-field">
          <label className="form-label">Notas</label>
          <textarea
            className="form-input"
            onChange={(e) => setField("notes", e.target.value)}
            rows={2}
            value={form.notes}
          />
        </div>

        {error && <p className="form-error">{error}</p>}

        <div className="modal-actions">
          <button className="button-secondary" onClick={onClose} type="button">
            Cancelar
          </button>
          <button
            className="button-primary"
            disabled={isPending}
            onClick={handleSave}
            type="button"
          >
            {isPending ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </AppModal>
  );
}

/* ─── Supplier detail drawer ──────────────────────────────────────────────── */

function SupplierProductsModal({
  supplier,
  inventoryItems,
  onClose,
}: {
  supplier: Supplier;
  inventoryItems: InventoryItem[];
  onClose: () => void;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [products, setProducts] = useState<SupplierProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingProduct, setAddingProduct] = useState(false);
  const [editingProduct, setEditingProduct] =
    useState<SupplierProduct | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/suppliers/${supplier.id}/products`);
        if (!res.ok) throw new Error(`${res.status}`);
        const data = (await res.json()) as {
          products: SupplierProduct[];
          total: number;
        };
        if (!cancelled) {
          setProducts(data.products);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supplier.id]);

  function handleProductSaved(saved: SupplierProduct) {
    setProducts((prev) => {
      const existsIdx = prev.findIndex((p) => p.id === saved.id);
      // If this new product is marked primary, unmark others (server already did it, but keep UI consistent)
      let next = existsIdx >= 0
        ? prev.map((p) => (p.id === saved.id ? saved : p))
        : [...prev, saved];
      if (saved.is_primary) {
        next = next.map((p) =>
          p.id === saved.id ? p : { ...p, is_primary: false },
        );
      }
      return next;
    });
    setAddingProduct(false);
    setEditingProduct(null);
    toast("Producto guardado", "success");
    router.refresh();
  }

  function handleDeleteProduct(p: SupplierProduct) {
    if (!confirm(`¿Quitar ${p.inventory_item_sku ?? "este SKU"} del proveedor?`))
      return;
    startTransition(async () => {
      try {
        await deleteSupplierProductClient(supplier.id, p.id);
        setProducts((prev) => prev.filter((x) => x.id !== p.id));
        toast("Producto eliminado", "info");
        router.refresh();
      } catch (e) {
        toast(e instanceof Error ? e.message : "Error", "error");
      }
    });
  }

  return (
    <AppModal
      onClose={onClose}
      open
      title={`Productos de ${supplier.name}`}
      width="wide"
    >
      <div className="stack" style={{ gap: 16 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span className="table-count">{products.length} productos</span>
          <button
            className="button-primary"
            onClick={() => setAddingProduct(true)}
            type="button"
          >
            Vincular producto
          </button>
        </div>

        {loading ? (
          <p className="sga-empty">Cargando…</p>
        ) : products.length === 0 ? (
          <p className="sga-empty">
            Aún no has vinculado productos a este proveedor.
          </p>
        ) : (
          <div className="sga-table-wrap">
            <table className="sga-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>SKU proveedor</th>
                  <th className="num">Coste</th>
                  <th className="num">MOQ</th>
                  <th className="num">Pack</th>
                  <th>Principal</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.inventory_item_sku ?? `#${p.inventory_item_id}`}</strong>
                      <div className="table-secondary">
                        {p.inventory_item_name ?? ""}
                      </div>
                    </td>
                    <td>{p.supplier_sku ?? "—"}</td>
                    <td className="num">
                      {p.cost_price
                        ? `${p.cost_price} ${p.currency}`
                        : "—"}
                    </td>
                    <td className="num">{p.moq}</td>
                    <td className="num">{p.pack_size}</td>
                    <td>{p.is_primary ? "✓" : ""}</td>
                    <td className="actions">
                      <button
                        className="button-secondary table-action"
                        onClick={() => setEditingProduct(p)}
                        type="button"
                      >
                        Editar
                      </button>
                      <button
                        className="button-ghost table-action"
                        onClick={() => handleDeleteProduct(p)}
                        type="button"
                      >
                        Quitar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="modal-actions">
          <button className="button-secondary" onClick={onClose} type="button">
            Cerrar
          </button>
        </div>
      </div>

      {(addingProduct || editingProduct) && (
        <ProductFormModal
          editing={editingProduct}
          inventoryItems={inventoryItems}
          onClose={() => {
            setAddingProduct(false);
            setEditingProduct(null);
          }}
          onSaved={handleProductSaved}
          supplier={supplier}
        />
      )}
    </AppModal>
  );
}

/* ─── Main panel ──────────────────────────────────────────────────────────── */

type SuppliersPanelProps = {
  initialSuppliers: Supplier[];
  inventoryItems: InventoryItem[];
  shopId?: number;
  shops: Shop[];
};

export function SuppliersPanel({
  initialSuppliers,
  inventoryItems,
  shopId,
  shops,
}: SuppliersPanelProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [suppliers, setSuppliers] = useState<Supplier[]>(initialSuppliers);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [viewingProductsOf, setViewingProductsOf] =
    useState<Supplier | null>(null);
  const [, startTransition] = useTransition();

  const shopMap = useMemo(
    () => new Map(shops.map((s) => [s.id, s.name])),
    [shops],
  );

  const filtered = useMemo(() => {
    const lower = search.trim().toLowerCase();
    if (!lower) return suppliers;
    return suppliers.filter(
      (s) =>
        s.name.toLowerCase().includes(lower) ||
        (s.email ?? "").toLowerCase().includes(lower) ||
        (s.contact_name ?? "").toLowerCase().includes(lower),
    );
  }, [suppliers, search]);

  function handleSaved(saved: Supplier) {
    setSuppliers((prev) => {
      const idx = prev.findIndex((s) => s.id === saved.id);
      return idx >= 0
        ? prev.map((s) => (s.id === saved.id ? saved : s))
        : [saved, ...prev];
    });
    setCreating(false);
    setEditing(null);
    toast(editing ? "Proveedor actualizado" : "Proveedor creado", "success");
    router.refresh();
  }

  function handleDelete(s: Supplier) {
    if (!confirm(`¿Eliminar el proveedor ${s.name}?`)) return;
    startTransition(async () => {
      try {
        await deleteSupplierClient(s.id);
        setSuppliers((prev) => prev.filter((x) => x.id !== s.id));
        toast("Proveedor eliminado", "info");
        router.refresh();
      } catch (e) {
        toast(e instanceof Error ? e.message : "Error", "error");
      }
    });
  }

  return (
    <>
      <Card className="stack table-card">
        <div className="table-header">
          <div className="table-filters">
            <input
              className="form-input table-search"
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre, email, contacto…"
              type="search"
              value={search}
            />
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <span className="table-count">{filtered.length} proveedores</span>
            <button
              className="button-primary"
              onClick={() => setCreating(true)}
              type="button"
            >
              Nuevo proveedor
            </button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="table-empty">
            <p>No hay proveedores{shopId ? " para este cliente" : ""}.</p>
            <button
              className="button-primary"
              onClick={() => setCreating(true)}
              type="button"
            >
              Crear primer proveedor
            </button>
          </div>
        ) : (
          <div className="sga-table-wrap">
            <table className="sga-table">
              <thead>
                <tr>
                  <th>Proveedor</th>
                  <th>Cliente</th>
                  <th>Contacto</th>
                  <th className="num">Productos</th>
                  <th className="num">Lead time</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <strong>{s.name}</strong>
                      {s.tax_id && (
                        <div className="table-secondary">{s.tax_id}</div>
                      )}
                    </td>
                    <td>
                      <div className="table-secondary">
                        {shopMap.get(s.shop_id) ?? `#${s.shop_id}`}
                      </div>
                    </td>
                    <td>
                      <div className="table-primary">
                        {s.contact_name ?? "—"}
                      </div>
                      <div className="table-secondary">{s.email ?? ""}</div>
                      {s.phone && (
                        <div className="table-secondary">{s.phone}</div>
                      )}
                    </td>
                    <td className="num">{s.products_count}</td>
                    <td className="num">{s.lead_time_days}d</td>
                    <td>
                      {s.is_active ? (
                        <span className="invoice-badge invoice-badge-paid">
                          Activo
                        </span>
                      ) : (
                        <span className="invoice-badge invoice-badge-cancelled">
                          Inactivo
                        </span>
                      )}
                    </td>
                    <td className="actions">
                      <button
                        className="button-secondary table-action"
                        onClick={() => setViewingProductsOf(s)}
                        type="button"
                      >
                        Productos
                      </button>
                      <button
                        className="button-secondary table-action"
                        onClick={() => setEditing(s)}
                        type="button"
                      >
                        Editar
                      </button>
                      <button
                        className="button-ghost table-action"
                        onClick={() => handleDelete(s)}
                        type="button"
                      >
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {(creating || editing) && (
        <SupplierFormModal
          defaultShopId={shopId}
          editing={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={handleSaved}
          shops={shops}
        />
      )}

      {viewingProductsOf && (
        <SupplierProductsModal
          inventoryItems={inventoryItems}
          onClose={() => setViewingProductsOf(null)}
          supplier={viewingProductsOf}
        />
      )}
    </>
  );
}
