"use client";

import { useEffect, useMemo, useState } from "react";

import { Card } from "@/components/card";
import { EmptyState } from "@/components/empty-state";
import { SectionTitle } from "@/components/section-title";
import type { Order } from "@/lib/types";

type Quote = {
  quote_id: number | null;
  carrier: string;
  service_code: string;
  service_name: string;
  delivery_type: string;
  amount: number;
  currency: string;
  estimated_days_min?: number | null;
  estimated_days_max?: number | null;
  weight_tier_code?: string | null;
};

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

type LiveRatesResponse = {
  currency: string;
  quotes: Quote[];
};

type PickupResponse = {
  points: PickupPoint[];
};

type ShippingOptionsPanelProps = {
  order: Order;
  token?: string | null;
};

function formatEta(quote: Quote) {
  if (quote.estimated_days_min && quote.estimated_days_max) {
    return `${quote.estimated_days_min}-${quote.estimated_days_max} días`;
  }
  if (quote.estimated_days_min) {
    return `${quote.estimated_days_min} días`;
  }
  return "ETA no definida";
}

export function ShippingOptionsPanel({ order, token }: ShippingOptionsPanelProps) {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [pickupPoints, setPickupPoints] = useState<PickupPoint[]>([]);
  const [loadingRates, setLoadingRates] = useState(false);
  const [loadingPickup, setLoadingPickup] = useState(false);
  const [selectedQuote, setSelectedQuote] = useState<number | null>(null);
  const [selectedPickup, setSelectedPickup] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headers = useMemo(() => ({
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }), [token]);

  useEffect(() => {
    if (!order.shop_id) return;
    setLoadingRates(true);
    setError(null);
    fetch("/api/shipping-options/live-rates", {
      method: "POST",
      headers,
      body: JSON.stringify({
        shop_id: order.shop_id,
        order_id: order.id,
        destination_country_code: order.shipping_country_code ?? "ES",
        destination_postal_code: order.shipping_postal_code ?? "28001",
        destination_city: order.shipping_town ?? "",
        weight_tier_code: order.shipment?.weight_tier_code ?? null,
        weight_kg: order.shipment?.shipping_weight_declared ?? null,
        is_personalized: order.is_personalized,
      }),
    })
      .then(async (res) => (res.ok ? res.json() : Promise.reject(await res.json())))
      .then((data: LiveRatesResponse) => {
        setQuotes(data.quotes ?? []);
        if (data.quotes?.length) {
          const matchById = data.quotes.find((quote) => quote.quote_id === order.shipping_rate_quote_id);
          const matchByService = data.quotes.find((quote) => quote.service_code === order.shipping_service_code);
          const fallback = data.quotes[0].quote_id ?? null;
          setSelectedQuote(matchById?.quote_id ?? matchByService?.quote_id ?? fallback);
        }
      })
      .catch(() => setError("No se pudieron cargar las tarifas ahora mismo."))
      .finally(() => setLoadingRates(false));
  }, [headers, order]);

  useEffect(() => {
    if (!order.shop_id) return;
    setLoadingPickup(true);
    setError(null);
    fetch("/api/shipping-options/pickup-points", {
      method: "POST",
      headers,
      body: JSON.stringify({
        shop_id: order.shop_id,
        carrier: "CTT",
        destination_country_code: order.shipping_country_code ?? "ES",
        destination_postal_code: order.shipping_postal_code ?? "28001",
        destination_city: order.shipping_town ?? "",
        max_distance_km: 10,
      }),
    })
      .then(async (res) => (res.ok ? res.json() : Promise.reject(await res.json())))
      .then((data: PickupResponse) => {
        setPickupPoints(data.points ?? []);
        if (order.pickup_point_json && typeof order.pickup_point_json === "object") {
          const existing = order.pickup_point_json as { id?: string };
          if (existing?.id) setSelectedPickup(existing.id);
        }
      })
      .catch(() => setError("No se pudieron cargar los puntos de recogida."))
      .finally(() => setLoadingPickup(false));
  }, [headers, order]);

  const activeQuote = quotes.find((quote) => quote.quote_id === selectedQuote);
  const pickupEnabled = activeQuote?.delivery_type === "pickup_point";

  async function handleSave() {
    if (!activeQuote) return;
    setSaving(true);
    try {
      setError(null);
      const payload = {
        order_id: order.id,
        delivery_type: activeQuote.delivery_type,
        carrier: activeQuote.carrier,
        service_code: activeQuote.service_code,
        service_name: activeQuote.service_name,
        quote_id: activeQuote.quote_id,
        amount: activeQuote.amount,
        currency: activeQuote.currency,
        estimated_days_min: activeQuote.estimated_days_min,
        estimated_days_max: activeQuote.estimated_days_max,
        pickup_point: pickupEnabled
          ? pickupPoints.find((point) => point.id === selectedPickup) ?? null
          : null,
      };
      const response = await fetch("/api/shipping-options/select", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error("No se pudo guardar la opción de envío");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="stack">
      <SectionTitle eyebrow="Checkout" title="Opciones de envío" />
      <p className="subtitle">
        Preparando live rates, pickup points y la selección inteligente de método. Esta capa usa datos
        mock por ahora, pero deja la estructura lista para conectar carriers reales.
      </p>
      {error ? <div className="alert-banner warning">{error}</div> : null}

      <div className="stack">
        <div>
          <div className="section-title section-title-small">Tarifas dinámicas</div>
          {loadingRates ? (
            <div className="muted">Cargando tarifas...</div>
          ) : quotes.length === 0 ? (
            <EmptyState title="Sin tarifas" description="No hay rates disponibles aún para este destino." />
          ) : (
            <div className="shipping-option-grid">
              {quotes.map((quote) => (
                <button
                  key={quote.quote_id ?? quote.service_code}
                  className={`shipping-option-card ${selectedQuote === quote.quote_id ? "is-active" : ""}`}
                  type="button"
                  onClick={() => setSelectedQuote(quote.quote_id ?? null)}
                >
                  <div className="shipping-option-head">
                    <div>
                      <div className="table-primary">{quote.service_name}</div>
                      <div className="table-secondary">{quote.delivery_type === "pickup_point" ? "Recogida" : "Domicilio"}</div>
                    </div>
                    <div className="shipping-option-price">{quote.amount.toFixed(2)} {quote.currency}</div>
                  </div>
                  <div className="shipping-option-meta">
                    <span>{quote.carrier} · {quote.service_code}</span>
                    <span>{formatEta(quote)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="section-title section-title-small">Pickup points (CTT)</div>
          <p className="muted">Disponible si eliges una tarifa con entrega en punto de recogida.</p>
          {loadingPickup ? (
            <div className="muted">Cargando puntos...</div>
          ) : pickupPoints.length === 0 ? (
            <EmptyState title="Sin puntos" description="No hay puntos de recogida disponibles aún." />
          ) : (
            <div className={`pickup-point-grid ${pickupEnabled ? "" : "is-disabled"}`}>
              {pickupPoints.map((point) => (
                <button
                  key={point.id}
                  className={`pickup-point-card ${selectedPickup === point.id ? "is-active" : ""}`}
                  type="button"
                  onClick={() => setSelectedPickup(point.id)}
                  disabled={!pickupEnabled}
                >
                  <div className="table-primary">{point.name}</div>
                  <div className="table-secondary">{point.address1}{point.address2 ? ` · ${point.address2}` : ""}</div>
                  <div className="table-secondary">{point.postal_code} · {point.city}</div>
                  {point.opening_hours?.length ? (
                    <div className="pickup-point-hours">{point.opening_hours[0]}</div>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="shipping-option-footer">
        <div>
          <div className="table-primary">Selección actual</div>
          <div className="table-secondary">
            {activeQuote
              ? `${activeQuote.service_name} · ${activeQuote.delivery_type === "pickup_point" ? "Recogida" : "Domicilio"}`
              : "Sin seleccionar"}
          </div>
        </div>
        <button className="btn btn-primary" onClick={handleSave} disabled={!activeQuote || saving} type="button">
          {saving ? "Guardando..." : "Guardar opción"}
        </button>
      </div>
    </Card>
  );
}
