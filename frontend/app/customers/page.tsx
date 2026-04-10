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
        label: "Atención",
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

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
}

export default async function CustomersPage({ searchParams }: CustomerAccountsPageProps) {
  await requireAdminUser();
  const params = await searchParams;
  const query = normalize(params.q);
  const selected = params.selected ?? "";

  const [shopsResult, ordersResult, incidentsResult, integrationsResult] = await Promise.allSettled([
    fetchShops(),
    fetchOrders({ page: 1, per_page: 250 }),
    fetchIncidents({ page: 1, per_page: 300 }),
    fetchShopifyIntegrations(),
  ]);

  const shops = shopsResult.status === "fulfilled" ? shopsResult.value : [];
  const orders =
    ordersResult.status === "fulfilled"
      ? ordersResult.value.orders
      : [];
  const incidents = incidentsResult.status === "fulfilled" ? incidentsResult.value : [];
  const integrations = integrationsResult.status === "fulfilled" ? integrationsResult.value : [];
  const hasPartialDataError =
    shopsResult.status === "rejected" ||
    ordersResult.status === "rejected" ||
    incidentsResult.status === "rejected" ||
    integrationsResult.status === "rejected";
  const ordersByShop = new Map<number, typeof orders>();
  for (const order of orders) {
    const current = ordersByShop.get(order.shop_id);
    if (current) {
      current.push(order);
    } else {
      ordersByShop.set(order.shop_id, [order]);
    }
  }
  const incidentsByShop = new Map<number, typeof incidents>();
  for (const incident of incidents) {
    const shopId = incident.order.shop_id;
    const current = incidentsByShop.get(shopId);
    if (current) {
      current.push(incident);
    } else {
      incidentsByShop.set(shopId, [incident]);
    }
  }
  const integrationByShop = new Map(integrations.map((item) => [item.shop_id, item]));

  const rows = shops
    .map((shop) => {
      const shopOrders = ordersByShop.get(shop.id) ?? [];
      const shopIncidents = incidentsByShop.get(shop.id) ?? [];
      const integration = integrationByShop.get(shop.id) ?? null;

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
          (order.shipment.events ?? [])
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
      {hasPartialDataError ? (
        <div className="feedback feedback-info">
          Parte de los datos no se pudieron cargar. Mostramos la información disponible para que puedas seguir operando.
        </div>
      ) : null}
      {/* ── Header ─────────────────────────────────────────────────── */}
      <Card className="stack customer-accounts-hero">
        <PageHeader
          actions={
            <CreateShopButton
              buttonClassName="button"
              buttonLabel="Nueva cuenta"
              description="Da de alta una nueva cuenta cliente y luego podrás completar integración, branding y accesos."
              successRedirectPath="/customers"
              title="Crear cuenta / tienda"
            />
          }
          eyebrow="CRM operativo"
          title="Cuentas de cliente"
          description="Estado, salud operativa, sync y expediciones de cada tienda en una sola vista."
        />

        <form className="customer-accounts-toolbar" method="get">
          <SearchInput
            defaultValue={params.q ?? ""}
            placeholder="Buscar por tienda, slug, dominio o SKU…"
          />
          <div className="field">
            <label htmlFor="health">Estado</label>
            <select defaultValue={params.health ?? "all"} id="health" name="health">
              <option value="all">Todas</option>
              <option value="healthy">Saludables</option>
              <option value="attention">Atención</option>
              <option value="risk">Riesgo</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="volume">Volumen</label>
            <select defaultValue={params.volume ?? "all"} id="volume" name="volume">
              <option value="all">Todos</option>
              <option value="high">Alto ≥100</option>
              <option value="medium">Medio ≥25</option>
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
            <label htmlFor="sync">Sync</label>
            <select defaultValue={params.sync ?? "all"} id="sync" name="sync">
              <option value="all">Todas</option>
              <option value="recent">Sync OK</option>
              <option value="attention">Revisar sync</option>
            </select>
          </div>
          <div className="customer-accounts-toolbar-actions">
            <button className="button" type="submit">Filtrar</button>
          </div>
        </form>
      </Card>

      {/* ── KPI strip ──────────────────────────────────────────────── */}
      <div className="crm-kpi-strip">
        <article className="crm-kpi-card">
          <span className="crm-kpi-label">Total cuentas</span>
          <span className="crm-kpi-value">{kpis.total}</span>
          <span className="crm-kpi-hint">clientes en la operativa</span>
        </article>
        <article className="crm-kpi-card is-blue">
          <span className="crm-kpi-label">Activas</span>
          <span className="crm-kpi-value">{kpis.active}</span>
          <span className="crm-kpi-hint">con pedidos en curso</span>
        </article>
        <article className="crm-kpi-card is-orange">
          <span className="crm-kpi-label">En producción</span>
          <span className="crm-kpi-value">{kpis.production}</span>
          <span className="crm-kpi-hint">trabajo interno activo</span>
        </article>
        <article className="crm-kpi-card is-sky">
          <span className="crm-kpi-label">En tránsito</span>
          <span className="crm-kpi-value">{kpis.transit}</span>
          <span className="crm-kpi-hint">expediciones vivas</span>
        </article>
        <article className="crm-kpi-card is-green">
          <span className="crm-kpi-label">Sync reciente</span>
          <span className="crm-kpi-value">{kpis.recentSync}</span>
          <span className="crm-kpi-hint">sync &lt;6h</span>
        </article>
        <article className="crm-kpi-card is-accent">
          <span className="crm-kpi-label">Con incidencias</span>
          <span className="crm-kpi-value">{kpis.incidents}</span>
          <span className="crm-kpi-hint">casos abiertos</span>
        </article>
        <article className="crm-kpi-card is-red">
          <span className="crm-kpi-label">En riesgo</span>
          <span className="crm-kpi-value">{kpis.risk}</span>
          <span className="crm-kpi-hint">SLA comprometido</span>
        </article>
      </div>

      {/* ── Workbench ──────────────────────────────────────────────── */}
      {rows.length === 0 ? (
        <Card className="stack">
          <EmptyState
            title="No hay cuentas para esta vista"
            description="Ajusta los filtros o conecta nuevas tiendas para recuperar el pulso operativo."
          />
        </Card>
      ) : (
        <section className="customer-accounts-workbench">

          {/* Left — account list */}
          <Card className="stack table-card">
            <div className="table-header">
              <div>
                <span className="eyebrow">Cuentas</span>
                <h3 className="section-title section-title-small">Radar de clientes</h3>
              </div>
              <div className="muted">{rows.length} cuentas</div>
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

                const isActive = selectedEntry?.shop.id === entry.shop.id;

                return (
                  <Link
                    key={entry.shop.id}
                    href={`/customers?${href.toString()}`}
                    className={`crm-account-row ${isActive ? "is-active" : ""} ${entry.health === "risk" ? "is-risk" : entry.health === "attention" ? "is-attention" : ""}`}
                  >
                    {/* Brand */}
                    <div className="customer-account-brand">
                      <div className="crm-avatar">{initials(entry.shop.name)}</div>
                      <div>
                        <div className="table-primary">{entry.shop.name}</div>
                        <div className="table-secondary">
                          {entry.shop.slug}
                          {entry.integration?.shop_domain ? ` · ${entry.integration.shop_domain}` : ""}
                        </div>
                      </div>
                    </div>

                    {/* Health */}
                    <div className="customer-account-health-wrap">
                      <span className={health.className}>{health.label}</span>
                      <span className="table-secondary" style={{ fontSize: "0.72rem" }}>
                        {entry.integration?.last_synced_at
                          ? `Sync ${formatDateTime(entry.integration.last_synced_at)}`
                          : "Sin sync"}
                      </span>
                    </div>

                    {/* Mini metrics */}
                    <div className="customer-account-mini-metrics">
                      <div>
                        <span className="customer-account-mini-label">Activos</span>
                        <strong>{entry.metrics.activeOrders}</strong>
                      </div>
                      <div>
                        <span className="customer-account-mini-label">Producción</span>
                        <strong>{entry.metrics.inProduction}</strong>
                      </div>
                      <div>
                        <span className="customer-account-mini-label">Tránsito</span>
                        <strong>{entry.metrics.inTransit}</strong>
                      </div>
                      <div>
                        <span className="customer-account-mini-label">Incidencias</span>
                        <strong style={{ color: entry.metrics.openIncidents > 0 ? "var(--danger)" : "inherit" }}>
                          {entry.metrics.openIncidents}
                        </strong>
                      </div>
                    </div>

                    {/* Meta */}
                    <div className="customer-account-meta">
                      <div className="table-secondary">
                        {entry.metrics.personalized > 0
                          ? `${entry.metrics.personalized} personalizados / ${entry.metrics.standard} estándar`
                          : "Solo operativa estándar"}
                      </div>
                      <div className="customer-account-links">
                        <span className="table-link">Ver pedidos →</span>
                        <span className="table-link">Ver envíos →</span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </Card>

          {/* Right — CRM drawer */}
          <div className="crm-drawer">
            {selectedEntry ? (
              <>
                {/* Head */}
                <div className="crm-drawer-head">
                  <div className="crm-drawer-avatar">{initials(selectedEntry.shop.name)}</div>
                  <div className="crm-drawer-name">{selectedEntry.shop.name}</div>
                  <div className="crm-drawer-meta">
                    {selectedEntry.integration?.shop_domain ?? selectedEntry.shop.slug}
                    {" · "}
                    {selectedEntry.metrics.totalOrders} pedidos totales
                  </div>
                  <div className="crm-drawer-health">
                    <span className={getHealthMeta(selectedEntry.health).className}>
                      {getHealthMeta(selectedEntry.health).label}
                    </span>
                  </div>
                </div>

                {/* Stats 2×2 grid */}
                <div className="crm-drawer-stats">
                  <div className="crm-drawer-stat">
                    <span className="crm-stat-label">Hoy</span>
                    <span className="crm-stat-value">{selectedEntry.metrics.ordersToday}</span>
                  </div>
                  <div className="crm-drawer-stat">
                    <span className="crm-stat-label">Producción</span>
                    <span className="crm-stat-value">{selectedEntry.metrics.inProduction}</span>
                  </div>
                  <div className="crm-drawer-stat">
                    <span className="crm-stat-label">Tránsito</span>
                    <span className="crm-stat-value">{selectedEntry.metrics.inTransit}</span>
                  </div>
                  <div className="crm-drawer-stat">
                    <span className="crm-stat-label">Entregados</span>
                    <span className="crm-stat-value">{selectedEntry.metrics.delivered}</span>
                  </div>
                </div>

                {/* Operativa */}
                <div className="crm-drawer-section">
                  <div className="crm-drawer-section-title">Operativa</div>
                  <div className="crm-status-row">
                    <span>Última sync</span>
                    <strong>{selectedEntry.integration?.last_synced_at ? formatDateTime(selectedEntry.integration.last_synced_at) : "Sin sync"}</strong>
                  </div>
                  <div className="crm-status-row">
                    <span>Estado sync</span>
                    <strong>{selectedEntry.integration?.last_sync_status ?? "—"}</strong>
                  </div>
                  <div className="crm-status-row">
                    <span>Excepciones</span>
                    <strong style={{ color: selectedEntry.metrics.exceptionShipments > 0 ? "var(--danger)" : "inherit" }}>
                      {selectedEntry.metrics.exceptionShipments}
                    </strong>
                  </div>
                  <div className="crm-status-row">
                    <span>Atascados +48h</span>
                    <strong style={{ color: selectedEntry.metrics.stalledShipments > 0 ? "var(--warning)" : "inherit" }}>
                      {selectedEntry.metrics.stalledShipments}
                    </strong>
                  </div>
                  <div className="crm-status-row">
                    <span>Sin tracking</span>
                    <strong>{selectedEntry.metrics.withoutTracking}</strong>
                  </div>
                  <div className="crm-status-row">
                    <span>Pedidos bloqueados</span>
                    <strong style={{ color: selectedEntry.metrics.blockedOrders > 0 ? "var(--danger)" : "inherit" }}>
                      {selectedEntry.metrics.blockedOrders}
                    </strong>
                  </div>
                </div>

                {/* Actividad */}
                <div className="crm-drawer-section">
                  <div className="crm-drawer-section-title">Actividad reciente</div>
                  <div className="crm-status-row">
                    <span>Último pedido</span>
                    <strong style={{ fontSize: "0.8rem" }}>
                      {selectedEntry.lastOrder
                        ? `${selectedEntry.lastOrder.external_id}`
                        : "Sin pedidos"}
                    </strong>
                  </div>
                  {selectedEntry.lastOrder && (
                    <div className="crm-status-row">
                      <span>Fecha</span>
                      <strong style={{ fontSize: "0.78rem" }}>{formatDateTime(selectedEntry.lastOrder.created_at)}</strong>
                    </div>
                  )}
                  <div className="crm-status-row">
                    <span>Incidencia reciente</span>
                    <strong style={{ fontSize: "0.8rem", color: selectedEntry.latestIncident ? "var(--danger)" : "inherit" }}>
                      {selectedEntry.latestIncident ? selectedEntry.latestIncident.title : "Sin incidencias"}
                    </strong>
                  </div>
                </div>

                {/* Mix & top SKU */}
                <div className="crm-drawer-section">
                  <div className="crm-drawer-section-title">Producto</div>
                  <div className="crm-status-row">
                    <span>Mix operativo</span>
                    <strong style={{ fontSize: "0.8rem" }}>
                      {selectedEntry.metrics.personalized}p / {selectedEntry.metrics.standard}e
                    </strong>
                  </div>
                  <div className="crm-status-row">
                    <span>Top SKU</span>
                    <strong style={{ fontSize: "0.78rem" }}>
                      {selectedEntry.topSku
                        ? `${selectedEntry.topSku.sku} · ${selectedEntry.topSku.quantity} uds.`
                        : "Sin historial"}
                    </strong>
                  </div>
                </div>

                {/* Actions */}
                <div className="crm-drawer-actions">
                  <Link className="button" href={`/tenant/${selectedEntry.shop.id}/dashboard/overview`}>
                    Ver cuenta completa
                  </Link>
                  <Link className="button button-secondary" href={`/orders?shop_id=${selectedEntry.shop.id}`}>
                    Pedidos
                  </Link>
                  <Link className="button button-secondary" href={`/shipments?shop_id=${selectedEntry.shop.id}`}>
                    Envíos
                  </Link>
                </div>
              </>
            ) : (
              <div style={{ padding: "32px 22px" }}>
                <EmptyState
                  title="Selecciona una cuenta"
                  description="Abre una cuenta desde la lista para revisar su salud, actividad y accesos."
                />
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
