import Link from "next/link";

import { Card } from "@/components/card";
import { formatDateTime } from "@/lib/format";
import type { EmployeeAnalyticsRow, EmployeeMetricsPeriod } from "@/lib/types";


type DashboardEmployeeMetricsProps = {
  employees: EmployeeAnalyticsRow[];
  period: EmployeeMetricsPeriod;
  range?: string;
  shopId?: string;
};


function getPeriodCount(employee: EmployeeAnalyticsRow, period: EmployeeMetricsPeriod) {
  return period === "day" ? employee.labels_today : employee.labels_this_week;
}


export function DashboardEmployeeMetrics({
  employees,
  period,
  range,
  shopId,
}: DashboardEmployeeMetricsProps) {
  const latestActivity = employees
    .map((employee) => employee.last_activity_at)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0];
  const links = [
    {
      label: "Día",
      href: `/dashboard?${new URLSearchParams({
        employee_period: "day",
        ...(range ? { range } : {}),
        ...(shopId ? { shop_id: shopId } : {}),
      }).toString()}`,
      active: period === "day",
    },
    {
      label: "Semana",
      href: `/dashboard?${new URLSearchParams({
        employee_period: "week",
        ...(range ? { range } : {}),
        ...(shopId ? { shop_id: shopId } : {}),
      }).toString()}`,
      active: period === "week",
    },
  ];

  const ranking = [...employees]
    .sort((left, right) => getPeriodCount(right, period) - getPeriodCount(left, period) || right.total_labels - left.total_labels)
    .slice(0, 5);
  const maxValue = Math.max(1, ...ranking.map((employee) => getPeriodCount(employee, period)));
  const totalInPeriod = employees.reduce((sum, employee) => sum + getPeriodCount(employee, period), 0);
  const activeEmployees = employees.filter((employee) => getPeriodCount(employee, period) > 0).length;

  return (
    <section className="admin-dashboard-analytics-section">
      <Card className="stack admin-dashboard-panel employee-dashboard-panel">
        <div className="admin-dashboard-panel-head">
          <div>
            <span className="eyebrow">Equipo</span>
            <h3 className="section-title section-title-small">Etiquetas por empleado</h3>
            <p className="subtitle">
              Ranking rápido de quién está generando etiquetas en el periodo seleccionado.
            </p>
          </div>
          <div className="employee-dashboard-panel-actions">
            <div className="dashboard-donut-range-pills">
              {links.map((link) => (
                <Link className={`shipments-range-pill${link.active ? " is-active" : ""}`} href={link.href} key={link.href}>
                  {link.label}
                </Link>
              ))}
            </div>
            <Link className="admin-dashboard-inline-link" href="/employees">
              Ver empleados
            </Link>
          </div>
        </div>

        <div className="employee-dashboard-grid">
          <div className="employee-dashboard-summary">
            <article className="employee-dashboard-stat">
              <span>Etiquetas {period === "day" ? "hoy" : "esta semana"}</span>
              <strong>{totalInPeriod}</strong>
            </article>
            <article className="employee-dashboard-stat">
              <span>Empleados activos en el periodo</span>
              <strong>{activeEmployees}</strong>
            </article>
            <article className="employee-dashboard-stat">
              <span>Última actividad registrada</span>
              <strong>
                {latestActivity ? formatDateTime(latestActivity) : "Sin datos"}
              </strong>
            </article>
          </div>

          <div className="employee-dashboard-ranking">
            {ranking.length > 0 ? (
              ranking.map((employee) => {
                const value = getPeriodCount(employee, period);
                return (
                  <article className="employees-ranking-row" key={employee.id}>
                    <div className="employees-ranking-main">
                      <div className="employees-ranking-meta">
                        <div>
                          <strong>{employee.name}</strong>
                          <div className="table-secondary">{employee.role.replace("_", " ")}</div>
                        </div>
                      </div>
                      <strong>{value}</strong>
                    </div>
                    <div className="employees-ranking-track">
                      <span style={{ width: `${Math.max(10, (value / maxValue) * 100)}%` }} />
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="admin-dashboard-empty">Todavía no hay etiquetas asignadas a empleados.</div>
            )}
          </div>
        </div>
      </Card>
    </section>
  );
}
