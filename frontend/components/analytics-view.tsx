import Link from "next/link";

import { Card } from "@/components/card";
import { KpiCard } from "@/components/kpi-card";
import { PageHeader } from "@/components/page-header";
import { getOrderStatusMeta, getProductionStatusMeta, orderStatusOptions, productionStatusOptions } from "@/lib/format";
import type { AnalyticsBreakdownItem, AnalyticsOverview, Shop } from "@/lib/types";


type AnalyticsViewProps = {
  analytics: AnalyticsOverview;
  shops: Shop[];
  basePath: string;
  title: string;
  description: string;
  eyebrow: string;
  allowShopFilter?: boolean;
  detailBasePath: string;
};


function formatPercent(value: number | null) {
  return value === null ? "n/d" : `${Math.round(value)}%`;
}


function formatHours(value: number | null) {
  return value === null ? "n/d" : `${value.toFixed(value >= 10 ? 0 : 1)}h`;
}


function filterValue(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}


function maxBreakdownValue(items: AnalyticsBreakdownItem[]) {
  return items.reduce((max, item) => Math.max(max, item.value), 0) || 1;
}


export function AnalyticsView({
  analytics,
  shops,
  basePath,
  title,
  description,
  eyebrow,
  allowShopFilter = true,
  detailBasePath,
}: AnalyticsViewProps) {
  const filters = analytics.filters;
  const availableCarriers = analytics.shipping.carrier_performance.map((item) => item.carrier);
  const ordersByDayMax = analytics.charts.orders_by_day.reduce((max, point) => Math.max(max, point.total), 0) || 1;
  const mixMax = maxBreakdownValue(analytics.charts.personalization_mix);
  const statusMax = maxBreakdownValue(analytics.charts.status_distribution);
  const incidentsMax = maxBreakdownValue(analytics.charts.incidents_by_type);
  const shopMax = maxBreakdownValue(analytics.charts.orders_by_shop);
  const carrierMax = maxBreakdownValue(analytics.charts.carrier_performance);

  return (
    <div className="stack">
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        actions={
          <div className="analytics-header-meta">
            <span className="analytics-generated">
              Generado {new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(new Date(analytics.scope.generated_at))}
            </span>
            <span className="tenant-chip">{analytics.scope.shop_count} tiendas</span>
          </div>
        }
      />

      <Card className="stack analytics-filter-card">
        <div className="section-header-inline">
          <div>
            <span className="eyebrow">Filtros</span>
            <h3 className="section-title section-title-small">Lectura operativa</h3>
          </div>
          <div className="table-secondary">Ajusta el enfoque por rango, tienda y flujo.</div>
        </div>

        <form action={basePath} className="analytics-filter-grid" method="get">
          <div className="field">
            <label htmlFor="date_from">Desde</label>
            <input defaultValue={filterValue(filters.date_from)} id="date_from" name="date_from" type="date" />
          </div>
          <div className="field">
            <label htmlFor="date_to">Hasta</label>
            <input defaultValue={filterValue(filters.date_to)} id="date_to" name="date_to" type="date" />
          </div>
          {allowShopFilter ? (
            <div className="field">
              <label htmlFor="shop_id">Tienda</label>
              <select defaultValue={filterValue(filters.shop_id)} id="shop_id" name="shop_id">
                <option value="">Todas</option>
                {shops.map((shop) => (
                  <option key={shop.id} value={shop.id}>
                    {shop.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="channel">Canal</label>
            <select defaultValue={filterValue(filters.channel)} id="channel" name="channel">
              <option value="">Todos</option>
              {analytics.scope.available_channels.map((channel) => (
                <option key={channel} value={channel}>
                  {channel}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="is_personalized">Tipo de pedido</label>
            <select defaultValue={filterValue(filters.is_personalized)} id="is_personalized" name="is_personalized">
              <option value="">Todos</option>
              <option value="true">Personalizados</option>
              <option value="false">Estándar</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="status">Estado</label>
            <select defaultValue={filterValue(filters.status)} id="status" name="status">
              <option value="">Todos</option>
              {orderStatusOptions.map((status) => (
                <option key={status} value={status}>
                  {getOrderStatusMeta(status).label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="production_status">Producción</label>
            <select defaultValue={filterValue(filters.production_status)} id="production_status" name="production_status">
              <option value="">Todos</option>
              {productionStatusOptions.map((status) => (
                <option key={status} value={status}>
                  {getProductionStatusMeta(status).label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="carrier">Carrier</label>
            <select defaultValue={filterValue(filters.carrier)} id="carrier" name="carrier">
              <option value="">Todos</option>
              {availableCarriers.map((carrier) => (
                <option key={carrier} value={carrier}>
                  {carrier}
                </option>
              ))}
            </select>
          </div>
          <div className="analytics-filter-actions">
            <button className="button" type="submit">Aplicar filtros</button>
            <Link className="button button-secondary" href={basePath}>Limpiar</Link>
          </div>
        </form>
      </Card>

      <section className="kpi-grid analytics-kpi-grid">
        <KpiCard label="Pedidos totales" value={String(analytics.kpis.total_orders)} tone="accent" />
        <KpiCard label="Pedidos hoy" value={String(analytics.kpis.orders_today)} />
        <KpiCard label="Esta semana" value={String(analytics.kpis.orders_this_week)} />
        <KpiCard label="Este mes" value={String(analytics.kpis.orders_this_month)} />
        <KpiCard label="Personalizados" value={String(analytics.kpis.personalized_orders)} tone="warning" />
        <KpiCard label="Estándar" value={String(analytics.kpis.standard_orders)} />
        <KpiCard label="En producción" value={String(analytics.kpis.in_production_orders)} tone="warning" />
        <KpiCard label="Enviados" value={String(analytics.kpis.shipped_orders)} tone="success" />
        <KpiCard label="Entregados" value={String(analytics.kpis.delivered_orders)} tone="success" />
        <KpiCard label="Incidencias abiertas" value={String(analytics.kpis.open_incidents)} tone="danger" />
      </section>

      <section className="analytics-grid analytics-grid-three">
        <Card className="stack">
          <div className="section-header-inline">
            <div>
              <span className="eyebrow">Operación</span>
              <h3 className="section-title section-title-small">Métricas operativas</h3>
            </div>
          </div>
          <div className="metric-list">
            <div className="metric-row"><span>Pedido a producción</span><strong>{formatHours(analytics.operational.avg_order_to_production_hours)}</strong></div>
            <div className="metric-row"><span>Producción a envío</span><strong>{formatHours(analytics.operational.avg_production_to_shipping_hours)}</strong></div>
            <div className="metric-row"><span>Envío a entrega</span><strong>{formatHours(analytics.operational.avg_shipping_to_delivery_hours)}</strong></div>
            <div className="metric-row"><span>% enviado en SLA</span><strong>{formatPercent(analytics.operational.sent_in_sla_rate)}</strong></div>
            <div className="metric-row"><span>% entregado en SLA</span><strong>{formatPercent(analytics.operational.delivered_in_sla_rate)}</strong></div>
            <div className="metric-row"><span>Pedidos bloqueados</span><strong>{analytics.operational.blocked_orders}</strong></div>
            <div className="metric-row"><span>Sin shipment</span><strong>{analytics.operational.orders_without_shipment}</strong></div>
            <div className="metric-row"><span>Tracking parado</span><strong>{analytics.operational.stalled_tracking_orders}</strong></div>
            <div className="metric-row"><span>Tasa de incidencias</span><strong>{formatPercent(analytics.operational.incident_rate)}</strong></div>
          </div>
        </Card>

        <Card className="stack">
          <div className="section-header-inline">
            <div>
              <span className="eyebrow">Personalización</span>
              <h3 className="section-title section-title-small">Salud del flujo</h3>
            </div>
          </div>
          <div className="metric-list">
            <div className="metric-row"><span>% personalizados</span><strong>{formatPercent(analytics.personalization.personalized_share)}</strong></div>
            <div className="metric-row"><span>% estándar</span><strong>{formatPercent(analytics.personalization.standard_share)}</strong></div>
            <div className="metric-row"><span>Personalizados hoy</span><strong>{analytics.personalization.personalized_today}</strong></div>
            <div className="metric-row"><span>Personalizados semana</span><strong>{analytics.personalization.personalized_this_week}</strong></div>
            <div className="metric-row"><span>Personalizados mes</span><strong>{analytics.personalization.personalized_this_month}</strong></div>
            <div className="metric-row"><span>Pendientes de assets</span><strong>{analytics.personalization.pending_assets_orders}</strong></div>
            <div className="metric-row"><span>Pendientes de revisión</span><strong>{analytics.personalization.pending_review_orders}</strong></div>
            <div className="metric-row"><span>Con design link</span><strong>{analytics.personalization.design_link_available_orders}</strong></div>
            <div className="metric-row"><span>Personalizados bloqueados</span><strong>{analytics.personalization.personalized_blocked_orders}</strong></div>
            <div className="metric-row"><span>Prep medio personalizados</span><strong>{formatHours(analytics.personalization.avg_personalized_preparation_hours)}</strong></div>
          </div>
        </Card>

        <Card className="stack">
          <div className="section-header-inline">
            <div>
              <span className="eyebrow">Envíos</span>
              <h3 className="section-title section-title-small">Rendimiento logístico</h3>
            </div>
          </div>
          <div className="metric-list">
            <div className="metric-row"><span>En tránsito</span><strong>{analytics.shipping.in_transit_orders}</strong></div>
            <div className="metric-row"><span>Entregados</span><strong>{analytics.shipping.delivered_orders}</strong></div>
            <div className="metric-row"><span>Con excepción</span><strong>{analytics.shipping.exception_orders}</strong></div>
          </div>
          <div className="mini-table">
            {analytics.shipping.carrier_performance.length > 0 ? analytics.shipping.carrier_performance.map((carrier) => (
              <div className="mini-table-row" key={carrier.carrier}>
                <div>
                  <div className="table-primary">{carrier.carrier}</div>
                  <div className="table-secondary">{carrier.shipments} envíos · {carrier.delivered_orders} entregas</div>
                </div>
                <div className="mini-table-metrics">
                  <span>{formatHours(carrier.avg_delivery_hours)}</span>
                  <span>{formatPercent(carrier.incident_rate)}</span>
                </div>
              </div>
            )) : <div className="table-secondary">Sin carriers en el rango actual.</div>}
          </div>
        </Card>
      </section>

      <section className="analytics-grid analytics-grid-two">
        <Card className="stack chart-card">
          <div className="section-header-inline">
            <div>
              <span className="eyebrow">Serie temporal</span>
              <h3 className="section-title section-title-small">Pedidos por día</h3>
            </div>
          </div>
          <div className="bar-chart">
            {analytics.charts.orders_by_day.length > 0 ? analytics.charts.orders_by_day.map((point) => (
              <div className="bar-chart-row" key={point.date}>
                <div className="bar-chart-label">{point.date}</div>
                <div className="bar-chart-track">
                  <div className="bar-chart-fill" style={{ width: `${(point.total / ordersByDayMax) * 100}%` }} />
                </div>
                <div className="bar-chart-value">{point.total}</div>
              </div>
            )) : <div className="table-secondary">Sin datos para el rango seleccionado.</div>}
          </div>
        </Card>

        <Card className="stack chart-card">
          <div className="section-header-inline">
            <div>
              <span className="eyebrow">Mix</span>
              <h3 className="section-title section-title-small">Personalizados vs estándar</h3>
            </div>
          </div>
          <div className="bar-chart">
            {analytics.charts.personalization_mix.map((item) => (
              <div className="bar-chart-row" key={item.label}>
                <div className="bar-chart-label">{item.label}</div>
                <div className="bar-chart-track">
                  <div className="bar-chart-fill bar-chart-fill-soft" style={{ width: `${(item.value / mixMax) * 100}%` }} />
                </div>
                <div className="bar-chart-value">{item.value}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="stack chart-card">
          <div className="section-header-inline">
            <div>
              <span className="eyebrow">Estados</span>
              <h3 className="section-title section-title-small">Distribución actual</h3>
            </div>
          </div>
          <div className="bar-chart">
            {analytics.charts.status_distribution.map((item) => (
              <div className="bar-chart-row" key={item.label}>
                <div className="bar-chart-label">{item.label}</div>
                <div className="bar-chart-track">
                  <div className="bar-chart-fill bar-chart-fill-neutral" style={{ width: `${(item.value / statusMax) * 100}%` }} />
                </div>
                <div className="bar-chart-value">{item.value}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="stack chart-card">
          <div className="section-header-inline">
            <div>
              <span className="eyebrow">Tiendas</span>
              <h3 className="section-title section-title-small">Volumen por tienda</h3>
            </div>
          </div>
          <div className="bar-chart">
            {analytics.charts.orders_by_shop.map((item) => (
              <div className="bar-chart-row" key={item.label}>
                <div className="bar-chart-label">{item.label}</div>
                <div className="bar-chart-track">
                  <div className="bar-chart-fill" style={{ width: `${(item.value / shopMax) * 100}%` }} />
                </div>
                <div className="bar-chart-value">{item.value}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="stack chart-card">
          <div className="section-header-inline">
            <div>
              <span className="eyebrow">Incidencias</span>
              <h3 className="section-title section-title-small">Por tipo</h3>
            </div>
          </div>
          <div className="bar-chart">
            {analytics.charts.incidents_by_type.length > 0 ? analytics.charts.incidents_by_type.map((item) => (
              <div className="bar-chart-row" key={item.label}>
                <div className="bar-chart-label">{item.label}</div>
                <div className="bar-chart-track">
                  <div className="bar-chart-fill bar-chart-fill-danger" style={{ width: `${(item.value / incidentsMax) * 100}%` }} />
                </div>
                <div className="bar-chart-value">{item.value}</div>
              </div>
            )) : <div className="table-secondary">Sin incidencias en el rango actual.</div>}
          </div>
        </Card>

        <Card className="stack chart-card">
          <div className="section-header-inline">
            <div>
              <span className="eyebrow">Carriers</span>
              <h3 className="section-title section-title-small">Rendimiento por carrier</h3>
            </div>
          </div>
          <div className="bar-chart">
            {analytics.charts.carrier_performance.length > 0 ? analytics.charts.carrier_performance.map((item) => (
              <div className="bar-chart-row" key={item.label}>
                <div className="bar-chart-label">{item.label}</div>
                <div className="bar-chart-track">
                  <div className="bar-chart-fill bar-chart-fill-soft" style={{ width: `${(item.value / carrierMax) * 100}%` }} />
                </div>
                <div className="bar-chart-value">{item.value}</div>
              </div>
            )) : <div className="table-secondary">Sin envíos para comparar carriers.</div>}
          </div>
        </Card>
      </section>

      <section className="analytics-grid analytics-grid-two">
        <Card className="stack table-card">
          <div className="table-header">
            <div>
              <span className="eyebrow">Ranking</span>
              <h3 className="section-title section-title-small">Top tiendas por volumen</h3>
            </div>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Tienda</th>
                  <th>Pedidos</th>
                  <th>Personalizados</th>
                  <th>Entregados</th>
                </tr>
              </thead>
              <tbody>
                {analytics.rankings.top_shops.map((shop) => (
                  <tr className="table-row" key={shop.shop_id}>
                    <td className="table-primary">{shop.shop_name}</td>
                    <td>{shop.orders}</td>
                    <td>{shop.personalized_orders}</td>
                    <td>{shop.delivered_orders}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="stack table-card">
          <div className="table-header">
            <div>
              <span className="eyebrow">SKU mix</span>
              <h3 className="section-title section-title-small">Top SKUs</h3>
            </div>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Nombre</th>
                  <th>Qty</th>
                  <th>Pedidos</th>
                </tr>
              </thead>
              <tbody>
                {analytics.rankings.top_skus.map((item) => (
                  <tr className="table-row" key={`${item.sku}-${item.name}`}>
                    <td className="table-primary">{item.sku}</td>
                    <td>{item.name}</td>
                    <td>{item.quantity}</td>
                    <td>{item.orders}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="stack table-card">
          <div className="table-header">
            <div>
              <span className="eyebrow">Incidencias</span>
              <h3 className="section-title section-title-small">Top incidencias</h3>
            </div>
          </div>
          <div className="mini-table">
            {analytics.rankings.top_incidents.length > 0 ? analytics.rankings.top_incidents.map((item) => (
              <div className="mini-table-row" key={item.label}>
                <div>
                  <div className="table-primary">{item.label}</div>
                  <div className="table-secondary">{formatPercent(item.percentage)} del total</div>
                </div>
                <div className="table-primary">{item.value}</div>
              </div>
            )) : <div className="table-secondary">Sin incidencias para destacar.</div>}
          </div>
        </Card>

        <Card className="stack table-card">
          <div className="table-header">
            <div>
              <span className="eyebrow">Atascos</span>
              <h3 className="section-title section-title-small">Pedidos más retrasados</h3>
            </div>
          </div>
          <div className="mini-table">
            {analytics.rankings.delayed_orders.length > 0 ? analytics.rankings.delayed_orders.map((order) => (
              <Link className="mini-table-row mini-table-row-link" href={`${detailBasePath}/${order.order_id}`} key={order.order_id}>
                <div>
                  <div className="table-primary">{order.external_id}</div>
                  <div className="table-secondary">{order.shop_name} · {order.customer_name}</div>
                  <div className="table-secondary">{order.reason}</div>
                </div>
                <div className="mini-table-metrics">
                  <span>{order.age_hours.toFixed(0)}h</span>
                  <span>{order.status}</span>
                </div>
              </Link>
            )) : <div className="table-secondary">No hay pedidos especialmente retrasados en el rango actual.</div>}
          </div>
        </Card>
      </section>
    </div>
  );
}
