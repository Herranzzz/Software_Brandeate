"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Order } from "@/lib/types";

type Props = {
  basePath: string;
  initialQuery: string;
  orders: Order[] | null;
  selectedShopId?: number | null;
  /** Base path for order detail links. Defaults to basePath replacing "shipments" with "orders". */
  orderDetailBasePath?: string;
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  ready_to_ship: "Listo para envío",
  shipped: "Enviado",
  delivered: "Entregado",
  cancelled: "Cancelado",
  returned: "Devuelto",
  blocked: "Bloqueado",
};

const SHIPPING_LABELS: Record<string, string> = {
  label_created: "Etiqueta creada",
  in_transit: "En tránsito",
  out_for_delivery: "En reparto",
  delivered: "Entregado",
  exception: "Incidencia",
  picked_up: "Recogido",
};

const SHIPPING_COLORS: Record<string, string> = {
  delivered: "is-green",
  in_transit: "is-blue",
  out_for_delivery: "is-orange",
  exception: "is-red",
};

export function PortalOrderSearch({ basePath, initialQuery, orders, selectedShopId, orderDetailBasePath }: Props) {
  const orderBase = orderDetailBasePath ?? basePath.replace("shipments", "orders");
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [isPending, startTransition] = useTransition();

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (selectedShopId) params.set("shop_id", String(selectedShopId));
    startTransition(() => {
      router.push(`${basePath}?${params.toString()}`);
    });
  }

  function handleClear() {
    setQuery("");
    const params = new URLSearchParams();
    if (selectedShopId) params.set("shop_id", String(selectedShopId));
    startTransition(() => {
      router.push(`${basePath}?${params.toString()}`);
    });
  }

  return (
    <div className="portal-order-search-panel">
      <div className="portal-order-search-header">
        <div className="portal-order-search-title">
          <svg fill="none" height="18" viewBox="0 0 24 24" width="18">
            <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/>
            <path d="m21 21-4.35-4.35" stroke="currentColor" strokeLinecap="round" strokeWidth="2"/>
          </svg>
          Buscar pedido
        </div>
        <p className="portal-order-search-sub">Busca por número de pedido, nombre del cliente o email</p>
      </div>

      <form className="portal-order-search-form" onSubmit={handleSearch}>
        <div className="portal-order-search-input-wrap">
          <input
            autoComplete="off"
            className="portal-order-search-input"
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ej: #12345, María García, maria@email.com…"
            type="search"
            value={query}
          />
          {query && (
            <button
              className="portal-order-search-clear"
              onClick={handleClear}
              type="button"
            >
              ✕
            </button>
          )}
        </div>
        <button
          className="button portal-order-search-btn"
          disabled={isPending || !query.trim()}
          type="submit"
        >
          {isPending ? "Buscando…" : "Buscar"}
        </button>
      </form>

      {orders !== null && (
        <div className="portal-order-search-results">
          {orders.length === 0 ? (
            <div className="portal-order-search-empty">
              <span>No se encontraron pedidos para «{initialQuery}»</span>
            </div>
          ) : (
            <div className="portal-order-search-list">
              <div className="portal-order-search-count">
                {orders.length} resultado{orders.length !== 1 ? "s" : ""} para «{initialQuery}»
              </div>
              {orders.map((order) => {
                const shippingStatus = order.shipment?.shipping_status;
                const shippingColor = SHIPPING_COLORS[shippingStatus ?? ""] ?? "";
                return (
                  <a
                    className="portal-order-search-item"
                    href={`${orderBase}/${order.id}`}
                    key={order.id}
                  >
                    <div className="portal-order-search-item-main">
                      <span className="portal-order-search-item-id">{order.external_id}</span>
                      <span className="portal-order-search-item-name">{order.customer_name}</span>
                    </div>
                    <div className="portal-order-search-item-meta">
                      <span className="portal-order-search-item-status">
                        {STATUS_LABELS[order.status] ?? order.status}
                      </span>
                      {shippingStatus && (
                        <span className={`portal-order-search-item-shipping ${shippingColor}`}>
                          {SHIPPING_LABELS[shippingStatus] ?? shippingStatus}
                        </span>
                      )}
                      <span className="portal-order-search-item-date">
                        {new Date(order.created_at).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
