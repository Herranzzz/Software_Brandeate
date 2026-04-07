import Link from "next/link";
import { notFound } from "next/navigation";

import { Card } from "@/components/card";
import { EmptyState } from "@/components/empty-state";
import { DesignPreviewWithValidation } from "@/components/design-preview-with-validation";
import { PersonalizationBadge } from "@/components/personalization-badge";
import { ProductionBadge } from "@/components/production-badge";
import { SectionTitle } from "@/components/section-title";
import { StatusBadge } from "@/components/status-badge";
import { ShippingOptionsPanel } from "@/components/shipping-options-panel";
import { fetchOrderById, fetchOrderIncidents, fetchShopCatalogProducts } from "@/lib/api";
import { getAuthToken, requirePortalUser } from "@/lib/auth";
import { formatDateTime, sortTrackingEvents } from "@/lib/format";
import { getPrimaryDesignPreview, isImageAsset } from "@/lib/personalization";
import type { OrderItem, ShopCatalogProduct } from "@/lib/types";


type PortalOrderDetailPageProps = {
  params: Promise<{ id: string }>;
};

type OrderActivity = {
  id: string;
  occurredAt: string;
  title: string;
  description: string;
  meta: string;
  icon: string;
  tone: "neutral" | "accent" | "warning";
};

type ShippingSnapshot = {
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
  company?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  province_code?: string | null;
  zip?: string | null;
  country?: string | null;
  country_code?: string | null;
  phone?: string | null;
  email?: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getProductSummary(item: OrderItem, catalogProducts: ShopCatalogProduct[]) {
  if (item.variant_title?.trim()) {
    return {
      productName: item.title?.trim() || item.name,
      variantName: item.variant_title.trim(),
    };
  }

  const separators = [" / ", " - ", " – ", " — "];
  for (const separator of separators) {
    if (item.name.includes(separator)) {
      const parts = item.name.split(separator).map((part) => part.trim()).filter(Boolean);
      if (parts.length >= 2) {
        return {
          productName: parts.slice(0, -1).join(separator),
          variantName: parts.at(-1) ?? "Sin variante",
        };
      }
    }
  }

  const matchedCatalogProduct =
    item.variant_id?.trim()
      ? catalogProducts.find((product) =>
          (product.variants_json ?? []).some((variant) => variant.id?.trim() === item.variant_id?.trim()),
        )
      : null;

  const matchedVariant = matchedCatalogProduct
    ? (matchedCatalogProduct.variants_json ?? []).find((variant) => variant.id?.trim() === item.variant_id?.trim())
    : null;

  if (matchedCatalogProduct && matchedVariant?.title?.trim()) {
    return {
      productName: matchedCatalogProduct.title,
      variantName: matchedVariant.title.trim(),
    };
  }

  const details = item.personalization_details_json;
  if (isRecord(details)) {
    const variantCandidateKeys = ["variant", "variant_title", "size", "talla", "color"];
    for (const key of variantCandidateKeys) {
      const value = details[key];
      if (typeof value === "string" && value.trim()) {
        return {
          productName: item.name,
          variantName: value.trim(),
        };
      }
    }
  }

  return {
    productName: item.name,
    variantName: "Variante no disponible",
  };
}

function getFulfillmentOrders(order: NonNullable<Awaited<ReturnType<typeof fetchOrderById>>>) {
  if (!Array.isArray(order.fulfillment_orders_json)) {
    return [];
  }

  return order.fulfillment_orders_json
    .filter((entry): entry is Record<string, unknown> => isRecord(entry))
    .map((entry) => ({
      id: typeof entry.id === "string" ? entry.id : "Sin id",
      status: typeof entry.status === "string" ? entry.status : "Sin estado",
      requestStatus: typeof entry.request_status === "string" ? entry.request_status : null,
      locationName:
        isRecord(entry.assigned_location) && typeof entry.assigned_location.name === "string"
          ? entry.assigned_location.name
          : "Sin ubicación",
      lineItems: Array.isArray(entry.line_items) ? entry.line_items.length : 0,
    }));
}

function buildOrderActivityFeed(
  order: Awaited<ReturnType<typeof fetchOrderById>>,
  incidents: Awaited<ReturnType<typeof fetchOrderIncidents>>,
) {
  if (!order || !incidents) {
    return [];
  }

  const activities: OrderActivity[] = [
    {
      id: `order-${order.id}`,
      occurredAt: order.created_at,
      title: "Pedido creado",
      description: `Pedido ${order.external_id} registrado para ${order.customer_name}.`,
      meta: "Inicio",
      icon: "○",
      tone: "neutral",
    },
  ];

  if (order.shipment) {
    activities.push({
      id: `shipment-${order.shipment.id}`,
      occurredAt: order.shipment.label_created_at ?? order.shipment.created_at,
      title: "Envío creado",
      description: `${order.shipment.carrier} · ${order.shipment.tracking_number}`,
      meta: "Shipment",
      icon: "□",
      tone: "accent",
    });
  }

  activities.push(
    ...sortTrackingEvents(order.shipment?.events ?? []).map((event) => ({
      id: `tracking-${event.id}`,
      occurredAt: event.occurred_at,
      title: event.status_norm,
      description: event.status_raw ?? "Actualización automática de tracking.",
      meta: "Tracking",
      icon: "➜",
      tone: "accent" as const,
    })),
  );

  activities.push(
    ...incidents.map((incident) => ({
      id: `incident-${incident.id}`,
      occurredAt: incident.updated_at,
      title: incident.title,
      description: incident.description ?? "Incidencia registrada sin detalle adicional.",
      meta: `Incidencia · ${incident.status}`,
      icon: "!",
      tone: "warning" as const,
    })),
  );

  return [...activities].sort((left, right) => {
    const dateDiff = new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime();
    if (dateDiff !== 0) {
      return dateDiff;
    }

    return left.id.localeCompare(right.id);
  });
}

function getShippingSnapshot(order: Awaited<ReturnType<typeof fetchOrderById>>): ShippingSnapshot | null {
  const snapshot = order?.shopify_shipping_snapshot_json;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return null;
  }
  return snapshot as ShippingSnapshot;
}

function buildAddressLines(parts: Array<string | null | undefined>) {
  return parts.map((part) => (part ?? "").trim()).filter(Boolean);
}


export default async function PortalOrderDetailPage({ params }: PortalOrderDetailPageProps) {
  await requirePortalUser();
  const { id } = await params;
  const token = await getAuthToken();
  const [order, incidents] = await Promise.all([
    fetchOrderById(id),
    fetchOrderIncidents(id),
  ]);

  if (!order || incidents === null) {
    notFound();
  }

  const catalogProducts = await fetchShopCatalogProducts(order.shop_id);

  const primaryItem = order.items[0] ?? null;
  const designPreviewUrl = getPrimaryDesignPreview(order.items);
  const primaryItemSummary = primaryItem ? getProductSummary(primaryItem, catalogProducts) : null;
  const activityFeed = buildOrderActivityFeed(order, incidents);
  const fulfillmentOrders = getFulfillmentOrders(order);
  const shippingSnapshot = getShippingSnapshot(order);
  const shopifyAddressLines = buildAddressLines([
    shippingSnapshot?.company,
    shippingSnapshot?.address1,
    shippingSnapshot?.address2,
    [shippingSnapshot?.zip, shippingSnapshot?.city].filter(Boolean).join(" "),
    [shippingSnapshot?.province, shippingSnapshot?.country].filter(Boolean).join(", "),
  ]);
  const operationalAddressLines = buildAddressLines([
    order.shipping_name,
    order.shipping_address_line1,
    order.shipping_address_line2,
    [order.shipping_postal_code, order.shipping_town].filter(Boolean).join(" "),
    order.shipping_country_code,
  ]);

  return (
    <div className="stack">
      <div className="detail-grid">
        <div className="stack">
          <Card className="card-soft stack order-hero-card">
            <div className="order-hero-topline">
              <div className="order-hero-copy">
                <div className="order-hero-heading">
                  <h1 className="order-hero-title">{order.external_id}</h1>
                  <div className="order-hero-badges">
                    <StatusBadge status={order.status} />
                    <ProductionBadge status={order.production_status} />
                    <PersonalizationBadge isPersonalized={order.is_personalized} />
                  </div>
                </div>
                <p className="order-hero-subtitle">
                  {order.customer_name}
                  <span className="order-hero-dot">·</span>
                  {order.customer_email}
                  <span className="order-hero-dot">·</span>
                  {formatDateTime(order.created_at)}
                </p>
              </div>
              <Link className="button-secondary order-hero-back" href="/portal/orders">
                Volver a pedidos
              </Link>
            </div>
          </Card>

          <Card className="stack">
            <SectionTitle eyebrow="📦 Producto" title="Contenido del pedido" />
            <div className="items-list">
              {order.items.map((item) => {
                const itemSummary = getProductSummary(item, catalogProducts);

                return (
                  <article className="item-card item-card-portal" key={item.id}>
                    <div className="item-head">
                      <div className="item-copy">
                        <div className="item-product-title">{itemSummary.productName}</div>
                        <div className="item-variant-title">{itemSummary.variantName}</div>
                      </div>
                      <span className="badge">x{item.quantity}</span>
                    </div>
                    <div className="item-meta-grid">
                      <div className="item-meta-pill">
                        <span className="kv-label">Unidades</span>
                        <strong>{item.quantity}</strong>
                      </div>
                      <div className="item-meta-pill">
                        <span className="kv-label">Cliente</span>
                        <strong>{order.customer_name}</strong>
                      </div>
                      <div className="item-meta-pill">
                        <span className="kv-label">Creado</span>
                        <strong>{formatDateTime(order.created_at)}</strong>
                      </div>
                    </div>
                    <div className="table-secondary item-note">
                      {item.personalization_notes ?? "Sin notas adicionales para este producto."}
                    </div>
                  </article>
                );
              })}

              {order.items.length === 0 ? (
                <EmptyState
                  title="Sin items cargados"
                  description="Este pedido aún no tiene líneas de producto disponibles."
                />
              ) : null}
            </div>
          </Card>

          <Card className="stack">
            <SectionTitle eyebrow="📋 Actividad" title="Timeline del pedido" />
            <div className="order-activity-timeline">
              {activityFeed.map((activity, index) => (
                <article className={`order-activity-card order-activity-card-${activity.tone}`} key={activity.id}>
                  <div className="order-activity-node">
                    <span className="order-activity-icon">{activity.icon}</span>
                    {index < activityFeed.length - 1 ? <div className="order-activity-connector" /> : null}
                  </div>
                  <div className="order-activity-topline">
                    <span className="order-activity-meta">{activity.meta}</span>
                    <span className="order-activity-date">{formatDateTime(activity.occurredAt)}</span>
                  </div>
                  <div className="order-activity-title">{activity.title}</div>
                  <div className="order-activity-description">{activity.description}</div>
                </article>
              ))}
            </div>
          </Card>

          <ShippingOptionsPanel order={order} token={token} />
        </div>

        <aside className="stack">
          <Card className="stack">
            <SectionTitle eyebrow="🎨 Diseño" title="Render de personalización" />
            {primaryItemSummary && designPreviewUrl ? (
              <div className="shipment-product-card">
                <div className="shipment-product-copy">
                  <span className="kv-label">Producto</span>
                  <div className="shipment-product-name">{primaryItemSummary.productName}</div>
                  <div className="shipment-product-variant">{primaryItemSummary.variantName}</div>
                </div>
                <div className="shipment-render-preview">
                  <DesignPreviewWithValidation
                    alt={`Render de ${primaryItemSummary.productName}`}
                    src={designPreviewUrl}
                    orderId={order.id}
                    itemId={primaryItem!.id}
                  />
                </div>
              </div>
            ) : (
              <EmptyState
                title="Sin render disponible"
                description="Todavía no hay una imagen renderizada o preview asociada a este pedido."
              />
            )}
          </Card>

          <Card className="stack">
            <SectionTitle eyebrow="🚚 Envío" title="Shipment" />
            {order.shipment ? (
              <div className="kv">
                <div className="kv-row">
                  <span className="kv-label">Carrier</span>
                  <div>{order.shipment.carrier}</div>
                </div>
                <div className="kv-row">
                  <span className="kv-label">Tracking</span>
                  <div>{order.shipment.tracking_number}</div>
                </div>
                <div className="kv-row">
                  <span className="kv-label">Creado</span>
                  <div>{formatDateTime(order.shipment.label_created_at ?? order.shipment.created_at)}</div>
                </div>
                <div className="kv-row">
                  <span className="kv-label">Estado envío</span>
                  <div>{order.shipment.shipping_status_detail ?? order.shipment.shipping_status ?? "Etiqueta creada"}</div>
                </div>
                <div className="kv-row">
                  <span className="kv-label">Servicio</span>
                  <div>{order.shipment.shipping_type_code ?? "CTT 24"}</div>
                </div>
                <div className="kv-row">
                  <span className="kv-label">Tramo</span>
                  <div>{order.shipment.weight_tier_label ?? "No definido"}</div>
                </div>
                <div className="kv-row">
                  <span className="kv-label">Tracking oficial</span>
                  <div>
                    {order.shipment.tracking_url ? (
                      <a className="table-link table-link-strong" href={order.shipment.tracking_url} rel="noreferrer" target="_blank">
                        Abrir tracking del carrier
                      </a>
                    ) : "Pendiente"}
                  </div>
                </div>
                <div className="kv-row">
                  <span className="kv-label">Tracking público</span>
                  <Link className="table-link table-link-strong" href={`/tracking/${order.shipment.public_token}`}>
                    Ver seguimiento
                  </Link>
                </div>
              </div>
            ) : (
              <EmptyState
                title="Envío pendiente"
                description="Todavía no hay shipment asociado a este pedido."
              />
            )}
          </Card>

          <Card className="stack">
            <SectionTitle eyebrow="📍 Dirección" title="Snapshot Shopify y dirección operativa" />
            <div className="kv">
              <div className="kv-row">
                <span className="kv-label">Shopify · contacto</span>
                <div>
                  {shippingSnapshot?.name || order.customer_name}
                  {shippingSnapshot?.email ? ` · ${shippingSnapshot.email}` : ""}
                  {shippingSnapshot?.phone ? ` · ${shippingSnapshot.phone}` : ""}
                </div>
              </div>
              <div className="kv-row">
                <span className="kv-label">Shopify · dirección</span>
                <div className="stack" style={{ gap: "6px" }}>
                  {shopifyAddressLines.length > 0 ? (
                    shopifyAddressLines.map((line) => <span key={line}>{line}</span>)
                  ) : (
                    <span>Sin snapshot de dirección todavía</span>
                  )}
                </div>
              </div>
              <div className="kv-row">
                <span className="kv-label">Operativa · CTT</span>
                <div className="stack" style={{ gap: "6px" }}>
                  {operationalAddressLines.length > 0 ? (
                    operationalAddressLines.map((line) => <span key={line}>{line}</span>)
                  ) : (
                    <span>Sin dirección operativa cargada</span>
                  )}
                </div>
              </div>
              <div className="kv-row">
                <span className="kv-label">Validación rápida</span>
                <div>
                  {order.shipping_address_line1 && order.shipping_postal_code && order.shipping_town
                    ? "La dirección interna está lista para crear etiqueta."
                    : "Faltan datos en la dirección interna; conviene resincronizar Shopify antes de etiquetar."}
                </div>
              </div>
            </div>
          </Card>

          {fulfillmentOrders.length > 0 ? (
            <Card className="stack">
              <SectionTitle eyebrow="🛒 Shopify" title="Preparación de envío" />
              <div className="mini-table">
                {fulfillmentOrders.map((fulfillmentOrder) => (
                  <div className="mini-table-row" key={fulfillmentOrder.id}>
                    <div>
                      <div className="table-primary">{fulfillmentOrder.locationName}</div>
                      <div className="table-secondary">
                        {fulfillmentOrder.status}
                        {fulfillmentOrder.requestStatus ? ` · ${fulfillmentOrder.requestStatus}` : ""}
                      </div>
                    </div>
                    <div className="mini-table-metrics">
                      <span>{fulfillmentOrder.lineItems} líneas</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
