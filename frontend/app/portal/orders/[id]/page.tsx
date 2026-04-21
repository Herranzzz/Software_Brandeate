import Link from "next/link";
import { notFound } from "next/navigation";

import { Card } from "@/components/card";
import { EmptyState } from "@/components/empty-state";
import { OrderCollabPanel } from "@/components/order-collab-panel";
import { OrderIncidentsPanel } from "@/components/order-incidents-panel";
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
    ...incidents
      .filter((incident) => incident.status !== "resolved")
      .map((incident) => ({
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
  const currentUser = await requirePortalUser();
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
            <SectionTitle eyebrow="⚠️ Incidencias" title="Seguimiento del pedido" />
            <OrderIncidentsPanel incidents={incidents} orderId={order.id} />
          </Card>

          <Card className="stack">
            <OrderCollabPanel
              orderId={order.id}
              shopId={order.shop_id}
              currentUserId={currentUser.id}
              currentUserName={currentUser.name}
            />
          </Card>

          <Card className="stack">
            <SectionTitle eyebrow="🚚 Envío" title="Shipment" />
            {order.shipment ? (
              <div className="kv">

                {/* — Identificación — */}
                <div className="kv-row">
                  <span className="kv-label">Carrier</span>
                  <div>{order.shipment.carrier}</div>
                </div>
                <div className="kv-row">
                  <span className="kv-label">Tracking</span>
                  <div>{order.shipment.tracking_number}</div>
                </div>
                {order.shipment.provider_reference && (
                  <div className="kv-row">
                    <span className="kv-label">Referencia CTT</span>
                    <div className="table-secondary">{order.shipment.provider_reference}</div>
                  </div>
                )}
                <div className="kv-row">
                  <span className="kv-label">Servicio</span>
                  <div>{order.shipment.shipping_type_code ?? "CTT 24"}</div>
                </div>
                <div className="kv-row">
                  <span className="kv-label">Etiqueta creada</span>
                  <div>{formatDateTime(order.shipment.label_created_at ?? order.shipment.created_at)}</div>
                </div>

                {/* — Estado — */}
                <div className="kv-row">
                  <span className="kv-label">Estado envío</span>
                  <div>{order.shipment.shipping_status_detail ?? order.shipment.shipping_status ?? "Etiqueta creada"}</div>
                </div>
                {order.shipment.ctt_info?.incident_type_name && (
                  <div className="kv-row">
                    <span className="kv-label" style={{ color: "var(--color-warning, #c05)" }}>Incidencia CTT</span>
                    <div style={{ color: "var(--color-warning, #c05)" }}>
                      {order.shipment.ctt_info.incident_type_name}
                      {order.shipment.ctt_info.incident_type_code ? ` (${order.shipment.ctt_info.incident_type_code})` : ""}
                      {order.shipment.ctt_info.incident_type_desc ? (
                        <div className="table-secondary" style={{ marginTop: 2 }}>{order.shipment.ctt_info.incident_type_desc}</div>
                      ) : null}
                    </div>
                  </div>
                )}
                {order.shipment.ctt_info?.management_type && (
                  <div className="kv-row">
                    <span className="kv-label">Gestión disponible</span>
                    <div>{order.shipment.ctt_info.management_type}</div>
                  </div>
                )}

                {/* — Peso — */}
                <div className="kv-row">
                  <span className="kv-label">Tramo de peso</span>
                  <div>{order.shipment.weight_tier_label ?? "No definido"}</div>
                </div>
                {order.shipment.shipping_weight_declared != null && (
                  <div className="kv-row">
                    <span className="kv-label">Peso declarado</span>
                    <div>{order.shipment.shipping_weight_declared} kg</div>
                  </div>
                )}
                {(order.shipment.final_weight != null || order.shipment.ctt_info?.final_weight != null) && (
                  <div className="kv-row">
                    <span className="kv-label">Peso final CTT</span>
                    <div style={{ fontWeight: 600 }}>
                      {(order.shipment.final_weight ?? order.shipment.ctt_info?.final_weight)} kg
                      <span className="table-secondary" style={{ fontWeight: 400, marginLeft: 6 }}>tasado por CTT</span>
                    </div>
                  </div>
                )}
                {order.shipment.package_count != null && (
                  <div className="kv-row">
                    <span className="kv-label">Bultos</span>
                    <div>{order.shipment.package_count}</div>
                  </div>
                )}

                {/* — Fechas — */}
                {order.shipment.ctt_info?.committed_delivery_datetime && (
                  <div className="kv-row">
                    <span className="kv-label">Compromiso CTT</span>
                    <div>{order.shipment.ctt_info.committed_delivery_datetime}</div>
                  </div>
                )}
                {order.shipment.expected_delivery_date && (
                  <div className="kv-row">
                    <span className="kv-label">Entrega estimada</span>
                    <div>{order.shipment.expected_delivery_date}</div>
                  </div>
                )}
                {order.shipment.ctt_info?.reported_delivery_date && (
                  <div className="kv-row">
                    <span className="kv-label">Fecha comunicada</span>
                    <div>{order.shipment.ctt_info.reported_delivery_date}</div>
                  </div>
                )}
                {order.shipment.ctt_info?.delivery_date && (
                  <div className="kv-row">
                    <span className="kv-label">Entrega real</span>
                    <div style={{ fontWeight: 600 }}>{order.shipment.ctt_info.delivery_date}</div>
                  </div>
                )}

                {/* — Ruta — */}
                {order.shipment.detected_zone && (
                  <div className="kv-row">
                    <span className="kv-label">Zona</span>
                    <div>{order.shipment.detected_zone}</div>
                  </div>
                )}
                {order.shipment.ctt_info?.origin && (
                  <div className="kv-row">
                    <span className="kv-label">Origen CTT</span>
                    <div>{order.shipment.ctt_info.origin}</div>
                  </div>
                )}
                {order.shipment.ctt_info?.destination && (
                  <div className="kv-row">
                    <span className="kv-label">Destino CTT</span>
                    <div>{order.shipment.ctt_info.destination}</div>
                  </div>
                )}

                {/* — Regla y coste — */}
                {order.shipment.shipping_rule_name && (
                  <div className="kv-row">
                    <span className="kv-label">Regla de envío</span>
                    <div className="table-secondary">{order.shipment.shipping_rule_name}</div>
                  </div>
                )}
                <div className="kv-row">
                  <span className="kv-label">Coste envío</span>
                  <div style={{ fontWeight: 600 }}>
                    {order.shipment.shipping_cost != null
                      ? new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(order.shipment.shipping_cost)
                      : order.shipping_rate_amount != null
                        ? new Intl.NumberFormat("es-ES", { style: "currency", currency: order.shipping_rate_currency ?? "EUR" }).format(order.shipping_rate_amount)
                        : "Pendiente"}
                  </div>
                </div>

                {/* — Shopify sync — */}
                <div className="kv-row">
                  <span className="kv-label">Shopify fulfillment</span>
                  <div>
                    {order.shipment.shopify_sync_status === "success"
                      ? `Sincronizado${order.shipment.shopify_synced_at ? ` · ${formatDateTime(order.shipment.shopify_synced_at)}` : ""}`
                      : order.shipment.shopify_sync_status === "failed"
                        ? <span style={{ color: "var(--color-warning, #c05)" }}>Error en sync{order.shipment.shopify_sync_error ? `: ${order.shipment.shopify_sync_error}` : ""}</span>
                        : order.shipment.shopify_sync_status ?? "Pendiente"}
                  </div>
                </div>

                {/* — Último sync CTT — */}
                {order.shipment.ctt_info?.last_synced_at && (
                  <div className="kv-row">
                    <span className="kv-label">Último sync CTT</span>
                    <div className="table-secondary">{formatDateTime(order.shipment.ctt_info.last_synced_at)}</div>
                  </div>
                )}

                {/* — Links — */}
                <div className="kv-row">
                  <span className="kv-label">Tracking oficial</span>
                  <div>
                    {order.shipment.tracking_url ? (
                      <a className="table-link table-link-strong" href={order.shipment.tracking_url} rel="noreferrer" target="_blank">
                        Abrir tracking CTT
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
