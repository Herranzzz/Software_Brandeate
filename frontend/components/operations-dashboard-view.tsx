import Link from "next/link";
import type { ReactNode } from "react";

import { Card } from "@/components/card";
import { KpiCard } from "@/components/kpi-card";
import { formatDateTime } from "@/lib/format";

type KpiTone = "default" | "accent" | "warning" | "success" | "danger";

export type DashboardKpi = {
  label: string;
  value: string;
  delta?: string;
  tone?: KpiTone;
};

export type DashboardShipmentStateCard = {
  key: string;
  label: string;
  value: number;
  description: string;
  tone: string;
};

export type DashboardShipmentRow = {
  id: string | number;
  orderLabel: string;
  customerName: string;
  carrier: string;
  trackingLabel: string;
  trackingUrl?: string | null;
  stateLabel: string;
  stateTone: string;
  eta: string;
  updatedAt: string;
  href: string;
};

export type DashboardAttentionItem = {
  id: string;
  orderLabel: string;
  reason: string;
  priority: string;
  href: string;
};

export type DashboardActivityItem = {
  id: string;
  occurredAt: string;
  label: string;
  title: string;
  detail: string;
};

export type DashboardPerformanceItem = {
  label: string;
  value: string;
};

export type DashboardBarPoint = {
  date: string;
  total: number;
};

export type DashboardCarrierPoint = {
  carrier: string;
  shipments: number;
  avgDeliveryHours: string;
};

type OperationsDashboardViewProps = {
  branding: {
    displayName: string;
    logoMark?: string;
    logoUrl?: string | null;
  };
  heroEyebrow: string;
  heroTitle: string;
  heroSubtitle: string;
  lastSyncLabel: string;
  syncStatusLabel: string;
  primaryCarrier: string;
  primaryCarrierMeta: string;
  heroActions: ReactNode;
  controls?: ReactNode;
  rangeControls?: ReactNode;
  primaryKpis: DashboardKpi[];
  shipmentStateCards: DashboardShipmentStateCard[];
  recentShipments: DashboardShipmentRow[];
  attentionItems: DashboardAttentionItem[];
  quickActions: ReactNode;
  activityItems: DashboardActivityItem[];
  performanceItems: DashboardPerformanceItem[];
  topSku: string;
  topCarrier: string;
  ordersByDay: DashboardBarPoint[];
  personalizedCount: number;
  standardCount: number;
  carrierPerformance: DashboardCarrierPoint[];
};

export function OperationsDashboardView({
  branding,
  heroEyebrow,
  heroTitle,
  heroSubtitle,
  lastSyncLabel,
  syncStatusLabel,
  primaryCarrier,
  primaryCarrierMeta,
  heroActions,
  controls,
  rangeControls,
  primaryKpis,
  shipmentStateCards,
  recentShipments,
  attentionItems,
  quickActions,
  activityItems,
  performanceItems,
  topSku,
  topCarrier,
  ordersByDay,
  personalizedCount,
  standardCount,
  carrierPerformance,
}: OperationsDashboardViewProps) {
  const maxOrders = Math.max(...ordersByDay.map((entry) => entry.total), 1);
  const personalizationTotal = personalizedCount + standardCount || 1;
  const maxCarrierShipments = Math.max(...carrierPerformance.map((item) => item.shipments), 1);

  return (
    <div className="stack portal-dashboard">
      <Card className="portal-dashboard-hero portal-glass-card">
        <div className="portal-dashboard-hero-top">
          <div className="portal-dashboard-brand">
            {branding.logoUrl ? (
              <img alt={branding.displayName} className="portal-dashboard-logo" src={branding.logoUrl} />
            ) : (
              <div className="portal-dashboard-logo portal-dashboard-logo-fallback">{branding.logoMark ?? "BR"}</div>
            )}
            <div className="portal-dashboard-brand-copy">
              <span className="eyebrow">{heroEyebrow}</span>
              <h2 className="portal-dashboard-title">{heroTitle}</h2>
              <p className="portal-dashboard-subtitle">{heroSubtitle}</p>
            </div>
          </div>

          <div className="portal-dashboard-hero-meta">
            <div className="portal-dashboard-meta-card">
              <span className="portal-summary-label">Última sincronización</span>
              <strong>{lastSyncLabel}</strong>
              <span className="table-secondary">{syncStatusLabel}</span>
            </div>
            <div className="portal-dashboard-meta-card">
              <span className="portal-summary-label">Carrier principal</span>
              <strong>{primaryCarrier}</strong>
              <span className="table-secondary">{primaryCarrierMeta}</span>
            </div>
          </div>
        </div>

        <div className="portal-dashboard-hero-actions">{heroActions}</div>
      </Card>

      {controls}

      <section className="portal-dashboard-kpi-grid">
        {primaryKpis.map((item) => (
          <KpiCard key={item.label} delta={item.delta} label={item.label} tone={item.tone ?? "default"} value={item.value} />
        ))}
      </section>

      <section className="portal-dashboard-main-grid">
        <Card className="portal-dashboard-shipments portal-glass-card">
          <div className="portal-dashboard-section-head">
            <div>
              <span className="eyebrow">Estado de envíos</span>
              <h3 className="section-title section-title-small">Control del lote actual</h3>
              <p className="subtitle">Lectura rápida de dónde está cada pedido y qué necesita moverse ahora.</p>
            </div>
            {rangeControls}
          </div>

          <div className="portal-dashboard-state-grid">
            {shipmentStateCards.map((item) => (
              <article className={`portal-shipment-state-card portal-shipment-tone-${item.tone}`} key={item.key}>
                <span className="portal-shipment-state-label">{item.label}</span>
                <strong>{item.value}</strong>
                <span className="table-secondary">{item.description}</span>
              </article>
            ))}
          </div>

          <div className="portal-recent-table-wrap">
            <table className="portal-recent-table">
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Carrier</th>
                  <th>Tracking</th>
                  <th>Estado</th>
                  <th>ETA</th>
                  <th>Última actualización</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {recentShipments.length > 0 ? (
                  recentShipments.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <div className="portal-recent-order">
                          <Link className="table-link table-link-strong" href={row.href}>
                            {row.orderLabel}
                          </Link>
                          <span className="table-secondary">{row.customerName}</span>
                        </div>
                      </td>
                      <td>{row.carrier}</td>
                      <td>
                        {row.trackingUrl ? (
                          <a className="table-link" href={row.trackingUrl} rel="noreferrer" target="_blank">
                            {row.trackingLabel}
                          </a>
                        ) : (
                          row.trackingLabel
                        )}
                      </td>
                      <td>
                        <span className={`shipments-status-pill shipments-status-pill-${row.stateTone}`}>{row.stateLabel}</span>
                      </td>
                      <td>{row.eta}</td>
                      <td>{formatDateTime(row.updatedAt)}</td>
                      <td>
                        {row.trackingUrl ? (
                          <a className="table-link" href={row.trackingUrl} rel="noreferrer" target="_blank">
                            Ver tracking
                          </a>
                        ) : (
                          <Link className="table-link" href={row.href}>
                            Ver pedido
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="table-secondary" colSpan={7}>
                      Todavía no hay envíos recientes en este periodo.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="portal-dashboard-side">
          <Card className="portal-glass-card">
            <div className="portal-dashboard-section-head">
              <div>
                <span className="eyebrow">Riesgos</span>
                <h3 className="section-title section-title-small">Necesitan atención</h3>
              </div>
            </div>
            <div className="portal-risk-list">
              {attentionItems.length > 0 ? (
                attentionItems.map((item) => (
                  <Link className="portal-risk-row" href={item.href} key={item.id}>
                    <div>
                      <strong>{item.orderLabel}</strong>
                      <div className="table-secondary">{item.reason}</div>
                    </div>
                    <span className={`portal-soft-pill ${item.priority === "Alta" ? "portal-soft-pill-alert" : ""}`}>
                      {item.priority}
                    </span>
                  </Link>
                ))
              ) : (
                <div className="table-secondary">Sin riesgos críticos en este momento.</div>
              )}
            </div>
          </Card>

          <Card className="portal-glass-card">
            <div className="portal-dashboard-section-head">
              <div>
                <span className="eyebrow">Acciones rápidas</span>
                <h3 className="section-title section-title-small">Siguiente paso</h3>
              </div>
            </div>
            <div className="portal-dashboard-action-grid">{quickActions}</div>
          </Card>
        </div>
      </section>

      <section className="portal-dashboard-secondary-grid">
        <Card className="portal-glass-card">
          <div className="portal-dashboard-section-head">
            <div>
              <span className="eyebrow">Actividad</span>
              <h3 className="section-title section-title-small">Timeline reciente</h3>
            </div>
          </div>
          <div className="portal-activity-timeline">
            {activityItems.length > 0 ? (
              activityItems.map((item) => (
                <article className="portal-activity-row" key={item.id}>
                  <div className="portal-activity-dot" />
                  <div className="portal-activity-copy">
                    <div className="portal-activity-head">
                      <span className="portal-soft-pill">{item.label}</span>
                      <span className="table-secondary">{formatDateTime(item.occurredAt)}</span>
                    </div>
                    <strong>{item.title}</strong>
                    <div className="table-secondary">{item.detail}</div>
                  </div>
                </article>
              ))
            ) : (
              <div className="table-secondary">Aún no hay actividad reciente para mostrar.</div>
            )}
          </div>
        </Card>

        <Card className="portal-glass-card">
          <div className="portal-dashboard-section-head">
            <div>
              <span className="eyebrow">Rendimiento</span>
              <h3 className="section-title section-title-small">Métricas del servicio</h3>
            </div>
          </div>
          <div className="portal-performance-grid">
            {performanceItems.map((item) => (
              <div className="portal-performance-item" key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
          <div className="portal-performance-foot">
            <div>
              <span className="portal-summary-label">Top SKU</span>
              <strong>{topSku}</strong>
            </div>
            <div>
              <span className="portal-summary-label">Top carrier</span>
              <strong>{topCarrier}</strong>
            </div>
          </div>
        </Card>
      </section>

      <section className="portal-dashboard-charts-grid">
        <Card className="portal-glass-card">
          <div className="portal-dashboard-section-head">
            <div>
              <span className="eyebrow">Tendencia</span>
              <h3 className="section-title section-title-small">Pedidos por día</h3>
            </div>
          </div>
          <div className="portal-mini-bars">
            {ordersByDay.map((point) => {
              const height = Math.max(18, (point.total / maxOrders) * 140);
              return (
                <div className="portal-mini-bar-column" key={point.date}>
                  <div className="portal-mini-bar-wrap">
                    <div className="portal-mini-bar" style={{ height }} />
                  </div>
                  <strong>{point.total}</strong>
                  <span>{new Date(point.date).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}</span>
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="portal-glass-card">
          <div className="portal-dashboard-section-head">
            <div>
              <span className="eyebrow">Mix</span>
              <h3 className="section-title section-title-small">Personalizados vs estándar</h3>
            </div>
          </div>
          <div className="portal-mix-card">
            <div className="portal-mix-track">
              <div className="portal-mix-fill portal-mix-fill-personalized" style={{ width: `${(personalizedCount / personalizationTotal) * 100}%` }} />
              <div className="portal-mix-fill portal-mix-fill-standard" style={{ width: `${(standardCount / personalizationTotal) * 100}%` }} />
            </div>
            <div className="portal-mix-stats">
              <div className="portal-mix-stat">
                <span className="portal-status-legend-dot portal-status-dot-personalized" />
                <div>
                  <strong>{personalizedCount}</strong>
                  <span>Personalizados</span>
                </div>
              </div>
              <div className="portal-mix-stat">
                <span className="portal-status-legend-dot portal-status-dot-standard" />
                <div>
                  <strong>{standardCount}</strong>
                  <span>Estándar</span>
                </div>
              </div>
            </div>
          </div>
        </Card>

        <Card className="portal-glass-card">
          <div className="portal-dashboard-section-head">
            <div>
              <span className="eyebrow">Carrier</span>
              <h3 className="section-title section-title-small">Rendimiento por transportista</h3>
            </div>
          </div>
          <div className="portal-carrier-list">
            {carrierPerformance.length > 0 ? (
              carrierPerformance.slice(0, 4).map((carrier) => (
                <article className="portal-carrier-row" key={carrier.carrier}>
                  <div className="portal-carrier-copy">
                    <strong>{carrier.carrier}</strong>
                    <span>{carrier.shipments} envíos · {carrier.avgDeliveryHours}</span>
                  </div>
                  <div className="portal-carrier-bar">
                    <div className="portal-carrier-bar-fill" style={{ width: `${(carrier.shipments / maxCarrierShipments) * 100}%` }} />
                  </div>
                </article>
              ))
            ) : (
              <div className="table-secondary">Todavía no hay rendimiento de carrier en este periodo.</div>
            )}
          </div>
        </Card>
      </section>

      <Card className="portal-glass-card">
        <div className="portal-dashboard-section-head">
          <div>
            <span className="eyebrow">Necesita atención</span>
            <h3 className="section-title section-title-small">Pedidos y envíos con fricción</h3>
          </div>
        </div>
        <div className="portal-recent-table-wrap">
          <table className="portal-recent-table">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Motivo</th>
                <th>Prioridad</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {attentionItems.length > 0 ? (
                attentionItems.map((item) => (
                  <tr key={item.id}>
                    <td>{item.orderLabel}</td>
                    <td>{item.reason}</td>
                    <td>
                      <span className={`portal-soft-pill ${item.priority === "Alta" ? "portal-soft-pill-alert" : ""}`}>{item.priority}</span>
                    </td>
                    <td><Link className="table-link" href={item.href}>Abrir</Link></td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="table-secondary" colSpan={4}>Nada crítico que revisar ahora mismo.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
