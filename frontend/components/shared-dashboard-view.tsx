import Link from "next/link";
import type { ReactNode } from "react";

import { Card } from "@/components/card";
import { DashVolumeChart, DashMiniSparklineCard } from "@/components/dashboard-charts";
import { ShipmentDonut, type ShipmentSegment } from "@/components/shipment-donut";

type DashboardTone = "accent" | "warning" | "danger" | "default" | "success" | "blue" | "purple";

type DashboardKpi = {
  label: string;
  value: string;
  delta: string;
  tone: DashboardTone;
  emoji?: string;
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

type DashboardMiniChart = {
  eyebrow: string;
  label: string;
  value: number;
  hint: string;
  points?: number[];
  tone?: "red" | "green" | "blue" | "orange" | "slate";
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
  isHourly?: boolean;
  extraCharts?: DashboardMiniChart[];
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

const KPI_COLOR_MAP: Record<DashboardTone, string> = {
  accent:  "is-accent",
  danger:  "is-red",
  success: "is-green",
  warning: "is-orange",
  default: "is-slate",
  blue:    "is-blue",
  purple:  "is-purple",
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
  isHourly = false,
  extraCharts,
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
  const chartTotal = chart.reduce((s, p) => s + p.value, 0);
  const donutTotal = donutSegments?.reduce((sum, seg) => sum + seg.value, 0) ?? 0;
  const highPriorityIncidents = incidents.filter(
    (i) => i.priority === "urgent" || i.priority === "high",
  ).length;
  const urgentIncidents = incidents.filter((i) => i.priority === "urgent").length;
  const incidentsPreview = incidents.slice(0, 4);

  /* ── Operational health ──────────────────────────────────────── */
  const healthStatus =
    urgentIncidents > 0        ? "critical" :
    highPriorityIncidents > 2  ? "warning"  : "nominal";
  const healthLabel =
    healthStatus === "critical" ? "Estado crítico" :
    healthStatus === "warning"  ? "Atención requerida" : "Operativa normal";

  /* ── Delivery rate ───────────────────────────────────────────── */
  const deliveredSeg = donutSegments?.find((s) => s.key === "delivered");
  const deliveryRate = donutTotal > 0 && deliveredSeg
    ? Math.round((deliveredSeg.value / donutTotal) * 100)
    : null;

  /* ── Health max for progress bars ───────────────────────────── */
  const healthMax = Math.max(1, ...healthItems.map((h) => h.value));

  return (
    <div className="stack admin-dashboard">
      {topContent}

      {/* ── Hero ──────────────────────────────────────────────── */}
      <section className="admin-dashboard-hero">
        <div className="admin-dashboard-hero-copy">
          <div className="dash-hero-eyebrow-row">
            <span className="eyebrow">{eyebrow}</span>
            <span className={`dash-health-badge dash-health-${healthStatus}`}>
              <span className="dash-health-dot" />
              {healthLabel}
            </span>
          </div>
          <h1 className="admin-dashboard-title">{title}</h1>
          <p className="admin-dashboard-subtitle">{subtitle}</p>
        </div>

        <div className="admin-dashboard-hero-actions">
          {controls}
          {heroAction}
        </div>
      </section>

      {/* ── Time filters ─────────────────────────────────────── */}
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

      {/* ── KPI strip ────────────────────────────────────────── */}
      <section className="dash-kpi-strip">
        {kpis.map((item) => (
          <article className={`exp-kpi-card ${KPI_COLOR_MAP[item.tone]}`} key={item.label}>
            <div className="exp-kpi-top">
              {item.emoji && <div className="exp-kpi-icon">{item.emoji}</div>}
              <span className="exp-kpi-label">{item.label}</span>
            </div>
            <strong className="exp-kpi-value">{item.value}</strong>
            <small className="exp-kpi-hint">{item.delta}</small>
          </article>
        ))}
      </section>

      {/* ── 2-col: donut + chart ─────────────────────────────── */}
      <section className="dash-analytics-grid">

        {/* Status donut with delivery rate headline */}
        {donutSegments && donutSegments.length > 0 && (
          <Card className="exp-donut-card dash-donut-card-v2">
            <div className="exp-section-head">
              <div>
                <span className="eyebrow">Estado de envíos</span>
                <h3 className="exp-card-title">Distribución activa</h3>
              </div>
              {deliveryRate !== null && (
                <div className="dash-delivery-rate-pill">
                  <strong>{deliveryRate}%</strong>
                  <span>entregado</span>
                </div>
              )}
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

        {/* Daily / hourly orders chart */}
        <Card className="dash-chart-card dash-chart-card-v2">
          <DashVolumeChart
            chart={chart}
            isHourly={isHourly}
            chartTotal={chartTotal}
            chartLinkHref={chartLinkHref}
            chartLinkLabel={chartLinkLabel}
          />
        </Card>

      </section>

      {/* ── Mini metric charts ───────────────────────────────── */}
      {extraCharts && extraCharts.length > 0 && (
        <section className="dash-mini-charts-strip">
          {extraCharts.map((mc) => (
            <DashMiniSparklineCard key={mc.eyebrow} {...mc} />
          ))}
        </section>
      )}

      {supplementaryContent}

      {/* ── Bottom grid ───────────────────────────────────────── */}
      <section className="admin-dashboard-columns">

        {/* Recent orders */}
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
              {recentOrders.length === 0 && (
                <p className="table-secondary" style={{ padding: "12px 0" }}>Sin pedidos en el periodo.</p>
              )}
            </div>
          </Card>
        </div>

        {/* Right column: health + incidents + quick actions */}
        <div className="stack admin-dashboard-column">

          {/* Operational health with visual bars */}
          <Card className="stack admin-dashboard-panel">
            <div className="admin-dashboard-panel-head">
              <div>
                <span className="eyebrow">💚 Estado operativo</span>
                <h3 className="section-title section-title-small">{healthTitle}</h3>
              </div>
            </div>

            <div className="dash-health-pipeline">
              {healthItems.map((item, idx) => {
                const pct = Math.round((item.value / healthMax) * 100);
                const isLast = idx === healthItems.length - 1;
                return (
                  <div className={`dash-health-row-v2${isLast ? " is-last" : ""}`} key={item.label}>
                    <div className="dash-health-row-meta">
                      <span className="dash-health-row-label">{item.label}</span>
                      <span className="dash-health-row-hint">{item.hint}</span>
                    </div>
                    <div className="dash-health-row-right">
                      <strong className="dash-health-row-value">{item.value}</strong>
                      <div className="dash-health-bar-track">
                        <div className="dash-health-bar-fill" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Incidents */}
          <Card className="stack admin-dashboard-panel exp-alert-card">
            <div className="admin-dashboard-panel-head">
              <div>
                <span className="eyebrow">⚡ Atención</span>
                <h3 className="section-title section-title-small">{incidentsTitle}</h3>
              </div>
              {incidents.length > 0 && (
                <div className="dash-incident-summary">
                  {urgentIncidents > 0 && (
                    <span className="dash-incident-pill is-urgent">{urgentIncidents} urgente{urgentIncidents !== 1 ? "s" : ""}</span>
                  )}
                  {highPriorityIncidents - urgentIncidents > 0 && (
                    <span className="dash-incident-pill is-high">{highPriorityIncidents - urgentIncidents} altas</span>
                  )}
                </div>
              )}
            </div>

            <div className="exp-alert-list">
              {incidentsPreview.map((incident) => {
                const isHot = incident.priority === "urgent" || incident.priority === "high";
                return (
                  <div className={`exp-alert-row${isHot ? " is-hot" : ""}`} key={incident.id}>
                    <span className="exp-alert-icon">{incident.priority === "urgent" ? "🔴" : isHot ? "🟠" : "🟡"}</span>
                    <div className="exp-alert-body">
                      <strong>{incident.title}</strong>
                      <span>{incident.secondary}</span>
                    </div>
                    <span className={`exp-alert-count is-${isHot ? (incident.priority === "urgent" ? "red" : "orange") : "orange"}`}>
                      {incident.priority}
                    </span>
                  </div>
                );
              })}

              {incidents.length === 0 && (
                <div className="exp-table-empty" style={{ padding: "16px 0" }}>
                  <span>✅</span>
                  <p>{incidentsEmptyMessage}</p>
                </div>
              )}
            </div>

            {incidents.length > 0 && (
              <Link className="exp-period-pill" href={incidentsLinkHref} style={{ marginTop: 4, justifySelf: "start" }}>
                {incidentsLinkLabel} →
              </Link>
            )}
          </Card>

          {/* Quick actions */}
          <Card className="stack admin-dashboard-panel dash-quick-actions-card">
            <div className="admin-dashboard-panel-head">
              <div>
                <span className="eyebrow">🚀 {noteTitle}</span>
              </div>
            </div>
            <p className="dash-quick-actions-body">{noteBody}</p>
            <div className="dash-quick-actions-row">{noteActions}</div>
          </Card>

        </div>
      </section>
    </div>
  );
}
