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
  source: string | null;
  location: string | null;
  occurred_at: string;
  created_at: string;
};

export type Shipment = {
  id: number;
  order_id: number;
  created_by_employee_id: number | null;
  fulfillment_id: string | null;
  carrier: string;
  tracking_number: string;
  tracking_url: string | null;
  shipping_status: string | null;
  shipping_status_detail: string | null;
  provider_reference: string | null;
  shipping_rule_id: number | null;
  shipping_rule_name: string | null;
  detected_zone: string | null;
  resolution_mode: string | null;
  shipping_type_code: string | null;
  weight_tier_code: string | null;
  weight_tier_label: string | null;
  shipping_weight_declared: number | null;
  package_count: number | null;
  provider_payload_json: unknown;
  label_created_at: string | null;
  shopify_sync_status: string | null;
  shopify_sync_error: string | null;
  shopify_last_sync_attempt_at: string | null;
  shopify_synced_at: string | null;
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
  is_automated: boolean;
  automation_rule_name: string | null;
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

export type AutomationFlag = {
  key: string;
  label: string;
  tone: string;
  description: string;
};

export type AutomationEvent = {
  id: number;
  shop_id: number;
  order_id: number | null;
  shipment_id: number | null;
  entity_type: "order" | "shipment";
  entity_id: number;
  rule_name: string;
  action_type: "flag_detected" | "incident_created" | "priority_raised";
  summary: string;
  payload_json: Record<string, unknown> | unknown[] | null;
  created_at: string;
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
  shipping_name: string | null;
  shipping_phone: string | null;
  shipping_country_code: string | null;
  shipping_postal_code: string | null;
  shipping_address_line1: string | null;
  shipping_address_line2: string | null;
  shipping_town: string | null;
  shipping_province_code: string | null;
  shopify_shipping_snapshot_json: Record<string, unknown> | null;
  shopify_shipping_rate_name: string | null;
  shopify_shipping_rate_amount: number | null;
  shopify_shipping_rate_currency: string | null;
  delivery_type: string | null;
  shipping_service_code: string | null;
  shipping_service_name: string | null;
  shipping_rate_amount: number | null;
  shipping_rate_currency: string | null;
  shipping_rate_estimated_days_min: number | null;
  shipping_rate_estimated_days_max: number | null;
  shipping_rate_quote_id: number | null;
  pickup_point_json: Record<string, unknown> | null;
  note: string | null;
  tags_json: string[] | null;
  channel: string | null;
  shopify_financial_status: string | null;
  shopify_fulfillment_status: string | null;
  fulfillment_orders_json: unknown;
  created_at: string;
  has_open_incident: boolean;
  open_incidents_count: number;
  automation_flags: AutomationFlag[];
  items: OrderItem[];
  shipment: Shipment | null;
  automation_events?: AutomationEvent[];
};

export type ShippingRule = {
  id: number;
  shop_id: number;
  zone_name: string;
  shipping_rate_name: string | null;
  shipping_rate_amount: number | null;
  rule_type: string;
  min_value: number | null;
  max_value: number | null;
  carrier_service_code: string;
  carrier_service_label: string | null;
  country_codes: string[] | null;
  province_codes: string[] | null;
  postal_code_patterns: string[] | null;
  is_active: boolean;
  priority: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ShippingRuleResolution = {
  matched: boolean;
  zone_name: string | null;
  resolution_mode: string;
  carrier_service_code: string | null;
  carrier_service_label: string | null;
  shipping_rule_id: number | null;
  shipping_rule_name: string | null;
  match_reason: string | null;
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
    source: string | null;
    location: string | null;
    occurred_at: string;
    created_at: string;
  }>;
};

export type Shop = {
  shipping_settings: ShopShippingSettings | null;
  id: number;
  name: string;
  slug: string;
  created_at: string;
};

export type ShopShippingSettings = {
  sender_name: string | null;
  sender_email: string | null;
  sender_phone: string | null;
  sender_country_code: string | null;
  sender_postal_code: string | null;
  sender_address_line1: string | null;
  sender_address_line2: string | null;
  sender_town: string | null;
  sender_province: string | null;
  default_shipping_type_code: string | null;
  default_weight_tier_code: string | null;
  label_reference_mode: string | null;
  recipient_email_notifications: boolean;
  default_package_strategy: string | null;
  default_package_count: number | null;
  printer_name: string | null;
  printer_label_format: string | null;
  printer_auto_print: boolean;
  ctt_client_center_code: string | null;
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
  aging_buckets: AgingBuckets | null;
};

export type AgingBuckets = {
  bucket_0_24: number;
  bucket_24_48: number;
  bucket_48_72: number;
  bucket_72_plus: number;
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
  delivered: number;
  exception: number;
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

export type AnalyticsFlow = {
  orders_received: number;
  orders_prepared: number;
  orders_in_transit: number;
  orders_delivered: number;
  orders_exception: number;
  avg_order_to_label_hours: number | null;
  avg_label_to_transit_hours: number | null;
  avg_transit_to_delivery_hours: number | null;
  avg_total_hours: number | null;
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
  flow: AnalyticsFlow;
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

export type EmployeeMetricsPeriod = "day" | "week";

export type EmployeeAnalyticsRow = AdminUser & {
  labels_today: number;
  labels_this_week: number;
  total_labels: number;
  last_activity_at: string | null;
};

export type EmployeeAnalyticsResponse = {
  period: EmployeeMetricsPeriod;
  employees: EmployeeAnalyticsRow[];
  generated_at: string;
};

export type EmployeeActivityItem = {
  shipment_id: number;
  order_id: number;
  order_external_id: string;
  carrier: string;
  tracking_number: string;
  label_created_at: string | null;
  created_at: string;
  last_activity_at: string;
};

export type EmployeeActivityResponse = {
  employee_id: number;
  employee_name: string;
  items: EmployeeActivityItem[];
};

export type LoginResponse = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  user: User;
};

export type ReturnStatus =
  | "requested"
  | "approved"
  | "in_transit"
  | "received"
  | "closed"
  | "rejected";

export type ReturnReason =
  | "damaged"
  | "wrong_product"
  | "not_delivered"
  | "address_issue"
  | "personalization_error"
  | "changed_mind"
  | "other";

export type Return = {
  id: number;
  shop_id: number;
  order_id: number | null;
  customer_name: string | null;
  customer_email: string | null;
  reason: ReturnReason;
  notes: string | null;
  status: ReturnStatus;
  tracking_number: string | null;
  created_at: string;
  updated_at: string;
  order: {
    id: number;
    external_id: string;
    customer_name: string;
    customer_email: string;
  } | null;
};
