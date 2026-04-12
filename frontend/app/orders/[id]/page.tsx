import Link from "next/link";
import { notFound } from "next/navigation";

import { AutomationFlagBadge } from "@/components/automation-flag-badge";
import { ActivityTimelineLoader } from "@/components/activity-timeline";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { OrderBlockButton } from "@/components/order-block-button";
import { OrderInternalNote } from "@/components/order-internal-note";
import { SlaBadge } from "@/components/sla-badge";
import { Card } from "@/components/card";
import { CopyButton } from "@/components/copy-button";
import { CttShipmentButton } from "@/components/ctt-shipment-button";
import { DesignStatusBadge } from "@/components/design-status-badge";
import { EmptyState } from "@/components/empty-state";
import { OrderActionModals } from "@/components/order-action-modals";
import { OrderIncidentsPanel } from "@/components/order-incidents-panel";
import { PersonalizationBadge } from "@/components/personalization-badge";
import { DesignPreviewWithValidation } from "@/components/design-preview-with-validation";
import { PrintCutlinePreview } from "@/components/print-cutline-preview";
import { SectionTitle } from "@/components/section-title";
import { StatusBadge } from "@/components/status-badge";
import { ShippingOptionsPanel } from "@/components/shipping-options-panel";
import { fetchOrderById, fetchOrderIncidents, fetchShopCatalogProducts } from "@/lib/api";
import { getAuthToken, requireAdminUser } from "@/lib/auth";
import { getOrderShipmentLabelUrl, getShipmentPodUrl } from "@/lib/ctt";
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

const TRACKING_NORM_LABELS: Record<string, string> = {
  delivered: "Entregado",
  out_for_delivery: "En reparto",
  in_transit: "En tránsito",
  pickup_available: "Disponible para recogida",
  attempted_delivery: "Intento de entrega fallido",
  exception: "Incidencia de carrier",
  label_created: "Etiqueta generada",
};

function getTrackingNormLabel(norm: string): string {
  return TRACKING_NORM_LABELS[norm.toLowerCase()] ?? norm;
}

function getTrackingIcon(norm: string): string {
  switch (norm.toLowerCase()) {
    case "delivered": return "✓";
    case "out_for_delivery": return "🚛";
    case "in_transit": return "🚚";
    case "exception": return "⚠";
    case "label_created": return "🏷";
    default: return "→";
  }
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
      icon: "📦",
      tone: "neutral",
    },
  ];

  if (order.shipment) {
    activities.push({
      id: `shipment-${order.shipment.id}`,
      occurredAt: order.shipment.label_created_at ?? order.shipment.created_at,
      title: "Etiqueta de envío creada",
      description: `${order.shipment.carrier} · ${order.shipment.tracking_number}`,
      meta: "Envío",
      icon: "🏷️",
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
        icon: "✕",
        tone: "warning",
      });
    }
  }

  activities.push(
    ...sortTrackingEvents(order.shipment?.events ?? []).map((event) => ({
      id: `tracking-${event.id}`,
      occurredAt: event.occurred_at,
      title: getTrackingNormLabel(event.status_norm),
      description: [
        event.status_raw && event.status_raw !== event.status_norm && !isInternalCode(event.status_raw) ? event.status_raw : null,
        event.location ? `📍 ${event.location}` : null,
      ].filter(Boolean).join(" — ") || "Actualización automática de tracking.",
      meta: "Tracking",
      icon: getTrackingIcon(event.status_norm),
      tone: event.status_norm.toLowerCase() === "exception" ? "warning" as const : "accent" as const,
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
      icon: "⚠️",
      tone: "warning" as const,
      })),
  );

  return [...activities].sort((left, right) => {
    const dateDiff = new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime();
    if (dateDiff !== 0) return dateDiff;
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
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  return snapshot as ShippingSnapshot;
}

function buildAddressLines(parts: Array<string | null | undefined>) {
  return parts.map((part) => (part ?? "").trim()).filter(Boolean);
}

function getOrderAge(createdAt: string): string {
  const diff = Date.now() - new Date(createdAt).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "Hoy";
  if (days === 1) return "Ayer";
  return `Hace ${days} días`;
}

function getShipmentStatusColor(status: string | null | undefined): string {
  if (!status) return "slate";
  if (status === "delivered") return "green";
  if (status === "out_for_delivery") return "orange";
  if (status === "in_transit" || status === "picked_up") return "blue";
  if (status === "exception" || status === "stalled") return "red";
  return "slate";
}

function isInternalCode(s: string): boolean {
  return /^[a-z0-9_]+:[A-Z_]+$/i.test(s.trim()) || /^[A-Z_]{5,}$/.test(s.trim());
}

const SHIPPING_STATUS_LABELS: Record<string, string> = {
  delivered: "Entregado",
  out_for_delivery: "En reparto",
  in_transit: "En tránsito",
  picked_up: "Recogido",
  pickup_available: "Disponible para recogida",
  attempted_delivery: "Intento fallido",
  exception: "Incidencia",
  stalled: "Sin novedades",
  label_created: "Etiqueta creada",
};

function translateShippingStatus(status: string | null | undefined): string {
  if (!status) return "Sin envío";
  return SHIPPING_STATUS_LABELS[status.toLowerCase()] ?? status;
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

  if (!order || incidents === null) notFound();

  let catalogProducts: ShopCatalogProduct[] = [];
  try {
    catalogProducts = await fetchShopCatalogProducts(order.shop_id);
  } catch {
    // Non-critical
  }

  const primaryItem = order.items[0] ?? null;
  const designPreviewUrl = getPrimaryDesignPreview(order.items);
  const primaryItemSummary = primaryItem ? getProductSummary(primaryItem, catalogProducts) : null;
  const activityFeed = buildOrderActivityFeed(order, incidents);
  const fulfillmentOrders = getFulfillmentOrders(order);
  const shipmentLabelUrl = getOrderShipmentLabelUrl(order);
  const shipmentLabelDownloadUrl = getOrderShipmentLabelUrl(order, { download: true });
  const shipmentLabelThermalUrl = getOrderShipmentLabelUrl(order, { download: true, labelType: "ZPL" });
  const shipmentPodUrl = getShipmentPodUrl(order.shipment);
  const isDelivered = order.shipment?.shipping_status === "delivered";
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
  const openIncidents = incidents.filter((i) => i.status !== "resolved");
  const shipmentStatusColor = getShipmentStatusColor(order.shipment?.shipping_status);

  return (
    <div className="stack">
      <Breadcrumbs items={[
        { label: "Pedidos", href: "/orders" },
        { label: `#${order.external_id}` },
      ]} />

      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <div className="order-detail-hero">
        <div className="order-detail-hero-main">
          <div className="order-detail-hero-id-row">
            <h1 className="order-detail-id">{order.external_id}</h1>
            <div className="order-detail-badges">
              <StatusBadge status={order.status} />
              <PersonalizationBadge isPersonalized={order.is_personalized} />
              {order.is_blocked && (
                <span className="order-detail-blocked-badge">Bloqueado</span>
              )}
              {openIncidents.length > 0 && (
                <span className="order-detail-incident-badge">
                  {openIncidents.length} incidencia{openIncidents.length !== 1 ? "s" : ""}
                </span>
              )}
              <SlaBadge
                expectedDeliveryDate={order.shipment?.expected_delivery_date}
                shippingStatus={order.shipment?.shipping_status}
              />
            </div>
          </div>

          <div className="order-detail-customer-row">
            <span className="order-detail-customer-name">{order.customer_name}</span>
            <span className="order-detail-sep">·</span>
            <a className="order-detail-customer-email" href={`mailto:${order.customer_email}`}>
              {order.customer_email}
            </a>
            <span className="order-detail-sep">·</span>
            <span className="order-detail-meta">{getOrderAge(order.created_at)}</span>
            <span className="order-detail-sep">·</span>
            <span className="order-detail-meta">{formatDateTime(order.created_at)}</span>
          </div>

          {/* Quick stats strip */}
          <div className="order-detail-stats">
            <div className="order-detail-stat">
              <span className="order-detail-stat-label">Items</span>
              <strong>{order.items.length}</strong>
            </div>
            <div className="order-detail-stat">
              <span className="order-detail-stat-label">Carrier</span>
              <strong>{order.shipment?.carrier ?? "—"}</strong>
            </div>
            <div className={`order-detail-stat is-${shipmentStatusColor}`}>
              <span className="order-detail-stat-label">Estado envío</span>
              <strong>{translateShippingStatus(order.shipment?.shipping_status)}</strong>
            </div>
            {order.shipment?.expected_delivery_date && (
              <div className="order-detail-stat">
                <span className="order-detail-stat-label">Entrega prevista</span>
                <strong>{new Date(order.shipment.expected_delivery_date).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}</strong>
              </div>
            )}
            <div className="order-detail-stat">
              <span className="order-detail-stat-label">Shopify</span>
              <strong>{order.shipment?.shopify_sync_status === "synced" ? "✓ Sync" : order.shipment?.shopify_sync_status === "failed" ? "✕ Error" : order.shipment ? "Pendiente" : "—"}</strong>
            </div>
          </div>
        </div>

        <div className="order-detail-hero-actions">
          <Link className="button button-secondary" href="/orders">← Volver</Link>
          <Link className="button button-secondary" href={`/orders/${order.id}/packing-slip`} rel="noreferrer" target="_blank">Albarán</Link>
          <OrderBlockButton order={order} />
          <CttShipmentButton order={order} />
          <OrderActionModals orderId={order.id} shipment={order.shipment} />
        </div>
      </div>

      {order.is_blocked && (
        <div className="order-blocked-alert">
          <strong>Pedido bloqueado</strong>
          {order.block_reason && <span> — {order.block_reason}</span>}
        </div>
      )}

      <div className="detail-grid">
        <div className="stack">

          {/* ── Items ──────────────────────────────────────────────── */}
          <Card className="stack">
            <SectionTitle eyebrow="Contenido" title="Productos del pedido" />
            <div className="order-items-grid">
              {order.items.map((item) => {
                const itemSummary = getProductSummary(item, catalogProducts);
                const designStatus = getItemDesignStatus(item);
                const assets = getVisibleAssets(item);
                const previewUrl = assets[0]?.url ?? null;

                return (
                  <article className="order-item-ficha" key={item.id}>
                    {previewUrl && (
                      <div className="order-item-ficha-thumb">
                        <DesignPreviewWithValidation
                          alt={`Preview ${itemSummary.productName}`}
                          itemId={item.id}
                          orderId={order.id}
                          src={previewUrl}
                        />
                      </div>
                    )}
                    <div className="order-item-ficha-body">
                      <div className="order-item-ficha-title">{itemSummary.productName}</div>
                      <div className="order-item-ficha-variant">{itemSummary.variantName}</div>
                      {item.personalization_notes && (
                        <div className="order-item-ficha-notes">{item.personalization_notes}</div>
                      )}
                      <div className="order-item-ficha-pills">
                        <div className="order-item-ficha-pill">
                          <span>×{item.quantity}</span>
                        </div>
                        {item.sku && (
                          <div className="order-item-ficha-pill">
                            <span className="order-item-ficha-pill-label">SKU</span>
                            <strong>{item.sku}</strong>
                          </div>
                        )}
                        <div className="order-item-ficha-pill">
                          {item.design_status
                            ? <DesignStatusBadge status={item.design_status} />
                            : <span className="badge badge-design badge-design-default">{designStatus.label}</span>
                          }
                        </div>
                        {assets.length > 0 && (
                          <div className="order-item-ficha-pill">
                            <span className="order-item-ficha-pill-label">Assets</span>
                            <strong>{assets.length}</strong>
                          </div>
                        )}
                        {item.design_link && (
                          <a
                            className="order-item-ficha-pill order-item-ficha-link"
                            href={item.design_link}
                            rel="noreferrer"
                            target="_blank"
                          >
                            Abrir diseño →
                          </a>
                        )}
                      </div>
                    </div>
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

          {/* ── Shipment ───────────────────────────────────────────── */}
          <Card className={`stack order-shipment-card order-shipment-card-${shipmentStatusColor}`}>
            <SectionTitle eyebrow="Envío" title="Estado del envío" />
            {order.shipment ? (
              <div className="order-shipment-body">
                {/* Top row: carrier + status + tracking */}
                <div className="order-shipment-top">
                  <div className="order-shipment-carrier-block">
                    <span className="order-shipment-carrier-name">{order.shipment.carrier}</span>
                    <span className={`order-shipment-status-pill is-${shipmentStatusColor}`}>
                      {translateShippingStatus(order.shipment.shipping_status)}
                    </span>
                  </div>
                  <div className="order-shipment-tracking-block">
                    <span className="order-kv-label">Nº seguimiento</span>
                    <span className="order-kv-value order-kv-actions">
                      <span className="order-shipment-tracking-num">{order.shipment.tracking_number}</span>
                      <CopyButton value={order.shipment.tracking_number} />
                    </span>
                  </div>
                </div>

                {/* KV grid */}
                <div className="order-kv-list order-kv-list-cols">
                  <div className="order-kv-item">
                    <span className="order-kv-label">Servicio</span>
                    <span className="order-kv-value">{order.shipment.shipping_type_code ?? "C24"}</span>
                  </div>
                  <div className="order-kv-item">
                    <span className="order-kv-label">Tramo de peso</span>
                    <span className="order-kv-value">{order.shipment.weight_tier_label ?? "No definido"}</span>
                  </div>
                  <div className="order-kv-item">
                    <span className="order-kv-label">Etiqueta creada</span>
                    <span className="order-kv-value">{formatDateTime(order.shipment.label_created_at ?? order.shipment.created_at)}</span>
                  </div>
                  {order.shipment.expected_delivery_date && (
                    <div className="order-kv-item">
                      <span className="order-kv-label">Entrega prevista</span>
                      <span className="order-kv-value order-kv-actions">
                        {new Date(order.shipment.expected_delivery_date).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" })}
                        <SlaBadge
                          expectedDeliveryDate={order.shipment.expected_delivery_date}
                          shippingStatus={order.shipment.shipping_status}
                        />
                      </span>
                    </div>
                  )}
                  {order.shipment.shipping_weight_declared != null && (
                    <div className="order-kv-item">
                      <span className="order-kv-label">Peso declarado</span>
                      <span className="order-kv-value">{order.shipment.shipping_weight_declared} kg</span>
                    </div>
                  )}
                  <div className="order-kv-item order-kv-item-accent">
                    <span className="order-kv-label">Coste envío</span>
                    <span className="order-kv-value">
                      {order.shipment.shipping_cost != null
                        ? new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(order.shipment.shipping_cost)
                        : order.shipping_rate_amount != null
                          ? new Intl.NumberFormat("es-ES", { style: "currency", currency: order.shipping_rate_currency ?? "EUR" }).format(order.shipping_rate_amount)
                          : "Pendiente"}
                    </span>
                  </div>
                  <div className="order-kv-item">
                    <span className="order-kv-label">Shopify sync</span>
                    <span className="order-kv-value">
                      {order.shipment.shopify_sync_status === "synced"
                        ? "✓ Sincronizado"
                        : order.shipment.shopify_sync_status === "failed"
                          ? `✕ ${order.shipment.shopify_sync_error ?? "Error"}`
                          : order.shipment.shopify_sync_status === "not_configured"
                            ? "Sin integración"
                            : "Pendiente"}
                    </span>
                  </div>
                </div>

                {/* Action links */}
                <div className="order-shipment-actions">
                  {order.shipment.tracking_url && (
                    <a className="order-shipment-action-link" href={order.shipment.tracking_url} rel="noreferrer" target="_blank">
                      Tracking carrier ↗
                    </a>
                  )}
                  <Link className="order-shipment-action-link" href={`/tracking/${order.shipment.public_token}`}>
                    Tracking cliente ↗
                  </Link>
                  {shipmentLabelUrl && (
                    <>
                      <a className="order-shipment-action-link" href={shipmentLabelUrl} rel="noreferrer" target="_blank">Etiqueta PDF</a>
                      <a className="order-shipment-action-link" download href={shipmentLabelDownloadUrl ?? shipmentLabelUrl} rel="noreferrer" target="_blank">Descargar etiqueta</a>
                      <a className="order-shipment-action-link" download href={shipmentLabelThermalUrl ?? "#"} rel="noreferrer" target="_blank">ZPL</a>
                    </>
                  )}
                  {isDelivered && shipmentPodUrl && (
                    <a className="order-shipment-action-link" href={shipmentPodUrl} rel="noreferrer" target="_blank">Justificante entrega ↗</a>
                  )}
                </div>
              </div>
            ) : (
              <EmptyState
                title="Sin shipment"
                description="Aún no hay carrier ni tracking asignado."
              />
            )}
          </Card>

          {/* ── Timeline ───────────────────────────────────────────── */}
          <Card className="stack">
            <SectionTitle eyebrow="Actividad" title="Timeline del pedido" />
            <div className="order-timeline-v">
              {activityFeed.map((activity, index) => (
                <div className={`order-timeline-item is-${activity.tone}`} key={activity.id}>
                  <div className="order-timeline-rail">
                    <div className="order-timeline-node">{activity.icon}</div>
                    {index < activityFeed.length - 1 && <div className="order-timeline-spine" />}
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
              {activityFeed.length === 0 && (
                <EmptyState title="Sin actividad" description="Aún no hay eventos registrados para este pedido." />
              )}
            </div>
          </Card>

          {/* ── Automation ─────────────────────────────────────────── */}
          {((order.automation_flags ?? []).length > 0 || (order.automation_events?.length ?? 0) > 0) && (
            <Card className="stack">
              <SectionTitle eyebrow="Automatización" title="Reglas aplicadas" />
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
                          <div className="table-secondary">{event.rule_name} · {event.action_type}</div>
                        </div>
                        <div className="mini-table-metrics">
                          <span>{formatDateTime(event.created_at)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* ── CTT Pickup ─────────────────────────────────────────── */}
          <ShippingOptionsPanel order={order} token={token} />

          {/* ── Fulfillment orders (technical, bottom of main col) ─── */}
          {fulfillmentOrders.length > 0 && (
            <Card className="stack">
              <SectionTitle eyebrow="Shopify" title="Fulfillment orders" />
              <div className="mini-table">
                {fulfillmentOrders.map((fo) => (
                  <div className="mini-table-row" key={fo.id}>
                    <div>
                      <div className="table-primary">{fo.locationName}</div>
                      <div className="table-secondary">
                        {fo.status}{fo.requestStatus ? ` · ${fo.requestStatus}` : ""}
                      </div>
                    </div>
                    <div className="mini-table-metrics">
                      <span>{fo.lineItems} líneas</span>
                      <span>{fo.fulfillments} fulfillments</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* ── Aside ──────────────────────────────────────────────── */}
        <aside className="stack">

          {/* Design preview */}
          {primaryItemSummary && designPreviewUrl && (
            <Card className="stack">
              <SectionTitle eyebrow="Diseño" title="Render de personalización" />
              <div className="shipment-product-card">
                <div className="shipment-product-copy">
                  <span className="kv-label">Producto</span>
                  <div className="shipment-product-name">{primaryItemSummary.productName}</div>
                  <div className="shipment-product-variant">{primaryItemSummary.variantName}</div>
                </div>
                <div className="shipment-render-preview">
                  <DesignPreviewWithValidation
                    alt={`Render de ${primaryItemSummary.productName}`}
                    itemId={primaryItem!.id}
                    orderId={order.id}
                    src={designPreviewUrl}
                  />
                </div>
              </div>
            </Card>
          )}

          {/* Print cut-line preview (30x40 → A3, 18x24 → A4) */}
          {designPreviewUrl && primaryItem?.variant_title && (
            /30\s*[xX×*]\s*40/i.test(primaryItem.variant_title) ||
            /18\s*[xX×*]\s*24/i.test(primaryItem.variant_title)
          ) && (
            <Card className="stack">
              <PrintCutlinePreview
                src={designPreviewUrl}
                variantTitle={primaryItem.variant_title}
                orderId={order.id}
                printVariant={
                  /18\s*[xX×*]\s*24/i.test(primaryItem.variant_title ?? "") ? "18x24" : "30x40"
                }
              />
            </Card>
          )}

          {/* Incidents alert */}
          {openIncidents.length > 0 && (
            <Card className="stack order-aside-card-alert">
              <SectionTitle eyebrow="Incidencias" title="Atención requerida" />
              <OrderIncidentsPanel incidents={incidents} orderId={order.id} />
            </Card>
          )}

          {/* Address */}
          <Card className="stack">
            <SectionTitle eyebrow="Dirección" title="Datos de entrega" />
            <div className="order-kv-list">
              <div className="order-kv-item">
                <span className="order-kv-label">Destinatario</span>
                <span className="order-kv-value">
                  {shippingSnapshot?.name || order.customer_name}
                  {shippingSnapshot?.phone ? ` · ${shippingSnapshot.phone}` : ""}
                </span>
              </div>
              <div className="order-kv-item order-kv-item-stack">
                <span className="order-kv-label">Dirección Shopify</span>
                <div className="order-kv-address">
                  {shopifyAddressLines.length > 0
                    ? shopifyAddressLines.map((line) => <span key={line}>{line}</span>)
                    : <span className="order-kv-empty">Sin snapshot</span>
                  }
                </div>
              </div>
              <div className="order-kv-item order-kv-item-stack">
                <span className="order-kv-label">Dirección CTT</span>
                <div className="order-kv-address">
                  {operationalAddressLines.length > 0
                    ? operationalAddressLines.map((line) => <span key={line}>{line}</span>)
                    : <span className="order-kv-empty">Sin dirección operativa</span>
                  }
                </div>
              </div>
              <div className="order-kv-item">
                <span className="order-kv-label">Validación</span>
                <span className="order-kv-value">
                  {order.shipping_address_line1 && order.shipping_postal_code && order.shipping_town
                    ? "✓ Lista para etiquetar"
                    : "⚠ Faltan datos — resincroniza"}
                </span>
              </div>
            </div>
          </Card>

          {/* Incidents collapsed */}
          {openIncidents.length === 0 && (
            <Card className="stack">
              <SectionTitle eyebrow="Incidencias" title="Seguimiento" />
              <OrderIncidentsPanel incidents={incidents} orderId={order.id} />
            </Card>
          )}

          {/* Preparation */}
          {order.prepared_by_employee_name ? (
            <Card className="stack">
              <SectionTitle eyebrow="Preparación" title="Responsable" />
              <div className="order-kv-list">
                <div className="order-kv-item">
                  <span className="order-kv-label">Preparado por</span>
                  <span className="order-kv-value">{order.prepared_by_employee_name}</span>
                </div>
                {order.prepared_at ? (
                  <div className="order-kv-item">
                    <span className="order-kv-label">Fecha</span>
                    <span className="order-kv-value">{formatDateTime(order.prepared_at)}</span>
                  </div>
                ) : null}
              </div>
            </Card>
          ) : null}

          {/* Internal note */}
          <Card className="stack">
            <SectionTitle eyebrow="Notas internas" title="Nota del equipo" />
            <OrderInternalNote orderId={order.id} initialNote={order.internal_note ?? null} />
          </Card>

          {/* Activity log */}
          <Card>
            <SectionTitle eyebrow="Historial" title="Actividad" />
            <ActivityTimelineLoader entityType="order" entityId={order.id} maxVisible={10} />
          </Card>

        </aside>
      </div>
    </div>
  );
}
