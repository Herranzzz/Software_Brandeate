import type { Order, Shipment, ShopShippingSettings } from "@/lib/types";


export type CttWeightBand = {
  code: string;
  label: string;
  maxWeight: number;
};

export type CttServiceOption = {
  code: string;
  label: string;
};

export type CttLabelFormat = "PDF" | "PDF2" | "ZPL" | "EPL";

export const CTT_WEIGHT_BANDS: CttWeightBand[] = [
  { code: "band_1000", label: "1 kg", maxWeight: 1 },
  { code: "band_2000", label: "2 kg", maxWeight: 2 },
  { code: "band_3000", label: "3 kg", maxWeight: 3 },
  { code: "band_4000", label: "4 kg", maxWeight: 4 },
  { code: "band_5000", label: "5 kg", maxWeight: 5 },
  { code: "band_10000", label: "10 kg", maxWeight: 10 },
  { code: "band_15000", label: "15 kg", maxWeight: 15 },
];

export const CTT_SERVICE_OPTIONS: CttServiceOption[] = [
  { code: "C24", label: "CTT 24" },
  { code: "C48", label: "CTT 48" },
  { code: "C14", label: "CTT 14" },
  { code: "C10", label: "CTT 10" },
  { code: "C14E", label: "CTT Premium Empresas" },
];

export function getInitialCttWeightBand(order: Order, settings?: ShopShippingSettings | null): string {
  return order.shipment?.weight_tier_code || settings?.default_weight_tier_code || "band_2000";
}

export function getInitialCttServiceCode(order: Order, settings?: ShopShippingSettings | null): string {
  return order.shipment?.shipping_type_code || settings?.default_shipping_type_code || "C24";
}

export function isCttShipment(shipment: Shipment | null | undefined): boolean {
  if (!shipment) return false;
  return (shipment.carrier || "").toLowerCase().includes("ctt");
}

export function getShipmentLabelUrl(
  shipment: Shipment | null | undefined,
  options?: { download?: boolean; labelType?: CttLabelFormat; modelType?: "SINGLE" | "MULTI4" },
): string | null {
  if (!shipment || !isCttShipment(shipment) || !shipment.tracking_number) {
    return null;
  }

  const baseUrl = `/api/ctt/shippings/${shipment.tracking_number}/label`;
  const params = new URLSearchParams();
  params.set("label_type", options?.labelType ?? "PDF");
  params.set("model_type", options?.modelType ?? "SINGLE");
  if (options?.download) {
    params.set("download", "1");
  }
  return `${baseUrl}?${params.toString()}`;
}

export function getOrderShipmentLabelUrl(
  order: Order,
  options?: { download?: boolean; labelType?: CttLabelFormat; modelType?: "SINGLE" | "MULTI4" },
): string | null {
  return getShipmentLabelUrl(order.shipment, options);
}

export function getOrderShippingAddress(order: Order): string {
  const snapshot = order.shopify_shipping_snapshot_json && typeof order.shopify_shipping_snapshot_json === "object"
    ? order.shopify_shipping_snapshot_json
    : null;
  return [
    order.shipping_address_line1,
    order.shipping_address_line2,
    typeof snapshot?.address1 === "string" ? snapshot.address1 : null,
    typeof snapshot?.address2 === "string" ? snapshot.address2 : null,
  ]
    .filter((value, index, array) => Boolean(value) && array.indexOf(value) === index)
    .join(", ");
}

export function getOrderShippingContact(order: Order) {
  const snapshot = order.shopify_shipping_snapshot_json && typeof order.shopify_shipping_snapshot_json === "object"
    ? order.shopify_shipping_snapshot_json
    : null;
  const snapshotName =
    typeof snapshot?.name === "string"
      ? snapshot.name
      : [snapshot?.first_name, snapshot?.last_name]
          .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          .join(" ");

  return {
    recipientName: order.shipping_name || snapshotName || order.customer_name || "",
    recipientEmail:
      (typeof snapshot?.email === "string" && snapshot.email) ||
      order.customer_email ||
      "",
    recipientCountry:
      (typeof snapshot?.country_code === "string" && snapshot.country_code) ||
      order.shipping_country_code ||
      "ES",
    recipientPostalCode:
      order.shipping_postal_code ||
      (typeof snapshot?.zip === "string" ? snapshot.zip : "") ||
      "",
    recipientAddress: getOrderShippingAddress(order),
    recipientTown:
      order.shipping_town ||
      (typeof snapshot?.city === "string" ? snapshot.city : "") ||
      "",
    recipientPhone:
      order.shipping_phone ||
      (typeof snapshot?.phone === "string" ? snapshot.phone : "") ||
      "",
  };
}
