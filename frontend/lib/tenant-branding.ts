import type { Shop } from "@/lib/types";

export type TenantBranding = {
  displayName: string;
  subtitle: string;
  accentColor: string;
  logoUrl?: string;
  logoMark?: string;
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

export function getTenantBranding(shop?: Pick<Shop, "slug" | "name" | "id"> | null): TenantBranding {
  const overrides = brandingBySlug[getShopKey(shop)] ?? {};
  const displayName = overrides.displayName ?? shop?.name ?? defaultBranding.displayName;
  const inferredLogoMark =
    displayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || defaultBranding.logoMark;

  const logoMark = overrides.logoMark ?? inferredLogoMark;

  return {
    ...defaultBranding,
    ...overrides,
    displayName,
    logoMark,
  };
}
