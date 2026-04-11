import { notFound } from "next/navigation";

import { fetchInvoiceById } from "@/lib/api";
import type { Invoice } from "@/lib/types";


type PrintPageProps = {
  params: Promise<{ id: string }>;
};


function fmt(value: string | number, currency = "EUR") {
  const num = typeof value === "string" ? parseFloat(value) : value;
  return new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(num);
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

const STATUS_LABELS: Record<Invoice["status"], string> = {
  draft: "BORRADOR",
  sent: "ENVIADA",
  paid: "PAGADA",
  cancelled: "CANCELADA",
};


export default async function InvoicePrintPage({ params }: PrintPageProps) {
  const { id } = await params;
  const invoiceId = parseInt(id, 10);
  if (isNaN(invoiceId)) notFound();

  let invoice: Invoice;
  try {
    invoice = await fetchInvoiceById(invoiceId);
  } catch {
    notFound();
  }

  const subtotal = parseFloat(invoice.subtotal);
  const taxAmount = parseFloat(invoice.tax_amount);
  const total = parseFloat(invoice.total);

  return (
    <html lang="es">
      <head>
        <meta charSet="UTF-8" />
        <meta content="width=device-width, initial-scale=1" name="viewport" />
        <title>{invoice.invoice_number}</title>
        <style>{`
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            font-size: 13px;
            color: #1a1a1a;
            background: #fff;
          }
          .page {
            max-width: 800px;
            margin: 0 auto;
            padding: 48px 48px 64px;
          }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            padding-bottom: 32px;
            border-bottom: 2px solid #e8392b;
            margin-bottom: 32px;
          }
          .brand { font-size: 26px; font-weight: 800; color: #e8392b; letter-spacing: -0.5px; }
          .brand-sub { font-size: 12px; color: #888; margin-top: 4px; }
          .invoice-meta { text-align: right; }
          .invoice-number { font-size: 20px; font-weight: 700; }
          .status-stamp {
            display: inline-block;
            padding: 3px 10px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.08em;
            margin-top: 6px;
          }
          .status-draft { background: #f1f5f9; color: #64748b; border: 1px solid #cbd5e1; }
          .status-sent { background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe; }
          .status-paid { background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0; }
          .status-cancelled { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; }
          .parties {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 24px;
            margin-bottom: 32px;
          }
          .party-block label {
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.1em;
            color: #888;
            display: block;
            margin-bottom: 6px;
          }
          .party-name { font-size: 15px; font-weight: 700; margin-bottom: 2px; }
          .party-detail { color: #555; line-height: 1.6; }
          .dates-row {
            display: flex;
            gap: 32px;
            background: #f8f9fa;
            border-radius: 8px;
            padding: 14px 20px;
            margin-bottom: 32px;
          }
          .date-item label {
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.1em;
            color: #888;
            display: block;
            margin-bottom: 3px;
          }
          .date-item span { font-weight: 600; }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 24px;
          }
          thead tr {
            background: #1a1a1a;
            color: #fff;
          }
          th {
            padding: 10px 14px;
            text-align: left;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.06em;
          }
          th:last-child, td:last-child { text-align: right; }
          td {
            padding: 12px 14px;
            border-bottom: 1px solid #f1f1f1;
            vertical-align: top;
          }
          tbody tr:hover { background: #fafafa; }
          .totals {
            display: flex;
            justify-content: flex-end;
            margin-bottom: 32px;
          }
          .totals-block { min-width: 260px; }
          .totals-row {
            display: flex;
            justify-content: space-between;
            padding: 7px 0;
            font-size: 13px;
            border-bottom: 1px solid #f1f1f1;
          }
          .totals-row:last-child { border-bottom: none; }
          .totals-grand {
            font-size: 16px;
            font-weight: 800;
            padding: 12px 0 4px;
          }
          .notes-block {
            background: #f8f9fa;
            border-radius: 8px;
            padding: 16px 20px;
            margin-bottom: 24px;
          }
          .notes-block label {
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.1em;
            color: #888;
            display: block;
            margin-bottom: 6px;
          }
          .footer {
            text-align: center;
            color: #aaa;
            font-size: 11px;
            padding-top: 24px;
            border-top: 1px solid #eee;
          }
          .print-btn {
            display: block;
            margin: 0 auto 32px;
            padding: 10px 28px;
            background: #e8392b;
            color: #fff;
            border: none;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
          }
          @media print {
            .print-btn { display: none !important; }
            body { background: #fff; }
            .page { padding: 24px; }
          }
        `}</style>
      </head>
      <body>
        <div className="page">
          <button className="print-btn" onClick={() => window.print()} type="button">
            Imprimir / Guardar PDF
          </button>

          <div className="header">
            <div>
              <div className="brand">Brandeate</div>
              {invoice.sender_name && <div className="brand-sub">{invoice.sender_name}</div>}
            </div>
            <div className="invoice-meta">
              <div className="invoice-number">{invoice.invoice_number}</div>
              <span className={`status-stamp status-${invoice.status}`}>
                {STATUS_LABELS[invoice.status]}
              </span>
            </div>
          </div>

          <div className="parties">
            <div className="party-block">
              <label>Emisor</label>
              <div className="party-name">{invoice.sender_name ?? "Brandeate"}</div>
              {invoice.sender_tax_id && <div className="party-detail">NIF/CIF: {invoice.sender_tax_id}</div>}
              {invoice.sender_address && <div className="party-detail" style={{ whiteSpace: "pre-line" }}>{invoice.sender_address}</div>}
            </div>
            <div className="party-block">
              <label>Cliente</label>
              <div className="party-name">
                {invoice.client_company ?? invoice.client_name}
              </div>
              {invoice.client_company && <div className="party-detail">{invoice.client_name}</div>}
              {invoice.client_tax_id && <div className="party-detail">NIF/CIF: {invoice.client_tax_id}</div>}
              {invoice.client_address && <div className="party-detail" style={{ whiteSpace: "pre-line" }}>{invoice.client_address}</div>}
              <div className="party-detail">{invoice.client_email}</div>
            </div>
          </div>

          <div className="dates-row">
            <div className="date-item">
              <label>Fecha de emisión</label>
              <span>{formatDate(invoice.issue_date)}</span>
            </div>
            {invoice.due_date && (
              <div className="date-item">
                <label>Fecha de vencimiento</label>
                <span>{formatDate(invoice.due_date)}</span>
              </div>
            )}
            {invoice.payment_terms && (
              <div className="date-item">
                <label>Condiciones de pago</label>
                <span>{invoice.payment_terms}</span>
              </div>
            )}
          </div>

          <table>
            <thead>
              <tr>
                <th style={{ width: "50%" }}>Descripción</th>
                <th style={{ textAlign: "right" }}>Cant.</th>
                <th style={{ textAlign: "right" }}>Precio unit.</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((item) => (
                <tr key={item.id}>
                  <td>{item.description}</td>
                  <td style={{ textAlign: "right" }}>{parseFloat(item.quantity)}</td>
                  <td style={{ textAlign: "right" }}>{fmt(item.unit_price, invoice.currency)}</td>
                  <td>{fmt(parseFloat(item.quantity) * parseFloat(item.unit_price), invoice.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="totals">
            <div className="totals-block">
              <div className="totals-row">
                <span>Subtotal</span>
                <span>{fmt(subtotal, invoice.currency)}</span>
              </div>
              <div className="totals-row">
                <span>IVA ({invoice.tax_rate}%)</span>
                <span>{fmt(taxAmount, invoice.currency)}</span>
              </div>
              <div className="totals-row totals-grand">
                <span>Total</span>
                <span>{fmt(total, invoice.currency)}</span>
              </div>
            </div>
          </div>

          {invoice.notes && (
            <div className="notes-block">
              <label>Notas</label>
              <div style={{ whiteSpace: "pre-line" }}>{invoice.notes}</div>
            </div>
          )}

          <div className="footer">
            Documento generado por Brandeate Operations Hub · {invoice.invoice_number}
          </div>
        </div>
      </body>
    </html>
  );
}
