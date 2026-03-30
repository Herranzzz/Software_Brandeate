import { Card } from "@/components/card";
import { EmptyState } from "@/components/empty-state";
import { KpiCard } from "@/components/kpi-card";
import { PageHeader } from "@/components/page-header";
import { PersonalizationBadge } from "@/components/personalization-badge";
import { SearchInput } from "@/components/search-input";
import { fetchIncidents, fetchShops } from "@/lib/api";
import { requireAdminUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import type { Incident } from "@/lib/types";


type IncidenciasPageProps = {
  searchParams: Promise<{
    status?: string;
    priority?: string;
    type?: string;
    q?: string;
    shop_id?: string;
  }>;
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
  const [incidentsFromApi, shops] = await Promise.all([
    fetchIncidents({
      status: params.status,
      priority: params.priority,
      type: params.type,
      shop_id: params.shop_id,
    }),
    fetchShops(),
  ]);
  const incidents = incidentsFromApi.filter((incident) =>
    matchesFilters(incident, params.q, params.status, params.priority),
  );
  const shopMap = new Map(shops.map((shop) => [shop.id, shop.name]));
  const openCount = incidents.filter((incident) => incident.status === "open").length;
  const inProgressCount = incidents.filter((incident) => incident.status === "in_progress").length;
  const urgentCount = incidents.filter((incident) => incident.priority === "urgent").length;
  const personalizationCount = incidents.filter((incident) => incident.order.is_personalized).length;

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Incidencias"
        title="Bandeja operativa"
        description="Seguimiento real de incidencias operativas vinculadas a pedidos."
      />

      <Card className="stack filter-card">
        <form className="filters filter-bar" method="get">
          <SearchInput defaultValue={params.q ?? ""} placeholder="Pedido, cliente, responsable..." />

          <div className="field">
            <label htmlFor="status">Estado</label>
            <select defaultValue={params.status ?? ""} id="status" name="status">
              <option value="">Todos</option>
              <option value="open">open</option>
              <option value="in_progress">in_progress</option>
              <option value="resolved">resolved</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="priority">Prioridad</label>
            <select defaultValue={params.priority ?? ""} id="priority" name="priority">
              <option value="">Todas</option>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
              <option value="urgent">urgent</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="type">Tipo</label>
            <select defaultValue={params.type ?? ""} id="type" name="type">
              <option value="">Todos</option>
              <option value="missing_asset">missing_asset</option>
              <option value="personalization_error">personalization_error</option>
              <option value="production_blocked">production_blocked</option>
              <option value="shipping_exception">shipping_exception</option>
              <option value="address_issue">address_issue</option>
              <option value="stock_issue">stock_issue</option>
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

          <button className="button" type="submit">
            Aplicar filtros
          </button>
        </form>
      </Card>

      <section className="kpi-grid">
        <KpiCard label="Abiertas" value={String(openCount)} tone="danger" />
        <KpiCard label="En progreso" value={String(inProgressCount)} tone="warning" />
        <KpiCard label="Urgentes" value={String(urgentCount)} tone="accent" />
        <KpiCard label="Resueltas" value={String(incidents.filter((incident) => incident.status === "resolved").length)} tone="success" />
        <KpiCard label="Pedido personalizado" value={String(personalizationCount)} tone="default" />
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
                  <th>Tipo</th>
                  <th>Prioridad</th>
                  <th>Tienda</th>
                  <th>Pedido</th>
                  <th>Cliente</th>
                  <th>Pedido tipo</th>
                  <th>Estado</th>
                  <th>Responsable</th>
                  <th>Updated at</th>
                </tr>
              </thead>
              <tbody>
                {incidents.map((incident) => (
                  <tr className="table-row" key={incident.id}>
                    <td>#{incident.id}</td>
                    <td className="table-primary">{incident.type}</td>
                    <td>
                      <span className={`incident-priority incident-priority-${incident.priority}`}>
                        {incident.priority}
                      </span>
                    </td>
                    <td>{shopMap.get(incident.order.shop_id) ?? `Shop #${incident.order.shop_id}`}</td>
                    <td>
                      <a className="table-link table-link-strong" href={`/orders/${incident.order.id}`}>
                        {incident.order.external_id}
                      </a>
                    </td>
                    <td>{incident.order.customer_name}</td>
                    <td>
                      <PersonalizationBadge isPersonalized={incident.order.is_personalized} />
                    </td>
                    <td><span className="badge">{incident.status}</span></td>
                    <td>{incident.assignee ?? "Sin asignar"}</td>
                    <td>{formatDateTime(incident.updated_at)}</td>
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
