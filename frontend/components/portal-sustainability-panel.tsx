"use client";

import { useMemo, useState } from "react";

import type { Order } from "@/lib/types";

type PortalSustainabilityPanelProps = {
  orders: Order[];
};

// Simplified CO₂ estimation:
// Base: 0.5 kg CO₂ per package handling
// Distance factor by country code (very simplified)
// Carrier factor

const CARRIER_FACTOR: Record<string, number> = {
  ctt: 0.85,
  gls: 1.0,
  mrw: 1.05,
  dhl: 1.2,
  ups: 1.15,
  fedex: 1.3,
  seur: 0.9,
  correos: 0.8,
};

const COUNTRY_FACTOR: Record<string, number> = {
  PT: 0.4,
  ES: 0.6,
  FR: 1.0,
  DE: 1.2,
  GB: 1.1,
  IT: 0.9,
  NL: 1.0,
  BE: 0.8,
  US: 3.0,
  BR: 2.5,
};

function estimateCO2(order: Order): number {
  // Base: 0.5 kg CO₂e for packaging + warehouse handling
  let co2 = 0.5;

  // Distance factor
  const country = order.shipping_country_code?.toUpperCase() ?? "ES";
  const countryFactor = COUNTRY_FACTOR[country] ?? 1.0;
  co2 += countryFactor * 0.3;

  // Carrier factor
  const carrier = order.shipment?.carrier?.toLowerCase().trim() ?? "";
  const carrierKey = Object.keys(CARRIER_FACTOR).find((k) => carrier.includes(k));
  const carrierFactor = carrierKey ? CARRIER_FACTOR[carrierKey] : 1.0;
  co2 *= carrierFactor;

  // Weight proxy: personalized orders typically heavier
  if (order.is_personalized) co2 *= 1.1;

  return Math.round(co2 * 100) / 100; // kg CO₂e
}

function getMonthKey(dateStr: string) {
  return dateStr.slice(0, 7);
}

function getMonthLabel(key: string): string {
  const [year, month] = key.split("-");
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString("es-ES", {
    month: "long",
    year: "numeric",
  });
}

function getLast6Months(): string[] {
  const result: string[] = [];
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

export function PortalSustainabilityPanel({ orders }: PortalSustainabilityPanelProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "monthly" | "carriers">("overview");

  const months = useMemo(() => getLast6Months(), []);

  const ordersWithCO2 = useMemo(() => {
    return orders.map((o) => ({ ...o, co2: estimateCO2(o) }));
  }, [orders]);

  const totalCO2 = useMemo(() => ordersWithCO2.reduce((s, o) => s + o.co2, 0), [ordersWithCO2]);
  const avgCO2 = orders.length > 0 ? totalCO2 / orders.length : 0;

  const monthlyData = useMemo(() => {
    return months.map((month) => {
      const monthOrders = ordersWithCO2.filter((o) => getMonthKey(o.created_at) === month);
      const co2 = monthOrders.reduce((s, o) => s + o.co2, 0);
      const avg = monthOrders.length > 0 ? co2 / monthOrders.length : 0;
      return { month, label: getMonthLabel(month), count: monthOrders.length, co2, avg };
    });
  }, [ordersWithCO2, months]);

  const currentMonthCO2 = monthlyData[monthlyData.length - 1]?.co2 ?? 0;
  const prevMonthCO2 = monthlyData[monthlyData.length - 2]?.co2 ?? 0;
  const co2Trend = prevMonthCO2 > 0 ? ((currentMonthCO2 - prevMonthCO2) / prevMonthCO2) * 100 : 0;

  // Carrier breakdown
  const carrierData = useMemo(() => {
    const map: Record<string, { count: number; co2: number }> = {};
    for (const o of ordersWithCO2) {
      const carrier = o.shipment?.carrier ?? "Sin carrier";
      if (!map[carrier]) map[carrier] = { count: 0, co2: 0 };
      map[carrier].count += 1;
      map[carrier].co2 += o.co2;
    }
    return Object.entries(map)
      .map(([carrier, data]) => ({
        carrier,
        count: data.count,
        co2: data.co2,
        avg: data.co2 / data.count,
      }))
      .sort((a, b) => b.co2 - a.co2);
  }, [ordersWithCO2]);

  // Green badge: < 0.8 kg avg CO₂ per order
  const isGreen = avgCO2 < 0.8 && orders.length >= 10;
  const isNearGreen = avgCO2 < 1.0 && !isGreen && orders.length >= 10;

  function exportCO2Data() {
    const headers = ["ID", "Referencia", "País destino", "Carrier", "Personalizado", "CO₂ estimado (kg)", "Mes"];
    const rows = ordersWithCO2.map((o) => [
      String(o.id),
      o.external_id,
      o.shipping_country_code ?? "",
      o.shipment?.carrier ?? "",
      o.is_personalized ? "Sí" : "No",
      o.co2.toFixed(2),
      getMonthKey(o.created_at),
    ]);
    downloadCSV("sostenibilidad-co2.csv", rows, headers);
  }

  return (
    <div className="stack">
      {/* Green badge */}
      <div className={`sust-badge-row ${isGreen ? "sust-badge-row-green" : isNearGreen ? "sust-badge-row-near" : "sust-badge-row-default"}`}>
        <div className="sust-badge-icon">{isGreen ? "🌿" : isNearGreen ? "🌱" : "🌍"}</div>
        <div className="sust-badge-copy">
          {isGreen ? (
            <>
              <strong>Brandeate Green ✓</strong>
              <span>Tu operativa supera el umbral de eficiencia de carbono. Media de {avgCO2.toFixed(2)} kg CO₂e por envío.</span>
            </>
          ) : isNearGreen ? (
            <>
              <strong>Casi en nivel Green</strong>
              <span>Media de {avgCO2.toFixed(2)} kg CO₂e por envío. Optimiza carriers o zonas de entrega para alcanzar el badge Brandeate Green.</span>
            </>
          ) : (
            <>
              <strong>Huella de carbono logística</strong>
              <span>Media estimada de {avgCO2.toFixed(2)} kg CO₂e por envío. Los datos son una estimación basada en carrier, país y tipo de pedido.</span>
            </>
          )}
        </div>
        <button className="button-secondary" onClick={exportCO2Data} type="button" style={{ flexShrink: 0 }}>
          ↓ Exportar datos
        </button>
      </div>

      {/* KPI row */}
      <div className="sust-kpi-row">
        <div className="sust-kpi-card">
          <span className="sust-kpi-icon">☁️</span>
          <div>
            <span className="sust-kpi-value">{totalCO2.toFixed(1)}</span>
            <span className="sust-kpi-unit">kg CO₂e total</span>
          </div>
          <span className="sust-kpi-label">Historial completo analizado</span>
        </div>
        <div className="sust-kpi-card">
          <span className="sust-kpi-icon">📦</span>
          <div>
            <span className="sust-kpi-value">{avgCO2.toFixed(2)}</span>
            <span className="sust-kpi-unit">kg CO₂e / envío</span>
          </div>
          <span className="sust-kpi-label">Media por pedido</span>
        </div>
        <div className="sust-kpi-card">
          <span className="sust-kpi-icon">{co2Trend <= 0 ? "📉" : "📈"}</span>
          <div>
            <span className={`sust-kpi-value ${co2Trend <= 0 ? "sust-kpi-good" : "sust-kpi-warn"}`}>
              {co2Trend >= 0 ? "+" : ""}{co2Trend.toFixed(0)}%
            </span>
            <span className="sust-kpi-unit">vs. mes anterior</span>
          </div>
          <span className="sust-kpi-label">Tendencia mensual</span>
        </div>
        <div className="sust-kpi-card">
          <span className="sust-kpi-icon">🌳</span>
          <div>
            <span className="sust-kpi-value">{(totalCO2 / 21.7).toFixed(1)}</span>
            <span className="sust-kpi-unit">árboles/año</span>
          </div>
          <span className="sust-kpi-label">Equivalente en absorción</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="rpt-tabs">
        {(["overview", "monthly", "carriers"] as const).map((tab) => (
          <button
            className={`rpt-tab${activeTab === tab ? " rpt-tab-active" : ""}`}
            key={tab}
            onClick={() => setActiveTab(tab)}
            type="button"
          >
            {tab === "overview" ? "🌍 Resumen" : tab === "monthly" ? "📅 Por mes" : "🚚 Por carrier"}
          </button>
        ))}
      </div>

      {/* Overview */}
      {activeTab === "overview" && (
        <div className="sust-overview-grid">
          <div className="sust-info-card">
            <h4 className="sust-info-title">¿Cómo se calcula?</h4>
            <p className="sust-info-text">
              La estimación de CO₂ por envío se basa en tres factores: el país de destino (distancia aproximada), el carrier seleccionado (eficiencia por tipo de flota) y si el pedido es personalizado (peso estimado mayor).
            </p>
            <ul className="sust-info-list">
              <li><strong>Base:</strong> 0.5 kg CO₂e por manipulación y embalaje</li>
              <li><strong>Distancia:</strong> 0.12–0.9 kg adicionales según zona geográfica</li>
              <li><strong>Carrier:</strong> factor 0.8×–1.3× según eficiencia de flota</li>
              <li><strong>Personalización:</strong> +10% si el pedido es personalizado</li>
            </ul>
            <p className="sust-info-disclaimer">
              Estos valores son estimaciones orientativas. Para datos certificados contacta con <strong>hola@brandeate.com</strong>.
            </p>
          </div>

          <div className="sust-info-card">
            <h4 className="sust-info-title">Cómo mejorar tu puntuación</h4>
            <ul className="sust-info-action-list">
              <li>
                <span className="sust-action-icon">🚚</span>
                <div>
                  <strong>Prioriza carriers con menor factor</strong>
                  <span>CTT (0.85×), Correos (0.80×) y SEUR (0.90×) tienen menor huella que DHL o FedEx.</span>
                </div>
              </li>
              <li>
                <span className="sust-action-icon">📍</span>
                <div>
                  <strong>Optimiza zonas de entrega</strong>
                  <span>Envíos nacionales (ES/PT) tienen factor de distancia mucho más bajo que internacionales.</span>
                </div>
              </li>
              <li>
                <span className="sust-action-icon">📦</span>
                <div>
                  <strong>Packaging reciclado</strong>
                  <span>El packaging de Brandeate es 100% reciclable. Solicita packaging certificado FSC para reducir huella total.</span>
                </div>
              </li>
            </ul>
          </div>
        </div>
      )}

      {/* Monthly */}
      {activeTab === "monthly" && (
        <div className="rpt-table-wrap">
          <table className="rpt-table">
            <thead>
              <tr>
                <th>Mes</th>
                <th className="rpt-th-num">Envíos</th>
                <th className="rpt-th-num">CO₂ total (kg)</th>
                <th className="rpt-th-num">CO₂ medio / envío</th>
                <th>Eficiencia</th>
              </tr>
            </thead>
            <tbody>
              {monthlyData.map((row) => (
                <tr key={row.month}>
                  <td className="rpt-td-month">{row.label}</td>
                  <td className="rpt-td-num">{row.count}</td>
                  <td className="rpt-td-num rpt-td-bold">{row.co2.toFixed(1)}</td>
                  <td className="rpt-td-num">{row.count > 0 ? row.avg.toFixed(2) : "—"}</td>
                  <td>
                    {row.count > 0 ? (
                      <span className={`rpt-rate-badge ${row.avg < 0.8 ? "rpt-rate-green" : row.avg < 1.2 ? "rpt-rate-yellow" : "rpt-rate-red"}`}>
                        {row.avg < 0.8 ? "🌿 Green" : row.avg < 1.2 ? "🌱 Medio" : "🌍 Alto"}
                      </span>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Carriers */}
      {activeTab === "carriers" && (
        <div className="rpt-table-wrap">
          <table className="rpt-table">
            <thead>
              <tr>
                <th>Carrier</th>
                <th className="rpt-th-num">Envíos</th>
                <th className="rpt-th-num">CO₂ total (kg)</th>
                <th className="rpt-th-num">CO₂ medio / envío</th>
                <th>Impacto relativo</th>
              </tr>
            </thead>
            <tbody>
              {carrierData.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: "center", padding: "32px", color: "var(--muted)" }}>Sin datos de carrier disponibles.</td></tr>
              ) : carrierData.map((row) => {
                const maxCO2 = carrierData[0]?.co2 ?? 1;
                const pctBar = Math.round((row.co2 / maxCO2) * 100);
                return (
                  <tr key={row.carrier}>
                    <td><strong>{row.carrier}</strong></td>
                    <td className="rpt-td-num">{row.count}</td>
                    <td className="rpt-td-num rpt-td-bold">{row.co2.toFixed(1)}</td>
                    <td className="rpt-td-num">{row.avg.toFixed(2)}</td>
                    <td>
                      <div className="sust-bar-wrap">
                        <div className="sust-bar" style={{ width: `${pctBar}%` }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
