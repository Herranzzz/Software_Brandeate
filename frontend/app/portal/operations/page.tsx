import { Card } from "@/components/card";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PortalTenantControl } from "@/components/portal-tenant-control";
import { fetchIncidents, fetchOrders } from "@/lib/api";
import { fetchMyShops, requirePortalUser } from "@/lib/auth";
import { formatDateTime, sortTrackingEvents } from "@/lib/format";
import { resolveTenantScope } from "@/lib/tenant-scope";


type PortalOperationsPageProps = {
  searchParams: Promise<{
    view?: string;
    shipment_status?: string;
    incident_status?: string;
    incident_period?: string;
    order_query?: string;
    per_page?: string;
    shop_id?: string;
  }>;
};


const shipmentViews = [
  { value: "all", label: "Todo" },
  { value: "in_transit", label: "En tránsito" },
  { value: "delivered", label: "Entregados" },
  { value: "exception", label: "Con incidencia" },
  { value: "pending", label: "Sin eventos" },
];

const incidentViews = [
  { value: "all", label: "Todas" },
  { value: "open", label: "Abiertas" },
  { value: "in_progress", label: "En curso" },
  { value: "resolved", label: "Resueltas" },
];


export default async function PortalOperationsPage({ searchParams }: PortalOperationsPageProps) {
  await requirePortalUser();
  const params = await searchParams;
  const view = params.view === "incidents" ? "incidents" : "shipments";
  const shipmentStatus = params.shipment_status ?? "all";
  const incidentStatus = params.incident_status ?? "open";
  const incidentPeriod = params.incident_period ?? "14d";
  const includeHistoricalIncidents = incidentPeriod === "all";
  const incidentRecentDays = includeHistoricalIncidents
    ? undefined
    : Number.parseInt(incidentPeriod.replace("d", ""), 10) || 30;
  const orderQuery = (params.order_query ?? "").trim().toLowerCase();
  const perPageOptions = [25, 50, 100, 200];
  const parsedPerPage = Number(params.per_page);
  const perPage = perPageOptions.includes(parsedPerPage) ? parsedPerPage : 50;
  const shops = await fetchMyShops();
  const tenantScope = resolveTenantScope(shops, params.shop_id);

  const [ordersResult, incidentsResult] = await Promise.allSettled([
    fetchOrders(
      {
        ...(tenantScope.selectedShopId ? { shop_id: tenantScope.selectedShopId } : {}),
        ...(orderQuery ? { q: orderQuery } : {}),
        page: 1,
        per_page: perPage,
      },
      { cacheSeconds: 20 },
    ).then(({ orders }) => orders),
    fetchIncidents({
      ...(incidentStatus !== "all" ? { status: incidentStatus } : {}),
      ...(tenantScope.selectedShopId ? { shop_id: tenantScope.selectedShopId } : {}),
      ...(incidentRecentDays ? { recent_days: incidentRecentDays } : {}),
      include_historical: includeHistoricalIncidents,
      page: 1,
      per_page: 300,
    }),
  ]);
  const orders = ordersResult.status === "fulfilled" ? ordersResult.value : [];
  const incidents = incidentsResult.status === "fulfilled" ? incidentsResult.value : [];
  const hasPartialDataError = ordersResult.status === "rejected" || incidentsResult.status === "rejected";

  const shipmentRows = orders
    .filter((order) => order.shipment)
    .map((order) => {
      const lastEvent = sortTrackingEvents(order.shipment?.events ?? [])[0] ?? null;
      return {
        order,
        shipment: order.shipment,
        lastEvent,
        derivedStatus: lastEvent?.status_norm ?? "pending",
      };
    })
    .filter((row) => {
      if (orderQuery && !row.order.external_id.toLowerCase().includes(orderQuery)) {
        return false;
      }
      if (shipmentStatus === "all") {
        return true;
      }
      if (shipmentStatus === "pending") {
        return row.lastEvent === null;
      }
      return row.derivedStatus === shipmentStatus;
    })
    .slice(0, perPage);

  const filteredIncidents = incidents.filter((incident) =>
    !orderQuery || incident.order.external_id.toLowerCase().includes(orderQuery)
  ).slice(0, perPage);

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Operativa"
        title="Envíos e incidencias"
        description="Una sola vista para seguir la operativa diaria, con filtros rápidos según lo que necesites revisar."
      />

      <PortalTenantControl
        action="/portal/operations"
        hiddenFields={{
          view,
          shipment_status: shipmentStatus,
          incident_status: incidentStatus,
          incident_period: incidentPeriod,
          order_query: orderQuery,
          per_page: perPage,
        }}
        selectedShopId={tenantScope.selectedShopId}
        shops={tenantScope.shops}
        submitLabel="Ver"
      />

      <Card className="stack operations-card">
        {hasPartialDataError ? (
          <div className="feedback feedback-info">
            Parte de los datos no se pudieron cargar. Mostramos la información disponible sin bloquear la operativa.
          </div>
        ) : null}
        <form className="operations-toolbar" method="get">
          {tenantScope.selectedShopId ? <input name="shop_id" type="hidden" value={tenantScope.selectedShopId} /> : null}
          {view === "shipments" ? <input name="shipment_status" type="hidden" value={shipmentStatus} /> : null}
          {view === "incidents" ? <input name="incident_status" type="hidden" value={incidentStatus} /> : null}
          {view === "shipments" ? <input name="incident_period" type="hidden" value={incidentPeriod} /> : null}
          <input name="per_page" type="hidden" value={perPage} />

          <div className="operations-segmented">
            <button
              className={`operations-segment ${view === "shipments" ? "operations-segment-active" : ""}`}
              name="view"
              type="submit"
              value="shipments"
            >
              Envíos
            </button>
            <button
              className={`operations-segment ${view === "incidents" ? "operations-segment-active" : ""}`}
              name="view"
              type="submit"
              value="incidents"
            >
              Incidencias
            </button>
          </div>

          {view === "shipments" ? (
            <div className="operations-toolbar-main">
              <div className="operations-filter-group">
                <span className="operations-filter-label">Pedido</span>
                <div className="operations-search-row">
                  <input
                    className="operations-search-input"
                    defaultValue={orderQuery}
                    name="order_query"
                    placeholder="Buscar por número de pedido"
                    type="search"
                  />
                  <button className="button button-secondary" type="submit">Buscar</button>
                </div>
              </div>

              <div className="operations-filter-group">
                <span className="operations-filter-label">Mostrar</span>
                <div className="operations-search-row">
                  <select className="operations-search-input" defaultValue={String(perPage)} name="per_page">
                    {perPageOptions.map((option) => (
                      <option key={option} value={option}>
                        {option} pedidos
                      </option>
                    ))}
                  </select>
                  <button className="button button-secondary" type="submit">Aplicar</button>
                </div>
              </div>

              <div className="operations-filter-group">
                <span className="operations-filter-label">Periodo</span>
                <div className="operations-search-row">
                  <select className="operations-search-input" defaultValue={incidentPeriod} name="incident_period">
                    <option value="7d">Últimos 7 días</option>
                    <option value="14d">Últimos 14 días</option>
                    <option value="30d">Últimos 30 días</option>
                    <option value="90d">Últimos 90 días</option>
                    <option value="all">Histórico</option>
                  </select>
                  <button className="button button-secondary" type="submit">Aplicar</button>
                </div>
              </div>

              <div className="operations-filter-group">
                <span className="operations-filter-label">Estado</span>
                <div className="operations-chip-group">
                  {shipmentViews.map((option) => (
                    <button
                      className={`operations-chip ${shipmentStatus === option.value ? "operations-chip-active" : ""}`}
                      key={option.value}
                      name="shipment_status"
                      type="submit"
                      value={option.value}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="operations-toolbar-main">
              <div className="operations-filter-group">
                <span className="operations-filter-label">Pedido</span>
                <div className="operations-search-row">
                  <input
                    className="operations-search-input"
                    defaultValue={orderQuery}
                    name="order_query"
                    placeholder="Buscar por número de pedido"
                    type="search"
                  />
                  <button className="button button-secondary" type="submit">Buscar</button>
                </div>
              </div>

              <div className="operations-filter-group">
                <span className="operations-filter-label">Mostrar</span>
                <div className="operations-search-row">
                  <select className="operations-search-input" defaultValue={String(perPage)} name="per_page">
                    {perPageOptions.map((option) => (
                      <option key={option} value={option}>
                        {option} registros
                      </option>
                    ))}
                  </select>
                  <button className="button button-secondary" type="submit">Aplicar</button>
                </div>
              </div>

              <div className="operations-filter-group">
                <span className="operations-filter-label">Estado</span>
                <div className="operations-chip-group">
                  {incidentViews.map((option) => (
                    <button
                      className={`operations-chip ${incidentStatus === option.value ? "operations-chip-active" : ""}`}
                      key={option.value}
                      name="incident_status"
                      type="submit"
                      value={option.value}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </form>

        {view === "shipments" ? (
          shipmentRows.length === 0 ? (
            <EmptyState title="Sin envíos visibles" description="No hay envíos que coincidan con el filtro actual." />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Pedido</th>
                    <th>Carrier</th>
                    <th>Tracking</th>
                    <th>Estado</th>
                    <th>Actualizado</th>
                  </tr>
                </thead>
                <tbody>
                  {shipmentRows.map((row) => (
                    <tr className="table-row" key={row.order.id}>
                      <td>{row.order.external_id}</td>
                      <td>{row.shipment?.carrier ?? "-"}</td>
                      <td>{row.shipment?.tracking_number ?? "Pendiente"}</td>
                      <td>{row.lastEvent?.status_norm ?? "Sin eventos"}</td>
                      <td>{row.lastEvent ? formatDateTime(row.lastEvent.occurred_at) : formatDateTime(row.shipment?.created_at ?? row.order.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : filteredIncidents.length === 0 ? (
          <EmptyState title="Sin incidencias visibles" description="No hay incidencias que coincidan con el filtro actual." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Pedido</th>
                  <th>Título</th>
                  <th>Prioridad</th>
                  <th>Estado</th>
                  <th>Actualizada</th>
                </tr>
              </thead>
              <tbody>
                {filteredIncidents.map((incident) => (
                  <tr className="table-row" key={incident.id}>
                    <td>#{incident.id}</td>
                    <td>{incident.order.external_id}</td>
                    <td>{incident.title}</td>
                    <td>{incident.priority}</td>
                    <td>{incident.status}</td>
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
