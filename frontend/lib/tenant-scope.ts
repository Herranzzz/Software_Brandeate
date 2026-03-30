import type { Shop } from "@/lib/types";


export type TenantScope = {
  shops: Shop[];
  selectedShop: Shop | null;
  selectedShopId: string;
  hasMultipleShops: boolean;
};


export function resolveTenantScope(
  shops: Shop[],
  requestedShopId?: string | number | null,
): TenantScope {
  const normalizedRequestedShopId =
    requestedShopId !== undefined && requestedShopId !== null && String(requestedShopId).trim()
      ? String(requestedShopId).trim()
      : "";

  const selectedShop =
    shops.find((shop) => String(shop.id) === normalizedRequestedShopId) ??
    shops[0] ??
    null;

  return {
    shops,
    selectedShop,
    selectedShopId: selectedShop ? String(selectedShop.id) : "",
    hasMultipleShops: shops.length > 1,
  };
}
