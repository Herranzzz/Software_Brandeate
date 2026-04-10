import Link from "next/link";

import { Card } from "@/components/card";
import { ClientAccountsPanel } from "@/components/client-accounts-panel";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { SearchInput } from "@/components/search-input";
import { fetchAdminUsers, fetchIncidents, fetchOrders, fetchShops, fetchShopifyIntegrations } from "@/lib/api";
import { requireAdminUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";


type ClientAccountsPageProps = {
  searchParams: Promise<{ q?: string; selected?: string }>;
};

function hoursSince(value?: string | null) {
  if (!value) return null;
  return Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 36e5));
}

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
}

type AccountHealth = "healthy" | "attention" | "risk";

function getHealthMeta(health: AccountHealth) {
  switch (health) {
    case "healthy":
      return { label: "Saludable", emoji: "🟢", className: "customer-account-health customer-account-health-healthy" };
    case "attention":
      return { label: "Atención", emoji: "🟡", className: "customer-account-health customer-account-health-attention" };
    default:
      return { label: "Riesgo", emoji: "🔴", className: "customer-account-health customer-account-health-risk" };
  }
}


export default async function ClientAccountsPage({ searchParams }: ClientAccountsPageProps) {
  const [userResult, usersResult, shopsResult, ordersResult, incidentsResult, integrationsResult] = await Promise.allSettled([
    requireAdminUser(),
    fetchAdminUsers(),
    fetchShops(),
    fetchOrders({ page: 1, per_page: 250 }),
    fetchIncidents({ page: 1, per_page: 300 }),
    fetchShopifyIntegrations(),
  ]);

  if (userResult.status === "rejected") throw userResult.reason;
  const currentUser = userResult.value;

  const allUsers = usersResult.status === "fulfilled" ? usersResult.value : [];
  const shops = shopsResult.status === "fulfilled" ? shopsResult.value : [];
  const orders = ordersResult.status === "fulfilled" ? ordersResult.value.orders : [];
  const incidents = incidentsResult.status === "fulfilled" ? incidentsResult.value : [];
  const integrations = integrationsResult.status === "fulfilled" ? integrationsResult.value : [];

  const clientAccounts = allUsers.filter(
    (u) => u.role === "shop_admin" || u.role === "shop_viewer",
  );

  const params = await searchParams;
  const query = (params.q ?? "").trim().toLowerCase();
  const selected = params.selected ?? "";

  // Build shop radar rows
  const ordersByShop = new Map<number, typeof orders>();
  for (const order of orders) {
    const list = ordersByShop.get(order.shop_id) ?? [];
    list.push(order);
    ordersByShop.set(order.shop_id, list);
  }
  const incidentsByShop = new Map<number, typeof incidents>();
  for (const incident of incidents) {
    const shopId = incident.order.shop_id;
    const list = incidentsByShop.get(shopId) ?? [];
    list.push(incident);
    incidentsByShop.set(shopId, list);
  }
  const integrationByShop = new Map(integrations.map((i) => [i.shop_id, i]));

  const rows = shops.map((shop) => {
    const shopOrders = ordersByShop.get(shop.id) ?? [];
    const shopIncidents = incidentsByShop.get(shop.id) ?? [];
    const integration = integrationByShop.get(shop.id) ?? null;
    const openIncidents = shopIncidents.filter((i) => i.status !== "resolved").length;
    const activeOrders = shopOrders.filter((o) => o.status !== "delivered").length;
    const inTransit = shopOrders.filter((o) => {
      const s = o.shipment?.shipping_status;
      return s === "in_transit" || s === "out_for_delivery";
    }).length;
    const inProduction = shopOrders.filter((o) =>
      o.production_status === "in_production" || o.production_status === "pending_personalization",
    ).length;
    const syncAge = hoursSince(integration?.last_synced_at ?? null);
    const exceptionShipments = shopOrders.filter((o) =>
      o.shipment?.shipping_status === "exception" || o.has_open_incident,
    ).length;
    const stalledShipments = shopOrders.filter((o) => {
      if (!o.shipment || o.status === "delivered") return false;
      const trackingDate =
        (o.shipment.events ?? [])
          .slice()
          .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())[0]
          ?.occurred_at ?? o.shipment.created_at;
      const age = hoursSince(trackingDate);
      return age !== null && age >= 48;
    }).length;

    let health: AccountHealth = "healthy";
    if (openIncidents >= 3 || stalledShipments >= 2 || (integration?.last_sync_status === "failed") || (syncAge !== null && syncAge > 24)) {
      health = "risk";
    } else if (openIncidents > 0 || exceptionShipments > 0 || (syncAge !== null && syncAge > 6)) {
      health = "attention";
    }

    return { shop, health, activeOrders, inTransit, inProduction, openIncidents, integration, syncAge };
  });

  const filteredRows = rows
    .filter((r) => {
      if (!query) return true;
      return r.shop.name.toLowerCase().includes(query) || r.shop.slug.toLowerCase().includes(query);
    })
    .sort((a, b) => {
      const scoreA = a.health === "risk" ? 3 : a.health === "attention" ? 2 : 1;
      const scoreB = b.health === "risk" ? 3 : b.health === "attention" ? 2 : 1;
      return scoreB - scoreA || b.activeOrders - a.activeOrders;
    });

  const selectedRow = filteredRows.find((r) => String(r.shop.id) === selected) ?? filteredRows[0] ?? null;

  const kpis = {
    total: filteredRows.length,
    risk: filteredRows.filter((r) => r.health === "risk").length,
    attention: filteredRows.filter((r) => r.health === "attention").length,
    inTransit: filteredRows.reduce((s, r) => s + r.inTransit, 0),
  };

  return (
    <div className="stack">
      {/* ── CRM operativo ─────────────────────────────────────────── */}
      <Card className="stack customer-accounts-hero">
        <PageHeader
          eyebrow="Cuentas cliente"
          title="Gestión de clientes y accesos"
          description="Radar operativo de todas tus tiendas más gestión completa de accesos al portal cliente."
        />
        <form className="customer-accounts-toolbar" method="get">
          <SearchInput defaultValue={params.q ?? ""} placeholder="Buscar tienda…" />
          <div className="customer-accounts-toolbar-actions">
            <button className="button" type="submit">Filtrar</button>
          </div>
        </form>
      </Card>

      {/* KPI strip */}
      <div className="crm-kpi-strip">
        <article className="crm-kpi-card">
          <span className="crm-kpi-label">Tiendas</span>
          <span className="crm-kpi-value">{kpis.total}</span>
          <span className="crm-kpi-hint">en la operativa</span>
        </article>
        <article className="crm-kpi-card is-red">
          <span className="crm-kpi-label">En riesgo</span>
          <span className="crm-kpi-value">{kpis.risk}</span>
          <span className="crm-kpi-hint">SLA comprometido</span>
        </article>
        <article className="crm-kpi-card is-orange">
          <span className="crm-kpi-label">Atención</span>
          <span className="crm-kpi-value">{kpis.attention}</span>
          <span className="crm-kpi-hint">revisar urgente</span>
        </article>
        <article className="crm-kpi-card is-sky">
          <span className="crm-kpi-label">En tránsito</span>
          <span className="crm-kpi-value">{kpis.inTransit}</span>
          <span className="crm-kpi-hint">expediciones activas</span>
        </article>
        <article className="crm-kpi-card is-accent">
          <span className="crm-kpi-label">Cuentas portal</span>
          <span className="crm-kpi-value">{clientAccounts.length}</span>
          <span className="crm-kpi-hint">accesos configurados</span>
        </article>
      </div>

      {/* Workbench */}
      {filteredRows.length === 0 ? (
        <Card className="stack">
          <EmptyState title="Sin tiendas" description="No hay tiendas que coincidan con la búsqueda." />
        </Card>
      ) : (
        <section className="customer-accounts-workbench">
          {/* List */}
          <Card className="stack table-card">
            <div className="table-header">
              <div>
                <span className="eyebrow">Radar</span>
                <h3 className="section-title section-title-small">Estado por tienda</h3>
              </div>
              <div className="muted">{filteredRows.length} tiendas</div>
            </div>
            <div className="customer-accounts-list">
              {filteredRows.map((entry) => {
                const health = getHealthMeta(entry.health);
                const href = new URLSearchParams();
                if (params.q) href.set("q", params.q);
                href.set("selected", String(entry.shop.id));
                return (
                  <Link
                    className={`crm-account-row ${selectedRow?.shop.id === entry.shop.id ? "is-active" : ""} ${entry.health === "risk" ? "is-risk" : entry.health === "attention" ? "is-attention" : ""}`}
                    href={`/client-accounts?${href.toString()}`}
                    key={entry.shop.id}
                  >
                    <div className="customer-account-brand">
                      <div className="crm-avatar">{initials(entry.shop.name)}</div>
                      <div>
                        <div className="table-primary">{entry.shop.name}</div>
                        <div className="table-secondary">{entry.shop.slug}</div>
                      </div>
                    </div>
                    <div className="customer-account-health-wrap">
                      <span className={health.className}>{health.emoji} {health.label}</span>
                    </div>
                    <div className="customer-account-mini-metrics">
                      <div><span className="customer-account-mini-label">Activos</span><strong>{entry.activeOrders}</strong></div>
                      <div><span className="customer-account-mini-label">Tránsito</span><strong>{entry.inTransit}</strong></div>
                      <div><span className="customer-account-mini-label">Incid.</span><strong style={{ color: entry.openIncidents > 0 ? "var(--danger)" : "inherit" }}>{entry.openIncidents}</strong></div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </Card>

          {/* Drawer */}
          <div className="crm-drawer">
            {selectedRow ? (
              <>
                <div className="crm-drawer-head">
                  <div className="crm-drawer-avatar">{initials(selectedRow.shop.name)}</div>
                  <div className="crm-drawer-name">{selectedRow.shop.name}</div>
                  <div className="crm-drawer-meta">{selectedRow.shop.slug}</div>
                  <span className={getHealthMeta(selectedRow.health).className}>
                    {getHealthMeta(selectedRow.health).emoji} {getHealthMeta(selectedRow.health).label}
                  </span>
                </div>
                <div className="crm-drawer-stats">
                  <div className="crm-drawer-stat"><span className="crm-stat-label">Activos</span><span className="crm-stat-value">{selectedRow.activeOrders}</span></div>
                  <div className="crm-drawer-stat"><span className="crm-stat-label">Producción</span><span className="crm-stat-value">{selectedRow.inProduction}</span></div>
                  <div className="crm-drawer-stat"><span className="crm-stat-label">Tránsito</span><span className="crm-stat-value">{selectedRow.inTransit}</span></div>
                  <div className="crm-drawer-stat"><span className="crm-stat-label">Incidencias</span><span className="crm-stat-value" style={{ color: selectedRow.openIncidents > 0 ? "var(--danger)" : "inherit" }}>{selectedRow.openIncidents}</span></div>
                </div>
                <div className="crm-drawer-section">
                  <div className="crm-drawer-section-title">Sync Shopify</div>
                  <div className="crm-status-row"><span>Última sync</span><strong>{selectedRow.integration?.last_synced_at ? formatDateTime(selectedRow.integration.last_synced_at) : "Sin sync"}</strong></div>
                  <div className="crm-status-row"><span>Estado</span><strong>{selectedRow.integration?.last_sync_status ?? "—"}</strong></div>
                  {selectedRow.syncAge !== null && (
                    <div className="crm-status-row"><span>Hace</span><strong>{selectedRow.syncAge}h</strong></div>
                  )}
                </div>
                <div className="crm-drawer-actions">
                  <Link className="button" href={`/tenant/${selectedRow.shop.id}/dashboard/overview`}>Ver cuenta completa</Link>
                  <Link className="button button-secondary" href={`/orders?shop_id=${selectedRow.shop.id}`}>Pedidos</Link>
                  <Link className="button button-secondary" href={`/shipments?shop_id=${selectedRow.shop.id}`}>Envíos</Link>
                </div>
              </>
            ) : (
              <div style={{ padding: "32px 22px" }}>
                <EmptyState title="Selecciona una tienda" description="Verás sus métricas y accesos aquí." />
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── Gestión de accesos ────────────────────────────────────── */}
      <div className="client-accounts-divider">
        <span className="eyebrow">Accesos al portal</span>
        <h2 className="section-title">Cuentas de acceso cliente</h2>
        <p className="subtitle">Gestiona quién puede entrar al portal cliente, con qué permisos y qué tiendas puede ver.</p>
      </div>

      <ClientAccountsPanel
        accounts={clientAccounts}
        currentUser={{ id: currentUser.id, role: currentUser.role }}
        shops={shops}
      />
    </div>
  );
}
