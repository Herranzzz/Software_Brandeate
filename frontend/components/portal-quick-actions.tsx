import Link from "next/link";

type PortalQuickActionsProps = {
  shopQuery: string; // e.g. "?shop_id=1" or ""
};

const ACTIONS = [
  {
    icon: "📋",
    title: "Mis pedidos",
    description: "Consulta el estado de todos tus pedidos",
    href: (q: string) => `/portal/orders${q}`,
    tone: "accent",
  },
  {
    icon: "🚚",
    title: "Analítica de envíos",
    description: "Estado de expediciones y tracking",
    href: (q: string) => `/portal/shipments${q}`,
    tone: "blue",
  },
  {
    icon: "↩️",
    title: "Nueva devolución",
    description: "Solicita la gestión de una devolución",
    href: (q: string) => `/portal/returns${q}`,
    tone: "orange",
  },
  {
    icon: "⚠️",
    title: "Reportar incidencia",
    description: "Comunica un problema con un pedido",
    href: (q: string) => `/portal/incidencias${q}`,
    tone: "danger",
  },
];

export function PortalQuickActions({ shopQuery }: PortalQuickActionsProps) {
  return (
    <div className="portal-quick-actions">
      {ACTIONS.map((action) => (
        <Link
          key={action.title}
          className={`portal-quick-action-card pqa-${action.tone}`}
          href={action.href(shopQuery)}
        >
          <span className="pqa-icon">{action.icon}</span>
          <div className="pqa-copy">
            <strong className="pqa-title">{action.title}</strong>
            <span className="pqa-desc">{action.description}</span>
          </div>
          <span className="pqa-arrow">→</span>
        </Link>
      ))}
    </div>
  );
}
