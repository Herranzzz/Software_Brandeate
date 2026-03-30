import Link from "next/link";


type HelpCategoryCardProps = {
  eyebrow: string;
  title: string;
  description: string;
  href: string;
  cta: string;
};

export function HelpCategoryCard({ eyebrow, title, description, href, cta }: HelpCategoryCardProps) {
  return (
    <article className="help-category-card">
      <span className="eyebrow">{eyebrow}</span>
      <h3 className="section-title section-title-small">{title}</h3>
      <p className="subtitle">{description}</p>
      <Link className="button button-secondary" href={href}>
        {cta}
      </Link>
    </article>
  );
}
