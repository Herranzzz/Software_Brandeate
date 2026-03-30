"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Card } from "@/components/card";
import { DesignStatusBadge } from "@/components/design-status-badge";
import { EmptyState } from "@/components/empty-state";
import { PriorityBadge } from "@/components/priority-badge";
import { ProductionBadge } from "@/components/production-badge";
import { RenderPreviewLightbox } from "@/components/render-preview-lightbox";
import { formatDateTime, orderPriorityOptions, productionStatusOptions } from "@/lib/format";
import type { DesignStatus, Order, OrderItem, OrderPriority, ProductionStatus, Shop } from "@/lib/types";

type ProductionQueueProps = {
  initialOrders: Order[];
  shops: Shop[];
};

type PersonalizationAsset = {
  type: string;
  url: string;
};

type QuickFilterKey =
  | "personalized"
  | "standard"
  | "design_available"
  | "pending_asset"
  | "has_incident"
  | "not_prepared";

const quickFilterMeta: Array<{ key: QuickFilterKey; label: string }> = [
  { key: "personalized", label: "Personalizados" },
  { key: "standard", label: "Estándar" },
  { key: "design_available", label: "Diseño disponible" },
  { key: "pending_asset", label: "Pendiente de asset" },
  { key: "has_incident", label: "Con incidencia" },
  { key: "not_prepared", label: "No preparados" },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function inferAssetType(url: string) {
  const normalizedUrl = url.toLowerCase();
  if (
    normalizedUrl.endsWith(".png") ||
    normalizedUrl.endsWith(".jpg") ||
    normalizedUrl.endsWith(".jpeg") ||
    normalizedUrl.endsWith(".webp") ||
    normalizedUrl.endsWith(".gif") ||
    normalizedUrl.endsWith(".svg")
  ) {
    return "image";
  }
  return "file";
}

function getPersonalizationAssets(item: OrderItem): PersonalizationAsset[] {
  const rawAssets = item.personalization_assets_json;
  if (!rawAssets) return [];

  if (Array.isArray(rawAssets)) {
    return rawAssets
      .map((entry) => {
        if (typeof entry === "string") {
          return { type: inferAssetType(entry), url: entry };
        }
        if (!isRecord(entry)) {
          return null;
        }
        const url = typeof entry.url === "string" ? entry.url : null;
        if (!url) return null;
        const type = typeof entry.type === "string" && entry.type.trim() ? entry.type : inferAssetType(url);
        return { type, url };
      })
      .filter((entry): entry is PersonalizationAsset => entry !== null);
  }

  if (isRecord(rawAssets)) {
    return Object.entries(rawAssets)
      .map(([key, value]) => {
        if (typeof value === "string") {
          return { type: key, url: value };
        }
        if (!isRecord(value)) {
          return null;
        }
        const url = typeof value.url === "string" ? value.url : null;
        if (!url) return null;
        return { type: typeof value.type === "string" && value.type.trim() ? value.type : key, url };
      })
      .filter((entry): entry is PersonalizationAsset => entry !== null);
  }

  return [];
}

function isImageAsset(url: string) {
  const normalizedUrl = url.toLowerCase();
  return [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"].some((extension) => normalizedUrl.includes(extension));
}

function getPrimaryRenderedAsset(orderItems: OrderItem[]) {
  return orderItems
    .flatMap((item) => getPersonalizationAssets(item))
    .filter((asset) => isImageAsset(asset.url))
    .map((asset) => {
      const normalizedType = asset.type.toLowerCase();
      let score = 0;
      if (normalizedType.includes("render")) score += 5;
      if (normalizedType.includes("preview")) score += 4;
      if (normalizedType.includes("mockup")) score += 3;
      if (normalizedType.includes("image")) score += 2;
      if (normalizedType.includes("design")) score += 1;
      return { ...asset, score };
    })
    .sort((left, right) => right.score - left.score)[0] ?? null;
}

function getPrimaryPreview(order: Order) {
  const renderedAsset = getPrimaryRenderedAsset(order.items);
  if (renderedAsset) return renderedAsset.url;

  const imageDesignItem = order.items.find(
    (item) => typeof item.design_link === "string" && item.design_link.trim() && isImageAsset(item.design_link),
  );
  return imageDesignItem?.design_link ?? null;
}

function getPrimaryItem(order: Order) {
  return order.items[0] ?? null;
}

function getItemTitle(order: Order) {
  const item = getPrimaryItem(order);
  return item?.title ?? item?.name ?? "Sin item principal";
}

function getVariantLabel(order: Order) {
  const item = getPrimaryItem(order);
  return item?.variant_title?.trim() || "Variante no disponible";
}

function getDesignLink(order: Order) {
  return order.items.find((item) => item.design_link)?.design_link ?? null;
}

function getDesignStatus(order: Order) {
  if (order.items.some((item) => item.design_status === "missing_asset")) return "missing_asset" as const;
  if (order.items.some((item) => item.design_status === "pending_asset")) return "pending_asset" as const;
  if (order.items.some((item) => item.design_status === "design_available")) return "design_available" as const;
  return null;
}

function isPrepared(order: Order) {
  return order.production_status === "packed" || order.production_status === "completed";
}

function getPreparedLabel(order: Order) {
  return isPrepared(order) ? "Preparado" : "No preparado";
}

function matchesQuickFilter(order: Order, filter: QuickFilterKey) {
  const designStatus = getDesignStatus(order);

  switch (filter) {
    case "personalized":
      return order.is_personalized;
    case "standard":
      return !order.is_personalized;
    case "design_available":
      return designStatus === "design_available";
    case "pending_asset":
      return designStatus === "pending_asset" || designStatus === "missing_asset";
    case "has_incident":
      return order.has_open_incident;
    case "not_prepared":
      return !isPrepared(order);
    default:
      return true;
  }
}

function buildSearchHaystack(order: Order) {
  const item = getPrimaryItem(order);
  return [
    order.external_id,
    order.customer_name,
    order.customer_email,
    item?.title ?? "",
    item?.name ?? "",
    item?.sku ?? "",
    item?.variant_title ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

export function ProductionQueue({ initialOrders, shops }: ProductionQueueProps) {
  const router = useRouter();
  const [orders, setOrders] = useState(initialOrders);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedShopId, setSelectedShopId] = useState("");
  const [activeFilters, setActiveFilters] = useState<QuickFilterKey[]>(["not_prepared"]);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setOrders(initialOrders);
  }, [initialOrders]);

  const shopMap = new Map(shops.map((shop) => [shop.id, shop.name]));

  const filteredOrders = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const base = [...orders].sort((left, right) => {
      const priorityRank: Record<OrderPriority, number> = {
        urgent: 0,
        high: 1,
        normal: 2,
        low: 3,
      };

      if (left.has_open_incident !== right.has_open_incident) {
        return left.has_open_incident ? -1 : 1;
      }
      if (priorityRank[left.priority] !== priorityRank[right.priority]) {
        return priorityRank[left.priority] - priorityRank[right.priority];
      }
      return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
    });

    return base.filter((order) => {
      if (selectedShopId && String(order.shop_id) !== selectedShopId) {
        return false;
      }
      if (normalizedQuery && !buildSearchHaystack(order).includes(normalizedQuery)) {
        return false;
      }
      return activeFilters.every((filter) => matchesQuickFilter(order, filter));
    });
  }, [activeFilters, orders, query, selectedShopId]);

  function toggleQuickFilter(filter: QuickFilterKey | "all") {
    if (filter === "all") {
      setActiveFilters([]);
      return;
    }

    setActiveFilters((current) =>
      current.includes(filter) ? current.filter((entry) => entry !== filter) : [...current, filter],
    );
  }

  async function patchOrder(orderId: number, path: "production-status" | "priority", payload: Record<string, string>) {
    const response = await fetch(`/api/orders/${orderId}/${path}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || "No se pudo actualizar el pedido.");
    }

    return response.json() as Promise<Order>;
  }

  function handleProductionStatusChange(orderId: number, productionStatus: ProductionStatus) {
    setFeedback(null);
    startTransition(async () => {
      try {
        const updated = await patchOrder(orderId, "production-status", { production_status: productionStatus });
        setOrders((current) => current.map((order) => (order.id === orderId ? updated : order)));
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "No se pudo actualizar producción.");
      }
    });
  }

  function handlePriorityChange(orderId: number, priority: OrderPriority) {
    setFeedback(null);
    startTransition(async () => {
      try {
        const updated = await patchOrder(orderId, "priority", { priority });
        setOrders((current) => current.map((order) => (order.id === orderId ? updated : order)));
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "No se pudo actualizar prioridad.");
      }
    });
  }

  function handleCreateIncident(order: Order) {
    setFeedback(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/incidents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            order_id: order.id,
            type: "production_blocked",
            priority: order.priority === "urgent" ? "urgent" : "high",
            status: "open",
            title: `Bloqueado en producción · ${order.external_id}`,
            description: "Incidencia creada desde la cola de preparación para revisar este pedido antes de seguir operando.",
          }),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || "No se pudo crear la incidencia.");
        }

        setOrders((current) =>
          current.map((entry) =>
            entry.id === order.id
              ? { ...entry, has_open_incident: true, open_incidents_count: entry.open_incidents_count + 1 }
              : entry,
          ),
        );
        router.refresh();
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "No se pudo crear la incidencia.");
      }
    });
  }

  return (
    <section className="stack production-workspace">
      {feedback ? <div className="admin-dashboard-empty">{feedback}</div> : null}

      <Card className="stack production-search-card">
        <div className="production-toolbar">
          <div className="production-toolbar-main">
            <div className="production-toolbar-copy">
              <span className="eyebrow">Buscar</span>
              <div className="production-toolbar-title">Mesa operativa</div>
            </div>

            <label className="production-search-input" htmlFor="production-search">
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path
                  d="M10.5 4a6.5 6.5 0 1 0 4.03 11.6l4.43 4.44 1.06-1.06-4.44-4.43A6.5 6.5 0 0 0 10.5 4Zm0 1.5a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z"
                  fill="currentColor"
                />
              </svg>
              <input
                id="production-search"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Pedido, cliente, email, SKU o variante"
                type="search"
                value={query}
              />
            </label>
          </div>

          <div className="production-toolbar-side">
            <div className="production-toolbar-counter">
              <strong>{filteredOrders.length}</strong>
              <span>pedidos visibles</span>
            </div>
            <select
              className="production-inline-select production-shop-select"
              onChange={(event) => setSelectedShopId(event.target.value)}
              value={selectedShopId}
            >
              <option value="">Todas las tiendas</option>
              {shops.map((shop) => (
                <option key={shop.id} value={shop.id}>
                  {shop.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="production-filter-pills">
          <button
            className={`production-filter-pill ${activeFilters.length === 0 ? "production-filter-pill-active" : ""}`}
            onClick={() => toggleQuickFilter("all")}
            type="button"
          >
            Todos
          </button>
          {quickFilterMeta.map((filter) => (
            <button
              className={`production-filter-pill ${activeFilters.includes(filter.key) ? "production-filter-pill-active" : ""}`}
              key={filter.key}
              onClick={() => toggleQuickFilter(filter.key)}
              type="button"
            >
              {filter.label}
            </button>
          ))}
        </div>
      </Card>

      <Card className="stack production-table-card">
        <div className="table-wrap">
          {filteredOrders.length > 0 ? (
            <table className="table production-table">
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Tienda</th>
                  <th>Cliente</th>
                  <th>Item principal</th>
                  <th>SKU</th>
                  <th>Diseño</th>
                  <th>Producción</th>
                  <th>Preparado</th>
                  <th>Imagen</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order) => {
                  const item = getPrimaryItem(order);
                  const designStatus = getDesignStatus(order);
                  const designLink = getDesignLink(order);
                  const previewSrc = getPrimaryPreview(order);

                  return (
                    <tr className="table-row production-table-row" key={order.id}>
                      <td>
                        <div className="table-primary">{order.external_id}</div>
                        <div className="table-secondary">{formatDateTime(order.created_at)}</div>
                      </td>
                      <td>
                        <div className="table-primary">{shopMap.get(order.shop_id) ?? `Shop #${order.shop_id}`}</div>
                      </td>
                      <td>
                        <div className="table-primary">{order.customer_name}</div>
                        <div className="table-secondary">{order.customer_email}</div>
                      </td>
                      <td>
                        <div className="table-primary">{getItemTitle(order)}</div>
                        <div className="table-secondary">
                          {getVariantLabel(order)}
                          {item?.quantity ? ` · x${item.quantity}` : ""}
                        </div>
                        <div className="production-type-line">
                          <span className={`production-type-pill ${order.is_personalized ? "production-type-pill-accent" : ""}`}>
                            {order.is_personalized ? "Personalizado" : "Estándar"}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div className="table-primary">{item?.sku ?? "Sin SKU"}</div>
                      </td>
                      <td>
                        <div className="production-status-stack">
                          {designStatus ? <DesignStatusBadge status={designStatus} /> : <span className="table-secondary">Sin diseño</span>}
                          {designLink ? (
                            <a className="table-link production-inline-link" href={designLink} rel="noreferrer" target="_blank">
                              Abrir diseño
                            </a>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        <div className="production-status-stack">
                          <ProductionBadge status={order.production_status} />
                          <PriorityBadge priority={order.priority} />
                          {order.has_open_incident ? (
                            <span className="badge badge-priority badge-priority-urgent">
                              {order.open_incidents_count} incidencia{order.open_incidents_count === 1 ? "" : "s"}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        <span className={`production-ready-pill ${isPrepared(order) ? "production-ready-pill-ok" : "production-ready-pill-pending"}`}>
                          {getPreparedLabel(order)}
                        </span>
                        <div className="table-secondary">
                          {isPrepared(order) ? "listo para expedición" : "requiere trabajo"}
                        </div>
                      </td>
                      <td>
                        {previewSrc ? (
                          <div className="production-preview-cell">
                            <RenderPreviewLightbox alt={`Render ${order.external_id}`} src={previewSrc} />
                          </div>
                        ) : (
                          <div className="production-preview-empty">Sin preview</div>
                        )}
                      </td>
                      <td>
                        <div className="production-actions">
                          <select
                            className="production-inline-select"
                            defaultValue={order.production_status}
                            disabled={isPending}
                            onChange={(event) => handleProductionStatusChange(order.id, event.target.value as ProductionStatus)}
                          >
                            {productionStatusOptions.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                          <select
                            className="production-inline-select"
                            defaultValue={order.priority}
                            disabled={isPending}
                            onChange={(event) => handlePriorityChange(order.id, event.target.value as OrderPriority)}
                          >
                            {orderPriorityOptions.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                          <button
                            className="button-secondary table-action"
                            disabled={isPending || order.has_open_incident}
                            onClick={() => handleCreateIncident(order)}
                            type="button"
                          >
                            {order.has_open_incident ? "Con incidencia" : "Crear incidencia"}
                          </button>
                          <Link className="button table-action" href={`/orders/${order.id}`}>
                            Ver ficha
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <EmptyState
              title="Sin pedidos en esta cola"
              description="Prueba con otros filtros o usa el buscador para localizar un pedido concreto."
            />
          )}
        </div>
      </Card>
    </section>
  );
}
