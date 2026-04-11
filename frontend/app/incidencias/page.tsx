import { Card } from "@/components/card";
import { EmptyState } from "@/components/empty-state";
import { IncidentStatusActions } from "@/components/incident-status-actions";
import { IncidentsReconcileButton } from "@/components/incidents-reconcile-button";
import { KpiCard } from "@/components/kpi-card";
import { PageHeader } from "@/components/page-header";
import { PersonalizationBadge } from "@/components/personalization-badge";
import { SearchInput } from "@/components/search-input";
import { fetchIncidents, fetchShops } from "@/lib/api";
import { requireAdminUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import type { Incident, IncidentPriority, IncidentStatus, IncidentType } from "@/lib/types";


type IncidenciasPageProps = {
  searchParams: Promise<{
    status?: string;
    priority?: string;
    type?: string;
    q?: string;
    shop_id?: string;
    period?: string;
  }>;
};

const PRIORITY_LABEL: Record<IncidentPriority, string> = {
  low:    "Baja",
  medium: "Media",
  high:   "Alta",
  urgent: "Urgente",
};

const STATUS_LABEL: Record<IncidentStatus, string> = {
  open:        "Abierta",
  in_progress: "En progreso",
  resolved:    "Resuelta",
};

const TYPE_LABEL: Record<IncidentType, string> = {
  missing_asset:          "Asset roto",
  personalization_error:  "Error personalización",
  production_blocked:     "Producción bloqueada",
  shipping_exception:     "Excepción envío",
  address_issue:          "Problema dirección",
  stock_issue:            "Stock",
};

const STATUS_CLASS: Record<IncidentStatus, string> = {
  open:        "incident-status-badge is-open",
  in_progress: "incident-status-badge is-in-progress",
  resolved:    "incident-status-badge is-resolved",
};

function matchesFilters(
  incident: Incident,
  q?: string,
  status?: string,
  priority?: string,
) {
  const normalizedQuery = q?.trim().toLowerCase() ?? "";

  const matchesQuery =
    normalizedQuery === "" ||
    [
      String(incident.id),
      incident.title,
      incident.type,
      incident.order.external_id,
      incident.order.customer_name,
      incident.assignee ?? "",
    ].some((field) => field.toLowerCase().includes(normalizedQuery));

  const matchesState = !status || incident.status === status;
  const matchesPriority = !priority || incident.priority === priority;

  return matchesQuery && matchesState && matchesPriority;
}


export default async function IncidenciasPage({ searchParams }: IncidenciasPageProps) {
  await requireAdminUser();
  const params = await searchParams;
  const periodFilter = params.period ?? "14d";
  const includeHistorical = periodFilter === "all";
  const recentDays = includeHistorical ? undefined : Number.parseInt(periodFilter.replace("d", ""), 10) || 14;
  const statusFilter = params.status ?? "open";
  const statusParam = statusFilter === "all" ? undefined : statusFilter;
  const [incidentsResult, shopsResult] = await Promise.allSettled([
    fetchIncidents({
      status: statusParam,
      priority: params.priority,
      type: params.type,
      shop_id: params.shop_id,
      recent_days: recentDays,
      include_historical: includeHistorical,
      page: 1,
      per_page: 300,
    }),
    fetchShops(),
  ]);
  const incidentsFromApi = incidentsResult.status === "fulfilled" ? incidentsResult.value : [];
  const shops = shopsResult.status === "fulfilled" ? shopsResult.value : [];
  const hasPartialDataError = incidentsResult.status === "rejected" || shopsResult.status === "rejected";
  const incidents = incidentsFromApi.filter((incident) =>
    matchesFilters(incident, params.q, statusParam, params.priority),
  );
  const shopMap = new Map(shops.map((shop) => [shop.id, shop.name]));
  const openCount = incidents.filter((incident) => incident.status === "open").length;
  const inProgressCount = incidents.filter((incident) => incident.status === "in_progress").length;
  const urgentCount = incidents.filter((incident) => incident.priority === "urgent").length;
  const resolvedCount = incidents.filter((incident) => incident.status === "resolved").length;
  const automatedCount = incidents.filter((incident) => incident.is_automated).length;

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Incidencias"
        title="Bandeja operativa"
        description="Solo incidencias activas y recientes por defecto. El histórico completo queda bajo demanda."
      />

      <Card className="stack filter-card">
        {hasPartialDataError ? (
          <div className="feedback feedback-info">
            Parte de la información no se pudo cargar. Mostramos los datos disponibles.
          </div>
        ) : null}
        <form className="filters filter-bar" method="get">
          <SearchInput defaultValue={params.q ?? ""} placeholder="Pedido, cliente, título..." />

          <div className="field">
            <label htmlFor="status">Estado</label>
            <select defaultValue={statusFilter} id="status" name="status">
              <option value="all">Todos</option>
              <option value="open">Abierta</option>
              <option value="in_progress">En progreso</option>
              <option value="resolved">Resuelta</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="priority">Prioridad</label>
            <select defaultValue={params.priority ?? ""} id="priority" name="priority">
              <option value="">Todas</option>
              <option value="low">Baja</option>
              <option value="medium">Media</option>
              <option value="high">Alta</option>
              <option value="urgent">Urgente</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="type">Tipo</label>
            <select defaultValue={params.type ?? ""} id="type" name="type">
              <option value="">Todos</option>
              <option value="missing_asset">Asset roto</option>
              <option value="personalization_error">Error personalización</option>
              <option value="production_blocked">Producción bloqueada</option>
              <option value="shipping_exception">Excepción envío</option>
              <option value="address_issue">Problema dirección</option>
              <option value="stock_issue">Stock</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="shop_id">Tienda</label>
            <select defaultValue={params.shop_id ?? ""} id="shop_id" name="shop_id">
              <option value="">Todas</option>
              {shops.map((shop) => (
                <option key={shop.id} value={shop.id}>
                  {shop.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="period">Periodo</label>
            <select defaultValue={periodFilter} id="period" name="period">
              <option value="7d">Últimos 7 días</option>
              <option value="14d">Últimos 14 días</option>
              <option value="30d">Últimos 30 días</option>
              <option value="90d">Últimos 90 días</option>
              <option value="all">Histórico</option>
            </select>
          </div>

          <button className="button" type="submit">
            Aplicar filtros
          </button>
          <IncidentsReconcileButton />
        </form>
      </Card>

      <section className="kpi-grid">
        <KpiCard label="Abiertas" value={String(openCount)} tone="danger" />
        <KpiCard label="En progreso" value={String(inProgressCount)} tone="warning" />
        <KpiCard label="Urgentes" value={String(urgentCount)} tone="accent" />
        <KpiCard label="Resueltas" value={String(resolvedCount)} tone="success" />
        <KpiCard label="Automáticas" value={String(automatedCount)} tone="default" />
      </section>

      <Card className="stack table-card">
        <div className="table-header">
          <div>
            <span className="eyebrow">Tabla</span>
            <h3 className="section-title section-title-small">Incidencias</h3>
          </div>
          <div className="muted">{incidents.length} resultados</div>
        </div>

        {incidents.length === 0 ? (
          <EmptyState
            title="Sin incidencias"
            description="No hay casos para esos filtros."
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Incidencia</th>
                  <th>Prioridad</th>
                  <th>Tienda</th>
                  <th>Pedido</th>
                  <th>Cliente</th>
                  <th>Tipo</th>
                  <th>Estado</th>
                  <th>Responsable</th>
                  <th>Actualizado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {incidents.map((incident) => (
                  <tr
                    className="table-row"
                    data-priority={incident.priority}
                    key={incident.id}
                  >
                    <td className="table-secondary">#{incident.id}</td>
                    <td>
                      <div className="incident-title-cell">
                        <span className="table-primary">{incident.title}</span>
                        {incident.is_automated && (
                          <span className="incident-auto-badge">Auto</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className={`incident-priority incident-priority-${incident.priority}`}>
                        {PRIORITY_LABEL[incident.priority] ?? incident.priority}
                      </span>
                    </td>
                    <td className="table-secondary">{shopMap.get(incident.order.shop_id) ?? `Shop #${incident.order.shop_id}`}</td>
                    <td>
                      <a className="table-link table-link-strong" href={`/orders/${incident.order.id}`}>
                        {incident.order.external_id}
                      </a>
                    </td>
                    <td>
                      <div className="table-primary">{incident.order.customer_name}</div>
                      <div className="table-secondary">{incident.order.customer_email}</div>
                    </td>
                    <td>
                      <div className="incident-type-cell">
                        <span className="table-secondary">{TYPE_LABEL[incident.type] ?? incident.type}</span>
                        <PersonalizationBadge isPersonalized={incident.order.is_personalized} />
                      </div>
                    </td>
                    <td>
                      <span className={STATUS_CLASS[incident.status]}>
                        {STATUS_LABEL[incident.status] ?? incident.status}
                      </span>
                    </td>
                    <td className="table-secondary">{incident.assignee ?? "—"}</td>
                    <td className="table-secondary">{formatDateTime(incident.updated_at)}</td>
                    <td>
                      <IncidentStatusActions compact incidentId={incident.id} status={incident.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
