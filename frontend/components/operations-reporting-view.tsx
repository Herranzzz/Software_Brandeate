import Link from "next/link";
import type { ReactNode } from "react";

import { Card } from "@/components/card";
import { PageHeader } from "@/components/page-header";
import { formatDateTime } from "@/lib/format";


type ReportingKpi = {
  label: string;
  value: string;
  meta: string;
};

type ReportingMetric = {
  label: string;
  value: string;
};

type ReportingStatus = {
  label: string;
  value: number;
  color: string;
};

type ReportingBar = {
  label: string;
  value: number;
  tone: string;
};

type ReportingTopItem = {
  label: string;
  value: string;
  meta?: string;
};

type ReportingActivity = {
  id: string;
  label: string;
  title: string;
  detail: string;
  occurredAt: string;
};

type ReportingAttention = {
  id: string;
  label: string;
  reason: string;
  priority: string;
  updatedAt: string;
  href: string;
};

type ReportingTrend = {
  label: string;
  value: number;
};

type OperationsReportingViewProps = {
  title: string;
  description: string;
  syncLabel: string;
  controls?: ReactNode;
  headerActions?: ReactNode;
  primaryKpis: ReportingKpi[];
  secondaryKpis: ReportingKpi[];
  statusMix: ReportingStatus[];
  shipmentHighlights: ReportingMetric[];
  riskHighlights: ReportingMetric[];
  performanceHighlights: ReportingMetric[];
  needsAttention: ReportingAttention[];
  activity: ReportingActivity[];
  topSkus: ReportingTopItem[];
  topVariants: ReportingTopItem[];
  topIncidentProducts: ReportingTopItem[];
  trend: ReportingTrend[];
};

function maxValue(items: Array<{ value: number }>) {
  return items.reduce((max, item) => Math.max(max, item.value), 0) || 1;
}

function buildDonutSegments(items: Array<{ value: number; color: string }>, radius: number, circumference: number) {
  const total = items.reduce((sum, item) => sum + item.value, 0) || 1;
  let offset = 0;
  return items.map((item) => {
    const dash = circumference * (item.value / total);
    const segment = { ...item, dash, offset };
    offset += dash;
    return segment;
  });
}

export function OperationsReportingView({
  title,
  description,
  syncLabel,
  controls,
  headerActions,
  primaryKpis,
  secondaryKpis,
  statusMix,
  shipmentHighlights,
  riskHighlights,
  performanceHighlights,
  needsAttention,
  activity,
  topSkus,
  topVariants,
  topIncidentProducts,
  trend,
}: OperationsReportingViewProps) {
  const radius = 56;
  const circumference = 2 * Math.PI * radius;
  const segments = buildDonutSegments(statusMix, radius, circumference);
  const trendMax = maxValue(trend);

  return (
    <div className="stack portal-reporting-page">
      <PageHeader
        eyebrow="Reporting"
        title={title}
        description={description}
        actions={
          <div className="analytics-header-meta">
            <span className="analytics-generated">Última sync {syncLabel}</span>
          </div>
        }
      />

      <Card className="portal-glass-card portal-reporting-hero">
        <div className="portal-reporting-hero-top">
          <div className="portal-reporting-hero-copy">
            <span className="eyebrow">Visibilidad logística</span>
            <h3 className="section-title section-title-small">Resumen ejecutivo del periodo</h3>
            <p className="subtitle">Misma base de métricas y lectura operativa para admin y cliente.</p>
          </div>
          <div className="portal-reporting-hero-actions">{headerActions}</div>
        </div>

        <div className="portal-reporting-controls">{controls}</div>

        <section className="portal-reporting-summary">
          <div className="portal-reporting-summary-head">
            <div>
              <span className="eyebrow">Resumen ejecutivo</span>
              <h3 className="section-title section-title-small">Lo importante primero</h3>
            </div>
          </div>

          <div className="portal-reporting-summary-grid">
            {primaryKpis.map((item) => (
              <article className="portal-reporting-stat-card" key={item.label}>
                <span className="portal-analytics-stat-label">{item.label}</span>
                <strong className="portal-analytics-stat-value">{item.value}</strong>
                <span className="table-secondary">{item.meta}</span>
              </article>
            ))}
          </div>

          <div className="portal-reporting-summary-grid portal-reporting-summary-grid-secondary">
            {secondaryKpis.map((item) => (
              <article className="portal-reporting-stat-card portal-reporting-stat-card-secondary" key={item.label}>
                <span className="portal-analytics-stat-label">{item.label}</span>
                <strong className="portal-analytics-stat-value">{item.value}</strong>
                <span className="table-secondary">{item.meta}</span>
              </article>
            ))}
          </div>
        </section>
      </Card>

      <section className="portal-reporting-block">
        <div className="portal-reporting-block-head">
          <div>
            <span className="eyebrow">Fulfillment / envíos</span>
            <h3 className="section-title section-title-small">Estado de expediciones</h3>
          </div>
        </div>
        <Card className="portal-glass-card portal-reporting-shipment-card">
          <div className="portal-reporting-shipment-top">
            <div className="portal-reporting-shipment-main">
              <div className="portal-analytics-status-list">
                {statusMix.map((item) => (
                  <div className="portal-analytics-status-row" key={item.label}>
                    <span className="portal-analytics-status-dot" style={{ background: item.color }} />
                    <span className="portal-analytics-status-label">{item.label}</span>
                    <span className="portal-analytics-status-value">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="portal-reporting-shipment-visual">
              <div className="portal-analytics-donut-wrap">
                <svg aria-hidden="true" className="portal-analytics-donut" viewBox="0 0 160 160">
                  <circle className="portal-analytics-donut-track" cx="80" cy="80" r={radius} />
                  {segments.map((segment, index) => (
                    <circle
                      className="portal-analytics-donut-segment"
                      cx="80"
                      cy="80"
                      key={`${index}-${segment.value}`}
                      r={radius}
                      stroke={segment.color}
                      strokeDasharray={`${segment.dash} ${circumference - segment.dash}`}
                      strokeDashoffset={-segment.offset}
                    />
                  ))}
                </svg>
                <div className="portal-analytics-donut-center">
                  <strong>{statusMix.reduce((sum, item) => sum + item.value, 0)}</strong>
                  <span>pedidos</span>
                </div>
              </div>
            </div>
          </div>

          <div className="portal-reporting-summary-grid portal-reporting-summary-grid-secondary">
            {shipmentHighlights.map((item) => (
              <article className="portal-reporting-stat-card portal-reporting-stat-card-secondary" key={item.label}>
                <span className="portal-analytics-stat-label">{item.label}</span>
                <strong className="portal-analytics-stat-value">{item.value}</strong>
              </article>
            ))}
          </div>

          <div className="portal-reporting-trend-card">
            <div className="portal-reporting-trend-card-head">
              <span className="table-primary">Actividad por días clave</span>
              <span className="table-secondary">Muestra resumida del periodo</span>
            </div>
            <div className="portal-mini-bars">
              {trend.map((point) => (
                <div className="portal-mini-bar-column" key={point.label}>
                  <div className="portal-mini-bar-wrap">
                    <div className="portal-mini-bar" style={{ height: `${Math.max(18, (point.value / trendMax) * 100)}%` }} />
                  </div>
                  <strong>{point.value}</strong>
                  <span className="table-secondary">{point.label}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </section>

      <section className="portal-reporting-block">
        <div className="portal-reporting-block-head">
          <div>
            <span className="eyebrow">Incidencias y riesgo</span>
            <h3 className="section-title section-title-small">Señales que requieren atención</h3>
          </div>
        </div>
        <div className="portal-reporting-section-grid">
          <Card className="portal-glass-card stack">
            <div className="portal-reporting-risk-grid">
              {riskHighlights.map((item) => (
                <div className="portal-reporting-risk-tile" key={item.label}>
                  <span className="portal-analytics-stat-label">{item.label}</span>
                  <strong className="portal-analytics-stat-value">{item.value}</strong>
                </div>
              ))}
            </div>
          </Card>

          <Card className="portal-glass-card stack">
            <div className="mini-table portal-reporting-attention-table">
              <div className="table-primary">Necesita atención</div>
              {needsAttention.length > 0 ? (
                needsAttention.map((item) => (
                  <Link className="mini-table-row mini-table-row-link" href={item.href} key={item.id}>
                    <div>
                      <div className="table-primary">{item.label}</div>
                      <div className="table-secondary">{item.reason}</div>
                    </div>
                    <div className="mini-table-metrics">
                      <span>{item.priority}</span>
                      <span>{item.updatedAt}</span>
                    </div>
                  </Link>
                ))
              ) : (
                <div className="table-secondary">No hay pedidos que requieran atención inmediata ahora mismo.</div>
              )}
            </div>
          </Card>
        </div>
      </section>

      <section className="portal-reporting-block">
        <div className="portal-reporting-block-head">
          <div>
            <span className="eyebrow">Productos y rendimiento</span>
            <h3 className="section-title section-title-small">Lectura comercial y operativa</h3>
          </div>
        </div>
        <div className="portal-reporting-section-grid">
          <Card className="portal-glass-card stack">
            <div className="mini-table">
              <div className="table-primary">Top SKUs</div>
              {topSkus.map((item) => (
                <div className="mini-table-row" key={item.label}>
                  <div>
                    <div className="table-primary">{item.label}</div>
                    {item.meta ? <div className="table-secondary">{item.meta}</div> : null}
                  </div>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          </Card>

          <Card className="portal-glass-card stack">
            <div className="mini-table">
              <div className="table-primary">Top variantes</div>
              {topVariants.map((item) => (
                <div className="mini-table-row" key={item.label}>
                  <div>
                    <div className="table-primary">{item.label}</div>
                    {item.meta ? <div className="table-secondary">{item.meta}</div> : null}
                  </div>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          </Card>

          <Card className="portal-glass-card stack">
            <div className="mini-table">
              <div className="table-primary">Productos con incidencias</div>
              {topIncidentProducts.map((item) => (
                <div className="mini-table-row" key={item.label}>
                  <div className="table-primary">{item.label}</div>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </section>

      <section className="portal-reporting-block">
        <div className="portal-reporting-block-head">
          <div>
            <span className="eyebrow">SLA y rendimiento</span>
            <h3 className="section-title section-title-small">Eficiencia operativa</h3>
          </div>
        </div>
        <div className="portal-reporting-summary-grid portal-reporting-summary-grid-secondary">
          {performanceHighlights.map((item) => (
            <article className="portal-reporting-stat-card portal-reporting-stat-card-secondary" key={item.label}>
              <span className="portal-analytics-stat-label">{item.label}</span>
              <strong className="portal-analytics-stat-value">{item.value}</strong>
            </article>
          ))}
        </div>
      </section>

      <section className="portal-reporting-block">
        <div className="portal-reporting-block-head">
          <div>
            <span className="eyebrow">Actividad reciente</span>
            <h3 className="section-title section-title-small">Lo último que ha pasado</h3>
          </div>
        </div>
        <Card className="portal-glass-card">
          <div className="portal-activity-timeline">
            {activity.length > 0 ? (
              activity.map((item) => (
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
      </section>
    </div>
  );
}
