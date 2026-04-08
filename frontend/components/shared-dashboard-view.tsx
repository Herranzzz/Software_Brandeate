import Link from "next/link";
import type { ReactNode } from "react";

import { Card } from "@/components/card";
import { KpiCard } from "@/components/kpi-card";
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

      <section className="admin-dashboard-kpis">
        {kpis.map((item, i) => (
          <KpiCard key={item.label} label={item.label} value={item.value} delta={item.delta} tone={item.tone} index={i} />
        ))}
      </section>

      <section className="admin-dashboard-analytics-section">
        <Card className="stack admin-dashboard-panel admin-dashboard-panel-primary">
          <div className="admin-dashboard-panel-head">
            <div>
              <span className="eyebrow">📊 Control operativo</span>
              <h3 className="section-title section-title-small">Volumen y estado de expediciones</h3>
            </div>
            <div className="admin-dashboard-panel-actions">
              <Link className="admin-dashboard-inline-link" href={chartLinkHref}>
                {chartLinkLabel}
              </Link>
            </div>
          </div>

          <div className="admin-dashboard-analytics-grid">
            <div className="admin-dashboard-chart-shell">
              <div className="admin-dashboard-subpanel-head">
                <div>
                  <h4 className="section-title section-title-small">Pedidos en el periodo</h4>
                </div>
              </div>
              <div className="chart-card admin-dashboard-chart-card">
                {chart.map((point) => (
                  <div className="chart-bar-group" key={point.dayKey}>
                    <div className="admin-dashboard-chart-plot">
                      <div
                        className="chart-bar admin-dashboard-chart-bar"
                        style={{ height: `${Math.max(12, (point.value / maxValue) * 100)}%` }}
                      />
                    </div>
                    <div className="chart-value">{point.value}</div>
                    <div className="chart-label">{point.day}</div>
                  </div>
                ))}
              </div>
            </div>

            {donutSegments && donutSegments.length > 0 ? (
              <div className="dashboard-donut-block dashboard-donut-side-panel">
                <div className="dashboard-donut-content">
                  <ShipmentDonut
                    segments={donutSegments}
                    size={256}
                    strokeWidth={20}
                    radius={98}
                    showTotal={false}
                    variant="hero"
                  />
                </div>
              </div>
            ) : null}
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

          <Card className="stack admin-dashboard-panel">
            <div className="admin-dashboard-panel-head">
              <div>
                <span className="eyebrow">🚨 Atención prioritaria</span>
                <h3 className="section-title section-title-small">{incidentsTitle}</h3>
              </div>
              <Link className="admin-dashboard-inline-link" href={incidentsLinkHref}>
                {incidentsLinkLabel}
              </Link>
            </div>

            <div className="incident-list incident-list-rich">
              {incidents.slice(0, 4).map((incident) => (
                <article className="incident-item incident-item-rich" key={incident.id}>
                  <div className="incident-content">
                    <div className="incident-topline">
                      <div className="activity-title">{incident.title}</div>
                      <span className={`incident-priority incident-priority-${incident.priority}`}>
                        {incident.priority}
                      </span>
                    </div>
                    <div className="table-secondary">{incident.secondary}</div>
                    <div className="incident-meta-row">
                      <span>{incident.status}</span>
                      <span>{incident.updatedAt}</span>
                    </div>
                  </div>
                </article>
              ))}

              {incidents.length === 0 ? (
                <div className="admin-dashboard-empty">{incidentsEmptyMessage}</div>
              ) : null}
            </div>
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
