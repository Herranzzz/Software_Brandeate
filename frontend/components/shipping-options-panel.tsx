"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Card } from "@/components/card";
import { SectionTitle } from "@/components/section-title";
import type { Order } from "@/lib/types";

type PickupPoint = {
  id: string;
  name: string;
  address1: string;
  address2?: string | null;
  city: string;
  province?: string | null;
  postal_code: string;
  country_code: string;
  carrier: string;
  opening_hours?: string[] | null;
};

type PickupResponse = {
  points: PickupPoint[];
};

type ShippingOptionsPanelProps = {
  order: Order;
  token?: string | null;
};

export function ShippingOptionsPanel({ order, token }: ShippingOptionsPanelProps) {
  const [points, setPoints] = useState<PickupPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [postalInput, setPostalInput] = useState(order.shipping_postal_code ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  const headers = useMemo(
    () => ({
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }),
    [token],
  );

  function fetchPoints(postal: string) {
    if (!order.shop_id) return;
    setLoading(true);
    setError(null);
    setSaved(false);
    fetch("/api/shipping-options/pickup-points", {
      method: "POST",
      headers,
      body: JSON.stringify({
        shop_id: order.shop_id,
        carrier: "CTT",
        destination_country_code: order.shipping_country_code ?? "PT",
        destination_postal_code: postal,
        destination_city: order.shipping_town ?? "",
        max_distance_km: 10,
      }),
    })
      .then(async (res) => (res.ok ? res.json() : Promise.reject(await res.json())))
      .then((data: PickupResponse) => {
        setPoints(data.points ?? []);
      })
      .catch(() => setError("No se pudieron cargar los puntos CTT para este código postal."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    // Pre-select existing pickup point from order
    if (order.pickup_point_json && typeof order.pickup_point_json === "object") {
      const existing = order.pickup_point_json as { id?: string };
      if (existing?.id) setSelectedId(existing.id);
    }
    // Fetch initial points
    fetchPoints(order.shipping_postal_code ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave() {
    const point = points.find((p) => p.id === selectedId);
    if (!point) return;
    setSaving(true);
    setSaved(false);
    try {
      setError(null);
      const res = await fetch("/api/shipping-options/select", {
        method: "POST",
        headers,
        body: JSON.stringify({
          order_id: order.id,
          delivery_type: "pickup_point",
          carrier: "CTT",
          service_code: "CTT_PICKUP",
          service_name: "CTT Entrega en Punto",
          pickup_point: point,
        }),
      });
      if (!res.ok) throw new Error("Error al guardar");
      setSaved(true);
    } catch {
      setError("No se pudo guardar el punto. Inténtalo de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  const selectedPoint = points.find((p) => p.id === selectedId);

  return (
    <Card className="stack">
      <SectionTitle eyebrow="📍 CTT" title="Punto de entrega" />

      {/* Current selection banner */}
      {selectedPoint && (
        <div className="ctt-selected-banner">
          <div className="ctt-selected-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
          </div>
          <div className="ctt-selected-body">
            <div className="ctt-selected-label">Punto de recogida asignado</div>
            <div className="ctt-selected-name">{selectedPoint.name}</div>
            <div className="ctt-selected-addr">
              {selectedPoint.address1}
              {selectedPoint.address2 ? ` · ${selectedPoint.address2}` : ""}
              {" · "}
              {selectedPoint.postal_code} {selectedPoint.city}
            </div>
            {selectedPoint.opening_hours?.[0] && (
              <div className="ctt-selected-hours">{selectedPoint.opening_hours[0]}</div>
            )}
          </div>
        </div>
      )}

      {/* Search bar */}
      <div className="ctt-search-bar">
        <div className="ctt-search-label">Buscar puntos CTT por código postal</div>
        <div className="ctt-search-row">
          <input
            ref={inputRef}
            className="ctt-search-input"
            placeholder="Ej. 28001"
            value={postalInput}
            onChange={(e) => setPostalInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") fetchPoints(postalInput);
            }}
          />
          <button
            className="button"
            type="button"
            disabled={loading}
            onClick={() => fetchPoints(postalInput)}
          >
            {loading ? "Buscando..." : "Buscar"}
          </button>
        </div>
      </div>

      {error && <div className="alert-banner warning">{error}</div>}

      {/* Points grid */}
      {!loading && points.length === 0 && !error && (
        <div className="ctt-empty">
          <div className="ctt-empty-icon">📭</div>
          <div className="ctt-empty-text">No se encontraron puntos CTT para este código postal</div>
        </div>
      )}

      {points.length > 0 && (
        <div className="ctt-points-grid">
          {points.map((point) => {
            const isActive = selectedId === point.id;
            return (
              <button
                key={point.id}
                className={`ctt-point-card ${isActive ? "is-active" : ""}`}
                type="button"
                onClick={() => setSelectedId(point.id)}
              >
                <div className="ctt-point-dot" />
                <div className="ctt-point-body">
                  <div className="ctt-point-name">{point.name}</div>
                  <div className="ctt-point-addr">{point.address1}</div>
                  <div className="ctt-point-city">{point.postal_code} · {point.city}</div>
                  {point.opening_hours?.[0] && (
                    <div className="ctt-point-hours">{point.opening_hours[0]}</div>
                  )}
                </div>
                {isActive && (
                  <div className="ctt-point-check">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Footer */}
      <div className="ctt-footer">
        {saved && (
          <span className="ctt-saved-msg">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Punto guardado correctamente
          </span>
        )}
        <button
          className="button"
          type="button"
          disabled={!selectedPoint || saving}
          onClick={handleSave}
        >
          {saving ? "Guardando..." : "Guardar punto de entrega"}
        </button>
      </div>
    </Card>
  );
}
