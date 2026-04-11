"use client";

import { useEffect, useMemo, useState } from "react";

import type { Order } from "@/lib/types";

const STORAGE_KEY = "brandeate_inventory_v1";
type StockStore = Record<string, number>; // keyed by sku

type SKURow = {
  sku: string;
  name: string;
  sold30: number;
  sold60: number;
  dailyVelocity: number;
  stock: number;
  daysRemaining: number | null;
  risk: "green" | "yellow" | "red" | "unknown";
};

type PortalInventoryPanelProps = {
  orders: Order[];
};

function loadStock(): StockStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as StockStore;
  } catch { /* ignore */ }
  return {};
}

function saveStock(store: StockStore) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch { /* ignore */ }
}

function getRisk(days: number | null): "green" | "yellow" | "red" | "unknown" {
  if (days === null) return "unknown";
  if (days <= 7) return "red";
  if (days <= 30) return "yellow";
  return "green";
}

function buildSKURows(orders: Order[], stockStore: StockStore): SKURow[] {
  const now = Date.now();
  const ms30 = 30 * 24 * 60 * 60 * 1000;
  const ms60 = 60 * 24 * 60 * 60 * 1000;

  // Aggregate by SKU
  const skuMap: Record<string, { name: string; sold30: number; sold60: number }> = {};

  for (const order of orders) {
    const orderTime = new Date(order.created_at).getTime();
    const inLast60 = now - orderTime <= ms60;
    const inLast30 = now - orderTime <= ms30;

    for (const item of order.items) {
      const sku = item.sku?.trim();
      if (!sku) continue;
      if (!skuMap[sku]) {
        skuMap[sku] = { name: item.title ?? item.name ?? sku, sold30: 0, sold60: 0 };
      }
      if (inLast60) skuMap[sku].sold60 += item.quantity;
      if (inLast30) skuMap[sku].sold30 += item.quantity;
    }
  }

  return Object.entries(skuMap).map(([sku, data]) => {
    const stock = stockStore[sku] ?? 0;
    const dailyVelocity = data.sold30 / 30;
    const daysRemaining = dailyVelocity > 0 ? Math.floor(stock / dailyVelocity) : stock > 0 ? null : 0;
    return {
      sku,
      name: data.name,
      sold30: data.sold30,
      sold60: data.sold60,
      dailyVelocity,
      stock,
      daysRemaining,
      risk: getRisk(daysRemaining),
    };
  }).sort((a, b) => {
    // Sort by risk: red first, then yellow, then unknown, then green
    const order = { red: 0, yellow: 1, unknown: 2, green: 3 };
    return order[a.risk] - order[b.risk];
  });
}

const RISK_META = {
  red: { label: "Crítico", className: "inv-risk-red", icon: "🔴" },
  yellow: { label: "Bajo", className: "inv-risk-yellow", icon: "🟡" },
  green: { label: "OK", className: "inv-risk-green", icon: "🟢" },
  unknown: { label: "Sin velocidad", className: "inv-risk-unknown", icon: "⚪" },
};

export function PortalInventoryPanel({ orders }: PortalInventoryPanelProps) {
  const [stockStore, setStockStore] = useState<StockStore>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [reposModal, setReposModal] = useState<SKURow | null>(null);
  const [addSku, setAddSku] = useState("");
  const [addName, setAddName] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);

  useEffect(() => {
    setStockStore(loadStock());
  }, []);

  const rows = useMemo(() => buildSKURows(orders, stockStore), [orders, stockStore]);

  // SKUs with no orders (manually added)
  const manualSkus = Object.keys(stockStore).filter(
    (sku) => !rows.find((r) => r.sku === sku),
  );
  const allRows: SKURow[] = [
    ...rows,
    ...manualSkus.map((sku) => {
      const stock = stockStore[sku] ?? 0;
      return {
        sku,
        name: sku,
        sold30: 0,
        sold60: 0,
        dailyVelocity: 0,
        stock,
        daysRemaining: stock > 0 ? null : 0,
        risk: "unknown" as const,
      };
    }),
  ];

  function startEdit(sku: string, current: number) {
    setEditingId(sku);
    setEditValue(String(current));
  }

  function commitEdit(sku: string) {
    const val = parseInt(editValue, 10);
    if (!isNaN(val) && val >= 0) {
      const next = { ...stockStore, [sku]: val };
      setStockStore(next);
      saveStock(next);
    }
    setEditingId(null);
  }

  function addManualSku() {
    const sku = addSku.trim();
    if (!sku) return;
    const next = { ...stockStore, [sku]: 0 };
    setStockStore(next);
    saveStock(next);
    setAddSku("");
    setAddName("");
    setShowAddForm(false);
  }

  const redCount = allRows.filter((r) => r.risk === "red").length;
  const yellowCount = allRows.filter((r) => r.risk === "yellow").length;

  return (
    <div className="stack">
      {/* Summary pills */}
      <div className="inv-summary-row">
        <div className="inv-summary-pill inv-pill-red">
          <span>🔴</span>
          <span><strong>{redCount}</strong> críticos</span>
        </div>
        <div className="inv-summary-pill inv-pill-yellow">
          <span>🟡</span>
          <span><strong>{yellowCount}</strong> bajos</span>
        </div>
        <div className="inv-summary-pill inv-pill-info">
          <span>📦</span>
          <span><strong>{allRows.length}</strong> SKUs activos</span>
        </div>
        <div className="inv-summary-pill inv-pill-info">
          <span>📊</span>
          <span>Basado en los últimos <strong>30 días</strong></span>
        </div>
      </div>

      {allRows.length === 0 ? (
        <div className="inv-empty">
          <div className="inv-empty-icon">📦</div>
          <strong>Sin SKUs registrados</strong>
          <p>Los SKUs aparecen automáticamente cuando hay pedidos con artículos. Puedes añadir uno manualmente para empezar a gestionar el stock.</p>
        </div>
      ) : (
        <div className="inv-table-wrap">
          <table className="inv-table">
            <thead>
              <tr>
                <th>SKU · Producto</th>
                <th className="inv-th-num">Vendidos 30d</th>
                <th className="inv-th-num">Vel. diaria</th>
                <th className="inv-th-num">Stock</th>
                <th className="inv-th-num">Días restantes</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {allRows.map((row) => {
                const risk = RISK_META[row.risk];
                const isEditing = editingId === row.sku;
                return (
                  <tr className={`inv-row inv-row-${row.risk}`} key={row.sku}>
                    <td>
                      <div className="inv-sku-cell">
                        <code className="inv-sku-code">{row.sku}</code>
                        <span className="inv-sku-name">{row.name !== row.sku ? row.name : ""}</span>
                      </div>
                    </td>
                    <td className="inv-td-num">{row.sold30}</td>
                    <td className="inv-td-num">
                      {row.dailyVelocity > 0 ? row.dailyVelocity.toFixed(1) : "—"}
                    </td>
                    <td className="inv-td-num">
                      {isEditing ? (
                        <div className="inv-stock-edit">
                          <input
                            autoFocus
                            className="inv-stock-input"
                            min={0}
                            onBlur={() => commitEdit(row.sku)}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitEdit(row.sku);
                              if (e.key === "Escape") setEditingId(null);
                            }}
                            type="number"
                            value={editValue}
                          />
                        </div>
                      ) : (
                        <button
                          className="inv-stock-btn"
                          onClick={() => startEdit(row.sku, row.stock)}
                          title="Haz clic para editar"
                          type="button"
                        >
                          {row.stock} <span className="inv-edit-hint">✏️</span>
                        </button>
                      )}
                    </td>
                    <td className="inv-td-num">
                      {row.daysRemaining === null ? "∞" : row.daysRemaining === 0 && row.stock === 0 ? "0" : row.daysRemaining ?? "—"}
                    </td>
                    <td>
                      <span className={`inv-risk-badge ${risk.className}`}>
                        {risk.icon} {risk.label}
                      </span>
                    </td>
                    <td>
                      <button
                        className="inv-reorder-btn"
                        onClick={() => setReposModal(row)}
                        title="Solicitar reposición"
                        type="button"
                      >
                        Reponer
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add SKU manually */}
      <div className="inv-add-row">
        {showAddForm ? (
          <div className="inv-add-form">
            <input
              className="inv-add-input"
              onChange={(e) => setAddSku(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addManualSku(); }}
              placeholder="Código SKU"
              type="text"
              value={addSku}
            />
            <button className="button" onClick={addManualSku} type="button">
              Añadir
            </button>
            <button className="button-secondary" onClick={() => setShowAddForm(false)} type="button">
              Cancelar
            </button>
          </div>
        ) : (
          <button className="button-secondary" onClick={() => setShowAddForm(true)} type="button">
            + Añadir SKU manualmente
          </button>
        )}
      </div>

      <div className="info-banner">
        Los niveles de stock se guardan en este navegador. Esta vista de previsión es local — escríbenos a <strong>hola@brandeate.com</strong> para sincronizar el inventario con tu WMS o ERP.
      </div>

      {/* Reposición modal */}
      {reposModal && (
        <div className="rwiz-overlay" onClick={(e) => { if (e.target === e.currentTarget) setReposModal(null); }}>
          <div className="inv-repos-dialog">
            <div className="rwiz-header">
              <div className="rwiz-header-left">
                <h2 className="rwiz-title">Solicitar reposición</h2>
                <p style={{ fontSize: 13, color: "var(--muted)" }}>
                  <code>{reposModal.sku}</code> · {reposModal.name !== reposModal.sku ? reposModal.name : ""}
                </p>
              </div>
              <button className="rwiz-close" onClick={() => setReposModal(null)} type="button">✕</button>
            </div>
            <div className="inv-repos-body">
              <div className="inv-repos-kv">
                <div className="inv-repos-kv-row">
                  <span>Stock actual</span>
                  <strong>{reposModal.stock} uds.</strong>
                </div>
                <div className="inv-repos-kv-row">
                  <span>Velocidad diaria</span>
                  <strong>{reposModal.dailyVelocity > 0 ? `${reposModal.dailyVelocity.toFixed(1)} uds./día` : "Sin datos"}</strong>
                </div>
                <div className="inv-repos-kv-row">
                  <span>Días estimados restantes</span>
                  <strong className={`inv-repos-days inv-repos-days-${reposModal.risk}`}>
                    {reposModal.daysRemaining === null ? "Sin estimación" : `${reposModal.daysRemaining} días`}
                  </strong>
                </div>
              </div>
              <p className="inv-repos-copy">
                Contacta con el equipo de Brandeate para tramitar la reposición. Incluiremos el contexto de este SKU en la solicitud.
              </p>
              <a
                className="button"
                href={`mailto:hola@brandeate.com?subject=Solicitud reposición SKU ${encodeURIComponent(reposModal.sku)}&body=Hola, necesito reponer el SKU ${encodeURIComponent(reposModal.sku)} (${encodeURIComponent(reposModal.name)}).%0A%0AStock actual: ${reposModal.stock} uds.%0ADías restantes estimados: ${reposModal.daysRemaining ?? "N/A"}`}
                rel="noreferrer"
                target="_blank"
              >
                Enviar solicitud por email
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
