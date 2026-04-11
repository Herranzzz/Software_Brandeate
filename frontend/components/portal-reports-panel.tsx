"use client";

import { useMemo, useState } from "react";

import type { Order, Incident } from "@/lib/types";

type PortalReportsPanelProps = {
  orders: Order[];
  incidents: Incident[];
};

type MonthKey = string; // "YYYY-MM"

function getMonthKey(dateStr: string): MonthKey {
  return dateStr.slice(0, 7);
}

function getMonthLabel(key: MonthKey): string {
  const [year, month] = key.split("-");
  const d = new Date(Number(year), Number(month) - 1, 1);
  return d.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
}

function getLast6Months(): MonthKey[] {
  const result: MonthKey[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    result.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return result;
}

function downloadCSV(filename: string, rows: string[][], headers: string[]) {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [headers.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

type ReportId = "fulfillment" | "costes" | "devoluciones" | "comparativa";

export function PortalReportsPanel({ orders, incidents }: PortalReportsPanelProps) {
  const [activeReport, setActiveReport] = useState<ReportId>("fulfillment");

  const months = useMemo(() => getLast6Months(), []);

  // ── Fulfillment por mes ──
  const fulfillmentRows = useMemo(() => {
    return months.map((month) => {
      const monthOrders = orders.filter((o) => getMonthKey(o.created_at) === month);
      const delivered = monthOrders.filter((o) => o.status === "delivered").length;
      const shipped = monthOrders.filter((o) => o.status === "shipped").length;
      const exception = monthOrders.filter((o) => o.status === "exception").length;
      const pending = monthOrders.filter(
        (o) => o.status !== "delivered" && o.status !== "shipped" && o.status !== "exception",
      ).length;
      return {
        month,
        label: getMonthLabel(month),
        total: monthOrders.length,
        delivered,
        shipped,
        exception,
        pending,
        fulfillmentRate: monthOrders.length > 0 ? Math.round((delivered / monthOrders.length) * 100) : 0,
      };
    });
  }, [orders, months]);

  // ── Costes logísticos ──
  const costRows = useMemo(() => {
    return months.map((month) => {
      const monthOrders = orders.filter((o) => getMonthKey(o.created_at) === month);
      let totalCost = 0;
      let shippedCount = 0;
      for (const order of monthOrders) {
        const cost = order.shipping_rate_amount ?? 0;
        if (cost > 0) { totalCost += cost; shippedCount++; }
      }
      const avgCost = shippedCount > 0 ? totalCost / shippedCount : 0;
      return {
        month,
        label: getMonthLabel(month),
        totalOrders: monthOrders.length,
        withCostData: shippedCount,
        totalCost,
        avgCost,
        currency: orders.find((o) => getMonthKey(o.created_at) === month && o.shipping_rate_amount)?.shipping_rate_currency ?? "EUR",
      };
    });
  }, [orders, months]);

  // ── Devoluciones ──
  const devRows = useMemo(() => {
    return months.map((month) => {
      const monthInc = incidents.filter((i) => getMonthKey(i.created_at) === month);
      const open = monthInc.filter((i) => i.status === "open").length;
      const inProgress = monthInc.filter((i) => i.status === "in_progress").length;
      const resolved = monthInc.filter((i) => i.status === "resolved").length;
      return {
        month,
        label: getMonthLabel(month),
        total: monthInc.length,
        open,
        inProgress,
        resolved,
        resolutionRate: monthInc.length > 0 ? Math.round((resolved / monthInc.length) * 100) : 0,
      };
    });
  }, [incidents, months]);

  // ── Comparativa mensual ──
  const currentMonth = months[months.length - 1];
  const prevMonth = months[months.length - 2];
  const currentOrders = orders.filter((o) => getMonthKey(o.created_at) === currentMonth);
  const prevOrders = orders.filter((o) => getMonthKey(o.created_at) === prevMonth);
  const currentIncidents = incidents.filter((i) => getMonthKey(i.created_at) === currentMonth);
  const prevIncidents = incidents.filter((i) => getMonthKey(i.created_at) === prevMonth);

  function pct(cur: number, prev: number) {
    if (prev === 0) return cur > 0 ? "+∞%" : "—";
    const diff = ((cur - prev) / prev) * 100;
    return (diff >= 0 ? "+" : "") + diff.toFixed(0) + "%";
  }
  function tone(cur: number, prev: number, higherIsBetter = true) {
    if (prev === 0) return "";
    return (cur > prev) === higherIsBetter ? "rpt-delta-up" : "rpt-delta-down";
  }

  // Export handlers
  function exportFulfillment() {
    const headers = ["Mes", "Total pedidos", "Entregados", "En tránsito", "Incidencias", "Pendientes", "Tasa entrega (%)"];
    const rows = fulfillmentRows.map((r) => [
      r.label,
      String(r.total),
      String(r.delivered),
      String(r.shipped),
      String(r.exception),
      String(r.pending),
      String(r.fulfillmentRate),
    ]);
    downloadCSV("fulfillment-mensual.csv", rows, headers);
  }

  function exportCostes() {
    const headers = ["Mes", "Total pedidos", "Con datos de coste", "Coste total", "Coste medio", "Moneda"];
    const rows = costRows.map((r) => [
      r.label,
      String(r.totalOrders),
      String(r.withCostData),
      r.totalCost.toFixed(2),
      r.avgCost.toFixed(2),
      r.currency,
    ]);
    downloadCSV("costes-logisticos.csv", rows, headers);
  }

  function exportDevoluciones() {
    const headers = ["Mes", "Total casos", "Abiertos", "En revisión", "Resueltos", "Tasa resolución (%)"];
    const rows = devRows.map((r) => [
      r.label,
      String(r.total),
      String(r.open),
      String(r.inProgress),
      String(r.resolved),
      String(r.resolutionRate),
    ]);
    downloadCSV("devoluciones-mensual.csv", rows, headers);
  }

  function exportOrders() {
    const headers = [
      "ID", "Referencia", "Cliente", "Email", "Estado", "Estado producción",
      "Personalizado", "Carrier", "Coste envío", "Moneda", "Fecha creación",
    ];
    const rows = orders.map((o) => [
      String(o.id),
      o.external_id,
      o.customer_name,
      o.customer_email,
      o.status,
      o.production_status,
      o.is_personalized ? "Sí" : "No",
      o.shipment?.carrier ?? "",
      o.shipping_rate_amount != null ? o.shipping_rate_amount.toFixed(2) : "",
      o.shipping_rate_currency ?? "",
      o.created_at,
    ]);
    downloadCSV("pedidos-completo.csv", rows, headers);
  }

  const reports: { id: ReportId; icon: string; title: string; description: string }[] = [
    { id: "fulfillment", icon: "📦", title: "Fulfillment mensual", description: "Pedidos, entregas y tasa de fulfillment por mes." },
    { id: "costes", icon: "💰", title: "Coste logístico", description: "Coste medio y total de envíos por mes." },
    { id: "devoluciones", icon: "↩️", title: "Devoluciones", description: "Incidencias abiertas, en revisión y resueltas por mes." },
    { id: "comparativa", icon: "📊", title: "Comparativa mensual", description: "Este mes vs. mes anterior en métricas clave." },
  ];

  return (
    <div className="stack">
      {/* Report nav tabs */}
      <div className="rpt-tabs">
        {reports.map((r) => (
          <button
            className={`rpt-tab${activeReport === r.id ? " rpt-tab-active" : ""}`}
            key={r.id}
            onClick={() => setActiveReport(r.id)}
            type="button"
          >
            <span>{r.icon}</span>
            <span>{r.title}</span>
          </button>
        ))}
      </div>

      {/* FULFILLMENT */}
      {activeReport === "fulfillment" && (
        <div className="stack">
          <div className="rpt-report-head">
            <div>
              <h3 className="rpt-report-title">Fulfillment mensual</h3>
              <p className="rpt-report-desc">Distribución de pedidos por estado para los últimos 6 meses.</p>
            </div>
            <div className="rpt-export-row">
              <button className="button-secondary" onClick={exportFulfillment} type="button">
                ↓ Exportar CSV
              </button>
            </div>
          </div>
          <div className="rpt-table-wrap">
            <table className="rpt-table">
              <thead>
                <tr>
                  <th>Mes</th>
                  <th className="rpt-th-num">Total</th>
                  <th className="rpt-th-num">Entregados</th>
                  <th className="rpt-th-num">En tránsito</th>
                  <th className="rpt-th-num">Incidencias</th>
                  <th className="rpt-th-num">Tasa entrega</th>
                </tr>
              </thead>
              <tbody>
                {fulfillmentRows.map((r) => (
                  <tr key={r.month}>
                    <td className="rpt-td-month">{r.label}</td>
                    <td className="rpt-td-num rpt-td-bold">{r.total}</td>
                    <td className="rpt-td-num rpt-td-success">{r.delivered}</td>
                    <td className="rpt-td-num">{r.shipped}</td>
                    <td className="rpt-td-num rpt-td-danger">{r.exception}</td>
                    <td className="rpt-td-num">
                      <span className={`rpt-rate-badge ${r.fulfillmentRate >= 90 ? "rpt-rate-green" : r.fulfillmentRate >= 70 ? "rpt-rate-yellow" : "rpt-rate-red"}`}>
                        {r.total > 0 ? `${r.fulfillmentRate}%` : "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rpt-full-export">
            <button className="button-secondary" onClick={exportOrders} type="button">
              ↓ Exportar todos los pedidos (CSV completo)
            </button>
          </div>
        </div>
      )}

      {/* COSTES */}
      {activeReport === "costes" && (
        <div className="stack">
          <div className="rpt-report-head">
            <div>
              <h3 className="rpt-report-title">Coste logístico</h3>
              <p className="rpt-report-desc">Coste total y medio de envíos de los últimos 6 meses. Basado en la tarifa de envío registrada en cada pedido.</p>
            </div>
            <div className="rpt-export-row">
              <button className="button-secondary" onClick={exportCostes} type="button">
                ↓ Exportar CSV
              </button>
            </div>
          </div>
          <div className="rpt-table-wrap">
            <table className="rpt-table">
              <thead>
                <tr>
                  <th>Mes</th>
                  <th className="rpt-th-num">Pedidos</th>
                  <th className="rpt-th-num">Con coste</th>
                  <th className="rpt-th-num">Coste total</th>
                  <th className="rpt-th-num">Coste medio / pedido</th>
                </tr>
              </thead>
              <tbody>
                {costRows.map((r) => (
                  <tr key={r.month}>
                    <td className="rpt-td-month">{r.label}</td>
                    <td className="rpt-td-num">{r.totalOrders}</td>
                    <td className="rpt-td-num rpt-td-muted">{r.withCostData}</td>
                    <td className="rpt-td-num rpt-td-bold">
                      {r.totalCost > 0 ? `${r.totalCost.toFixed(2)} ${r.currency}` : "—"}
                    </td>
                    <td className="rpt-td-num">
                      {r.avgCost > 0 ? `${r.avgCost.toFixed(2)} ${r.currency}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="info-banner">
            El coste se toma del campo "tarifa de envío" del pedido. Si los pedidos no tienen este dato registrado, aparecerá "—". Escríbenos para conectar datos de facturación del carrier directamente.
          </div>
        </div>
      )}

      {/* DEVOLUCIONES */}
      {activeReport === "devoluciones" && (
        <div className="stack">
          <div className="rpt-report-head">
            <div>
              <h3 className="rpt-report-title">Devoluciones por mes</h3>
              <p className="rpt-report-desc">Casos abiertos, en revisión y resueltos en los últimos 6 meses.</p>
            </div>
            <div className="rpt-export-row">
              <button className="button-secondary" onClick={exportDevoluciones} type="button">
                ↓ Exportar CSV
              </button>
            </div>
          </div>
          <div className="rpt-table-wrap">
            <table className="rpt-table">
              <thead>
                <tr>
                  <th>Mes</th>
                  <th className="rpt-th-num">Total casos</th>
                  <th className="rpt-th-num">Abiertos</th>
                  <th className="rpt-th-num">En revisión</th>
                  <th className="rpt-th-num">Resueltos</th>
                  <th className="rpt-th-num">Tasa resolución</th>
                </tr>
              </thead>
              <tbody>
                {devRows.map((r) => (
                  <tr key={r.month}>
                    <td className="rpt-td-month">{r.label}</td>
                    <td className="rpt-td-num rpt-td-bold">{r.total}</td>
                    <td className="rpt-td-num rpt-td-danger">{r.open}</td>
                    <td className="rpt-td-num rpt-td-warning">{r.inProgress}</td>
                    <td className="rpt-td-num rpt-td-success">{r.resolved}</td>
                    <td className="rpt-td-num">
                      <span className={`rpt-rate-badge ${r.total === 0 ? "rpt-rate-muted" : r.resolutionRate >= 80 ? "rpt-rate-green" : r.resolutionRate >= 50 ? "rpt-rate-yellow" : "rpt-rate-red"}`}>
                        {r.total > 0 ? `${r.resolutionRate}%` : "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* COMPARATIVA */}
      {activeReport === "comparativa" && (
        <div className="stack">
          <div className="rpt-report-head">
            <div>
              <h3 className="rpt-report-title">Comparativa mensual</h3>
              <p className="rpt-report-desc">
                {getMonthLabel(currentMonth)} vs. {getMonthLabel(prevMonth)}.
              </p>
            </div>
          </div>

          <div className="rpt-comparison-grid">
            <div className="rpt-comp-card">
              <span className="rpt-comp-icon">📦</span>
              <span className="rpt-comp-label">Pedidos totales</span>
              <div className="rpt-comp-values">
                <span className="rpt-comp-current">{currentOrders.length}</span>
                <span className="rpt-comp-prev">{prevOrders.length} mes ant.</span>
              </div>
              <span className={`rpt-comp-delta ${tone(currentOrders.length, prevOrders.length)}`}>
                {pct(currentOrders.length, prevOrders.length)}
              </span>
            </div>

            <div className="rpt-comp-card">
              <span className="rpt-comp-icon">✅</span>
              <span className="rpt-comp-label">Pedidos entregados</span>
              <div className="rpt-comp-values">
                <span className="rpt-comp-current">
                  {currentOrders.filter((o) => o.status === "delivered").length}
                </span>
                <span className="rpt-comp-prev">
                  {prevOrders.filter((o) => o.status === "delivered").length} mes ant.
                </span>
              </div>
              <span className={`rpt-comp-delta ${tone(
                currentOrders.filter((o) => o.status === "delivered").length,
                prevOrders.filter((o) => o.status === "delivered").length,
              )}`}>
                {pct(
                  currentOrders.filter((o) => o.status === "delivered").length,
                  prevOrders.filter((o) => o.status === "delivered").length,
                )}
              </span>
            </div>

            <div className="rpt-comp-card">
              <span className="rpt-comp-icon">↩️</span>
              <span className="rpt-comp-label">Devoluciones abiertas</span>
              <div className="rpt-comp-values">
                <span className="rpt-comp-current">{currentIncidents.length}</span>
                <span className="rpt-comp-prev">{prevIncidents.length} mes ant.</span>
              </div>
              <span className={`rpt-comp-delta ${tone(currentIncidents.length, prevIncidents.length, false)}`}>
                {pct(currentIncidents.length, prevIncidents.length)}
              </span>
            </div>

            <div className="rpt-comp-card">
              <span className="rpt-comp-icon">⚠️</span>
              <span className="rpt-comp-label">Incidencias de envío</span>
              <div className="rpt-comp-values">
                <span className="rpt-comp-current">
                  {currentOrders.filter((o) => o.status === "exception").length}
                </span>
                <span className="rpt-comp-prev">
                  {prevOrders.filter((o) => o.status === "exception").length} mes ant.
                </span>
              </div>
              <span className={`rpt-comp-delta ${tone(
                currentOrders.filter((o) => o.status === "exception").length,
                prevOrders.filter((o) => o.status === "exception").length,
                false,
              )}`}>
                {pct(
                  currentOrders.filter((o) => o.status === "exception").length,
                  prevOrders.filter((o) => o.status === "exception").length,
                )}
              </span>
            </div>

            <div className="rpt-comp-card">
              <span className="rpt-comp-icon">🎨</span>
              <span className="rpt-comp-label">Pedidos personalizados</span>
              <div className="rpt-comp-values">
                <span className="rpt-comp-current">
                  {currentOrders.filter((o) => o.is_personalized).length}
                </span>
                <span className="rpt-comp-prev">
                  {prevOrders.filter((o) => o.is_personalized).length} mes ant.
                </span>
              </div>
              <span className={`rpt-comp-delta ${tone(
                currentOrders.filter((o) => o.is_personalized).length,
                prevOrders.filter((o) => o.is_personalized).length,
              )}`}>
                {pct(
                  currentOrders.filter((o) => o.is_personalized).length,
                  prevOrders.filter((o) => o.is_personalized).length,
                )}
              </span>
            </div>

            <div className="rpt-comp-card">
              <span className="rpt-comp-icon">📈</span>
              <span className="rpt-comp-label">Tasa de fulfillment</span>
              <div className="rpt-comp-values">
                <span className="rpt-comp-current">
                  {currentOrders.length > 0
                    ? `${Math.round((currentOrders.filter((o) => o.status === "delivered").length / currentOrders.length) * 100)}%`
                    : "—"}
                </span>
                <span className="rpt-comp-prev">
                  {prevOrders.length > 0
                    ? `${Math.round((prevOrders.filter((o) => o.status === "delivered").length / prevOrders.length) * 100)}%`
                    : "—"} mes ant.
                </span>
              </div>
            </div>
          </div>

          <div className="info-banner">
            El informe mensual automático (resumen del mes en email) está disponible bajo demanda. Escríbenos a <strong>hola@brandeate.com</strong> para activarlo.
          </div>
        </div>
      )}
    </div>
  );
}
