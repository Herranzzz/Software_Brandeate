import Link from "next/link";

type Crumb = { label: string; href?: string };

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      {items.map((crumb, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={i} className="breadcrumb-item">
            {i > 0 && <span className="breadcrumb-sep">›</span>}
            {crumb.href && !isLast ? (
              <Link href={crumb.href} className="breadcrumb-link">
                {crumb.label}
              </Link>
            ) : (
              <span className="breadcrumb-current">{crumb.label}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
