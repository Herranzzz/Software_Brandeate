import Link from "next/link";
import { notFound } from "next/navigation";

import { AutomationFlagBadge } from "@/components/automation-flag-badge";
import { Card } from "@/components/card";
import { CopyButton } from "@/components/copy-button";
import { CttShipmentButton } from "@/components/ctt-shipment-button";
import { DesignStatusBadge } from "@/components/design-status-badge";
import { EmptyState } from "@/components/empty-state";
import { OrderActionModals } from "@/components/order-action-modals";
import { OrderIncidentsPanel } from "@/components/order-incidents-panel";
import { PersonalizationBadge } from "@/components/personalization-badge";
import { ProductionBadge } from "@/components/production-badge";
import { DesignPreviewWithValidation } from "@/components/design-preview-with-validation";
import { SectionTitle } from "@/components/section-title";
import { StatusBadge } from "@/components/status-badge";
import { ShippingOptionsPanel } from "@/components/shipping-options-panel";
import { fetchOrderById, fetchOrderIncidents, fetchShopCatalogProducts } from "@/lib/api";
import { getAuthToken, requireAdminUser } from "@/lib/auth";
import { getOrderShipmentLabelUrl } from "@/lib/ctt";
import { formatDateTime, getDesignStatusLabel, sortTrackingEvents } from "@/lib/format";
import { getVisibleAssets, getPrimaryDesignPreview } from "@/lib/personalization";
import type { OrderItem, ShopCatalogProduct } from "@/lib/types";

type OrderDetailPageProps = {
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
      fulfillments: Array.isArray(entry.fulfillments) ? entry.fulfillments.length : 0,
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

    if (order.shipment.shopify_synced_at) {
      activities.push({
        id: `shopify-sync-${order.shipment.id}`,
        occurredAt: order.shipment.shopify_synced_at,
        title: "Tracking enviado a Shopify",
        description: order.shipment.fulfillment_id
          ? `Fulfillment ${order.shipment.fulfillment_id}`
          : "Fulfillment y tracking sincronizados",
        meta: "Shopify",
        icon: "⇄",
        tone: "accent",
      });
    } else if (order.shipment.shopify_sync_status === "failed" && order.shipment.shopify_last_sync_attempt_at) {
      activities.push({
        id: `shopify-sync-failed-${order.shipment.id}`,
        occurredAt: order.shipment.shopify_last_sync_attempt_at,
        title: "Sync con Shopify fallida",
        description: order.shipment.shopify_sync_error ?? "No se pudo actualizar fulfillment en Shopify.",
        meta: "Shopify",
        icon: "!",
        tone: "warning",
      });
    }
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

function getItemDesignStatus(item: OrderItem) {
  if (item.design_status === "design_available") {
    return { label: getDesignStatusLabel("design_available"), tone: "success" as const };
  }

  if (item.design_status === "pending_asset") {
    return { label: getDesignStatusLabel("pending_asset"), tone: "warning" as const };
  }

  if (item.design_status === "missing_asset") {
    return { label: getDesignStatusLabel("missing_asset"), tone: "danger" as const };
  }

  return { label: "Sin diseño", tone: "default" as const };
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

export default async function OrderDetailPage({ params }: OrderDetailPageProps) {
  const [, { id }] = await Promise.all([requireAdminUser(), params]);
  const token = await getAuthToken();

  let order: Awaited<ReturnType<typeof fetchOrderById>>;
  let incidents: Awaited<ReturnType<typeof fetchOrderIncidents>>;
  try {
    [order, incidents] = await Promise.all([
      fetchOrderById(id),
      fetchOrderIncidents(id),
    ]);
  } catch {
    notFound();
  }

  if (!order || incidents === null) {
    notFound();
  }

  let catalogProducts: ShopCatalogProduct[] = [];
  try {
    catalogProducts = await fetchShopCatalogProducts(order.shop_id);
  } catch {
    // Non-critical — continue without catalog data
  }
  const primaryItem = order.items[0] ?? null;
  const designPreviewUrl = getPrimaryDesignPreview(order.items);
  const primaryItemSummary = primaryItem ? getProductSummary(primaryItem, catalogProducts) : null;
  const activityFeed = buildOrderActivityFeed(order, incidents);
  const fulfillmentOrders = getFulfillmentOrders(order);
  const shipmentLabelUrl = getOrderShipmentLabelUrl(order);
  const shipmentLabelDownloadUrl = getOrderShipmentLabelUrl(order, { download: true });
  const shipmentLabelThermalUrl = getOrderShipmentLabelUrl(order, { download: true, labelType: "ZPL" });
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

          {/* ── Hero ─────────────────────────────────────────────── */}
          <div className="order-hero-v2">
            <div className="order-hero-v2-top">
              <div>
                <div className="order-hero-v2-id">{order.external_id}</div>
                <div className="order-hero-v2-badges">
                  <StatusBadge status={order.status} />
                  <ProductionBadge status={order.production_status} />
                  <PersonalizationBadge isPersonalized={order.is_personalized} />
                </div>
                <div className="order-hero-v2-sub">
                  <span>{order.customer_name}</span>
                  <span className="order-hero-v2-dot">·</span>
                  <span>{order.customer_email}</span>
                  <span className="order-hero-v2-dot">·</span>
                  <span>Shop #{order.shop_id}</span>
                  <span className="order-hero-v2-dot">·</span>
                  <span>{formatDateTime(order.created_at)}</span>
                </div>
              </div>
              <div className="order-hero-v2-actions">
                <Link className="button-secondary" href="/orders">
                  ← Volver
                </Link>
                <CttShipmentButton order={order} />
                <OrderActionModals orderId={order.id} shipment={order.shipment} />
              </div>
            </div>
          </div>

          {/* ── Items ────────────────────────────────────────────── */}
          <Card className="stack">
            <SectionTitle eyebrow="📦 Producto" title="Contenido del pedido" />
            <div className="items-list">
              {order.items.map((item) => {
                const itemSummary = getProductSummary(item, catalogProducts);
                const designStatus = getItemDesignStatus(item);

                return (
                  <article className="order-item-card-v2" key={item.id}>
                    <div className="order-item-v2-head">
                      <div>
                        <div className="order-item-v2-name">{itemSummary.productName}</div>
                        <div className="order-item-v2-variant">{itemSummary.variantName}</div>
                      </div>
                      <span className="badge">×{item.quantity}</span>
                    </div>
                    <div className="order-item-v2-pills">
                      <div className="order-item-v2-pill">
                        <span className="kv-label">Unidades</span>
                        <strong>{item.quantity}</strong>
                      </div>
                      <div className="order-item-v2-pill">
                        <span className="kv-label">SKU</span>
                        <strong>{item.sku || "Sin SKU"}</strong>
                      </div>
                      <div className="order-item-v2-pill">
                        <span className="kv-label">Diseño</span>
                        {item.design_status
                          ? <DesignStatusBadge status={item.design_status} />
                          : <span className="badge badge-design badge-design-default">{designStatus.label}</span>
                        }
                      </div>
                      <div className="order-item-v2-pill">
                        <span className="kv-label">Assets</span>
                        <strong>{getVisibleAssets(item).length}</strong>
                      </div>
                    </div>
                    {item.personalization_notes && (
                      <div className="table-secondary" style={{ fontSize: "0.82rem" }}>
                        {item.personalization_notes}
                      </div>
                    )}
                  </article>
                );
              })}

              {order.items.length === 0 && (
                <EmptyState
                  title="Sin items cargados"
                  description="Este pedido todavía no tiene líneas de producto disponibles."
                />
              )}
            </div>
          </Card>

          {/* ── Activity timeline ─────────────────────────────────── */}
          <Card className="stack">
            <SectionTitle eyebrow="📋 Actividad" title="Timeline del pedido" />
            <div className="order-timeline-v">
              {activityFeed.map((activity, index) => (
                <div
                  className={`order-timeline-item is-${activity.tone}`}
                  key={activity.id}
                >
                  <div className="order-timeline-rail">
                    <div className="order-timeline-node">{activity.icon}</div>
                    {index < activityFeed.length - 1 && (
                      <div className="order-timeline-spine" />
                    )}
                  </div>
                  <div className="order-timeline-content">
                    <div className="order-timeline-topline">
                      <span className="order-timeline-label">{activity.meta}</span>
                      <span className="order-timeline-date">{formatDateTime(activity.occurredAt)}</span>
                    </div>
                    <div className="order-timeline-title">{activity.title}</div>
                    <div className="order-timeline-desc">{activity.description}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* ── Automation ────────────────────────────────────────── */}
          <Card className="stack">
            <SectionTitle eyebrow="⚡ Automatización" title="Reglas aplicadas" />
            {(order.automation_flags ?? []).length > 0 || (order.automation_events?.length ?? 0) > 0 ? (
              <div className="stack">
                {(order.automation_flags ?? []).length > 0 && (
                  <div className="automation-flag-row">
                    {(order.automation_flags ?? []).map((flag) => (
                      <AutomationFlagBadge flag={flag} key={`${order.id}-${flag.key}`} />
                    ))}
                  </div>
                )}
                {order.automation_events && order.automation_events.length > 0 && (
                  <div className="mini-table">
                    {order.automation_events.slice(0, 8).map((event) => (
                      <div className="mini-table-row" key={event.id}>
                        <div>
                          <div className="table-primary">{event.summary}</div>
                          <div className="table-secondary">
                            {event.rule_name} · {event.action_type}
                          </div>
                        </div>
                        <div className="mini-table-metrics">
                          <span>{formatDateTime(event.created_at)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <EmptyState
                title="Sin automatizaciones activas"
                description="Este pedido no ha disparado reglas automáticas visibles por ahora."
              />
            )}
          </Card>

          {/* ── CTT Pickup selector ───────────────────────────────── */}
          <ShippingOptionsPanel order={order} token={token} />
        </div>

        {/* ── Aside ──────────────────────────────────────────────── */}
        <aside className="stack">

          {/* Design preview */}
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
                    itemId={primaryItem.id}
                    orderId={order.id}
                    src={designPreviewUrl}
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

          {/* Incidents */}
          <Card className="stack">
            <SectionTitle eyebrow="⚠️ Incidencias" title="Seguimiento del pedido" />
            <OrderIncidentsPanel incidents={incidents} orderId={order.id} />
          </Card>

          {/* Shipment details */}
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
                  <div className="order-inline-actions">
                    <span>{order.shipment.tracking_number}</span>
                    <CopyButton value={order.shipment.tracking_number} />
                  </div>
                </div>
                <div className="kv-row">
                  <span className="kv-label">Creado</span>
                  <div>{formatDateTime(order.shipment.label_created_at ?? order.shipment.created_at)}</div>
                </div>
                <div className="kv-row">
                  <span className="kv-label">Estado</span>
                  <div>{order.shipment.shipping_status_detail ?? order.shipment.shipping_status ?? "Etiqueta creada"}</div>
                </div>
                <div className="kv-row">
                  <span className="kv-label">Servicio CTT</span>
                  <div>{order.shipment.shipping_type_code ?? "C24"}</div>
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
                        Abrir tracking →
                      </a>
                    ) : "Pendiente"}
                  </div>
                </div>
                <div className="kv-row">
                  <span className="kv-label">Etiqueta</span>
                  <div className="order-inline-actions">
                    {shipmentLabelUrl ? (
                      <>
                        <a className="table-link table-link-strong" href={shipmentLabelUrl} rel="noreferrer" target="_blank">Ver PDF</a>
                        <a className="table-link" download href={shipmentLabelDownloadUrl ?? shipmentLabelUrl} rel="noreferrer" target="_blank">Descargar</a>
                        <a className="table-link" download href={shipmentLabelThermalUrl ?? "#"} rel="noreferrer" target="_blank">ZPL</a>
                      </>
                    ) : "No disponible"}
                  </div>
                </div>
                <div className="kv-row">
                  <span className="kv-label">Shopify</span>
                  <div>
                    {order.shipment.shopify_sync_status === "synced"
                      ? "Sincronizado"
                      : order.shipment.shopify_sync_status === "failed"
                        ? order.shipment.shopify_sync_error ?? "Sync fallida"
                        : order.shipment.shopify_sync_status === "not_configured"
                          ? "Sin integración"
                          : "Pendiente"}
                  </div>
                </div>
                <div className="kv-row">
                  <span className="kv-label">Tracking público</span>
                  <div className="order-inline-actions">
                    <Link className="table-link table-link-strong" href={`/tracking/${order.shipment.public_token}`}>
                      /tracking/{order.shipment.public_token}
                    </Link>
                    <CopyButton value={`/tracking/${order.shipment.public_token}`} />
                  </div>
                </div>
              </div>
            ) : (
              <EmptyState
                title="Sin shipment asociado"
                description="Este pedido todavía no tiene shipment, carrier ni tracking asignado."
              />
            )}
          </Card>

          {/* Address */}
          <Card className="stack">
            <SectionTitle eyebrow="📍 Dirección" title="Snapshot y dirección operativa" />
            <div className="kv">
              <div className="kv-row">
                <span className="kv-label">Contacto Shopify</span>
                <div>
                  {shippingSnapshot?.name || order.customer_name}
                  {shippingSnapshot?.email ? ` · ${shippingSnapshot.email}` : ""}
                  {shippingSnapshot?.phone ? ` · ${shippingSnapshot.phone}` : ""}
                </div>
              </div>
              <div className="kv-row">
                <span className="kv-label">Dirección Shopify</span>
                <div className="stack" style={{ gap: "4px" }}>
                  {shopifyAddressLines.length > 0
                    ? shopifyAddressLines.map((line) => <span key={line}>{line}</span>)
                    : <span>Sin snapshot todavía</span>
                  }
                </div>
              </div>
              <div className="kv-row">
                <span className="kv-label">Dirección CTT</span>
                <div className="stack" style={{ gap: "4px" }}>
                  {operationalAddressLines.length > 0
                    ? operationalAddressLines.map((line) => <span key={line}>{line}</span>)
                    : <span>Sin dirección operativa</span>
                  }
                </div>
              </div>
              <div className="kv-row">
                <span className="kv-label">Validación</span>
                <div>
                  {order.shipping_address_line1 && order.shipping_postal_code && order.shipping_town
                    ? "Dirección lista para etiquetar."
                    : "Faltan datos — resincroniza Shopify antes de etiquetar."}
                </div>
              </div>
            </div>
          </Card>

          {/* Fulfillment orders */}
          {fulfillmentOrders.length > 0 && (
            <Card className="stack">
              <SectionTitle eyebrow="🛒 Shopify" title="Fulfillment orders" />
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
                      <span>{fulfillmentOrder.fulfillments} fulfillments</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
