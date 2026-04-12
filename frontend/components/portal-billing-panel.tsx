"use client";

import { useMemo } from "react";
import type { Order } from "@/lib/types";

/* ── Helpers ─────────────────────────────────────────────────────── */

function fmt(value: number, currency = "EUR") {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(value);
}

function monthKey(dateStr: string) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string) {
  const [y, m] = key.split("-");
  const date = new Date(Number(y), Number(m) - 1);
  return date.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
}

/* ── Weight tier pricing (CTT reference) ─────────────────────────── */

const WEIGHT_TIER_PRICES: Record<string, number> = {
  "0.5 kg": 3.20,
  "1 kg":   3.50,
  "2 kg":   3.90,
  "5 kg":   4.80,
  "10 kg":  6.50,
  "15 kg":  8.20,
  "20 kg":  9.90,
  "30 kg": 12.50,
};

function estimateCost(order: Order): number {
  // Use real shipment cost if available
  if (order.shipment?.shipping_cost != null) return order.shipment.shipping_cost;
  // Fall back to rate amount
  if (order.shipping_rate_amount != null) return order.shipping_rate_amount;
  // Fall back to weight tier estimate
  const tierLabel = order.shipment?.weight_tier_label;
  if (tierLabel && WEIGHT_TIER_PRICES[tierLabel]) return WEIGHT_TIER_PRICES[tierLabel];
  // Default
  return 3.90;
}

/* ── Component ────────────────────────────────────────────────────── */

type PortalBillingPanelProps = {
  orders: Order[];
};

export function PortalBillingPanel({ orders }: PortalBillingPanelProps) {
  const stats = useMemo(() => {
    const shippedOrders = orders.filter(
      (o) => o.shipment && ["shipped", "delivered", "in_transit", "out_for_delivery"].includes(o.status),
    );
    const totalCost = shippedOrders.reduce((sum, o) => sum + estimateCost(o), 0);
    const avgCost = shippedOrders.length > 0 ? totalCost / shippedOrders.length : 0;

    // Group by month
    const byMonth = new Map<string, { orders: number; cost: number; weight: number }>();
    for (const o of shippedOrders) {
      const key = monthKey(o.created_at);
      const entry = byMonth.get(key) ?? { orders: 0, cost: 0, weight: 0 };
      entry.orders += 1;
      entry.cost += estimateCost(o);
      entry.weight += o.shipment?.shipping_weight_declared ?? 0;
      byMonth.set(key, entry);
    }

    // Group by weight tier
    const byTier = new Map<string, { count: number; cost: number }>();
    for (const o of shippedOrders) {
      const tier = o.shipment?.weight_tier_label ?? "Sin definir";
      const entry = byTier.get(tier) ?? { count: 0, cost: 0 };
      entry.count += 1;
      entry.cost += estimateCost(o);
      byTier.set(tier, entry);
    }

    const months = [...byMonth.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, 6);

    const tiers = [...byTier.entries()]
      .sort(([, a], [, b]) => b.count - a.count);

    return { shippedOrders: shippedOrders.length, totalCost, avgCost, months, tiers };
  }, [orders]);

  return (
    <div className="billing-panel">

      {/* ── KPI strip ─────────────────────────────────────────────── */}
      <div className="billing-kpi-strip">
        <div className="billing-kpi">
          <span className="billing-kpi-label">Total envíos</span>
          <strong className="billing-kpi-value">{stats.shippedOrders}</strong>
        </div>
        <div className="billing-kpi">
          <span className="billing-kpi-label">Coste total</span>
          <strong className="billing-kpi-value">{fmt(stats.totalCost)}</strong>
        </div>
        <div className="billing-kpi">
          <span className="billing-kpi-label">Coste medio/envío</span>
          <strong className="billing-kpi-value">{fmt(stats.avgCost)}</strong>
        </div>
      </div>

      {/* ── Monthly breakdown ──────────────────────────────────────── */}
      {stats.months.length > 0 && (
        <div className="billing-section">
          <h4 className="billing-section-title">Desglose mensual</h4>
          <div className="billing-table-wrap">
            <table className="billing-table">
              <thead>
                <tr>
                  <th>Mes</th>
                  <th className="billing-th-num">Envíos</th>
                  <th className="billing-th-num">Peso total</th>
                  <th className="billing-th-num">Coste</th>
                  <th className="billing-th-num">Coste/envío</th>
                </tr>
              </thead>
              <tbody>
                {stats.months.map(([key, data]) => (
                  <tr key={key}>
                    <td className="billing-td-label">{monthLabel(key)}</td>
                    <td className="billing-td-num">{data.orders}</td>
                    <td className="billing-td-num">
                      {data.weight > 0 ? `${data.weight.toFixed(1)} kg` : "—"}
                    </td>
                    <td className="billing-td-num billing-td-bold">{fmt(data.cost)}</td>
                    <td className="billing-td-num">
                      {data.orders > 0 ? fmt(data.cost / data.orders) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Weight tier breakdown ──────────────────────────────────── */}
      {stats.tiers.length > 0 && (
        <div className="billing-section">
          <h4 className="billing-section-title">Coste por tramo de peso</h4>
          <div className="billing-tiers-grid">
            {stats.tiers.map(([tier, data]) => {
              const avg = data.count > 0 ? data.cost / data.count : 0;
              const pct = stats.shippedOrders > 0
                ? Math.round((data.count / stats.shippedOrders) * 100)
                : 0;
              return (
                <div className="billing-tier-card" key={tier}>
                  <div className="billing-tier-head">
                    <span className="billing-tier-name">{tier}</span>
                    <span className="billing-tier-pct">{pct}%</span>
                  </div>
                  <div className="billing-tier-bar-track">
                    <div className="billing-tier-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="billing-tier-stats">
                    <span>{data.count} envíos</span>
                    <span>{fmt(avg)}/envío</span>
                  </div>
                  <div className="billing-tier-total">{fmt(data.cost)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {stats.shippedOrders === 0 && (
        <div className="billing-empty">
          <p>Aún no hay envíos facturables en el periodo seleccionado.</p>
        </div>
      )}
    </div>
  );
}
