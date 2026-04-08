import Link from "next/link";
import type { ReactNode } from "react";

import { ShipmentDonut, type ShipmentSegment } from "@/components/shipment-donut";

type DashboardTone = "accent" | "warning" | "danger" | "default" | "success";

type DashboardKpi = {
  label: string;
  value: string;
  delta: string;
  tone: DashboardTone;
};

type DashboardChartPoint = {
  dayKey: string;
  day: string;
  value: number;
};

type DashboardRecentOrder = {
  id: string | number;
  label: string;
  secondary: string;
  status: string;
  time: string;
};

type DashboardHealthItem = {
  label: string;
  value: number;
  hint: string;
};

type DashboardIncidentItem = {
  id: string | number;
  title: string;
  priority: string;
  secondary: string;
  status: string;
  updatedAt: string;
};

type SharedDashboardViewProps = {
  topContent?: ReactNode;
  supplementaryContent?: ReactNode;
  eyebrow: string;
  title: string;
  subtitle: string;
  controls?: ReactNode;
  heroAction?: ReactNode;
  kpis: DashboardKpi[];
  donutSegments?: ShipmentSegment[];
  chart: DashboardChartPoint[];
  chartLinkHref: string;
  chartLinkLabel: string;
  timeFilters?: Array<{ label: string; href: string; active?: boolean }>;
  recentOrdersTitle: string;
  recentOrdersLinkHref: string;
  recentOrdersLinkLabel: string;
  recentOrders: DashboardRecentOrder[];
  healthTitle: string;
  healthItems: DashboardHealthItem[];
  incidentsTitle: string;
  incidentsLinkHref: string;
  incidentsLinkLabel: string;
  incidents: DashboardIncidentItem[];
  incidentsEmptyMessage: string;
  noteTitle: string;
  noteBody: string;
  noteActions: ReactNode;
};

const PRIORITY_COLOR: Record<string, string> = {
  urgent:   "#dc2626",
  high:     "#d97706",
  medium:   "#2563eb",
  low:      "#6b7280",
};

const STATUS_LABEL: Record<string, string> = {
  pending:       "Pendiente",
  in_progress:   "En proceso",
  ready_to_ship: "Listo",
  shipped:       "Enviado",
  delivered:     "Entregado",
  exception:     "Incidencia",
};

const STATUS_PILL_CLASS: Record<string, string> = {
  pending:       "exp-stage-pill",
  in_progress:   "exp-stage-pill is-blue",
  ready_to_ship: "exp-stage-pill is-orange",
  shipped:       "exp-stage-pill is-sky",
  delivered:     "exp-stage-pill is-green",
  exception:     "exp-stage-pill is-red",
};

export function SharedDashboardView({
  topContent,
  supplementaryContent,
  eyebrow,
  title,
  controls,
  heroAction,
  kpis,
  donutSegments,
  chart,
  chartLinkHref,
  chartLinkLabel,
  timeFilters = [],
  recentOrdersTitle,
  recentOrdersLinkHref,
  recentOrdersLinkLabel,
  recentOrders,
  healthTitle,
  healthItems,
  incidentsTitle,
  incidentsLinkHref,
  incidentsLinkLabel,
  incidents,
  incidentsEmptyMessage,
}: SharedDashboardViewProps) {
  const maxChart = Math.max(1, ...chart.map((p) => p.value));
  const totalOrders = chart.reduce((s, p) => s + p.value, 0);
  const openIncidents = incidents.length;
  const urgentCount = incidents.filter(
    (i) => i.priority === "urgent" || i.priority === "high",
  ).length;

  const kpiColorClass: Record<DashboardTone, string> = {
    accent:  "is-accent",
    danger:  "is-red",
    success: "is-green",
    warning: "is-orange",
    default: "is-slate",
  };

  return (
    <div className="dash-v2-page">
      {topContent}

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="exp-header card">
        <div className="exp-header-top">
          <div className="exp-header-copy">
            <span className="eyebrow">{eyebrow}</span>
            <h1 className="exp-page-title">{title}</h1>
          </div>
          <div className="exp-header-right">
            {timeFilters.length > 0 && (
              <div className="exp-period-pills">
                {timeFilters.map((f) => (
                  <Link
                    className={`exp-period-pill${f.active ? " is-active" : ""}`}
                    href={f.href}
                    key={f.label}
                  >
                    {f.label}
                  </Link>
                ))}
              </div>
            )}
            {heroAction}
          </div>
        </div>
        {controls && (
          <div className="dash-header-toolbar">{controls}</div>
        )}
      </div>

      {/* ── KPI strip ──────────────────────────────────────── */}
      <div className="dash-kpi-strip">
        {kpis.map((item) => (
          <article
            className={`exp-kpi-card ${kpiColorClass[item.tone]}`}
            key={item.label}
          >
            <span className="exp-kpi-label">{item.label}</span>
            <strong className="exp-kpi-value">{item.value}</strong>
            <small className="exp-kpi-hint">{item.delta}</small>
          </article>
        ))}
      </div>

      {/* ── Main 3-col grid ────────────────────────────────── */}
      <div className="exp-main-grid">

        {/* Col 1: Status donut */}
        {donutSegments && donutSegments.length > 0 && (
          <div className="card exp-donut-card">
            <div className="exp-section-head">
              <span className="eyebrow">Estado envíos</span>
              <h2 className="exp-card-title">Distribución activa</h2>
            </div>
            <div className="exp-donut-wrap">
              <ShipmentDonut
                centerLabel="pedidos"
                centerValue={String(donutSegments.reduce((s, seg) => s + seg.value, 0))}
                radius={90}
                segments={donutSegments}
                showLegend={false}
                showTotal={false}
                size={228}
                strokeWidth={22}
                variant="hero"
              />
            </div>
            <div className="exp-status-list">
              {donutSegments.map((seg) => {
                const total = donutSegments.reduce((s, x) => s + x.value, 0);
                const pct = total > 0 ? Math.round((seg.value / total) * 100) : 0;
                return (
                  <div className={`exp-status-row is-${seg.tone}`} key={seg.key}>
                    <span className="exp-status-dot" />
                    <span className="exp-status-name">{seg.label.replace(/^.+\s/, "")}</span>
                    <div className="exp-status-bar-track">
                      <div className="exp-status-bar-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <strong>{seg.value}</strong>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Col 2: Daily chart */}
        <div className="card exp-flow-card dash-chart-card">
          <div className="exp-section-head">
            <span className="eyebrow">Volumen</span>
            <h2 className="exp-card-title">Pedidos por día</h2>
          </div>

          <div className="dash-chart-hero">
            <strong>{totalOrders}</strong>
            <span>pedidos en el periodo</span>
          </div>

          <div className="dash-chart-bars">
            {chart.map((point) => (
              <div className="dash-chart-col" key={point.dayKey}>
                <div className="dash-chart-bar-wrap">
                  <div
                    className="dash-chart-bar"
                    style={{ height: `${Math.max(8, (point.value / maxChart) * 100)}%` }}
                  />
                </div>
                <span className="dash-chart-value">{point.value}</span>
                <span className="dash-chart-label">{point.day}</span>
              </div>
            ))}
          </div>

          <div className="dash-chart-footer">
            <Link className="exp-period-pill" href={chartLinkHref}>
              {chartLinkLabel} →
            </Link>
          </div>

          {/* Health mini grid */}
          <div className="exp-sla-row dash-health-row">
            {healthItems.map((item) => (
              <div className="exp-sla-item" key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        </div>

        {/* Col 3: Incidents alert panel */}
        <div className="card exp-alert-card">
          <div className="exp-section-head">
            <span className="eyebrow">Atención prioritaria</span>
            <h2 className="exp-card-title">{incidentsTitle}</h2>
          </div>

          <div className="exp-alert-total">
            <strong>{openIncidents}</strong>
            <span>{urgentCount > 0 ? `${urgentCount} urgentes` : "incidencias abiertas"}</span>
          </div>

          <div className="exp-alert-list">
            {incidents.slice(0, 5).map((incident) => {
              const color = PRIORITY_COLOR[incident.priority] ?? "#6b7280";
              return (
                <div
                  className={`exp-alert-row${incident.priority === "urgent" || incident.priority === "high" ? " is-hot" : ""}`}
                  key={incident.id}
                >
                  <span
                    className="exp-alert-icon"
                    style={{ color }}
                    title={incident.priority}
                  >
                    ●
                  </span>
                  <div className="exp-alert-body">
                    <strong>{incident.title}</strong>
                    <span>{incident.secondary}</span>
                  </div>
                  <span className="exp-alert-count" style={{ color, fontSize: "0.72rem", fontWeight: 600 }}>
                    {incident.priority}
                  </span>
                </div>
              );
            })}
            {incidents.length === 0 && (
              <div className="exp-table-empty" style={{ padding: "24px 0" }}>
                <span>✅</span>
                <p>{incidentsEmptyMessage}</p>
              </div>
            )}
          </div>

          {incidents.length > 0 && (
            <Link className="exp-period-pill" href={incidentsLinkHref} style={{ marginTop: 6, justifySelf: "start" }}>
              {incidentsLinkLabel} →
            </Link>
          )}
        </div>
      </div>

      {/* ── Supplementary (employee metrics) ───────────────── */}
      {supplementaryContent}

      {/* ── Recent orders table ────────────────────────────── */}
      <div className="card exp-table-card">
        <div className="exp-section-head" style={{ flexDirection: "row", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <span className="eyebrow">Actividad</span>
            <h2 className="exp-card-title">{recentOrdersTitle}</h2>
          </div>
          <Link className="exp-period-pill" href={recentOrdersLinkHref}>
            {recentOrdersLinkLabel} →
          </Link>
        </div>

        <div className="exp-table-wrap">
          <table className="exp-table">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Cliente</th>
                <th>Estado</th>
                <th>Fecha</th>
              </tr>
            </thead>
            <tbody>
              {recentOrders.map((order) => (
                <tr className="exp-table-row" key={order.id}>
                  <td className="exp-table-id">{order.label}</td>
                  <td className="exp-table-primary">{order.secondary}</td>
                  <td>
                    <span className={STATUS_PILL_CLASS[order.status] ?? "exp-stage-pill"}>
                      {STATUS_LABEL[order.status] ?? order.status}
                    </span>
                  </td>
                  <td className="exp-table-muted">{order.time}</td>
                </tr>
              ))}
              {recentOrders.length === 0 && (
                <tr>
                  <td className="exp-table-muted" colSpan={4} style={{ textAlign: "center", padding: "32px" }}>
                    No hay pedidos en este periodo.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
