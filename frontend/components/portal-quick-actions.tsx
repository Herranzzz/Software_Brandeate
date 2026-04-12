import Link from "next/link";

type PortalQuickActionsProps = {
  shopQuery: string;
};

const ACTIONS = [
  {
    icon: "📋",
    title: "Pedidos",
    href: (q: string) => `/portal/orders${q}`,
  },
  {
    icon: "📊",
    title: "Analítica",
    href: (q: string) => `/portal/shipments${q}`,
  },
  {
    icon: "↩️",
    title: "Devoluciones",
    href: (q: string) => `/portal/returns${q}`,
  },
  {
    icon: "⚠️",
    title: "Incidencias",
    href: (q: string) => `/portal/incidencias${q}`,
  },
  {
    icon: "📦",
    title: "Inventario",
    href: (q: string) => `/portal/inventory${q}`,
  },
  {
    icon: "⚙️",
    title: "Ajustes",
    href: (q: string) => `/portal/settings${q ? q + "&tab=shopify" : "?tab=shopify"}`,
  },
];

export function PortalQuickActions({ shopQuery }: PortalQuickActionsProps) {
  return (
    <nav className="pqa-bar" aria-label="Accesos rápidos">
      {ACTIONS.map((action) => (
        <Link
          key={action.title}
          className="pqa-pill"
          href={action.href(shopQuery)}
        >
          <span className="pqa-pill-icon">{action.icon}</span>
          <span className="pqa-pill-label">{action.title}</span>
        </Link>
      ))}
    </nav>
  );
}
