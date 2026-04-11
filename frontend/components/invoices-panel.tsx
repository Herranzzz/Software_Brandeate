"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { AppModal } from "@/components/app-modal";
import { Card } from "@/components/card";
import { useToast } from "@/components/toast";
import {
  cancelInvoice,
  createInvoice,
  deleteInvoice,
  markInvoicePaid,
  sendInvoice,
  updateInvoice,
} from "@/lib/api";
import type { Invoice, InvoiceItemDraft, InvoiceStatus, Shop } from "@/lib/types";


/* ─── Helpers ─────────────────────────────────────────────────────────────── */

function fmt(value: string | number, currency = "EUR") {
  const num = typeof value === "string" ? parseFloat(value) : value;
  return new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(num);
}

function today() {
  return new Date().toISOString().split("T")[0];
}

const STATUS_META: Record<InvoiceStatus, { label: string; className: string }> = {
  draft:     { label: "Borrador",   className: "invoice-badge invoice-badge-draft" },
  sent:      { label: "Enviada",    className: "invoice-badge invoice-badge-sent" },
  paid:      { label: "Pagada",     className: "invoice-badge invoice-badge-paid" },
  cancelled: { label: "Cancelada",  className: "invoice-badge invoice-badge-cancelled" },
};

function calcSubtotal(items: InvoiceItemDraft[]) {
  return items.reduce((s, i) => s + (parseFloat(i.quantity) || 0) * (parseFloat(i.unit_price) || 0), 0);
}

/* ─── Types ───────────────────────────────────────────────────────────────── */

type InvoicesPanelProps = {
  initialInvoices: Invoice[];
  shops: Shop[];
  initialStatus?: InvoiceStatus;
  initialQ?: string;
};

type FormState = {
  client_name: string;
  client_email: string;
  client_company: string;
  client_tax_id: string;
  client_address: string;
  sender_name: string;
  sender_tax_id: string;
  sender_address: string;
  currency: string;
  tax_rate: string;
  notes: string;
  payment_terms: string;
  issue_date: string;
  due_date: string;
  items: InvoiceItemDraft[];
};

const BLANK_FORM: FormState = {
  client_name: "",
  client_email: "",
  client_company: "",
  client_tax_id: "",
  client_address: "",
  sender_name: "Brandeate",
  sender_tax_id: "",
  sender_address: "",
  currency: "EUR",
  tax_rate: "21",
  notes: "",
  payment_terms: "30 días",
  issue_date: today(),
  due_date: "",
  items: [{ description: "", quantity: "1", unit_price: "0", sort_order: 0 }],
};

function invoiceToForm(inv: Invoice): FormState {
  return {
    client_name: inv.client_name,
    client_email: inv.client_email,
    client_company: inv.client_company ?? "",
    client_tax_id: inv.client_tax_id ?? "",
    client_address: inv.client_address ?? "",
    sender_name: inv.sender_name ?? "",
    sender_tax_id: inv.sender_tax_id ?? "",
    sender_address: inv.sender_address ?? "",
    currency: inv.currency,
    tax_rate: inv.tax_rate,
    notes: inv.notes ?? "",
    payment_terms: inv.payment_terms ?? "",
    issue_date: inv.issue_date,
    due_date: inv.due_date ?? "",
    items: inv.items.map((it) => ({
      description: it.description,
      quantity: it.quantity,
      unit_price: it.unit_price,
      sort_order: it.sort_order,
    })),
  };
}

/* ─── Send modal ──────────────────────────────────────────────────────────── */

function SendModal({
  invoice,
  onClose,
  onSent,
}: {
  invoice: Invoice;
  onClose: () => void;
  onSent: (updated: Invoice) => void;
}) {
  const [email, setEmail] = useState(invoice.client_email);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSend() {
    startTransition(async () => {
      try {
        const updated = await sendInvoice(invoice.id, {
          recipient_email: email !== invoice.client_email ? email : undefined,
          message: message || undefined,
        });
        onSent(updated);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al enviar");
      }
    });
  }

  return (
    <AppModal open title={`Enviar ${invoice.invoice_number}`} onClose={onClose}>
      <div className="stack" style={{ gap: 16 }}>
        <div className="form-field">
          <label className="form-label">Destinatario</label>
          <input className="form-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="form-field">
          <label className="form-label">Mensaje adicional (opcional)</label>
          <textarea className="form-input" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Cualquier nota para el cliente…" />
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button className="button-secondary" onClick={onClose} type="button">Cancelar</button>
          <button className="button-primary" disabled={isPending} onClick={handleSend} type="button">
            {isPending ? "Enviando…" : "Enviar factura"}
          </button>
        </div>
      </div>
    </AppModal>
  );
}

/* ─── Invoice form modal ──────────────────────────────────────────────────── */

function InvoiceFormModal({
  editingInvoice,
  onClose,
  onSaved,
}: {
  editingInvoice: Invoice | null;
  onClose: () => void;
  onSaved: (invoice: Invoice) => void;
}) {
  const [form, setForm] = useState<FormState>(
    editingInvoice ? invoiceToForm(editingInvoice) : BLANK_FORM,
  );
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isEditing = editingInvoice !== null;
  const subtotal = calcSubtotal(form.items);
  const taxAmount = subtotal * (parseFloat(form.tax_rate) || 0) / 100;
  const total = subtotal + taxAmount;

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateItem(index: number, field: keyof InvoiceItemDraft, value: string) {
    setForm((prev) => {
      const items = [...prev.items];
      items[index] = { ...items[index], [field]: value };
      return { ...prev, items };
    });
  }

  function addItem() {
    setForm((prev) => ({
      ...prev,
      items: [...prev.items, { description: "", quantity: "1", unit_price: "0", sort_order: prev.items.length }],
    }));
  }

  function removeItem(index: number) {
    setForm((prev) => ({ ...prev, items: prev.items.filter((_, i) => i !== index) }));
  }

  function handleSave() {
    if (!form.client_name.trim() || !form.client_email.trim()) {
      setError("Nombre y email del cliente son obligatorios.");
      return;
    }
    if (form.items.length === 0) {
      setError("Añade al menos una línea.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const payload = {
          client_name: form.client_name,
          client_email: form.client_email,
          client_company: form.client_company || null,
          client_tax_id: form.client_tax_id || null,
          client_address: form.client_address || null,
          sender_name: form.sender_name || null,
          sender_tax_id: form.sender_tax_id || null,
          sender_address: form.sender_address || null,
          currency: form.currency,
          tax_rate: form.tax_rate,
          notes: form.notes || null,
          payment_terms: form.payment_terms || null,
          issue_date: form.issue_date,
          due_date: form.due_date || null,
          items: form.items.map((it, idx) => ({ ...it, sort_order: idx })),
        };
        const saved = isEditing
          ? await updateInvoice(editingInvoice.id, payload)
          : await createInvoice(payload);
        onSaved(saved);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al guardar");
      }
    });
  }

  return (
    <AppModal open title={isEditing ? `Editar ${editingInvoice.invoice_number}` : "Nueva factura"} onClose={onClose} width="wide">
      <div className="invoice-form-body">
        {/* Client */}
        <div className="invoice-form-section">
          <span className="eyebrow">Cliente</span>
          <div className="invoice-form-grid">
            <div className="form-field">
              <label className="form-label">Nombre *</label>
              <input className="form-input" value={form.client_name} onChange={(e) => setField("client_name", e.target.value)} />
            </div>
            <div className="form-field">
              <label className="form-label">Email *</label>
              <input className="form-input" type="email" value={form.client_email} onChange={(e) => setField("client_email", e.target.value)} />
            </div>
            <div className="form-field">
              <label className="form-label">Empresa</label>
              <input className="form-input" value={form.client_company} onChange={(e) => setField("client_company", e.target.value)} />
            </div>
            <div className="form-field">
              <label className="form-label">NIF/CIF</label>
              <input className="form-input" value={form.client_tax_id} onChange={(e) => setField("client_tax_id", e.target.value)} />
            </div>
            <div className="form-field invoice-form-full">
              <label className="form-label">Dirección</label>
              <textarea className="form-input" rows={2} value={form.client_address} onChange={(e) => setField("client_address", e.target.value)} />
            </div>
          </div>
        </div>

        {/* Sender */}
        <div className="invoice-form-section">
          <span className="eyebrow">Emisor (Brandeate)</span>
          <div className="invoice-form-grid">
            <div className="form-field">
              <label className="form-label">Nombre del emisor</label>
              <input className="form-input" value={form.sender_name} onChange={(e) => setField("sender_name", e.target.value)} />
            </div>
            <div className="form-field">
              <label className="form-label">NIF/CIF emisor</label>
              <input className="form-input" value={form.sender_tax_id} onChange={(e) => setField("sender_tax_id", e.target.value)} />
            </div>
            <div className="form-field invoice-form-full">
              <label className="form-label">Dirección emisor</label>
              <textarea className="form-input" rows={2} value={form.sender_address} onChange={(e) => setField("sender_address", e.target.value)} />
            </div>
          </div>
        </div>

        {/* Dates + terms */}
        <div className="invoice-form-section">
          <span className="eyebrow">Fecha y condiciones</span>
          <div className="invoice-form-grid">
            <div className="form-field">
              <label className="form-label">Fecha de emisión *</label>
              <input className="form-input" type="date" value={form.issue_date} onChange={(e) => setField("issue_date", e.target.value)} />
            </div>
            <div className="form-field">
              <label className="form-label">Fecha de vencimiento</label>
              <input className="form-input" type="date" value={form.due_date} onChange={(e) => setField("due_date", e.target.value)} />
            </div>
            <div className="form-field">
              <label className="form-label">Condiciones de pago</label>
              <input className="form-input" value={form.payment_terms} onChange={(e) => setField("payment_terms", e.target.value)} placeholder="30 días, contado…" />
            </div>
            <div className="form-field">
              <label className="form-label">IVA (%)</label>
              <input className="form-input" type="number" min="0" max="100" step="0.01" value={form.tax_rate} onChange={(e) => setField("tax_rate", e.target.value)} />
            </div>
          </div>
        </div>

        {/* Line items */}
        <div className="invoice-form-section">
          <span className="eyebrow">Líneas</span>
          <div className="invoice-lines-table">
            <div className="invoice-lines-header">
              <span>Descripción</span>
              <span>Cant.</span>
              <span>Precio unit.</span>
              <span>Total</span>
              <span />
            </div>
            {form.items.map((item, index) => (
              <div className="invoice-line-row" key={index}>
                <input
                  className="form-input"
                  placeholder="Descripción del servicio"
                  value={item.description}
                  onChange={(e) => updateItem(index, "description", e.target.value)}
                />
                <input
                  className="form-input invoice-line-num"
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={item.quantity}
                  onChange={(e) => updateItem(index, "quantity", e.target.value)}
                />
                <input
                  className="form-input invoice-line-num"
                  type="number"
                  min="0"
                  step="0.01"
                  value={item.unit_price}
                  onChange={(e) => updateItem(index, "unit_price", e.target.value)}
                />
                <span className="invoice-line-total">
                  {fmt((parseFloat(item.quantity) || 0) * (parseFloat(item.unit_price) || 0), form.currency)}
                </span>
                <button
                  className="invoice-line-remove"
                  disabled={form.items.length === 1}
                  onClick={() => removeItem(index)}
                  type="button"
                  aria-label="Eliminar línea"
                >×</button>
              </div>
            ))}
            <button className="invoice-add-line-btn" onClick={addItem} type="button">
              + Añadir línea
            </button>
          </div>

          <div className="invoice-form-totals">
            <div className="invoice-form-total-row">
              <span>Subtotal</span>
              <strong>{fmt(subtotal, form.currency)}</strong>
            </div>
            <div className="invoice-form-total-row">
              <span>IVA ({form.tax_rate}%)</span>
              <strong>{fmt(taxAmount, form.currency)}</strong>
            </div>
            <div className="invoice-form-total-row invoice-form-total-grand">
              <span>Total</span>
              <strong>{fmt(total, form.currency)}</strong>
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="invoice-form-section">
          <span className="eyebrow">Notas</span>
          <textarea className="form-input" rows={3} value={form.notes} onChange={(e) => setField("notes", e.target.value)} placeholder="Información adicional para el cliente…" />
        </div>

        {error && <p className="form-error">{error}</p>}

        <div className="modal-actions">
          <button className="button-secondary" onClick={onClose} type="button">Cancelar</button>
          <button className="button-primary" disabled={isPending} onClick={handleSave} type="button">
            {isPending ? "Guardando…" : isEditing ? "Guardar cambios" : "Crear factura"}
          </button>
        </div>
      </div>
    </AppModal>
  );
}

/* ─── Main panel ──────────────────────────────────────────────────────────── */

export function InvoicesPanel({
  initialInvoices,
  shops,
  initialStatus,
  initialQ,
}: InvoicesPanelProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [invoices, setInvoices] = useState<Invoice[]>(initialInvoices);
  const [showForm, setShowForm] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [sendingInvoice, setSendingInvoice] = useState<Invoice | null>(null);
  const [q, setQ] = useState(initialQ ?? "");
  const [filterStatus, setFilterStatus] = useState<InvoiceStatus | "">(initialStatus ?? "");
  const [, startTransition] = useTransition();

  const shopMap = useMemo(
    () => new Map(shops.map((s) => [s.id, s.name])),
    [shops],
  );

  const filtered = useMemo(() => {
    let list = invoices;
    if (filterStatus) list = list.filter((inv) => inv.status === filterStatus);
    if (q.trim()) {
      const lower = q.toLowerCase();
      list = list.filter(
        (inv) =>
          inv.invoice_number.toLowerCase().includes(lower) ||
          inv.client_name.toLowerCase().includes(lower) ||
          inv.client_email.toLowerCase().includes(lower) ||
          (inv.client_company ?? "").toLowerCase().includes(lower),
      );
    }
    return list;
  }, [invoices, filterStatus, q]);

  // KPIs
  const kpiDraft = invoices.filter((i) => i.status === "draft").length;
  const kpiSent = invoices.filter((i) => i.status === "sent").length;
  const kpiPaid = invoices.filter((i) => i.status === "paid").length;
  const totalPending = invoices
    .filter((i) => i.status === "sent")
    .reduce((s, i) => s + parseFloat(i.total), 0);
  const totalPaid = invoices
    .filter((i) => i.status === "paid")
    .reduce((s, i) => s + parseFloat(i.total), 0);

  function handleSaved(saved: Invoice) {
    setInvoices((prev) => {
      const exists = prev.find((i) => i.id === saved.id);
      return exists ? prev.map((i) => (i.id === saved.id ? saved : i)) : [saved, ...prev];
    });
    setShowForm(false);
    setEditingInvoice(null);
    toast(editingInvoice ? "Factura actualizada" : "Factura creada", "success");
  }

  function handleSent(updated: Invoice) {
    setInvoices((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
    setSendingInvoice(null);
    toast("Factura enviada", "success");
  }

  function handleMarkPaid(invoice: Invoice) {
    startTransition(async () => {
      const updated = await markInvoicePaid(invoice.id);
      setInvoices((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
      toast("Marcada como pagada", "success");
    });
  }

  function handleCancel(invoice: Invoice) {
    if (!confirm(`¿Cancelar la factura ${invoice.invoice_number}?`)) return;
    startTransition(async () => {
      const updated = await cancelInvoice(invoice.id);
      setInvoices((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
      toast("Factura cancelada", "info");
    });
  }

  function handleDelete(invoice: Invoice) {
    if (!confirm(`¿Eliminar la factura ${invoice.invoice_number}?`)) return;
    startTransition(async () => {
      await deleteInvoice(invoice.id);
      setInvoices((prev) => prev.filter((i) => i.id !== invoice.id));
      toast("Factura eliminada", "info");
    });
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <span className="eyebrow">Facturación</span>
          <h1 className="page-title">Facturas</h1>
        </div>
        <div className="page-header-actions">
          <button className="button-primary" onClick={() => { setEditingInvoice(null); setShowForm(true); }} type="button">
            Nueva factura
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="invoice-kpi-strip">
        <div className="invoice-kpi-card">
          <span className="invoice-kpi-label">Borradores</span>
          <strong className="invoice-kpi-value">{kpiDraft}</strong>
        </div>
        <div className="invoice-kpi-card">
          <span className="invoice-kpi-label">Enviadas</span>
          <strong className="invoice-kpi-value">{kpiSent}</strong>
        </div>
        <div className="invoice-kpi-card invoice-kpi-card-accent">
          <span className="invoice-kpi-label">Pendiente de cobro</span>
          <strong className="invoice-kpi-value">{fmt(totalPending)}</strong>
        </div>
        <div className="invoice-kpi-card invoice-kpi-card-green">
          <span className="invoice-kpi-label">Cobrado</span>
          <strong className="invoice-kpi-value">{fmt(totalPaid)}</strong>
        </div>
        <div className="invoice-kpi-card">
          <span className="invoice-kpi-label">Pagadas</span>
          <strong className="invoice-kpi-value">{kpiPaid}</strong>
        </div>
      </div>

      <Card className="stack table-card">
        {/* Filters */}
        <div className="table-header">
          <div className="table-filters">
            <input
              className="form-input table-search"
              placeholder="Buscar factura, cliente…"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select
              className="form-input form-select"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as InvoiceStatus | "")}
            >
              <option value="">Todos los estados</option>
              <option value="draft">Borrador</option>
              <option value="sent">Enviada</option>
              <option value="paid">Pagada</option>
              <option value="cancelled">Cancelada</option>
            </select>
          </div>
          <span className="table-count">{filtered.length} facturas</span>
        </div>

        {filtered.length === 0 ? (
          <div className="table-empty">
            <p>No hay facturas.</p>
            <button className="button-primary" onClick={() => setShowForm(true)} type="button">Crear primera factura</button>
          </div>
        ) : (
          <div className="table-scroll-wrapper">
            <table className="data-table invoice-table">
              <thead>
                <tr>
                  <th>Número</th>
                  <th>Cliente</th>
                  <th>Tienda</th>
                  <th>Fecha</th>
                  <th>Vence</th>
                  <th>Total</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((invoice) => {
                  const meta = STATUS_META[invoice.status];
                  return (
                    <tr key={invoice.id} className="invoice-row">
                      <td>
                        <Link className="table-link table-primary" href={`/invoices/${invoice.id}/print`} target="_blank">
                          {invoice.invoice_number}
                        </Link>
                      </td>
                      <td>
                        <div className="table-primary">{invoice.client_name}</div>
                        {invoice.client_company && (
                          <div className="table-secondary">{invoice.client_company}</div>
                        )}
                        <div className="table-secondary">{invoice.client_email}</div>
                      </td>
                      <td>
                        <div className="table-secondary">
                          {invoice.shop_id ? shopMap.get(invoice.shop_id) ?? `#${invoice.shop_id}` : "—"}
                        </div>
                      </td>
                      <td>
                        <div className="table-primary">{invoice.issue_date}</div>
                      </td>
                      <td>
                        <div className={`table-primary${invoice.due_date && new Date(invoice.due_date) < new Date() && invoice.status === "sent" ? " text-danger" : ""}`}>
                          {invoice.due_date ?? "—"}
                        </div>
                      </td>
                      <td>
                        <div className="table-primary table-mono">{fmt(invoice.total, invoice.currency)}</div>
                        <div className="table-secondary">IVA {invoice.tax_rate}%</div>
                      </td>
                      <td>
                        <span className={meta.className}>{meta.label}</span>
                      </td>
                      <td>
                        <div className="invoice-row-actions">
                          {invoice.status === "draft" && (
                            <>
                              <button className="button-secondary table-action" onClick={() => { setEditingInvoice(invoice); setShowForm(true); }} type="button">Editar</button>
                              <button className="button-primary table-action" onClick={() => setSendingInvoice(invoice)} type="button">Enviar</button>
                            </>
                          )}
                          {invoice.status === "sent" && (
                            <>
                              <button className="button-secondary table-action" onClick={() => setSendingInvoice(invoice)} type="button">Reenviar</button>
                              <button className="button-primary table-action" onClick={() => handleMarkPaid(invoice)} type="button">Marcar pagada</button>
                            </>
                          )}
                          {invoice.status === "paid" && (
                            <Link className="button-secondary table-action" href={`/invoices/${invoice.id}/print`} target="_blank">Ver PDF</Link>
                          )}
                          {(invoice.status === "draft" || invoice.status === "sent") && (
                            <button className="button-ghost table-action" onClick={() => handleCancel(invoice)} type="button">Cancelar</button>
                          )}
                          {(invoice.status === "draft" || invoice.status === "cancelled") && (
                            <button className="button-ghost table-action invoice-delete-btn" onClick={() => handleDelete(invoice)} type="button">Eliminar</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {(showForm || editingInvoice) && (
        <InvoiceFormModal
          editingInvoice={editingInvoice}
          onClose={() => { setShowForm(false); setEditingInvoice(null); }}
          onSaved={handleSaved}
        />
      )}

      {sendingInvoice && (
        <SendModal
          invoice={sendingInvoice}
          onClose={() => setSendingInvoice(null)}
          onSent={handleSent}
        />
      )}
    </div>
  );
}
