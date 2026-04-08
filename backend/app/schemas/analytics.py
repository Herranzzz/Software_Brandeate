from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel


class AnalyticsFiltersRead(BaseModel):
    date_from: date | None
    date_to: date | None
    shop_id: int | None
    channel: str | None
    is_personalized: bool | None
    status: str | None
    production_status: str | None
    carrier: str | None


class AnalyticsKpisRead(BaseModel):
    total_orders: int
    orders_today: int
    orders_this_week: int
    orders_this_month: int
    personalized_orders: int
    standard_orders: int
    in_production_orders: int
    shipped_orders: int
    delivered_orders: int
    open_incidents: int


class AgingBucketsRead(BaseModel):
    bucket_0_24: int = 0
    bucket_24_48: int = 0
    bucket_48_72: int = 0
    bucket_72_plus: int = 0


class AnalyticsOperationalMetricsRead(BaseModel):
    avg_order_to_production_hours: float | None
    avg_production_to_shipping_hours: float | None
    avg_shipping_to_delivery_hours: float | None
    sent_in_sla_rate: float | None
    delivered_in_sla_rate: float | None
    blocked_orders: int
    orders_without_shipment: int
    orders_without_tracking: int = 0
    prepared_not_collected_orders: int = 0
    outside_sla_orders: int = 0
    stalled_tracking_orders: int
    incident_rate: float | None
    aging_buckets: AgingBucketsRead | None = None


class AnalyticsPersonalizationMetricsRead(BaseModel):
    personalized_share: float | None
    standard_share: float | None
    personalized_today: int
    personalized_this_week: int
    personalized_this_month: int
    pending_assets_orders: int
    pending_review_orders: int
    design_link_available_orders: int
    personalized_blocked_orders: int
    avg_personalized_preparation_hours: float | None


class CarrierPerformanceRead(BaseModel):
    carrier: str
    shipments: int
    delivered_orders: int
    avg_delivery_hours: float | None
    incident_rate: float | None


class AnalyticsShippingMetricsRead(BaseModel):
    pending_orders: int = 0
    prepared_orders: int = 0
    picked_up_orders: int = 0
    in_transit_orders: int
    out_for_delivery_orders: int = 0
    delivered_orders: int
    exception_orders: int
    stalled_orders: int = 0
    without_tracking_orders: int = 0
    avg_transit_hours: float | None = None
    avg_order_to_delivery_hours: float | None = None
    carrier_performance: list[CarrierPerformanceRead] = []


class AnalyticsSeriesPointRead(BaseModel):
    date: str
    total: int
    personalized: int
    standard: int
    delivered: int = 0
    exception: int = 0


class AnalyticsBreakdownItemRead(BaseModel):
    label: str
    value: int
    percentage: float | None = None


class AnalyticsShippingPerformancePointRead(BaseModel):
    date: str
    created_shipments: int = 0
    delivered_orders: int = 0
    exception_orders: int = 0
    on_time_delivery_rate: float | None = None
    avg_transit_hours: float | None = None
    avg_total_hours: float | None = None


class AnalyticsAttentionMetricsRead(BaseModel):
    tracking_stalled: int = 0
    without_shipment: int = 0
    without_tracking: int = 0
    carrier_exception: int = 0
    outside_sla: int = 0
    prepared_not_collected: int = 0


class AnalyticsAttentionShipmentRead(BaseModel):
    order_id: int
    external_id: str
    shop_name: str
    customer_name: str
    tracking_number: str | None = None
    current_stage: str
    latest_event_label: str
    last_event_at: datetime | None = None
    hours_since_update: float | None = None
    risk_reason: str


class AnalyticsTopShopRead(BaseModel):
    shop_id: int
    shop_name: str
    orders: int
    personalized_orders: int
    delivered_orders: int


class AnalyticsTopSkuRead(BaseModel):
    sku: str
    name: str
    quantity: int
    orders: int


class AnalyticsDelayedOrderRead(BaseModel):
    order_id: int
    external_id: str
    shop_name: str
    customer_name: str
    status: str
    production_status: str
    age_hours: float
    reason: str


class AnalyticsRankingsRead(BaseModel):
    top_shops: list[AnalyticsTopShopRead]
    top_skus: list[AnalyticsTopSkuRead]
    top_incidents: list[AnalyticsBreakdownItemRead]
    delayed_orders: list[AnalyticsDelayedOrderRead]
    attention_shipments: list[AnalyticsAttentionShipmentRead] = []


class AnalyticsScopeRead(BaseModel):
    shop_count: int
    available_channels: list[str]
    generated_at: datetime


class AnalyticsFlowRead(BaseModel):
    orders_received: int
    orders_prepared: int
    orders_picked_up: int = 0
    orders_in_transit: int
    orders_out_for_delivery: int = 0
    orders_delivered: int
    orders_exception: int
    avg_order_to_label_hours: float | None
    avg_label_to_transit_hours: float | None
    avg_transit_to_delivery_hours: float | None
    avg_total_hours: float | None
    avg_order_to_prepared_hours: float | None = None
    avg_prepared_to_picked_up_hours: float | None = None
    avg_picked_up_to_delivered_hours: float | None = None
    avg_order_to_delivered_hours: float | None = None


class AnalyticsOverviewRead(BaseModel):
    scope: AnalyticsScopeRead
    filters: AnalyticsFiltersRead
    kpis: AnalyticsKpisRead
    operational: AnalyticsOperationalMetricsRead
    personalization: AnalyticsPersonalizationMetricsRead
    shipping: AnalyticsShippingMetricsRead
    charts: dict[str, list[AnalyticsBreakdownItemRead] | list[AnalyticsSeriesPointRead]]
    shipping_status_distribution: list[AnalyticsBreakdownItemRead] = []
    shipping_performance_by_day: list[AnalyticsShippingPerformancePointRead] = []
    attention: AnalyticsAttentionMetricsRead = AnalyticsAttentionMetricsRead()
    rankings: AnalyticsRankingsRead
    flow: AnalyticsFlowRead
