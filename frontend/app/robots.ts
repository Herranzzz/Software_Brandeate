import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "https://app.brandeate.com";
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/tracking/", "/login", "/signup"],
        disallow: [
          "/api/",
          "/tenant/",
          "/dashboard",
          "/orders",
          "/shipments",
          "/customers",
          "/analytics",
          "/reporting",
          "/settings",
          "/invoices",
          "/inventory",
          "/incidencias",
          "/returns",
          "/employees",
          "/production",
          "/catalog",
          "/portal",
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
