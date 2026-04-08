import Link from "next/link";

import { Card } from "@/components/card";
import { formatDateTime } from "@/lib/format";
import type { EmployeeWorkspace, User } from "@/lib/types";


type EmployeePortalWorkspaceProps = {
  user: User;
  workspace: EmployeeWorkspace;
  selectedShopId?: string;
};


function getGreetingForCurrentTime() {
  const hour = Number(
    new Intl.DateTimeFormat("es-ES", {
      hour: "2-digit",
      hour12: false,
      timeZone: "Europe/Madrid",
    }).format(new Date()),
  );

  if (hour < 13) return "Buenos días";
  if (hour < 20) return "Buenas tardes";
  return "Buenas noches";
}

function getRoleLabel(role: User["role"]) {
  switch (role) {
    case "super_admin":
      return "Super admin";
    case "ops_admin":
      return "Operaciones";
    case "shop_admin":
      return "Responsable de tienda";
    default:
      return "Equipo";
  }
}

function withShopScope(href: string, selectedShopId?: string) {
  if (!selectedShopId) {
    return href;
  }

  const [pathname, query = ""] = href.split("?");
  const params = new URLSearchParams(query);
  if (!params.has("shop_id")) {
    params.set("shop_id", selectedShopId);
  }
  const nextQuery = params.toString();
  return nextQuery ? `${pathname}?${nextQuery}` : pathname;
}

function buildQuickActions(selectedShopId: string | undefined, workspace: EmployeeWorkspace) {
  return [
    {
      label: "No preparados",
      count: workspace.metrics.pending_orders_visible,
      href: withShopScope("/portal/orders?quick=not_prepared", selectedShopId),
      tone: "accent",
    },
    {
      label: "Diseños listos",
      count: workspace.metrics.designs_ready_visible,
      href: withShopScope("/portal/orders?quick=design_available", selectedShopId),
      tone: "success",
    },
    {
      label: "Expediciones atascadas",
      count: workspace.metrics.stalled_shipments_visible,
      href: withShopScope("/portal/shipments?quick=stalled", selectedShopId),
      tone: "warning",
    },
    {
      label: "Incidencias",
      count: workspace.metrics.incidents_visible,
      href: withShopScope("/portal/incidencias", selectedShopId),
      tone: "danger",
    },
    {
      label: "Mis pedidos recientes",
      count: workspace.metrics.recent_orders_handled,
      href: withShopScope("/portal/orders", selectedShopId),
      tone: "default",
    },
    {
      label: "Crear etiqueta",
      count: workspace.metrics.pending_orders_visible,
      href: withShopScope("/portal/orders?quick=not_prepared", selectedShopId),
      tone: "indigo",
    },
    {
      label: "Descargar diseños",
      count: workspace.metrics.designs_ready_visible,
      href: withShopScope("/portal/orders?quick=design_available", selectedShopId),
      tone: "success",
    },
  ];
}

export function EmployeePortalWorkspace({
  user,
  workspace,
  selectedShopId,
}: EmployeePortalWorkspaceProps) {
  const greeting = getGreetingForCurrentTime();
  const quickActions = buildQuickActions(selectedShopId, workspace);
  const continueItem = workspace.recent_activity[0] ?? null;
  const spotlightStats = [
    { label: "Etiquetas hoy", value: workspace.metrics.labels_today },
    { label: "Semana", value: workspace.metrics.labels_this_week },
    { label: "Preparados hoy", value: workspace.metrics.orders_prepared_today },
    { label: "Pendientes", value: workspace.metrics.pending_orders_visible },
  ];

  return (
    <section className="employee-workspace-shell">
      <Card className="employee-workspace-hero-card">
        <div className="employee-workspace-hero-copy">
          <span className="eyebrow">Tu operativa de hoy</span>
          <h2 className="employee-workspace-hero-title">
            {greeting}, {user.name.split(" ")[0]}
          </h2>
          <p className="employee-workspace-hero-subtitle">
            {getRoleLabel(user.role)}
          </p>

          <div className="employee-workspace-meta-strip">
            <span className="employee-workspace-meta-pill">
              {workspace.metrics.incidents_assigned > 0 ? `${workspace.metrics.incidents_assigned} tuyas` : "Sin bloqueos tuyos"}
            </span>
            <span className="employee-workspace-meta-pill">
              {workspace.metrics.total_labels} etiquetas
            </span>
            <span className="employee-workspace-meta-pill">
              {workspace.metrics.last_activity_at ? formatDateTime(workspace.metrics.last_activity_at) : "Sin actividad"}
            </span>
          </div>
        </div>

        <div className="employee-workspace-hero-stats">
          {spotlightStats.map((item) => (
            <article className="employee-workspace-stat" key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </article>
          ))}
        </div>
      </Card>

      <div className="employee-workspace-grid">
        <Card className="employee-workspace-panel">
          <div className="employee-workspace-panel-head">
            <div>
              <span className="eyebrow">Continuar</span>
              <h3 className="section-title section-title-small">Sigue por aquí</h3>
            </div>
          </div>

          {continueItem ? (
            <Link className="employee-workspace-continue-card" href={withShopScope(continueItem.href, selectedShopId)}>
              <span className="employee-workspace-continue-badge">{continueItem.badge}</span>
              <strong>{continueItem.title}</strong>
              <span>{continueItem.subtitle}</span>
            </Link>
          ) : (
            <div className="employee-workspace-empty">Tu actividad aparecerá aquí en cuanto empieces a mover pedidos.</div>
          )}

          <div className="employee-workspace-actions-grid">
            {quickActions.map((action) => (
              <Link className={`employee-workspace-action-card tone-${action.tone}`} href={action.href} key={action.label}>
                <span>{action.label}</span>
                <strong>{action.count}</strong>
              </Link>
            ))}
          </div>
        </Card>

        <Card className="employee-workspace-panel">
          <div className="employee-workspace-panel-head">
            <div>
              <span className="eyebrow">Actividad reciente</span>
              <h3 className="section-title section-title-small">Tu rastro reciente</h3>
            </div>
          </div>

          <div className="employee-workspace-activity-list">
            {workspace.recent_activity.length > 0 ? (
              workspace.recent_activity.slice(0, 5).map((item) => (
                <Link
                  className="employee-workspace-activity-row"
                  href={withShopScope(item.href, selectedShopId)}
                  key={`${item.type}-${item.href}-${item.timestamp}`}
                >
                  <span className="employee-workspace-activity-badge">{item.badge}</span>
                  <div className="employee-workspace-activity-copy">
                    <strong>{item.title}</strong>
                    <span>{item.subtitle}</span>
                  </div>
                  <time>{formatDateTime(item.timestamp)}</time>
                </Link>
              ))
            ) : (
              <div className="employee-workspace-empty">Todavía no hay actividad personal registrada.</div>
            )}
          </div>
        </Card>
      </div>
    </section>
  );
}
