import Link from "next/link";

import { Card } from "@/components/card";
import { CreateShopButton } from "@/components/create-shop-button";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { SearchInput } from "@/components/search-input";
import { fetchIncidents, fetchOrders, fetchShops, fetchShopifyIntegrations } from "@/lib/api";
import { requireAdminUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";


type CustomerAccountsPageProps = {
  searchParams: Promise<{
    q?: string;
    health?: string;
    volume?: string;
    incidents?: string;
    sync?: string;
    selected?: string;
  }>;
};

type AccountHealth = "healthy" | "attention" | "risk";

function normalize(value?: string) {
  return (value ?? "").trim().toLowerCase();
}

function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

function isToday(value: string) {
  return value.slice(0, 10) === getTodayDate();
}

function hoursSince(value?: string | null) {
  if (!value) {
    return null;
  }
  return Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 36e5));
}

function getHealthMeta(health: AccountHealth) {
  switch (health) {
    case "healthy":
      return {
        label: "Saludable",
        className: "customer-account-health customer-account-health-healthy",
      };
    case "attention":
      return {
        label: "Atencion",
        className: "customer-account-health customer-account-health-attention",
      };
    default:
      return {
        label: "Riesgo",
        className: "customer-account-health customer-account-health-risk",
      };
  }
}

function getVolumeBucket(totalOrders: number) {
  if (totalOrders >= 100) {
    return "high";
  }
  if (totalOrders >= 25) {
    return "medium";
  }
  return "low";
}

export default async function CustomersPage({ searchParams }: CustomerAccountsPageProps) {
  await requireAdminUser();
  const params = await searchParams;
  const query = normalize(params.q);
  const selected = params.selected ?? "";

  const [shopsResult, ordersResult, incidentsResult, integrationsResult] = await Promise.allSettled([
    fetchShops(),
    fetchOrders({ per_page: 500 }),
    fetchIncidents(),
    fetchShopifyIntegrations(),
  ]);

  const shops = shopsResult.status === "fulfilled" ? shopsResult.value : [];
  const orders =
    ordersResult.status === "fulfilled"
      ? ordersResult.value.orders
      : [];
  const incidents = incidentsResult.status === "fulfilled" ? incidentsResult.value : [];
  const integrations = integrationsResult.status === "fulfilled" ? integrationsResult.value : [];

  const rows = shops
    .map((shop) => {
      const shopOrders = orders.filter((order) => order.shop_id === shop.id);
      const shopIncidents = incidents.filter((incident) => incident.order.shop_id === shop.id);
      const integration = integrations.find((item) => item.shop_id === shop.id) ?? null;

      const ordersToday = shopOrders.filter((order) => isToday(order.created_at)).length;
      const activeOrders = shopOrders.filter((order) => order.status !== "delivered").length;
      const inProduction = shopOrders.filter((order) =>
        order.production_status === "in_production" || order.production_status === "pending_personalization",
      ).length;
      const inTransit = shopOrders.filter((order) => {
        const shipmentStatus = order.shipment?.shipping_status;
        return shipmentStatus === "in_transit" || shipmentStatus === "out_for_delivery";
      }).length;
      const delivered = shopOrders.filter((order) => order.status === "delivered").length;
      const personalized = shopOrders.filter((order) => order.is_personalized).length;
      const standard = Math.max(shopOrders.length - personalized, 0);
      const openIncidents = shopIncidents.filter((incident) => incident.status !== "resolved");
      const exceptionShipments = shopOrders.filter((order) =>
        order.shipment?.shipping_status === "exception" || order.has_open_incident,
      ).length;
      const stalledShipments = shopOrders.filter((order) => {
        if (!order.shipment || order.status === "delivered") {
          return false;
        }
        const trackingDate =
          order.shipment.events
            .slice()
            .sort((left, right) => new Date(right.occurred_at).getTime() - new Date(left.occurred_at).getTime())[0]
            ?.occurred_at ?? order.shipment.created_at;
        const age = hoursSince(trackingDate);
        return age !== null && age >= 48;
      }).length;
      const withoutTracking = shopOrders.filter((order) => order.shipment && !order.shipment.tracking_number).length;
      const blockedOrders = shopOrders.filter((order) => order.has_open_incident || order.items.some((item) => item.design_status === "pending_asset" || item.design_status === "missing_asset")).length;
      const syncAge = hoursSince(integration?.last_synced_at ?? null);
      const syncRecent = integration?.last_synced_at ? (syncAge ?? 999) <= 6 : false;
      const lastOrder =
        [...shopOrders].sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))[0] ?? null;
      const latestIncident =
        [...openIncidents].sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))[0] ?? null;
      const topSkuEntry = Object.entries(
        shopOrders.flatMap((order) => order.items).reduce<Record<string, number>>((accumulator, item) => {
          const key = item.sku || item.title || item.name;
          if (!key) {
            return accumulator;
          }
          accumulator[key] = (accumulator[key] ?? 0) + item.quantity;
          return accumulator;
        }, {}),
      ).sort((left, right) => right[1] - left[1])[0] ?? null;

      let health: AccountHealth = "healthy";
      if (
        openIncidents.length >= 3 ||
        stalledShipments >= 2 ||
        withoutTracking >= 2 ||
        (integration?.last_sync_status === "failed") ||
        (syncAge !== null && syncAge > 24)
      ) {
        health = "risk";
      } else if (
        openIncidents.length > 0 ||
        blockedOrders > 0 ||
        exceptionShipments > 0 ||
        (syncAge !== null && syncAge > 6) ||
        !syncRecent
      ) {
        health = "attention";
      }

      return {
        shop,
        integration,
        health,
        latestIncident,
        lastOrder,
        topSku: topSkuEntry
          ? {
              sku: topSkuEntry[0],
              quantity: topSkuEntry[1],
            }
          : null,
        metrics: {
          totalOrders: shopOrders.length,
          ordersToday,
          activeOrders,
          inProduction,
          inTransit,
          delivered,
          personalized,
          standard,
          openIncidents: openIncidents.length,
          exceptionShipments,
          stalledShipments,
          withoutTracking,
          blockedOrders,
          syncRecent,
        },
      };
    })
    .filter((entry) => {
      if (query) {
        const haystack = [
          entry.shop.name,
          entry.shop.slug,
          entry.integration?.shop_domain ?? "",
          entry.topSku?.sku ?? "",
        ]
          .join(" ")
          .toLowerCase();

        if (!haystack.includes(query)) {
          return false;
        }
      }

      if (params.health && params.health !== "all" && entry.health !== params.health) {
        return false;
      }

      if (params.volume && params.volume !== "all" && getVolumeBucket(entry.metrics.totalOrders) !== params.volume) {
        return false;
      }

      if (params.incidents === "open" && entry.metrics.openIncidents === 0) {
        return false;
      }

      if (params.incidents === "none" && entry.metrics.openIncidents > 0) {
        return false;
      }

      if (params.sync === "recent" && !entry.metrics.syncRecent) {
        return false;
      }

      if (params.sync === "attention" && entry.metrics.syncRecent) {
        return false;
      }

      return true;
    })
    .sort((left, right) => {
      const leftScore = left.health === "risk" ? 3 : left.health === "attention" ? 2 : 1;
      const rightScore = right.health === "risk" ? 3 : right.health === "attention" ? 2 : 1;
      if (leftScore !== rightScore) {
        return rightScore - leftScore;
      }
      return right.metrics.activeOrders - left.metrics.activeOrders;
    });

  const selectedEntry = rows.find((entry) => String(entry.shop.id) === selected) ?? rows[0] ?? null;

  const kpis = {
    total: rows.length,
    active: rows.filter((entry) => entry.metrics.activeOrders > 0).length,
    incidents: rows.filter((entry) => entry.metrics.openIncidents > 0).length,
    recentSync: rows.filter((entry) => entry.metrics.syncRecent).length,
    production: rows.filter((entry) => entry.metrics.inProduction > 0).length,
    transit: rows.filter((entry) => entry.metrics.inTransit > 0).length,
    risk: rows.filter((entry) => entry.health === "risk").length,
  };

  return (
    <div className="stack customer-accounts-page">
      <Card className="stack customer-accounts-hero">
        <PageHeader
          actions={
            <CreateShopButton
              buttonClassName="button"
              buttonLabel="Nueva tienda"
              description="Da de alta una nueva cuenta cliente y luego podrás completar integración, branding y accesos."
              successRedirectPath="/customers"
              title="Crear cuenta / tienda"
            />
          }
          eyebrow="Cuentas de cliente"
          title="Account management operativo"
          description="Lee todas las tiendas desde una unica vista: estado de la cuenta, sync, riesgo operativo, expediciones e incidencias sin perder contexto."
        />

        <form className="customer-accounts-toolbar" method="get">
          <SearchInput
            defaultValue={params.q ?? ""}
            placeholder="Buscar por tienda, slug, dominio o SKU principal"
          />

          <div className="field">
            <label htmlFor="health">Estado de la cuenta</label>
            <select defaultValue={params.health ?? "all"} id="health" name="health">
              <option value="all">Todas</option>
              <option value="healthy">Saludables</option>
              <option value="attention">Atencion</option>
              <option value="risk">Riesgo</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="volume">Volumen</label>
            <select defaultValue={params.volume ?? "all"} id="volume" name="volume">
              <option value="all">Todos</option>
              <option value="high">Alto</option>
              <option value="medium">Medio</option>
              <option value="low">Bajo</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="incidents">Incidencias</label>
            <select defaultValue={params.incidents ?? "all"} id="incidents" name="incidents">
              <option value="all">Todas</option>
              <option value="open">Con incidencias</option>
              <option value="none">Sin incidencias</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="sync">Sync status</label>
            <select defaultValue={params.sync ?? "all"} id="sync" name="sync">
              <option value="all">Todas</option>
              <option value="recent">Sync reciente</option>
              <option value="attention">Revisar sync</option>
            </select>
          </div>

          <div className="customer-accounts-toolbar-actions">
            <button className="button" type="submit">
              Aplicar
            </button>
            <button className="button button-secondary" type="button">
              Exportar
            </button>
          </div>
        </form>
      </Card>

      <section className="customer-accounts-kpis">
        <Card className="customer-accounts-kpi">
          <span className="customer-accounts-kpi-label">Total cuentas</span>
          <strong>{kpis.total}</strong>
          <span className="table-secondary">clientes visibles en la operativa</span>
        </Card>
        <Card className="customer-accounts-kpi">
          <span className="customer-accounts-kpi-label">Activas</span>
          <strong>{kpis.active}</strong>
          <span className="table-secondary">con pedidos todavia en juego</span>
        </Card>
        <Card className="customer-accounts-kpi">
          <span className="customer-accounts-kpi-label">Con incidencias</span>
          <strong>{kpis.incidents}</strong>
          <span className="table-secondary">casos abiertos que requieren seguimiento</span>
        </Card>
        <Card className="customer-accounts-kpi">
          <span className="customer-accounts-kpi-label">Sync reciente</span>
          <strong>{kpis.recentSync}</strong>
          <span className="table-secondary">sincronizadas en las ultimas 6 horas</span>
        </Card>
        <Card className="customer-accounts-kpi">
          <span className="customer-accounts-kpi-label">En produccion</span>
          <strong>{kpis.production}</strong>
          <span className="table-secondary">cuentas con trabajo interno en marcha</span>
        </Card>
        <Card className="customer-accounts-kpi">
          <span className="customer-accounts-kpi-label">En transito</span>
          <strong>{kpis.transit}</strong>
          <span className="table-secondary">cuentas con expediciones vivas</span>
        </Card>
        <Card className="customer-accounts-kpi">
          <span className="customer-accounts-kpi-label">En riesgo</span>
          <strong>{kpis.risk}</strong>
          <span className="table-secondary">SLA, incidencias o sync comprometida</span>
        </Card>
      </section>

      {rows.length === 0 ? (
        <Card className="stack">
          <EmptyState
            title="No hay cuentas para esta vista"
            description="Ajusta los filtros o conecta nuevas tiendas para recuperar el pulso operativo desde aqui."
          />
        </Card>
      ) : (
        <section className="customer-accounts-workbench">
          <Card className="stack table-card">
            <div className="table-header">
              <div>
                <span className="eyebrow">Cuentas</span>
                <h3 className="section-title section-title-small">Radar de clientes y tiendas</h3>
              </div>
              <div className="muted">{rows.length} cuentas visibles</div>
            </div>

            <div className="customer-accounts-list">
              {rows.map((entry) => {
                const health = getHealthMeta(entry.health);
                const href = new URLSearchParams();
                if (params.q) href.set("q", params.q);
                if (params.health) href.set("health", params.health);
                if (params.volume) href.set("volume", params.volume);
                if (params.incidents) href.set("incidents", params.incidents);
                if (params.sync) href.set("sync", params.sync);
                href.set("selected", String(entry.shop.id));

                return (
                  <div
                    className={`customer-account-row ${selectedEntry?.shop.id === entry.shop.id ? "is-active" : ""}`}
                    key={entry.shop.id}
                  >
                    <div className="customer-account-brand">
                      <div className="customer-account-logo">
                        {entry.shop.name
                          .split(" ")
                          .map((part) => part[0])
                          .join("")
                          .slice(0, 2)
                          .toUpperCase()}
                      </div>
                      <div>
                        <div className="table-primary">{entry.shop.name}</div>
                        <div className="table-secondary">
                          {entry.shop.slug}
                          {entry.integration?.shop_domain ? ` · ${entry.integration.shop_domain}` : ""}
                        </div>
                      </div>
                    </div>

                    <div className="customer-account-health-wrap">
                      <span className={health.className}>{health.label}</span>
                      <span className="table-secondary">
                        {entry.integration?.last_synced_at ? `Sync ${formatDateTime(entry.integration.last_synced_at)}` : "Sin sync"}
                      </span>
                    </div>

                    <div className="customer-account-mini-metrics">
                      <div>
                        <span className="customer-account-mini-label">Activos</span>
                        <strong>{entry.metrics.activeOrders}</strong>
                      </div>
                      <div>
                        <span className="customer-account-mini-label">Produccion</span>
                        <strong>{entry.metrics.inProduction}</strong>
                      </div>
                      <div>
                        <span className="customer-account-mini-label">Transito</span>
                        <strong>{entry.metrics.inTransit}</strong>
                      </div>
                      <div>
                        <span className="customer-account-mini-label">Incidencias</span>
                        <strong>{entry.metrics.openIncidents}</strong>
                      </div>
                    </div>

                    <div className="customer-account-meta">
                      <div className="table-secondary">
                        {entry.metrics.personalized > 0
                          ? `${entry.metrics.personalized} personalizados / ${entry.metrics.standard} estandar`
                          : "Solo operativa estandar"}
                      </div>
                      <div className="customer-account-links">
                        <Link className="table-link" href={`/customers?${href.toString()}`}>
                          Ver cuenta
                        </Link>
                        <Link className="table-link" href={`/orders?shop_id=${entry.shop.id}`}>
                          Ver pedidos
                        </Link>
                        <Link className="table-link" href={`/shipments?shop_id=${entry.shop.id}`}>
                          Ver envios
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="stack customer-account-drawer">
            {selectedEntry ? (
              <>
                <div className="customer-account-drawer-head">
                  <div className="customer-account-brand">
                    <div className="customer-account-logo customer-account-logo-large">
                      {selectedEntry.shop.name
                        .split(" ")
                        .map((part) => part[0])
                        .join("")
                        .slice(0, 2)
                        .toUpperCase()}
                    </div>
                    <div>
                      <span className="eyebrow">Cuenta seleccionada</span>
                      <h3 className="section-title section-title-small">{selectedEntry.shop.name}</h3>
                      <div className="table-secondary">
                        {selectedEntry.integration?.shop_domain ?? selectedEntry.shop.slug}
                      </div>
                    </div>
                  </div>
                  <span className={getHealthMeta(selectedEntry.health).className}>
                    {getHealthMeta(selectedEntry.health).label}
                  </span>
                </div>

                <div className="customer-account-drawer-grid">
                  <div className="customer-account-drawer-stat">
                    <span className="customer-account-mini-label">Pedidos del dia</span>
                    <strong>{selectedEntry.metrics.ordersToday}</strong>
                  </div>
                  <div className="customer-account-drawer-stat">
                    <span className="customer-account-mini-label">En produccion</span>
                    <strong>{selectedEntry.metrics.inProduction}</strong>
                  </div>
                  <div className="customer-account-drawer-stat">
                    <span className="customer-account-mini-label">En transito</span>
                    <strong>{selectedEntry.metrics.inTransit}</strong>
                  </div>
                  <div className="customer-account-drawer-stat">
                    <span className="customer-account-mini-label">Entregados</span>
                    <strong>{selectedEntry.metrics.delivered}</strong>
                  </div>
                </div>

                <div className="status-summary-list">
                  <div className="status-summary-row">
                    <span>Ultima sincronizacion</span>
                    <strong>
                      {selectedEntry.integration?.last_synced_at
                        ? formatDateTime(selectedEntry.integration.last_synced_at)
                        : "Sin sincronizacion"}
                    </strong>
                  </div>
                  <div className="status-summary-row">
                    <span>Sync status</span>
                    <strong>{selectedEntry.integration?.last_sync_status ?? "Sin estado"}</strong>
                  </div>
                  <div className="status-summary-row">
                    <span>Envios con excepcion</span>
                    <strong>{selectedEntry.metrics.exceptionShipments}</strong>
                  </div>
                  <div className="status-summary-row">
                    <span>Envios atascados</span>
                    <strong>{selectedEntry.metrics.stalledShipments}</strong>
                  </div>
                  <div className="status-summary-row">
                    <span>Sin tracking</span>
                    <strong>{selectedEntry.metrics.withoutTracking}</strong>
                  </div>
                  <div className="status-summary-row">
                    <span>Pedidos bloqueados</span>
                    <strong>{selectedEntry.metrics.blockedOrders}</strong>
                  </div>
                </div>

                <div className="customer-account-drawer-block">
                  <div className="table-primary">Actividad reciente</div>
                  <div className="table-secondary">
                    {selectedEntry.lastOrder
                      ? `${selectedEntry.lastOrder.external_id} · ${formatDateTime(selectedEntry.lastOrder.created_at)}`
                      : "Sin pedidos recientes"}
                  </div>
                </div>

                <div className="customer-account-drawer-block">
                  <div className="table-primary">Incidencia reciente</div>
                  <div className="table-secondary">
                    {selectedEntry.latestIncident
                      ? `${selectedEntry.latestIncident.title} · ${formatDateTime(selectedEntry.latestIncident.updated_at)}`
                      : "Sin incidencias abiertas"}
                  </div>
                </div>

                <div className="customer-account-drawer-block">
                  <div className="table-primary">Mix operativo</div>
                  <div className="table-secondary">
                    {selectedEntry.metrics.personalized} personalizados / {selectedEntry.metrics.standard} estandar
                  </div>
                </div>

                <div className="customer-account-drawer-block">
                  <div className="table-primary">Top SKU</div>
                  <div className="table-secondary">
                    {selectedEntry.topSku
                      ? `${selectedEntry.topSku.sku} · ${selectedEntry.topSku.quantity} uds.`
                      : "Sin suficiente historial todavia"}
                  </div>
                </div>

                <div className="customer-account-drawer-actions">
                  <Link className="button button-secondary" href={`/orders?shop_id=${selectedEntry.shop.id}`}>
                    Ver pedidos
                  </Link>
                  <Link className="button button-secondary" href={`/shipments?shop_id=${selectedEntry.shop.id}`}>
                    Ver envios
                  </Link>
                  <Link className="button button-secondary" href={`/analytics?shop_id=${selectedEntry.shop.id}`}>
                    Ver analytics
                  </Link>
                  <Link className="button" href={`/tenant/${selectedEntry.shop.id}/dashboard/overview`}>
                    Ver cuenta
                  </Link>
                </div>
              </>
            ) : (
              <EmptyState
                title="Selecciona una cuenta"
                description="Abre una cuenta desde la lista para revisar su salud, actividad y accesos rapidos."
              />
            )}
          </Card>
        </section>
      )}
    </div>
  );
}
