import Link from "next/link";

import { Card } from "@/components/card";
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

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function getRoleTag(role: EmployeeAnalyticsRow["role"]) {
  switch (role) {
    case "super_admin":
      return "SA";
    case "ops_admin":
      return "OPS";
    case "shop_admin":
      return "SHOP";
    default:
      return "VIEW";
  }
}

function formatLastActivityShort(value?: string) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);
  return date.toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  });
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
  const topEmployee = ranking[0] ?? null;

  return (
    <section className="admin-dashboard-analytics-section">
      <Card className="stack admin-dashboard-panel employee-dashboard-panel">
        <div className="admin-dashboard-panel-head">
          <div>
            <span className="eyebrow">Equipo</span>
            <h3 className="section-title section-title-small">Etiquetas por empleado</h3>
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
            <article className="employee-dashboard-hero">
              <div className="employee-dashboard-orbit">
                <div className="employee-dashboard-orbit-core">
                  <span>{period === "day" ? "Hoy" : "Semana"}</span>
                  <strong>{totalInPeriod}</strong>
                </div>
              </div>

              <div className="employee-dashboard-hero-strip">
                <div className="employee-dashboard-chip">
                  <strong>{activeEmployees}</strong>
                  <span>activos</span>
                </div>
                {topEmployee ? (
                  <div className="employee-dashboard-chip employee-dashboard-chip-accent">
                    <strong>{getInitials(topEmployee.name)}</strong>
                    <span>top</span>
                  </div>
                ) : null}
                <div className="employee-dashboard-chip">
                  <strong>{formatLastActivityShort(latestActivity)}</strong>
                  <span>últ.</span>
                </div>
              </div>
            </article>
          </div>

          <div className="employee-dashboard-ranking employee-dashboard-board">
            {ranking.length > 0 ? (
              ranking.map((employee, index) => {
                const value = getPeriodCount(employee, period);
                const share = totalInPeriod > 0 ? Math.round((value / totalInPeriod) * 100) : 0;
                return (
                  <article className={`employee-dashboard-rank-row${index === 0 ? " is-lead" : ""}`} key={employee.id}>
                    <div className="employee-dashboard-rank-main">
                      <div className="employee-dashboard-rank-meta">
                        <span className="employee-dashboard-rank-avatar">{getInitials(employee.name)}</span>
                        <div>
                          <strong>{employee.name}</strong>
                          <div className="employee-dashboard-rank-subline">
                            <span>{getRoleTag(employee.role)}</span>
                            <span>{share}%</span>
                          </div>
                        </div>
                      </div>
                      <strong className="employee-dashboard-rank-value">{value}</strong>
                    </div>
                    <div className="employee-dashboard-rank-track">
                      <span style={{ width: `${Math.max(value > 0 ? 12 : 0, (value / maxValue) * 100)}%` }} />
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="admin-dashboard-empty">Sin actividad</div>
            )}
          </div>
        </div>
      </Card>
    </section>
  );
}
