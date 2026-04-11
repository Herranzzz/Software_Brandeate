import { notFound } from "next/navigation";

import { fetchOrderById } from "@/lib/api";
import { requireAdminUser } from "@/lib/auth";
import type { Order, OrderItem } from "@/lib/types";


type PackingSlipPageProps = {
  params: Promise<{ id: string }>;
};


function formatDate(value: string) {
  return new Date(value).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function buildAddress(order: Order): string[] {
  const snap = order.shopify_shipping_snapshot_json as Record<string, unknown> | null;
  const lines: string[] = [];
  const name = order.shipping_name || order.customer_name;
  if (name) lines.push(name);
  if (order.shipping_address_line1) lines.push(order.shipping_address_line1);
  if (order.shipping_address_line2) lines.push(order.shipping_address_line2);
  if (!order.shipping_address_line1 && snap?.address1) lines.push(String(snap.address1));
  const cityLine = [order.shipping_postal_code, order.shipping_town].filter(Boolean).join(" ");
  if (cityLine) lines.push(cityLine);
  if (order.shipping_country_code) lines.push(order.shipping_country_code);
  return lines;
}

function ItemRow({ item }: { item: OrderItem }) {
  const hasVariant = item.variant_title && item.variant_title !== "Default Title";
  return (
    <tr>
      <td style={{ padding: "10px 14px", borderBottom: "1px solid #eee" }}>
        <div style={{ fontWeight: 600 }}>{item.name || item.title || item.sku}</div>
        {hasVariant && (
          <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{item.variant_title}</div>
        )}
        <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>SKU: {item.sku}</div>
      </td>
      <td style={{ padding: "10px 14px", borderBottom: "1px solid #eee", textAlign: "center", fontWeight: 700 }}>
        {item.quantity}
      </td>
      <td style={{ padding: "10px 14px", borderBottom: "1px solid #eee" }}>
        {item.customization_id ? (
          <span style={{ fontSize: 11, background: "#fef3c7", color: "#92400e", padding: "2px 8px", borderRadius: 4, fontWeight: 600 }}>
            Personalizado
          </span>
        ) : null}
        {item.personalization_notes ? (
          <div style={{ fontSize: 11, color: "#555", marginTop: 4 }}>{item.personalization_notes}</div>
        ) : null}
      </td>
    </tr>
  );
}


export default async function PackingSlipPage({ params }: PackingSlipPageProps) {
  await requireAdminUser();
  const { id } = await params;
  const orderId = parseInt(id, 10);
  if (isNaN(orderId)) notFound();

  let order: Order;
  try {
    const result = await fetchOrderById(id);
    if (!result) notFound();
    order = result;
  } catch {
    notFound();
  }

  const addressLines = buildAddress(order);
  const totalItems = order.items.reduce((sum, i) => sum + i.quantity, 0);
  const hasPersonalized = order.items.some((i) => !!i.customization_id);
  const printDate = new Date().toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" });

  return (
    <html lang="es">
      <head>
        <meta charSet="UTF-8" />
        <meta content="width=device-width, initial-scale=1" name="viewport" />
        <title>Albarán #{order.external_id}</title>
        <style>{`
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            font-size: 13px;
            color: #1a1a1a;
            background: #fff;
          }
          .page { max-width: 800px; margin: 0 auto; padding: 48px 48px 64px; }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            padding-bottom: 28px;
            border-bottom: 2px solid #e8392b;
            margin-bottom: 28px;
          }
          .brand { font-size: 24px; font-weight: 800; color: #e8392b; letter-spacing: -0.5px; }
          .brand-sub { font-size: 11px; color: #888; margin-top: 3px; }
          .doc-meta { text-align: right; }
          .doc-number { font-size: 20px; font-weight: 700; }
          .doc-label { font-size: 11px; color: #888; margin-bottom: 4px; }
          .doc-date { font-size: 12px; color: #555; margin-top: 4px; }
          .info-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 24px;
            margin-bottom: 28px;
          }
          .info-block label {
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.1em;
            color: #888;
            display: block;
            margin-bottom: 6px;
          }
          .info-name { font-size: 14px; font-weight: 700; margin-bottom: 2px; }
          .info-detail { color: #555; line-height: 1.6; }
          .meta-strip {
            display: flex;
            gap: 32px;
            background: #f8f9fa;
            border-radius: 8px;
            padding: 12px 20px;
            margin-bottom: 28px;
          }
          .meta-item label {
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.1em;
            color: #888;
            display: block;
            margin-bottom: 3px;
          }
          .meta-item span { font-weight: 600; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 28px; }
          thead tr { background: #1a1a1a; color: #fff; }
          th { padding: 10px 14px; text-align: left; font-size: 11px; font-weight: 700; letter-spacing: 0.05em; }
          th:last-child { text-align: right; }
          .total-row {
            display: flex;
            justify-content: flex-end;
            gap: 32px;
            padding: 12px 14px;
            background: #f8f9fa;
            border-radius: 6px;
            margin-bottom: 32px;
          }
          .total-label { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #888; }
          .total-value { font-size: 16px; font-weight: 800; }
          .alert-box {
            background: #fef3c7;
            border: 1px solid #fbbf24;
            border-radius: 6px;
            padding: 12px 16px;
            margin-bottom: 28px;
            font-size: 12px;
            color: #92400e;
            font-weight: 600;
          }
          .signature-area {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 40px;
            margin-top: 48px;
            padding-top: 24px;
            border-top: 1px dashed #ddd;
          }
          .sig-block label {
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.1em;
            color: #888;
            display: block;
            margin-bottom: 32px;
          }
          .sig-line { border-top: 1px solid #999; padding-top: 6px; font-size: 11px; color: #aaa; }
          .footer {
            margin-top: 40px;
            padding-top: 16px;
            border-top: 1px solid #eee;
            font-size: 10px;
            color: #aaa;
            display: flex;
            justify-content: space-between;
          }
          @media print {
            .no-print { display: none !important; }
            body { font-size: 12px; }
            .page { padding: 24px; }
          }
        `}</style>
        <script dangerouslySetInnerHTML={{ __html: "window.onload=()=>window.print();" }} />
      </head>
      <body>
        <div className="page">
          {/* Print button (hidden on print) */}
          <div className="no-print" style={{ marginBottom: 24, display: "flex", gap: 12 }}>
            <button
              onClick={() => window.print()}
              style={{ padding: "8px 20px", background: "#e8392b", color: "#fff", border: "none", borderRadius: 6, fontWeight: 700, cursor: "pointer", fontSize: 13 }}
            >
              Imprimir
            </button>
            <a href={`/orders/${order.id}`} style={{ padding: "8px 20px", background: "#f1f5f9", color: "#333", border: "none", borderRadius: 6, fontWeight: 600, cursor: "pointer", fontSize: 13, textDecoration: "none" }}>
              ← Volver al pedido
            </a>
          </div>

          {/* Header */}
          <div className="header">
            <div>
              <div className="brand">Brandeate</div>
              <div className="brand-sub">Operations Hub · Fulfillment</div>
            </div>
            <div className="doc-meta">
              <div className="doc-label">Albarán de entrega</div>
              <div className="doc-number">#{order.external_id}</div>
              <div className="doc-date">Impreso el {printDate}</div>
              {order.shopify_order_name && (
                <div className="doc-date" style={{ marginTop: 2, color: "#aaa" }}>
                  Shopify: {order.shopify_order_name}
                </div>
              )}
            </div>
          </div>

          {/* Info grid */}
          <div className="info-grid">
            <div className="info-block">
              <label>Destinatario</label>
              {addressLines.map((line, i) => (
                <div className={i === 0 ? "info-name" : "info-detail"} key={i}>{line}</div>
              ))}
              {order.shipping_phone && (
                <div className="info-detail" style={{ marginTop: 4 }}>Tel: {order.shipping_phone}</div>
              )}
              {order.customer_email && (
                <div className="info-detail">{order.customer_email}</div>
              )}
            </div>
            <div className="info-block">
              <label>Datos del envío</label>
              {order.shipment ? (
                <>
                  <div className="info-name">{order.shipment.carrier}</div>
                  <div className="info-detail">Tracking: {order.shipment.tracking_number}</div>
                  {order.shipment.shipping_type_code && (
                    <div className="info-detail">Servicio: {order.shipment.shipping_type_code}</div>
                  )}
                  {order.shipment.weight_tier_label && (
                    <div className="info-detail">Tramo peso: {order.shipment.weight_tier_label}</div>
                  )}
                </>
              ) : (
                <div className="info-detail" style={{ color: "#aaa" }}>Sin shipment asignado</div>
              )}
            </div>
          </div>

          {/* Meta strip */}
          <div className="meta-strip">
            <div className="meta-item">
              <label>Pedido creado</label>
              <span>{formatDate(order.created_at)}</span>
            </div>
            <div className="meta-item">
              <label>Total unidades</label>
              <span>{totalItems} ud.</span>
            </div>
            <div className="meta-item">
              <label>Líneas</label>
              <span>{order.items.length}</span>
            </div>
            {order.note && (
              <div className="meta-item" style={{ flex: 1 }}>
                <label>Nota del pedido</label>
                <span>{order.note}</span>
              </div>
            )}
          </div>

          {/* Personalization alert */}
          {hasPersonalized && (
            <div className="alert-box">
              ⚠ Este pedido contiene artículos personalizados. Verificar diseño antes del empaquetado.
            </div>
          )}

          {/* Items table */}
          <table>
            <thead>
              <tr>
                <th style={{ width: "60%" }}>Producto</th>
                <th style={{ width: "10%", textAlign: "center" }}>Cant.</th>
                <th style={{ width: "30%" }}>Notas</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((item) => (
                <ItemRow item={item} key={item.id} />
              ))}
            </tbody>
          </table>

          {/* Total */}
          <div className="total-row">
            <div>
              <div className="total-label">Total unidades</div>
              <div className="total-value">{totalItems}</div>
            </div>
          </div>

          {/* Signature */}
          <div className="signature-area">
            <div className="sig-block">
              <label>Preparado por</label>
              <div className="sig-line">
                {order.prepared_by_employee_name ?? "________________________"}
              </div>
            </div>
            <div className="sig-block">
              <label>Recibido · Firma y fecha</label>
              <div className="sig-line">________________________</div>
            </div>
          </div>

          {/* Footer */}
          <div className="footer">
            <span>Brandeate Operations Hub</span>
            <span>Pedido #{order.external_id} · {printDate}</span>
          </div>
        </div>
      </body>
    </html>
  );
}
