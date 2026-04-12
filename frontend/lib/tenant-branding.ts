import type { Shop, TrackingConfig } from "@/lib/types";

export type TrackingCTA = {
  message?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  discountCode?: string;
  discountText?: string;
  reviewUrl?: string;
  reviewLabel?: string;
};

export type TenantBranding = {
  displayName: string;
  subtitle: string;
  accentColor: string;
  logoUrl?: string;
  logoMark?: string;
  tracking?: TrackingCTA;
};

const brandingBySlug: Record<string, Partial<TenantBranding>> = {
  "donde-fue": {
    displayName: "Donde Fue",
    subtitle: "Portal de pedidos y seguimiento gestionado por Brandeate.",
    accentColor: "#0F62FE",
    logoMark: "DF",
  },
};

const defaultBranding: TenantBranding = {
  displayName: "Cliente Brandeate",
  subtitle: "Seguimiento, operativa y soporte para tiendas conectadas a Brandeate.",
  accentColor: "#0F62FE",
  logoMark: "BR",
};

function getShopKey(shop?: Pick<Shop, "slug" | "name" | "id"> | null) {
  if (!shop) {
    return "";
  }

  if (shop.slug?.trim()) {
    return shop.slug.trim().toLowerCase();
  }

  if (shop.name?.trim()) {
    return shop.name.trim().toLowerCase().replace(/\s+/g, "-");
  }

  return String(shop.id);
}

export function getTenantBranding(
  shop?: Pick<Shop, "slug" | "name" | "id"> | null,
  trackingConfig?: TrackingConfig | null,
): TenantBranding {
  const overrides = brandingBySlug[getShopKey(shop)] ?? {};

  // DB config takes priority over hardcoded slug overrides
  const displayName =
    trackingConfig?.display_name || overrides.displayName || shop?.name || defaultBranding.displayName;
  const accentColor =
    trackingConfig?.accent_color || overrides.accentColor || defaultBranding.accentColor;
  const logoUrl = trackingConfig?.logo_url || overrides.logoUrl;

  const inferredLogoMark =
    displayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || defaultBranding.logoMark;

  const logoMark = overrides.logoMark ?? inferredLogoMark;

  const tracking: TrackingCTA | undefined = trackingConfig
    ? {
        ctaUrl: trackingConfig.cta_url,
        ctaLabel: trackingConfig.cta_label,
        discountCode: trackingConfig.discount_code,
        discountText: trackingConfig.discount_text,
        message: trackingConfig.message,
        reviewUrl: trackingConfig.review_url,
        reviewLabel: trackingConfig.review_label,
      }
    : overrides.tracking;

  return {
    ...defaultBranding,
    ...overrides,
    displayName,
    accentColor,
    logoUrl,
    logoMark,
    tracking,
  };
}
