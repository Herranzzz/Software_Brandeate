type SectionTitleProps = {
  eyebrow?: string;
  title: string;
  description?: string;
};


export function SectionTitle({ eyebrow, title, description }: SectionTitleProps) {
  return (
    <div className="section-header">
      {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
      <h3 className="section-title section-title-small">{title}</h3>
      {description ? <p className="subtitle">{description}</p> : null}
    </div>
  );
}
