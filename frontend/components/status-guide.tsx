type StatusGuideItem = {
  label: string;
  description: string;
  badgeClassName: string;
};

type StatusGuideProps = {
  title: string;
  description: string;
  items: StatusGuideItem[];
};

export function StatusGuide({ title, description, items }: StatusGuideProps) {
  return (
    <article className="help-status-card">
      <div className="stack stack-tight">
        <h3 className="section-title section-title-small">{title}</h3>
        <p className="subtitle">{description}</p>
      </div>
      <div className="help-status-list">
        {items.map((item) => (
          <div className="help-status-row" key={item.label}>
            <span className={`badge ${item.badgeClassName}`}>{item.label}</span>
            <span className="table-secondary">{item.description}</span>
          </div>
        ))}
      </div>
    </article>
  );
}
