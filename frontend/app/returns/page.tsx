import Link from "next/link";

import { Card } from "@/components/card";
import { KpiCard } from "@/components/kpi-card";
import { ReturnsWorkbench } from "@/components/returns-workbench";
import { fetchReturns, fetchShops } from "@/lib/api";
import { requireAdminUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";

type AdminReturnsPageProps = {
  searchParams: Promise<{
    shop_id?: string;
    status?: string;
  }>;
};

const STATUS_META: Record<string, { label: string; className: string }> = {
  requested: { label: "Solicitada", className: "badge badge-status badge-status-pending" },
  approved: { label: "Aprobada", className: "badge badge-status badge-status-in-progress" },
  in_transit: { label: "En tránsito", className: "badge badge-status badge-status-in-transit" },
  received: { label: "Recibida", className: "badge badge-status badge-status-delivered" },
  closed: { label: "Cerrada", className: "badge badge-status badge-status-delivered" },
  rejected: { label: "Rechazada", className: "badge badge-status badge-status-exception" },
};

const REASON_LABELS: Record<string, string> = {
  damaged: "💔 Producto dañado",
  wrong_product: "❌ Producto incorrecto",
  not_delivered: "📭 No entregado",
  address_issue: "📍 Problema de dirección",
  personalization_error: "🎨 Error de personalización",
  changed_mind: "💭 Cambio de opinión",
  other: "📝 Otro motivo",
};

export default async function AdminReturnsPage({ searchParams }: AdminReturnsPageProps) {
  await requireAdminUser();
  const params = await searchParams;

  const [shopsResult, returnsResult] = await Promise.allSettled([
    fetchShops(),
    fetchReturns({ shop_id: params.shop_id, status: params.status, page: 1, per_page: 250 }),
  ]);
  const shops = shopsResult.status === "fulfilled" ? shopsResult.value : [];
  const returns = returnsResult.status === "fulfilled" ? returnsResult.value : [];
  const hasPartialDataError = shopsResult.status === "rejected" || returnsResult.status === "rejected";

  const requested = returns.filter((r) => r.status === "requested").length;
  const approved = returns.filter((r) => r.status === "approved").length;
  const inTransit = returns.filter((r) => r.status === "in_transit").length;
  const received = returns.filter((r) => r.status === "received").length;
  const closed = returns.filter((r) => r.status === "closed").length;
  const rejected = returns.filter((r) => r.status === "rejected").length;
  const active = requested + approved + inTransit;
  const withoutTracking = returns.filter((ret) => (ret.status === "approved" || ret.status === "in_transit") && !ret.tracking_number).length;
  const personalizationCases = returns.filter((ret) => ret.reason === "personalization_error").length;
  const latestUpdatedAt =
    returns
      .map((ret) => ret.updated_at)
      .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null;
  const shopMap = new Map(shops.map((shop) => [shop.id, shop.name]));
  const shopMapObj = Object.fromEntries(shopMap) as Record<number, string>;
  const reasonRows = Object.entries(REASON_LABELS)
    .map(([key, label]) => ({
      key,
      label,
      count: returns.filter((ret) => ret.reason === key).length,
    }))
    .filter((item) => item.count > 0)
    .sort((left, right) => right.count - left.count)
    .slice(0, 5);

  const statusFilters = [
    { value: "", label: "Todas" },
    { value: "requested", label: "Solicitadas" },
    { value: "approved", label: "Aprobadas" },
    { value: "in_transit", label: "En tránsito" },
    { value: "received", label: "Recibidas" },
    { value: "closed", label: "Cerradas" },
    { value: "rejected", label: "Rechazadas" },
  ];

  return (
    <div className="stack">
      {/* Hero */}
      <section className="admin-dashboard-hero">
        <div className="admin-dashboard-hero-copy">
          <span className="eyebrow">🔄 Gestión</span>
          <h1 className="admin-dashboard-title">Devoluciones</h1>
          <p className="admin-dashboard-subtitle">
            Controla solicitudes abiertas, seguimientos de devolución y cierres desde una única vista operativa.
          </p>
        </div>
        <div className="admin-dashboard-hero-actions">
          <Link className="button button-secondary" href="/orders">
            Ver pedidos
          </Link>
          <Link className="button button-secondary" href="/incidencias">
            Ver incidencias
          </Link>
        </div>
      </section>

      <Card className="stack portal-orders-toolbar-card" style={{ gap: 0 }}>
        {hasPartialDataError ? (
          <div className="feedback feedback-info">
            Parte de los datos no se pudieron cargar. Mostramos la información disponible.
          </div>
        ) : null}
        <div className="portal-dashboard-section-head">
          <div>
            <span className="eyebrow">🔎 Filtros</span>
            <h3 className="section-title section-title-small">Ajusta la cola de devoluciones</h3>
            <p className="subtitle">Filtra por tienda y estado para priorizar revisión, tracking y cierre.</p>
          </div>
        </div>

        <form className="returns-admin-toolbar" method="get">
          <div className="field">
            <label htmlFor="shop_id_ret">Tienda</label>
            <select defaultValue={params.shop_id ?? ""} id="shop_id_ret" name="shop_id">
              <option value="">Todas las tiendas</option>
              {shops.map((shop) => (
                <option key={shop.id} value={shop.id}>{shop.name}</option>
              ))}
            </select>
          </div>
          <input name="status" type="hidden" value={params.status ?? ""} />
          <button className="button button-secondary" type="submit">Aplicar</button>
        </form>
        <div className="shipments-control-pills returns-admin-pills">
          {statusFilters.map((f) => {
            const href = `?status=${f.value}${params.shop_id ? `&shop_id=${params.shop_id}` : ""}`;
            const isActive = (params.status ?? "") === f.value;
            return (
              <Link
                className={`shipments-control-pill${isActive ? " is-active" : ""}`}
                href={`/returns${href}`}
                key={f.value}
              >
                {f.label}
              </Link>
            );
          })}
        </div>
      </Card>

      <section className="reporting-kpis">
        <KpiCard label="🔄 Activas" value={String(active)} delta="solicitadas + aprobadas + en tránsito" tone="warning" />
        <KpiCard label="📩 Solicitadas" value={String(requested)} delta="esperando revisión" tone="default" />
        <KpiCard label="🚚 En tránsito" value={String(inTransit)} delta="en camino" tone="accent" />
        <KpiCard label="📥 Recibidas" value={String(received)} delta="en almacén" tone="success" />
        <KpiCard label="🔍 Sin tracking" value={String(withoutTracking)} delta="requieren atención" tone="danger" />
        <KpiCard label="🎨 Personalización" value={String(personalizationCases)} delta="casos por error de diseño" tone="warning" />
      </section>

      <section className="returns-admin-layout">
        <Card className="stack returns-admin-main-card">
          <div className="table-header returns-admin-table-header">
            <div>
              <span className="eyebrow">📋 Cola operativa</span>
              <h3 className="section-title section-title-small">
                {returns.length} {params.status ? `con estado "${STATUS_META[params.status]?.label ?? params.status}"` : "devoluciones visibles"}
              </h3>
            </div>
            <div className="returns-admin-summary-chip">
              <span>Última actividad</span>
              <strong>{latestUpdatedAt ? formatDateTime(latestUpdatedAt) : "Sin datos"}</strong>
            </div>
          </div>

          <ReturnsWorkbench
            returns={returns}
            shopMap={shopMapObj}
            statusFilter={params.status ?? ""}
          />
        </Card>

        <div className="returns-admin-side">
          <Card className="stack">
            <div className="portal-dashboard-section-head">
              <div>
                <span className="eyebrow">📊 Mix de motivos</span>
                <h3 className="section-title section-title-small">Qué está generando más devoluciones</h3>
              </div>
            </div>
            <div className="returns-admin-breakdown">
              {reasonRows.length > 0 ? (
                reasonRows.map((item) => (
                  <div className="returns-admin-breakdown-row" key={item.key}>
                    <span>{item.label}</span>
                    <strong>{item.count}</strong>
                  </div>
                ))
              ) : (
                <div className="table-secondary">Todavía no hay motivos suficientes para desglosar.</div>
              )}
            </div>
          </Card>

          <Card className="stack">
            <div className="portal-dashboard-section-head">
              <div>
                <span className="eyebrow">🔄 Flujo</span>
                <h3 className="section-title section-title-small">Estado de la cola</h3>
              </div>
            </div>
            <div className="returns-admin-flow-grid">
              <div className="returns-admin-flow-item">
                <span>Pendientes</span>
                <strong>{requested}</strong>
              </div>
              <div className="returns-admin-flow-item">
                <span>Aprobadas</span>
                <strong>{approved}</strong>
              </div>
              <div className="returns-admin-flow-item">
                <span>En tránsito</span>
                <strong>{inTransit}</strong>
              </div>
              <div className="returns-admin-flow-item">
                <span>Recibidas</span>
                <strong>{received}</strong>
              </div>
              <div className="returns-admin-flow-item">
                <span>Cerradas</span>
                <strong>{closed}</strong>
              </div>
              <div className="returns-admin-flow-item">
                <span>Rechazadas</span>
                <strong>{rejected}</strong>
              </div>
            </div>
          </Card>
        </div>
      </section>
    </div>
  );
}
