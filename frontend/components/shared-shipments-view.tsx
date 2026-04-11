import Link from "next/link";
import type { ReactNode } from "react";

import { EmptyState } from "@/components/empty-state";
import { ShipmentDonut, type ShipmentSegment } from "@/components/shipment-donut";
import { formatDateTime } from "@/lib/format";
import type {
  AnalyticsAttentionShipment,
  AnalyticsBreakdownItem,
  AnalyticsOverview,
  AnalyticsShippingPerformancePoint,
  Shop,
  ShopIntegration,
} from "@/lib/types";

export type ShipmentQuickFilter =
  | "all"
  | "without_shipment"
  | "without_tracking"
  | "pending"
  | "in_transit"
  | "delivered"
  | "incident"
  | "stalled";

export type ShipmentPeriod = "7d" | "30d" | "ytd" | "custom";

type SharedShipmentsViewProps = {
  basePath: string;
  title: string;
  subtitle: string;
  heroEyebrow?: string;
  shops: Shop[];
  integrations: ShopIntegration[];
  analytics: AnalyticsOverview | null;
  selectedShopId?: string;
  selectedShippingStatus?: string;
  period: ShipmentPeriod;
  dateFrom: string;
  dateTo: string;
  allowAllShops?: boolean;
  syncSlot?: ReactNode;
  syncHint?: string;
  shopFieldHelp?: string;
};

type TrendChartProps = {
  points: AnalyticsShippingPerformancePoint[];
  valueKey: "on_time_delivery_rate" | "avg_transit_hours" | "avg_total_hours";
  tone: "blue" | "green" | "red";
  label: string;
  eyebrow: string;
  valueFormatter?: (value: number | null) => string;
};

type DualBarChartProps = {
  points: AnalyticsShippingPerformancePoint[];
};

type CompatibleAttention = {
  tracking_stalled: number;
  without_shipment: number;
  without_tracking: number;
  carrier_exception: number;
  outside_sla: number;
  prepared_not_collected: number;
};

const STATUS_META: Record<
  string,
  { label: string; icon: string; tone: ShipmentSegment["tone"]; note: string }
> = {
  pending:           { label: "Pendiente",    icon: "📦", tone: "slate",  note: "Sin etiqueta" },
  prepared:          { label: "Preparado",    icon: "✅", tone: "indigo", note: "Pendiente recogida" },
  picked_up:         { label: "Recogido",     icon: "🚚", tone: "blue",   note: "Primer escaneo" },
  in_transit:        { label: "En tránsito",  icon: "🛣️", tone: "sky",    note: "Red activa" },
  out_for_delivery:  { label: "En reparto",   icon: "📬", tone: "orange", note: "Última milla" },
  delivered:         { label: "Entregado",    icon: "🎯", tone: "green",  note: "Ciclo cerrado" },
  exception:         { label: "Incidencia",   icon: "⚠️", tone: "red",    note: "Requiere acción" },
  stalled:           { label: "Atascado",     icon: "💤", tone: "slate",  note: "Sin movimiento" },
};

const ATTENTION_META: Array<{
  key: keyof CompatibleAttention;
  icon: string;
  label: string;
  note: string;
  tone: "red" | "orange" | "slate" | "yellow";
}> = [
  { key: "tracking_stalled",       icon: "💤", label: "Tracking parado",      note: "Sin actualización reciente",  tone: "orange" },
  { key: "without_shipment",       icon: "📦", label: "Sin envío",             note: "Pedido sin etiqueta",         tone: "slate"  },
  { key: "without_tracking",       icon: "📡", label: "Sin tracking",          note: "Sin señal del carrier",       tone: "slate"  },
  { key: "carrier_exception",      icon: "⚠️", label: "Excepción carrier",     note: "Desvíos o eventos anómalos",  tone: "red"    },
  { key: "outside_sla",            icon: "⏱️", label: "Fuera de SLA",          note: "Por encima del objetivo",     tone: "orange" },
  { key: "prepared_not_collected", icon: "🧾", label: "Preparado sin recoger", note: "Etiqueta sin escaneo",        tone: "yellow" },
];

/* ── Helpers ──────────────────────────────────────────────────────── */

function toDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function getDefaultShipmentDateRange() {
  return getShipmentDateRange("7d");
}

export function getShipmentDateRange(period: ShipmentPeriod, today = new Date()) {
  const end = new Date(today);
  const start = new Date(today);
  if (period === "30d") start.setDate(end.getDate() - 29);
  else if (period === "ytd") start.setMonth(0, 1);
  else start.setDate(end.getDate() - 6);
  return { dateFrom: toDateInputValue(start), dateTo: toDateInputValue(end) };
}

function getRangeShortcuts(dateTo: string) {
  const end = new Date(`${dateTo}T23:59:59`);
  const yearStart = new Date(end);
  yearStart.setMonth(0, 1);
  return [
    { label: "7 días",      value: "7d"     as ShipmentPeriod, ...getShipmentDateRange("7d", end) },
    { label: "30 días",     value: "30d"    as ShipmentPeriod, ...getShipmentDateRange("30d", end) },
    { label: "Este año",    value: "ytd"    as ShipmentPeriod, dateFrom: toDateInputValue(yearStart), dateTo: toDateInputValue(end) },
    { label: "Custom",      value: "custom" as ShipmentPeriod, dateFrom: "", dateTo: "" },
  ];
}

function buildQuery(params: Record<string, string | number | null | undefined>) {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  });
  const q = sp.toString();
  return q ? `?${q}` : "";
}

function formatHoursAsShort(value: number | null) {
  if (value === null || Number.isNaN(value)) return "—";
  if (value >= 48) return `${Math.round(value / 24)}d`;
  return `${Math.round(value)}h`;
}

function formatDaysAsReadableFromHours(value: number | null) {
  if (value === null || Number.isNaN(value)) return "—";
  if (value < 24) return `${Math.round(value)}h`;
  return `${(value / 24).toFixed(1).replace(".", ",")}d`;
}

function formatPercent(value: number | null) {
  if (value === null || Number.isNaN(value)) return "—";
  return `${Math.round(value)}%`;
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short" }).format(
    new Date(`${value}T12:00:00`),
  );
}

function formatCompactDateTime(value: string | null) {
  if (!value) return "Sin evento";
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  }).format(new Date(value));
}

function formatCount(value: number) {
  return new Intl.NumberFormat("es-ES").format(value);
}

function mapShippingStatusItem(item: AnalyticsBreakdownItem): ShipmentSegment | null {
  const meta = STATUS_META[item.label.toLowerCase()];
  if (!meta) return null;
  return { key: item.label.toLowerCase(), label: meta.label, value: item.value, tone: meta.tone };
}

function normalizeAnalyticsOverview(analytics: AnalyticsOverview) {
  const operational = {
    ...analytics.operational,
    orders_without_tracking:
      analytics.operational.orders_without_tracking ?? analytics.shipping.without_tracking_orders ?? 0,
    prepared_not_collected_orders: analytics.operational.prepared_not_collected_orders ?? 0,
    outside_sla_orders: analytics.operational.outside_sla_orders ?? 0,
  };
  const shipping = {
    ...analytics.shipping,
    pending_orders:           analytics.shipping.pending_orders           ?? analytics.operational.orders_without_shipment,
    prepared_orders:          analytics.shipping.prepared_orders          ?? analytics.flow.orders_prepared,
    picked_up_orders:         analytics.shipping.picked_up_orders         ?? 0,
    out_for_delivery_orders:  analytics.shipping.out_for_delivery_orders  ?? 0,
    stalled_orders:           analytics.shipping.stalled_orders           ?? analytics.operational.stalled_tracking_orders,
    without_tracking_orders:  analytics.shipping.without_tracking_orders  ?? operational.orders_without_tracking,
    avg_transit_hours:        analytics.shipping.avg_transit_hours        ?? analytics.flow.avg_transit_to_delivery_hours ?? null,
    avg_order_to_delivery_hours: analytics.shipping.avg_order_to_delivery_hours ?? analytics.flow.avg_total_hours ?? null,
  };
  const flow = {
    ...analytics.flow,
    orders_picked_up:                   analytics.flow.orders_picked_up               ?? 0,
    orders_out_for_delivery:            analytics.flow.orders_out_for_delivery         ?? 0,
    avg_order_to_prepared_hours:        analytics.flow.avg_order_to_prepared_hours     ?? analytics.flow.avg_order_to_label_hours       ?? null,
    avg_prepared_to_picked_up_hours:    analytics.flow.avg_prepared_to_picked_up_hours ?? analytics.flow.avg_label_to_transit_hours     ?? null,
    avg_picked_up_to_delivered_hours:   analytics.flow.avg_picked_up_to_delivered_hours ?? analytics.flow.avg_transit_to_delivery_hours ?? null,
    avg_order_to_delivered_hours:       analytics.flow.avg_order_to_delivered_hours    ?? analytics.flow.avg_total_hours                ?? null,
  };
  const attention: CompatibleAttention = {
    tracking_stalled:        analytics.attention?.tracking_stalled        ?? analytics.operational.stalled_tracking_orders ?? 0,
    without_shipment:        analytics.attention?.without_shipment        ?? analytics.operational.orders_without_shipment  ?? 0,
    without_tracking:        analytics.attention?.without_tracking        ?? analytics.operational.orders_without_tracking  ?? analytics.shipping.without_tracking_orders ?? 0,
    carrier_exception:       analytics.attention?.carrier_exception       ?? analytics.shipping.exception_orders            ?? 0,
    outside_sla:             analytics.attention?.outside_sla             ?? analytics.operational.outside_sla_orders       ?? 0,
    prepared_not_collected:  analytics.attention?.prepared_not_collected  ?? analytics.operational.prepared_not_collected_orders ?? 0,
  };
  const shippingStatusDistribution =
    analytics.shipping_status_distribution?.length
      ? analytics.shipping_status_distribution
      : [
          { label: "pending",           value: Math.max(shipping.pending_orders ?? 0, analytics.operational.orders_without_shipment ?? 0), percentage: null },
          { label: "prepared",          value: Math.max((shipping.prepared_orders ?? 0) - (shipping.picked_up_orders ?? 0), 0), percentage: null },
          { label: "picked_up",         value: shipping.picked_up_orders ?? 0, percentage: null },
          { label: "in_transit",        value: shipping.in_transit_orders ?? 0, percentage: null },
          { label: "out_for_delivery",  value: shipping.out_for_delivery_orders ?? 0, percentage: null },
          { label: "delivered",         value: shipping.delivered_orders ?? 0, percentage: null },
          { label: "exception",         value: shipping.exception_orders ?? 0, percentage: null },
        ].filter((item) => item.value > 0);
  const shippingPerformanceByDay =
    analytics.shipping_performance_by_day?.length
      ? analytics.shipping_performance_by_day
      : (analytics.charts.orders_by_day ?? []).map((point) => ({
          date: point.date,
          created_shipments: point.total,
          delivered_orders: point.delivered ?? 0,
          exception_orders: point.exception ?? 0,
          on_time_delivery_rate: null,
          avg_transit_hours: null,
          avg_total_hours: null,
        }));
  return {
    operational,
    shipping,
    flow,
    attention,
    shippingStatusDistribution,
    shippingPerformanceByDay,
    attentionShipments: analytics.rankings.attention_shipments ?? [],
  };
}

/* ── Charts ───────────────────────────────────────────────────────── */

function buildLinePath(values: Array<number | null>, width = 280, height = 72) {
  const filtered = values.filter((v): v is number => v !== null && !Number.isNaN(v));
  if (filtered.length === 0) return "";
  const max = Math.max(...filtered, 1);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  return values
    .map((v, i) => {
      const sv = v ?? 0;
      const x = i * step;
      const y = height - (sv / max) * height * 0.9;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function MiniTrendChart({ points, valueKey, tone, label, eyebrow, valueFormatter = formatPercent }: TrendChartProps) {
  const values = points.map((p) => p[valueKey]);
  const latest = values.at(-1) ?? null;
  const path = buildLinePath(values);
  const colorMap = { blue: "#3b82f6", green: "#10b981", red: "#ef4444" };
  const softMap  = { blue: "#eff6ff", green: "#f0fdf4", red: "#fef2f2" };
  const color = colorMap[tone];
  const soft  = softMap[tone];
  return (
    <div className="exp-mini-chart">
      <div className="exp-mini-chart-head">
        <span className="exp-mini-eyebrow">{eyebrow}</span>
        <strong className="exp-mini-value" style={{ color }}>{valueFormatter(latest)}</strong>
      </div>
      <p className="exp-mini-label">{label}</p>
      <div className="exp-mini-svg-wrap" style={{ background: soft }}>
        <svg aria-hidden="true" viewBox="0 0 280 72" preserveAspectRatio="none" width="100%" height="72">
          {path ? (
            <>
              <path d={`${path} L 280 72 L 0 72 Z`} fill={color} fillOpacity="0.12" stroke="none" />
              <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </>
          ) : (
            <text x="140" y="40" textAnchor="middle" fill="#9ca3af" fontSize="12">Sin datos</text>
          )}
        </svg>
      </div>
      <div className="exp-mini-axis">
        {points.slice(-4).map((p) => (
          <span key={`${valueKey}-${p.date}`}>{formatShortDate(p.date)}</span>
        ))}
      </div>
    </div>
  );
}

function DailyBarsChart({ points }: DualBarChartProps) {
  const max = Math.max(...points.map((p) => p.created_shipments), 1);
  return (
    <div className="exp-mini-chart">
      <div className="exp-mini-chart-head">
        <span className="exp-mini-eyebrow">Volumen</span>
        <strong className="exp-mini-value" style={{ color: "#ef4444" }}>
          {formatCount(points.reduce((s, p) => s + p.created_shipments, 0))}
        </strong>
      </div>
      <p className="exp-mini-label">Expediciones por día</p>
      <div className="exp-mini-bars-wrap">
        {points.slice(-14).map((p) => (
          <div className="exp-mini-bar-col" key={`day-${p.date}`}>
            <div
              className="exp-mini-bar"
              style={{ height: `${Math.max(p.created_shipments > 0 ? 8 : 2, (p.created_shipments / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="exp-mini-axis">
        {points.slice(-4).map((p) => <span key={`ax-${p.date}`}>{formatShortDate(p.date)}</span>)}
      </div>
    </div>
  );
}

function DualBarsChart({ points }: DualBarChartProps) {
  const max = Math.max(...points.flatMap((p) => [p.delivered_orders, p.exception_orders]), 1);
  return (
    <div className="exp-mini-chart">
      <div className="exp-mini-chart-head">
        <span className="exp-mini-eyebrow">Calidad</span>
        <strong className="exp-mini-value" style={{ color: "#10b981" }}>
          {formatCount(points.reduce((s, p) => s + p.delivered_orders, 0))}
        </strong>
      </div>
      <p className="exp-mini-label">Entregadas vs incidencias</p>
      <div className="exp-mini-bars-wrap is-dual">
        {points.slice(-14).map((p) => (
          <div className="exp-mini-bar-col" key={`dual-${p.date}`}>
            <div className="exp-mini-bar is-green"
              style={{ height: `${Math.max(p.delivered_orders > 0 ? 6 : 2, (p.delivered_orders / max) * 100)}%` }} />
            <div className="exp-mini-bar is-red"
              style={{ height: `${Math.max(p.exception_orders > 0 ? 6 : 1, (p.exception_orders / max) * 60)}%` }} />
          </div>
        ))}
      </div>
      <div className="exp-mini-axis">
        {points.slice(-4).map((p) => <span key={`dax-${p.date}`}>{formatShortDate(p.date)}</span>)}
      </div>
    </div>
  );
}

function getStageBadgeModifier(stage: string) {
  const tone = STATUS_META[stage]?.tone ?? "slate";
  return `is-${tone}`;
}

/* ── Main component ───────────────────────────────────────────────── */

export function SharedShipmentsView({
  basePath,
  title,
  subtitle,
  heroEyebrow = "Expediciones",
  shops,
  integrations,
  analytics,
  selectedShopId = "",
  selectedShippingStatus = "all",
  period,
  dateFrom,
  dateTo,
  allowAllShops = false,
  syncSlot,
  syncHint = "Selecciona una tienda.",
  shopFieldHelp,
}: SharedShipmentsViewProps) {
  const orderBasePath = basePath.startsWith("/portal") ? "/portal/orders" : "/orders";
  const selectedIntegration =
    (selectedShopId
      ? integrations.find((i) => String(i.shop_id) === selectedShopId) ?? null
      : null) ??
    integrations
      .filter((i) => i.last_synced_at)
      .sort((a, b) => new Date(b.last_synced_at ?? 0).getTime() - new Date(a.last_synced_at ?? 0).getTime())[0] ??
    null;
  const rangeShortcuts = getRangeShortcuts(dateTo);
  const isCustomPeriod = period === "custom";

  /* Empty state */
  if (!analytics || analytics.kpis.total_orders === 0) {
    return (
      <div className="exp-page">
        <div className="exp-header card">
          <div className="exp-header-top">
            <div className="exp-header-copy">
              <span className="eyebrow">{heroEyebrow}</span>
              <h1 className="exp-page-title">{title}</h1>
            </div>
          </div>
          <form action={basePath} className="exp-toolbar" method="get">
            <input name="period" type="hidden" value={period} />
            {selectedShippingStatus !== "all" ? (
              <input name="shipping_status" type="hidden" value={selectedShippingStatus} />
            ) : null}
            <div className="field">
              <label htmlFor={`${basePath}-shop_id`}>Tienda</label>
              <select defaultValue={selectedShopId} id={`${basePath}-shop_id`} name="shop_id">
                {allowAllShops ? <option value="">Todas</option> : null}
                {shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <button className="button" type="submit">Aplicar</button>
          </form>
        </div>
        <EmptyState
          title="Sin expediciones en este rango"
          description="Ajusta tienda o periodo para ver la control tower logística."
        />
      </div>
    );
  }

  /* Data */
  const normalized       = normalizeAnalyticsOverview(analytics);
  const operational      = normalized.operational;
  const shipping         = normalized.shipping;
  const flow             = normalized.flow;
  const attention        = normalized.attention;
  const totalOrders      = analytics.kpis.total_orders;
  const shipmentsCreated = Math.max(0, totalOrders - operational.orders_without_shipment);
  const performancePoints = normalized.shippingPerformanceByDay.slice(-14);
  const attentionRows    = normalized.attentionShipments;
  const aging            = operational.aging_buckets ?? { bucket_0_24: 0, bucket_24_48: 0, bucket_48_72: 0, bucket_72_plus: 0 };
  const agingTotal       = Math.max(aging.bucket_0_24 + aging.bucket_24_48 + aging.bucket_48_72 + aging.bucket_72_plus, 1);

  const shippingStatusSegments = normalized.shippingStatusDistribution
    .map(mapShippingStatusItem)
    .filter((s): s is ShipmentSegment => s !== null && s.value > 0);

  const totalAttentionCount = Object.values(attention).reduce((a, b) => a + b, 0);

  /* ── Derived metrics ── */
  const criticalCount =
    (attention.carrier_exception ?? 0) +
    (attention.outside_sla ?? 0) +
    (attention.tracking_stalled ?? 0);

  const lastMileTotal = Math.max(
    1,
    (shipping.in_transit_orders ?? 0) +
    (shipping.out_for_delivery_orders ?? 0) +
    (shipping.delivered_orders ?? 0) +
    (shipping.exception_orders ?? 0),
  );

  const carrierData = analytics.shipping.carrier_performance ?? [];

  /* ── Render ── */
  return (
    <div className="exp-page">

      {/* ── Critical alert banner ───────────────────────────────── */}
      {criticalCount > 0 && (
        <div className={`exp-alert-banner${criticalCount >= 10 ? " is-critical" : " is-warning"}`}>
          <span className="exp-alert-banner-icon">{criticalCount >= 10 ? "🚨" : "⚠️"}</span>
          <div className="exp-alert-banner-content">
            <strong>{criticalCount} expedición{criticalCount !== 1 ? "es" : ""} requieren acción inmediata</strong>
            <span>
              {attention.carrier_exception > 0 && `${attention.carrier_exception} excepciones carrier`}
              {attention.outside_sla > 0 && `${attention.carrier_exception > 0 ? " · " : ""}${attention.outside_sla} fuera de SLA`}
              {attention.tracking_stalled > 0 && `${(attention.carrier_exception > 0 || attention.outside_sla > 0) ? " · " : ""}${attention.tracking_stalled} tracking parado`}
            </span>
          </div>
          <a className="exp-alert-banner-cta" href="#attention-table">Ver cola operativa →</a>
        </div>
      )}

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="exp-header card">
        <div className="exp-header-top">
          <div className="exp-header-copy">
            <span className="eyebrow">{heroEyebrow}</span>
            <h1 className="exp-page-title">{title}</h1>
            <p className="exp-page-subtitle">{subtitle}</p>
          </div>

          <div className="exp-header-right">
            {/* Period pills */}
            <div className="exp-period-pills">
              {rangeShortcuts.map((sc) => {
                const href = buildQuery({
                  shop_id: selectedShopId,
                  shipping_status: selectedShippingStatus === "all" ? undefined : selectedShippingStatus,
                  period: sc.value,
                  date_from: sc.dateFrom || undefined,
                  date_to: sc.dateTo || undefined,
                });
                return (
                  <Link
                    className={`exp-period-pill${sc.value === period ? " is-active" : ""}`}
                    href={`${basePath}${href}`}
                    key={sc.label}
                  >
                    {sc.label}
                  </Link>
                );
              })}
            </div>

            {/* Sync info */}
            <div className="exp-sync-info">
              <span className="exp-sync-dot" />
              <span>
                {selectedIntegration?.last_synced_at
                  ? `Sincronizado ${formatDateTime(selectedIntegration.last_synced_at)}`
                  : "Sin sincronizar"}
              </span>
              {syncSlot ?? null}
            </div>
          </div>
        </div>

        {/* Toolbar */}
        <form action={basePath} className="exp-toolbar" method="get">
          <input name="period" type="hidden" value={period} />
          <div className="field">
            <label htmlFor={`${basePath}-shipping_status`}>Estado envío</label>
            <select
              defaultValue={selectedShippingStatus}
              id={`${basePath}-shipping_status`}
              name="shipping_status"
            >
              <option value="all">Todos</option>
              <option value="picked_up">Recogido</option>
              <option value="in_transit">En tránsito</option>
              <option value="out_for_delivery">En reparto</option>
              <option value="delivered">Entregado</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${basePath}-shop_id`}>Cuenta</label>
            <select defaultValue={selectedShopId} id={`${basePath}-shop_id`} name="shop_id">
              {allowAllShops ? <option value="">Todas las tiendas</option> : null}
              {shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {shopFieldHelp ? <small className="field-hint">{shopFieldHelp}</small> : null}
          </div>
          {isCustomPeriod ? (
            <>
              <div className="field">
                <label htmlFor={`${basePath}-date_from`}>Desde</label>
                <input defaultValue={dateFrom} id={`${basePath}-date_from`} name="date_from" type="date" />
              </div>
              <div className="field">
                <label htmlFor={`${basePath}-date_to`}>Hasta</label>
                <input defaultValue={dateTo} id={`${basePath}-date_to`} name="date_to" type="date" />
              </div>
              <button className="button" type="submit">Aplicar rango</button>
            </>
          ) : (
            <>
              <input name="date_from" type="hidden" value={dateFrom} />
              <input name="date_to" type="hidden" value={dateTo} />
              <button className="button" type="submit">Actualizar</button>
            </>
          )}
        </form>
      </div>

      {/* ── KPI Strip ──────────────────────────────────────────── */}
      <div className="exp-kpi-strip">
        <article className="exp-kpi-card is-accent">
          <span className="exp-kpi-label">Expediciones creadas</span>
          <strong className="exp-kpi-value">{formatCount(shipmentsCreated)}</strong>
          <small className="exp-kpi-hint">etiquetas emitidas</small>
        </article>
        <article className="exp-kpi-card is-green">
          <span className="exp-kpi-label">Entregadas</span>
          <strong className="exp-kpi-value">{formatCount(shipping.delivered_orders)}</strong>
          <small className="exp-kpi-hint">ciclo cerrado</small>
        </article>
        <article className="exp-kpi-card is-blue">
          <span className="exp-kpi-label">En tránsito</span>
          <strong className="exp-kpi-value">{formatCount(shipping.in_transit_orders)}</strong>
          <small className="exp-kpi-hint">red activa</small>
        </article>
        <article className="exp-kpi-card is-red">
          <span className="exp-kpi-label">Incidencias</span>
          <strong className="exp-kpi-value">{formatCount(shipping.exception_orders)}</strong>
          <small className="exp-kpi-hint">carrier o flujo</small>
        </article>
        <article className="exp-kpi-card is-orange">
          <span className="exp-kpi-label">On-time delivery</span>
          <strong className="exp-kpi-value">{formatPercent(operational.delivered_in_sla_rate)}</strong>
          <small className="exp-kpi-hint">dentro de SLA</small>
        </article>
        <article className="exp-kpi-card is-slate">
          <span className="exp-kpi-label">Transit time medio</span>
          <strong className="exp-kpi-value">{formatHoursAsShort(shipping.avg_transit_hours)}</strong>
          <small className="exp-kpi-hint">recogido → entregado</small>
        </article>
        <article className="exp-kpi-card is-slate">
          <span className="exp-kpi-label">Pedido → entrega</span>
          <strong className="exp-kpi-value">{formatDaysAsReadableFromHours(flow.avg_order_to_delivered_hours)}</strong>
          <small className="exp-kpi-hint">ciclo completo</small>
        </article>
      </div>

      {/* ── Main 3-col grid ────────────────────────────────────── */}
      <div className="exp-main-grid">

        {/* Status donut */}
        <div className="card exp-donut-card">
          <div className="exp-section-head">
            <span className="eyebrow">Distribución</span>
            <h2 className="exp-card-title">Estado de la red</h2>
          </div>
          <div className="exp-donut-wrap">
            <ShipmentDonut
              centerLabel="pedidos"
              centerValue={formatCount(totalOrders)}
              radius={90}
              segments={shippingStatusSegments}
              showLegend={false}
              showTotal={false}
              size={228}
              strokeWidth={22}
              variant="hero"
            />
          </div>
          <div className="exp-status-list">
            {shippingStatusSegments.map((seg) => {
              const meta = STATUS_META[seg.key];
              const pct = totalOrders > 0 ? Math.round((seg.value / totalOrders) * 100) : 0;
              return (
                <div className={`exp-status-row is-${seg.tone}`} key={seg.key}>
                  <span className="exp-status-dot" />
                  <span className="exp-status-name">{meta?.label ?? seg.key}</span>
                  <div className="exp-status-bar-track">
                    <div className="exp-status-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <strong>{formatCount(seg.value)}</strong>
                </div>
              );
            })}
          </div>
        </div>

        {/* Flow timeline */}
        <div className="card exp-flow-card">
          <div className="exp-section-head">
            <span className="eyebrow">Tiempos de flujo</span>
            <h2 className="exp-card-title">Ciclo end-to-end</h2>
          </div>
          <div className="exp-flow-timeline">
            <div className="exp-flow-step">
              <div className="exp-flow-node">📦</div>
              <span>Pedido</span>
            </div>
            <div className="exp-flow-connector">
              <div className="exp-flow-line" />
              <strong>{formatHoursAsShort(flow.avg_order_to_prepared_hours)}</strong>
            </div>
            <div className="exp-flow-step">
              <div className="exp-flow-node">🏷️</div>
              <span>Etiqueta</span>
            </div>
            <div className="exp-flow-connector">
              <div className="exp-flow-line" />
              <strong>{formatHoursAsShort(flow.avg_prepared_to_picked_up_hours)}</strong>
            </div>
            <div className="exp-flow-step">
              <div className="exp-flow-node">🚚</div>
              <span>Recogida</span>
            </div>
            <div className="exp-flow-connector">
              <div className="exp-flow-line" />
              <strong>{formatHoursAsShort(flow.avg_picked_up_to_delivered_hours)}</strong>
            </div>
            <div className="exp-flow-step">
              <div className="exp-flow-node is-accent">🎯</div>
              <span>Entrega</span>
            </div>
          </div>
          <div className="exp-flow-total">
            <span>Tiempo total medio</span>
            <strong>{formatDaysAsReadableFromHours(flow.avg_order_to_delivered_hours)}</strong>
          </div>

          {/* SLA row */}
          <div className="exp-sla-row">
            <div className="exp-sla-item">
              <span>SLA cumplido</span>
              <strong className="is-green">{formatPercent(operational.delivered_in_sla_rate)}</strong>
            </div>
            <div className="exp-sla-item">
              <span>Fuera de SLA</span>
              <strong className="is-red">{formatCount(operational.outside_sla_orders)}</strong>
            </div>
            <div className="exp-sla-item">
              <span>Sin recoger</span>
              <strong className="is-orange">{formatCount(operational.prepared_not_collected_orders)}</strong>
            </div>
          </div>

          {/* Aging bar */}
          <div className="exp-aging-block">
            <div className="exp-aging-label-row">
              <span className="eyebrow">Aging en tránsito</span>
            </div>
            <div className="exp-aging-bar">
              <div className="exp-aging-seg is-green"  style={{ width: `${(aging.bucket_0_24   / agingTotal) * 100}%` }} />
              <div className="exp-aging-seg is-blue"   style={{ width: `${(aging.bucket_24_48  / agingTotal) * 100}%` }} />
              <div className="exp-aging-seg is-orange" style={{ width: `${(aging.bucket_48_72  / agingTotal) * 100}%` }} />
              <div className="exp-aging-seg is-red"    style={{ width: `${(aging.bucket_72_plus / agingTotal) * 100}%` }} />
            </div>
            <div className="exp-aging-grid">
              <div><strong>{formatCount(aging.bucket_0_24)}</strong><span>0–24h</span></div>
              <div><strong>{formatCount(aging.bucket_24_48)}</strong><span>24–48h</span></div>
              <div><strong>{formatCount(aging.bucket_48_72)}</strong><span>48–72h</span></div>
              <div><strong>{formatCount(aging.bucket_72_plus)}</strong><span>+72h</span></div>
            </div>
          </div>
        </div>

        {/* Attention panel */}
        <div className="card exp-alert-card">
          <div className="exp-section-head">
            <span className="eyebrow">Necesita atención</span>
            <h2 className="exp-card-title">Fricciones activas</h2>
          </div>
          <div className="exp-alert-total">
            <strong>{formatCount(totalAttentionCount)}</strong>
            <span>casos en cola</span>
          </div>
          <div className="exp-alert-list">
            {ATTENTION_META.map((item) => {
              const count = attention[item.key];
              const isHot = count > 0 && (item.tone === "red" || item.tone === "orange");
              return (
                <div className={`exp-alert-row${isHot ? " is-hot" : ""}`} key={item.key}>
                  <span className="exp-alert-icon">{item.icon}</span>
                  <div className="exp-alert-body">
                    <strong>{item.label}</strong>
                    <span>{item.note}</span>
                  </div>
                  <strong className={`exp-alert-count${count > 0 ? ` is-${item.tone}` : ""}`}>
                    {formatCount(count)}
                  </strong>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Last-mile funnel ───────────────────────────────────── */}
      <div className="exp-lastmile-strip">
        <div className="exp-lastmile-label-col">
          <span className="eyebrow">Última milla</span>
          <span className="exp-lastmile-subtitle">Estado en tiempo real</span>
        </div>
        {([
          { key: "in_transit",       icon: "🛣️",  label: "En tránsito",  value: shipping.in_transit_orders       ?? 0, tone: "blue"   },
          { key: "out_for_delivery", icon: "📬",  label: "En reparto",   value: shipping.out_for_delivery_orders ?? 0, tone: "orange" },
          { key: "delivered",        icon: "🎯",  label: "Entregado",    value: shipping.delivered_orders        ?? 0, tone: "green"  },
          { key: "exception",        icon: "⚠️",  label: "Excepción",    value: shipping.exception_orders        ?? 0, tone: "red"    },
        ] as const).map((stage, idx, arr) => {
          const pct = Math.round((stage.value / lastMileTotal) * 100);
          return (
            <div className="exp-lastmile-funnel-item" key={stage.key}>
              <div className={`exp-lastmile-stage is-${stage.tone}`}>
                <span className="exp-lastmile-icon">{stage.icon}</span>
                <strong className="exp-lastmile-count">{stage.value}</strong>
                <span className="exp-lastmile-stage-name">{stage.label}</span>
                <span className="exp-lastmile-pct">{pct}%</span>
              </div>
              {idx < arr.length - 1 && <div className="exp-lastmile-arrow">›</div>}
            </div>
          );
        })}
      </div>

      {/* ── Charts strip ───────────────────────────────────────── */}
      <div className="exp-charts-strip">
        <DailyBarsChart points={performancePoints} />
        <DualBarsChart  points={performancePoints} />
        <MiniTrendChart
          points={performancePoints}
          valueKey="on_time_delivery_rate"
          tone="green"
          label="On-time delivery"
          eyebrow="Servicio"
        />
        <MiniTrendChart
          points={performancePoints}
          valueKey="avg_transit_hours"
          tone="blue"
          label="Tránsito medio"
          eyebrow="Transit time"
          valueFormatter={formatHoursAsShort}
        />
        <MiniTrendChart
          points={performancePoints.map((p) => ({
            ...p,
            on_time_delivery_rate: p.created_shipments > 0
              ? Math.round((p.exception_orders / p.created_shipments) * 100)
              : null,
          }))}
          valueKey="on_time_delivery_rate"
          tone="red"
          label="Exception drift"
          eyebrow="Excepciones"
        />
      </div>

      {/* ── Carrier performance ────────────────────────────────── */}
      {carrierData.length > 0 && (
        <div className="card exp-carrier-section">
          <div className="exp-section-head">
            <div>
              <span className="eyebrow">Transportistas</span>
              <h2 className="exp-card-title">Rendimiento por carrier</h2>
            </div>
            <span className="exp-table-count">
              <strong>{carrierData.length}</strong> carrier{carrierData.length !== 1 ? "s" : ""} activos
            </span>
          </div>
          <div className="exp-carrier-table-wrap">
            <table className="exp-carrier-table">
              <thead>
                <tr>
                  <th>Carrier</th>
                  <th className="exp-th-num">Envíos</th>
                  <th className="exp-th-num">Entregados</th>
                  <th>Tasa entrega</th>
                  <th className="exp-th-num">Transit medio</th>
                  <th>Incidencias</th>
                  <th>Valoración</th>
                </tr>
              </thead>
              <tbody>
                {[...carrierData]
                  .sort((a, b) => b.shipments - a.shipments)
                  .map((carrier) => {
                    const deliveryRate =
                      carrier.shipments > 0
                        ? (carrier.delivered_orders / carrier.shipments) * 100
                        : 0;
                    const incidentRate = carrier.incident_rate ?? 0;
                    const scoreClass =
                      incidentRate < 1 && deliveryRate >= 95 ? "is-green" :
                      incidentRate > 4 || deliveryRate < 82 ? "is-red"   : "is-orange";
                    const scoreLabel =
                      scoreClass === "is-green" ? "Excelente" :
                      scoreClass === "is-red"   ? "Revisar"   : "Normal";
                    return (
                      <tr className="exp-carrier-row" key={carrier.carrier}>
                        <td>
                          <div className="exp-carrier-name-cell">
                            <span className="exp-carrier-badge">
                              {carrier.carrier.slice(0, 2).toUpperCase()}
                            </span>
                            <span className="exp-carrier-name">{carrier.carrier}</span>
                          </div>
                        </td>
                        <td className="exp-td-num">{formatCount(carrier.shipments)}</td>
                        <td className="exp-td-num">{formatCount(carrier.delivered_orders)}</td>
                        <td>
                          <div className="exp-carrier-rate-wrap">
                            <div className="exp-carrier-rate-bar">
                              <div
                                className={`exp-carrier-rate-fill ${scoreClass}`}
                                style={{ width: `${deliveryRate}%` }}
                              />
                            </div>
                            <span className={`exp-carrier-rate-pct ${scoreClass}`}>
                              {deliveryRate.toFixed(0)}%
                            </span>
                          </div>
                        </td>
                        <td className="exp-td-num">
                          {formatHoursAsShort(carrier.avg_delivery_hours)}
                        </td>
                        <td>
                          <span className={`exp-carrier-incident-pill ${
                            incidentRate > 4 ? "is-red" :
                            incidentRate > 1 ? "is-orange" : "is-green"
                          }`}>
                            {incidentRate.toFixed(1)}%
                          </span>
                        </td>
                        <td>
                          <span className={`exp-carrier-score-pill ${scoreClass}`}>{scoreLabel}</span>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Attention table ────────────────────────────────────── */}
      <div className="card exp-table-card" id="attention-table">
        <div className="exp-section-head">
          <div>
            <span className="eyebrow">Cola operativa</span>
            <h2 className="exp-card-title">Pedidos que requieren acción</h2>
          </div>
          <span className="exp-table-count">
            <strong>{formatCount(attentionRows.length)}</strong> filas priorizadas
          </span>
        </div>

        {attentionRows.length > 0 ? (
          <div className="exp-table-wrap">
            <table className="exp-table">
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Cliente</th>
                  <th>Tienda</th>
                  <th>Tracking</th>
                  <th>Estado</th>
                  <th>Último evento</th>
                  <th>Actualización</th>
                  <th>Riesgo</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {attentionRows.map((row) => (
                  <AttentionRow
                    basePath={orderBasePath}
                    key={row.order_id}
                    row={row}
                    selectedShopId={selectedShopId}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="exp-table-empty">
            <span>✅</span>
            <p>No hay expediciones en riesgo en el periodo seleccionado.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function AttentionRow({
  row,
  basePath,
  selectedShopId,
}: {
  row: AnalyticsAttentionShipment;
  basePath: string;
  selectedShopId?: string;
}) {
  const stageMeta = STATUS_META[row.current_stage] ?? STATUS_META.pending;
  return (
    <tr className="exp-table-row">
      <td className="exp-table-id">{row.external_id}</td>
      <td>
        <div className="exp-table-primary">{row.customer_name}</div>
      </td>
      <td className="exp-table-muted">{row.shop_name}</td>
      <td className="exp-table-mono">{row.tracking_number ?? "—"}</td>
      <td>
        <span className={`exp-stage-pill ${getStageBadgeModifier(row.current_stage)}`}>
          {stageMeta.icon} {stageMeta.label}
        </span>
      </td>
      <td className="exp-table-muted">{row.latest_event_label}</td>
      <td>
        <div className="exp-table-primary">
          {row.hours_since_update !== null ? formatHoursAsShort(row.hours_since_update) : "—"}
        </div>
        <div className="exp-table-sub">{formatCompactDateTime(row.last_event_at)}</div>
      </td>
      <td>
        <span className="exp-risk-pill">{row.risk_reason}</span>
      </td>
      <td>
        <Link
          className="button-secondary exp-table-action"
          href={`${basePath}/${row.order_id}${selectedShopId ? `?shop_id=${selectedShopId}` : ""}`}
        >
          Abrir →
        </Link>
      </td>
    </tr>
  );
}
