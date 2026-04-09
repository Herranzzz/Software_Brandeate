import Link from "next/link";
import type { ReactNode } from "react";

import { Card } from "@/components/card";
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
  timeFilters?: Array<{
    label: string;
    href: string;
    active?: boolean;
  }>;
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

export function SharedDashboardView({
  topContent,
  supplementaryContent,
  eyebrow,
  title,
  subtitle,
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
  noteTitle,
  noteBody,
  noteActions,
}: SharedDashboardViewProps) {
  const maxValue = Math.max(1, ...chart.map((item) => item.value));
  const donutTotal = donutSegments?.reduce((sum, segment) => sum + segment.value, 0) ?? 0;
  const highPriorityIncidents = incidents.filter(
    (incident) => incident.priority === "urgent" || incident.priority === "high",
  ).length;
  const incidentsPreview = incidents.slice(0, 3);
  const incidentSummaryText = highPriorityIncidents > 0 ? `${highPriorityIncidents} urgentes` : "abiertas";

  return (
    <div className="stack admin-dashboard">
      {topContent}

      <section className="admin-dashboard-hero">
        <div className="admin-dashboard-hero-copy">
          <span className="eyebrow">{eyebrow}</span>
          <h1 className="admin-dashboard-title">{title}</h1>
          <p className="admin-dashboard-subtitle">{subtitle}</p>
        </div>

        <div className="admin-dashboard-hero-actions">
          {controls}
          {heroAction}
        </div>
      </section>

      {timeFilters.length > 0 ? (
        <section className="admin-dashboard-timebar">
          <span className="admin-dashboard-timebar-label">Periodo</span>
          <div className="dashboard-donut-range-pills">
            {timeFilters.map((filter) => (
              <Link
                className={`shipments-range-pill${filter.active ? " is-active" : ""}`}
                href={filter.href}
                key={filter.label}
              >
                {filter.label}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* ── KPI pipeline strip (6 tarjetas) ───────────────── */}
      <section className="dash-kpi-strip">
        {kpis.map((item) => {
          const colorClass =
            item.tone === "accent"  ? "is-accent"  :
            item.tone === "danger"  ? "is-red"     :
            item.tone === "success" ? "is-green"   :
            item.tone === "warning" ? "is-orange"  : "is-slate";
          return (
            <article className={`exp-kpi-card ${colorClass}`} key={item.label}>
              <span className="exp-kpi-label">{item.label}</span>
              <strong className="exp-kpi-value">{item.value}</strong>
              <small className="exp-kpi-hint">{item.delta}</small>
            </article>
          );
        })}
      </section>

      {/* ── 2-col grid: donut · chart hero (50/50) ─────────── */}
      <section className="dash-analytics-grid">

        {/* Col 1: Status donut */}
        {donutSegments && donutSegments.length > 0 && (
          <Card className="exp-donut-card">
            <div className="exp-section-head">
              <span className="eyebrow">Estado envíos</span>
              <h3 className="exp-card-title">Distribución activa</h3>
            </div>
            <div className="exp-donut-wrap">
              <ShipmentDonut
                centerLabel="pedidos"
                centerValue={String(donutTotal)}
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
                const pct = donutTotal > 0 ? Math.round((seg.value / donutTotal) * 100) : 0;
                return (
                  <div className={`exp-status-row is-${seg.tone}`} key={seg.key}>
                    <span className="exp-status-dot" />
                    <span className="exp-status-name">{seg.label.replace(/^\S+\s/, "")}</span>
                    <div className="exp-status-bar-track">
                      <div className="exp-status-bar-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <strong>{seg.value}</strong>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {/* Col 2: Daily chart with hero number */}
        <Card className="dash-chart-card">
          <div className="exp-section-head">
            <span className="eyebrow">Volumen</span>
            <h3 className="exp-card-title">Pedidos por día</h3>
          </div>
          <div className="dash-chart-hero">
            <strong>{chart.reduce((s, p) => s + p.value, 0)}</strong>
            <span>pedidos en el periodo</span>
          </div>
          <div className="dash-chart-bars">
            {chart.map((point) => (
              <div className="dash-chart-col" key={point.dayKey}>
                <div className="dash-chart-bar-wrap">
                  <div
                    className="dash-chart-bar"
                    style={{ height: `${Math.max(8, (point.value / maxValue) * 100)}%` }}
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
        </Card>

      </section>

      {supplementaryContent}

      <section className="admin-dashboard-columns">
        <div className="stack admin-dashboard-column">
          <Card className="stack admin-dashboard-panel">
            <div className="admin-dashboard-panel-head">
              <div>
                <span className="eyebrow">📋 Actividad</span>
                <h3 className="section-title section-title-small">{recentOrdersTitle}</h3>
              </div>
              <Link className="admin-dashboard-inline-link" href={recentOrdersLinkHref}>
                {recentOrdersLinkLabel}
              </Link>
            </div>

            <div className="admin-orders-list">
              {recentOrders.slice(0, 6).map((order) => (
                <article className="admin-orders-row" key={order.id}>
                  <div className="admin-orders-main">
                    <div className="activity-title">{order.label}</div>
                    <div className="table-secondary">{order.secondary}</div>
                  </div>
                  <div className="admin-orders-meta">
                    <span className="admin-orders-status">{order.status}</span>
                    <span className="admin-orders-time">{order.time}</span>
                  </div>
                </article>
              ))}
            </div>
          </Card>
        </div>

        <div className="stack admin-dashboard-column">
          <Card className="stack admin-dashboard-panel">
            <div className="admin-dashboard-panel-head">
              <div>
                <span className="eyebrow">💚 Salud operativa</span>
                <h3 className="section-title section-title-small">{healthTitle}</h3>
              </div>
            </div>

            <div className="admin-health-grid">
              {healthItems.map((item) => (
                <article className="admin-health-card" key={item.label}>
                  <span className="admin-health-label">{item.label}</span>
                  <strong className="admin-health-value">{item.value}</strong>
                  <span className="admin-health-hint">{item.hint}</span>
                </article>
              ))}
            </div>
          </Card>

          <Card className="stack admin-dashboard-panel exp-alert-card">
            <div className="admin-dashboard-panel-head">
              <div>
                <span className="eyebrow">Atención</span>
                <h3 className="section-title section-title-small">{incidentsTitle}</h3>
              </div>
            </div>

            <div className="exp-alert-total">
              <strong>{incidents.length}</strong>
              <span>{incidentSummaryText}</span>
            </div>
            <div className="exp-alert-list">
              {incidentsPreview.map((incident) => {
                const isHot = incident.priority === "urgent" || incident.priority === "high";
                return (
                  <div className={`exp-alert-row${isHot ? " is-hot" : ""}`} key={incident.id}>
                    <span className="exp-alert-icon">{isHot ? "🔴" : "🟡"}</span>
                    <div className="exp-alert-body">
                      <strong>{incident.title}</strong>
                      <span>{incident.secondary}</span>
                    </div>
                    <span className={`exp-alert-count is-${isHot ? "red" : "orange"}`}>
                      {incident.priority}
                    </span>
                  </div>
                );
              })}

              {incidents.length === 0 ? (
                <div className="exp-table-empty" style={{ padding: "20px 0" }}>
                  <span>✅</span>
                  <p>{incidentsEmptyMessage}</p>
                </div>
              ) : null}
            </div>
            {incidents.length > 0 && (
              <Link className="exp-period-pill" href={incidentsLinkHref} style={{ marginTop: 4, justifySelf: "start" }}>
                {incidentsLinkLabel} →
              </Link>
            )}
          </Card>

          <Card className="stack admin-dashboard-panel admin-dashboard-panel-note">
            <div className="admin-dashboard-panel-head">
              <div>
                <span className="eyebrow">🚀 Siguiente paso</span>
                <h3 className="section-title section-title-small">{noteTitle}</h3>
              </div>
            </div>

            <div className="admin-dashboard-note">
              <p>{noteBody}</p>
              <div className="admin-dashboard-note-actions">{noteActions}</div>
            </div>
          </Card>
        </div>
      </section>
    </div>
  );
}
