"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { Card } from "@/components/card";
import { useToast } from "@/components/toast";
import { generateReplenishmentPOsClient } from "@/lib/api-client";
import type { ReplenishmentRecommendation, ReplenishmentUrgency } from "@/lib/types";

const URGENCY_META: Record<
  ReplenishmentUrgency,
  { label: string; className: string; rank: number }
> = {
  critical: {
    label: "Crítico",
    className: "invoice-badge invoice-badge-cancelled",
    rank: 0,
  },
  high: {
    label: "Alto",
    className: "invoice-badge invoice-badge-cancelled",
    rank: 1,
  },
  medium: {
    label: "Medio",
    className: "invoice-badge invoice-badge-sent",
    rank: 2,
  },
  low: {
    label: "Bajo",
    className: "invoice-badge invoice-badge-draft",
    rank: 3,
  },
};

function fmtMoney(value: string | null, currency = "EUR"): string {
  if (!value) return "—";
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency,
  }).format(n);
}

type ReplenishmentTabProps = {
  recommendations: ReplenishmentRecommendation[];
  shopId?: number;
  hasMultipleShops: boolean;
};

export function ReplenishmentTab({
  recommendations,
  shopId,
  hasMultipleShops,
}: ReplenishmentTabProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [isPending, startTransition] = useTransition();

  const sorted = useMemo(() => {
    return [...recommendations].sort((a, b) => {
      const ra = URGENCY_META[a.urgency].rank;
      const rb = URGENCY_META[b.urgency].rank;
      if (ra !== rb) return ra - rb;
      return (a.days_of_cover_remaining ?? 999) -
        (b.days_of_cover_remaining ?? 999);
    });
  }, [recommendations]);

  const kpiCritical = recommendations.filter(
    (r) => r.urgency === "critical",
  ).length;
  const kpiHigh = recommendations.filter((r) => r.urgency === "high").length;
  const kpiNoSupplier = recommendations.filter(
    (r) => r.primary_supplier_id == null,
  ).length;
  const totalEstimated = recommendations.reduce((s, r) => {
    const cost = r.cost_price ? parseFloat(r.cost_price) : 0;
    if (!Number.isFinite(cost)) return s;
    return s + cost * r.suggested_order_qty;
  }, 0);

  const allSelectable = sorted.filter((r) => r.primary_supplier_id != null);
  const allSelected =
    allSelectable.length > 0 && allSelectable.every((r) => selected.has(r.inventory_item_id));

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allSelectable.map((r) => r.inventory_item_id)));
    }
  }

  function handleGenerate(onlySelected: boolean) {
    if (!shopId) {
      toast("Selecciona un cliente para generar órdenes.", "warning");
      return;
    }
    const ids = onlySelected ? Array.from(selected) : undefined;
    if (onlySelected && (!ids || ids.length === 0)) {
      toast("Selecciona al menos un SKU.", "warning");
      return;
    }
    const confirmMsg = onlySelected
      ? `Generar órdenes de compra para ${ids!.length} SKU(s) seleccionados?`
      : `Generar órdenes para todos los SKUs con proveedor (${sorted.filter((r) => r.primary_supplier_id != null).length})?`;
    if (!confirm(confirmMsg)) return;

    startTransition(async () => {
      try {
        const result = await generateReplenishmentPOsClient(shopId, ids);
        toast(
          `${result.purchase_orders_created} órdenes creadas · ${result.items_skipped_no_supplier} sin proveedor · ${result.items_no_consumption} sin consumo`,
          "success",
        );
        setSelected(new Set());
        router.refresh();
      } catch (e) {
        toast(e instanceof Error ? e.message : "Error", "error");
      }
    });
  }

  if (!shopId && hasMultipleShops) {
    return (
      <div className="stack">
        <Card>
          <p>
            Filtra por cliente en la parte superior para ver recomendaciones de
            reposición.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="stack">
      {/* KPI strip */}
      <div className="sga-kpi-strip">
        <div className="sga-kpi">
          <div className="sga-kpi-value">{recommendations.length}</div>
          <div className="sga-kpi-label">Recomendaciones</div>
          <div className="sga-kpi-sub">SKUs por reponer</div>
        </div>
        <div className={`sga-kpi${kpiCritical > 0 ? " is-danger" : ""}`}>
          <div className="sga-kpi-value is-red">{kpiCritical}</div>
          <div className="sga-kpi-label">Críticos</div>
          <div className="sga-kpi-sub">stock agotado o bajo mínimo</div>
        </div>
        <div className={`sga-kpi${kpiHigh > 0 ? " is-warning" : ""}`}>
          <div className="sga-kpi-value is-yellow">{kpiHigh}</div>
          <div className="sga-kpi-label">Alta urgencia</div>
          <div className="sga-kpi-sub">días restantes bajo plazo</div>
        </div>
        <div className="sga-kpi">
          <div className="sga-kpi-value">
            {new Intl.NumberFormat("es-ES", {
              style: "currency",
              currency: "EUR",
              maximumFractionDigits: 0,
            }).format(totalEstimated)}
          </div>
          <div className="sga-kpi-label">Coste estimado</div>
          <div className="sga-kpi-sub">todas las recomendaciones</div>
        </div>
      </div>

      {kpiNoSupplier > 0 && (
        <div className="sga-reorder-banner">
          <strong>{kpiNoSupplier} SKUs sin proveedor principal</strong>
          <span style={{ fontSize: 13, color: "var(--muted)", marginLeft: 8 }}>
            Asigna un proveedor para que se generen órdenes automáticamente.
          </span>
          <Link
            className="button-secondary"
            href="/suppliers"
            style={{ marginLeft: "auto", fontSize: 13 }}
          >
            Ir a proveedores →
          </Link>
        </div>
      )}

      <Card className="stack table-card">
        <div className="table-header">
          <div className="table-filters">
            <span className="table-count">{sorted.length} SKUs a reponer</span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              className="button-secondary"
              disabled={selected.size === 0 || isPending}
              onClick={() => handleGenerate(true)}
              type="button"
            >
              Generar órdenes (seleccionadas)
            </button>
            <button
              className="button-primary"
              disabled={isPending || allSelectable.length === 0}
              onClick={() => handleGenerate(false)}
              type="button"
            >
              Generar todas las órdenes
            </button>
          </div>
        </div>

        {sorted.length === 0 ? (
          <div className="table-empty">
            <p>No hay recomendaciones de reposición ahora mismo.</p>
          </div>
        ) : (
          <div className="sga-table-wrap">
            <table className="sga-table">
              <thead>
                <tr>
                  <th style={{ width: 32 }}>
                    <input
                      checked={allSelected}
                      onChange={toggleAll}
                      type="checkbox"
                    />
                  </th>
                  <th>SKU</th>
                  <th>Proveedor</th>
                  <th>Urgencia</th>
                  <th className="num">Stock</th>
                  <th className="num">Días cob.</th>
                  <th className="num">Consumo/día</th>
                  <th className="num">Sugerido</th>
                  <th className="num">Coste estim.</th>
                  <th>Motivo</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => {
                  const meta = URGENCY_META[r.urgency];
                  const hasSupplier = r.primary_supplier_id != null;
                  const estCost =
                    r.cost_price &&
                    Number.isFinite(parseFloat(r.cost_price))
                      ? parseFloat(r.cost_price) * r.suggested_order_qty
                      : null;
                  return (
                    <tr key={r.inventory_item_id}>
                      <td>
                        <input
                          checked={selected.has(r.inventory_item_id)}
                          disabled={!hasSupplier}
                          onChange={() => toggleOne(r.inventory_item_id)}
                          type="checkbox"
                        />
                      </td>
                      <td>
                        <strong>{r.sku}</strong>
                        <div className="table-secondary">{r.name}</div>
                      </td>
                      <td>
                        {hasSupplier ? (
                          r.primary_supplier_name
                        ) : (
                          <span className="table-secondary">Sin proveedor</span>
                        )}
                      </td>
                      <td>
                        <span className={meta.className}>{meta.label}</span>
                      </td>
                      <td className="num">
                        {r.stock_available}
                        {r.stock_reserved > 0 && (
                          <div
                            className="table-secondary"
                            style={{ fontSize: 11 }}
                          >
                            ({r.stock_reserved} reservado)
                          </div>
                        )}
                      </td>
                      <td className="num">
                        {r.days_of_cover_remaining != null
                          ? `${r.days_of_cover_remaining.toFixed(1)}d`
                          : "—"}
                      </td>
                      <td className="num">
                        {r.daily_consumption_rate.toFixed(2)}
                      </td>
                      <td className="num">
                        <strong>{r.suggested_order_qty}</strong>
                      </td>
                      <td className="num">
                        {estCost != null
                          ? fmtMoney(String(estCost))
                          : "—"}
                      </td>
                      <td>
                        <span
                          className="table-secondary"
                          style={{ fontSize: 12 }}
                        >
                          {r.reason}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
