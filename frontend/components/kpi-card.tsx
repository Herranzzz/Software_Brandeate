type KpiCardProps = {
  label: string;
  value: string;
  delta?: string;
  tone?: "default" | "accent" | "success" | "warning" | "danger";
};


export function KpiCard({
  label,
  value,
  delta,
  tone = "default",
}: KpiCardProps) {
  return (
    <article className={`kpi-card kpi-${tone}`}>
      <div className="kpi-head">
        <span className="kpi-label">{label}</span>
        <span className="kpi-dot" />
      </div>
      <div className="kpi-value-row">
        <strong className="kpi-value">{value}</strong>
      </div>
      {delta ? <span className="kpi-delta">{delta}</span> : null}
    </article>
  );
}
