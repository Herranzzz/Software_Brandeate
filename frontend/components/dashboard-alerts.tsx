import Link from "next/link";

type AlertItem = {
  emoji: string;
  label: string;
  count: number;
  href: string;
  tone?: "danger" | "warning" | "info";
};

type Props = {
  alerts: AlertItem[];
};

export function DashboardAlerts({ alerts }: Props) {
  const active = alerts.filter((a) => a.count > 0);
  if (active.length === 0) return null;

  return (
    <div className="dash-alerts">
      <div className="dash-alerts-header">
        <span className="eyebrow">Alertas operativas</span>
        <strong className="dash-alerts-title">
          {active.length} punto{active.length !== 1 ? "s" : ""} de atención
        </strong>
      </div>
      <ul className="dash-alerts-list">
        {active.map((alert) => (
          <li
            className={`dash-alert-item dash-alert-${alert.tone ?? "warning"}`}
            key={alert.href}
          >
            <span className="dash-alert-emoji">{alert.emoji}</span>
            <span className="dash-alert-text">
              <strong>{alert.count}</strong> {alert.label}
            </span>
            <Link className="dash-alert-action" href={alert.href}>
              Ver →
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
