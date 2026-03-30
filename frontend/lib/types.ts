export type OrderStatus =
  | "pending"
  | "in_progress"
  | "ready_to_ship"
  | "shipped"
  | "delivered"
  | "exception";

export type ProductionStatus =
  | "pending_personalization"
  | "in_production"
  | "packed"
  | "completed";

export type OrderPriority = "low" | "normal" | "high" | "urgent";
export type PickBatchStatus = "draft" | "active" | "completed";

export type DesignStatus =
  | "design_available"
  | "pending_asset"
  | "missing_asset";

export type TrackingEvent = {
  id: number;
  shipment_id: number;
  status_norm: string;
  status_raw: string | null;
  occurred_at: string;
  created_at: string;
};

export type Shipment = {
  id: number;
  order_id: number;
  fulfillment_id: string | null;
  carrier: string;
  tracking_number: string;
  tracking_url: string | null;
  shipping_status: string | null;
  shipping_status_detail: string | null;
  public_token: string;
  created_at: string;
  events: TrackingEvent[];
};

export type IncidentType =
  | "missing_asset"
  | "personalization_error"
  | "production_blocked"
  | "shipping_exception"
  | "address_issue"
  | "stock_issue";

export type IncidentPriority = "low" | "medium" | "high" | "urgent";

export type IncidentStatus = "open" | "in_progress" | "resolved";

export type Incident = {
  id: number;
  order_id: number;
  type: IncidentType;
  priority: IncidentPriority;
  status: IncidentStatus;
  title: string;
  description: string | null;
  assignee: string | null;
  created_at: string;
  updated_at: string;
  order: {
    id: number;
    shop_id: number;
    external_id: string;
    is_personalized: boolean;
    customer_name: string;
    customer_email: string;
  };
};

export type OrderItem = {
  id: number;
  order_id: number;
  shopify_line_item_gid: string | null;
  product_id: string | null;
  variant_id: string | null;
  sku: string;
  name: string;
  title: string | null;
  variant_title: string | null;
  quantity: number;
  properties_json: unknown;
  customization_id: string | null;
  design_link: string | null;
  customization_provider: string | null;
  design_status: DesignStatus | null;
  personalization_details_json: unknown;
  personalization_notes: string | null;
  personalization_assets_json: unknown;
  created_at: string;
};

export type Order = {
  id: number;
  shop_id: number;
  external_id: string;
  shopify_order_gid: string | null;
  shopify_order_name: string | null;
  customer_external_id: string | null;
  status: OrderStatus;
  production_status: ProductionStatus;
  priority: OrderPriority;
  is_personalized: boolean;
  customer_name: string;
  customer_email: string;
  note: string | null;
  tags_json: string[] | null;
  channel: string | null;
  shopify_financial_status: string | null;
  shopify_fulfillment_status: string | null;
  fulfillment_orders_json: unknown;
  created_at: string;
  has_open_incident: boolean;
  open_incidents_count: number;
  items: OrderItem[];
  shipment: Shipment | null;
};

export type PickBatch = {
  id: number;
  shop_id: number | null;
  status: PickBatchStatus;
  orders_count: number;
  notes: string | null;
  created_at: string;
  orders: Array<{
    id: number;
    order_id: number;
    created_at: string;
  }>;
};

export type PublicTracking = {
  order: {
    id: number;
    external_id: string;
    status: OrderStatus;
    customer_name: string;
    customer_email: string;
    created_at: string;
  };
  shipment: {
    id: number;
    carrier: string;
    tracking_number: string;
    tracking_url: string | null;
    shipping_status: string | null;
    public_token: string;
    created_at: string;
  };
  tracking_events: Array<{
    id: number;
    status_norm: string;
    status_raw: string | null;
    occurred_at: string;
    created_at: string;
  }>;
};

export type Shop = {
  id: number;
  name: string;
  slug: string;
  created_at: string;
};

export type ShopCustomer = {
  id: number;
  shop_id: number;
  provider: string;
  external_customer_id: string;
  first_name: string | null;
  last_name: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  tags_json: string[] | null;
  default_address_json: Record<string, unknown> | null;
  total_orders: number | null;
  last_order_at: string | null;
  synced_at: string | null;
  created_at: string;
};

export type ShopifySyncResult = {
  imported_count: number;
  updated_count: number;
  skipped_count?: number;
  customers_created_count?: number;
  customers_updated_count?: number;
  shipments_created_count: number;
  shipments_updated_count: number;
  external_ids_migrated_count: number;
  tracking_events_created_count: number;
  incidents_created_count: number;
  total_fetched: number;
};

export type ShopIntegration = {
  id: number;
  shop_id: number;
  provider: string;
  shop_domain: string;
  is_active: boolean;
  last_synced_at: string | null;
  last_sync_status: string | null;
  last_sync_summary: Record<string, unknown> | null;
  last_error_message: string | null;
  created_at: string;
};

export type ShopCatalogVariant = {
  id: string | null;
  title: string | null;
  sku: string | null;
};

export type ShopCatalogProduct = {
  id: number;
  shop_id: number;
  provider: string;
  external_product_id: string;
  title: string;
  handle: string | null;
  vendor: string | null;
  product_type: string | null;
  status: string | null;
  image_url: string | null;
  variants_json: ShopCatalogVariant[] | null;
  is_personalizable: boolean;
  synced_at: string | null;
  created_at: string;
};

export type ShopifyCatalogSyncResult = {
  fetched_count: number;
  created_count: number;
  updated_count: number;
};

export type AnalyticsFilters = {
  date_from: string | null;
  date_to: string | null;
  shop_id: number | null;
  channel: string | null;
  is_personalized: boolean | null;
  status: string | null;
  production_status: string | null;
  carrier: string | null;
};

export type AnalyticsKpis = {
  total_orders: number;
  orders_today: number;
  orders_this_week: number;
  orders_this_month: number;
  personalized_orders: number;
  standard_orders: number;
  in_production_orders: number;
  shipped_orders: number;
  delivered_orders: number;
  open_incidents: number;
};

export type AnalyticsOperational = {
  avg_order_to_production_hours: number | null;
  avg_production_to_shipping_hours: number | null;
  avg_shipping_to_delivery_hours: number | null;
  sent_in_sla_rate: number | null;
  delivered_in_sla_rate: number | null;
  blocked_orders: number;
  orders_without_shipment: number;
  stalled_tracking_orders: number;
  incident_rate: number | null;
};

export type AnalyticsPersonalization = {
  personalized_share: number | null;
  standard_share: number | null;
  personalized_today: number;
  personalized_this_week: number;
  personalized_this_month: number;
  pending_assets_orders: number;
  pending_review_orders: number;
  design_link_available_orders: number;
  personalized_blocked_orders: number;
  avg_personalized_preparation_hours: number | null;
};

export type CarrierPerformance = {
  carrier: string;
  shipments: number;
  delivered_orders: number;
  avg_delivery_hours: number | null;
  incident_rate: number | null;
};

export type AnalyticsShipping = {
  in_transit_orders: number;
  delivered_orders: number;
  exception_orders: number;
  carrier_performance: CarrierPerformance[];
};

export type AnalyticsSeriesPoint = {
  date: string;
  total: number;
  personalized: number;
  standard: number;
};

export type AnalyticsBreakdownItem = {
  label: string;
  value: number;
  percentage: number | null;
};

export type AnalyticsTopShop = {
  shop_id: number;
  shop_name: string;
  orders: number;
  personalized_orders: number;
  delivered_orders: number;
};

export type AnalyticsTopSku = {
  sku: string;
  name: string;
  quantity: number;
  orders: number;
};

export type AnalyticsDelayedOrder = {
  order_id: number;
  external_id: string;
  shop_name: string;
  customer_name: string;
  status: string;
  production_status: string;
  age_hours: number;
  reason: string;
};

export type AnalyticsOverview = {
  scope: {
    shop_count: number;
    available_channels: string[];
    generated_at: string;
  };
  filters: AnalyticsFilters;
  kpis: AnalyticsKpis;
  operational: AnalyticsOperational;
  personalization: AnalyticsPersonalization;
  shipping: AnalyticsShipping;
  charts: {
    orders_by_day: AnalyticsSeriesPoint[];
    personalization_mix: AnalyticsBreakdownItem[];
    status_distribution: AnalyticsBreakdownItem[];
    orders_by_shop: AnalyticsBreakdownItem[];
    incidents_by_type: AnalyticsBreakdownItem[];
    carrier_performance: AnalyticsBreakdownItem[];
  };
  rankings: {
    top_shops: AnalyticsTopShop[];
    top_skus: AnalyticsTopSku[];
    top_incidents: AnalyticsBreakdownItem[];
    delayed_orders: AnalyticsDelayedOrder[];
  };
};

export type UserRole = "super_admin" | "ops_admin" | "shop_admin" | "shop_viewer";

export type User = {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
};

export type AdminUser = User & {
  shops: Shop[];
};

export type LoginResponse = {
  access_token: string;
  token_type: string;
  user: User;
};
