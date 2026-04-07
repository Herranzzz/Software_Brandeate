import type { OrderItem } from "@/lib/types";

export type PersonalizationAsset = {
  type: string;
  url: string;
};

const HIDDEN_ASSET_TYPES = new Set([
  "_customization_image",
  "customization_image",
  "_preview_image",
  "preview_image",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function inferAssetType(url: string) {
  const normalizedUrl = url.toLowerCase();
  if (
    normalizedUrl.endsWith(".png") ||
    normalizedUrl.endsWith(".jpg") ||
    normalizedUrl.endsWith(".jpeg") ||
    normalizedUrl.endsWith(".webp") ||
    normalizedUrl.endsWith(".gif") ||
    normalizedUrl.endsWith(".svg")
  ) {
    return "image";
  }
  return "file";
}

export function isImageAsset(url: string) {
  const normalizedUrl = url.toLowerCase();
  return [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"].some((ext) =>
    normalizedUrl.includes(ext),
  );
}

export function getPersonalizationAssets(item: OrderItem): PersonalizationAsset[] {
  const rawAssets = item.personalization_assets_json;
  if (!rawAssets) return [];

  if (Array.isArray(rawAssets)) {
    return rawAssets
      .map((entry) => {
        if (typeof entry === "string") {
          return { type: inferAssetType(entry), url: entry };
        }
        if (!isRecord(entry)) return null;
        const url = typeof entry.url === "string" ? entry.url : null;
        if (!url) return null;
        return {
          type: typeof entry.type === "string" && entry.type.trim() ? entry.type : inferAssetType(url),
          url,
        };
      })
      .filter((entry): entry is PersonalizationAsset => entry !== null);
  }

  if (isRecord(rawAssets)) {
    return Object.entries(rawAssets)
      .map(([key, value]) => {
        if (typeof value === "string") return { type: key, url: value };
        if (!isRecord(value)) return null;
        const url = typeof value.url === "string" ? value.url : null;
        if (!url) return null;
        return {
          type: typeof value.type === "string" && value.type.trim() ? value.type : key,
          url,
        };
      })
      .filter((entry): entry is PersonalizationAsset => entry !== null);
  }

  return [];
}

/** Assets visible in production/orders — excludes _customization_image */
export function getVisibleAssets(item: OrderItem): PersonalizationAsset[] {
  return getPersonalizationAssets(item).filter((asset) => {
    const t = asset.type.toLowerCase();
    return !HIDDEN_ASSET_TYPES.has(t);
  });
}

function scoreAsset(asset: PersonalizationAsset): number {
  const t = asset.type.toLowerCase();
  // _tib_design_link always wins
  if (t.includes("_tib_design_link")) return 10;
  if (t.includes("render")) return 5;
  if (t.includes("preview")) return 4;
  if (t.includes("mockup")) return 3;
  // Penalise _customization_image so it never wins
  if (HIDDEN_ASSET_TYPES.has(t)) return -1;
  if (t.includes("image")) return 2;
  if (t.includes("design")) return 1;
  return 0;
}

export function getPrimaryRenderedAsset(items: OrderItem[]): PersonalizationAsset | null {
  const scored = items
    .flatMap((item) => getVisibleAssets(item))
    .filter((asset) => isImageAsset(asset.url))
    .map((asset) => ({ ...asset, score: scoreAsset(asset) }))
    .sort((a, b) => b.score - a.score);
  return scored[0] ?? null;
}

export function getItemPrimaryAsset(item: OrderItem): PersonalizationAsset | null {
  const scored = getVisibleAssets(item)
    .filter((asset) => isImageAsset(asset.url))
    .map((asset) => ({ ...asset, score: scoreAsset(asset) }))
    .sort((a, b) => b.score - a.score);
  return scored[0] ?? null;
}

export function getPrimaryDesignPreview(items: OrderItem[]): string | null {
  const asset = getPrimaryRenderedAsset(items);
  if (asset) return asset.url;

  const designLinkItem = items.find(
    (item) =>
      typeof item.design_link === "string" &&
      item.design_link.trim() &&
      isImageAsset(item.design_link),
  );
  return designLinkItem?.design_link ?? null;
}
