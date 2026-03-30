"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState, type CSSProperties, type ReactNode, type SVGProps } from "react";

import { LogoutButton } from "@/components/logout-button";
import { getTenantBranding } from "@/lib/tenant-branding";
import { resolveTenantScope } from "@/lib/tenant-scope";
import type { Shop, User } from "@/lib/types";


type PortalShellProps = {
  children: ReactNode;
  user: User;
  shops: Shop[];
};

type IconProps = SVGProps<SVGSVGElement>;

function HomeIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" {...props}>
      <path d="M4 11.5L12 5l8 6.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="M6.5 10.5V19h11v-8.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function OrdersIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" {...props}>
      <rect height="14" rx="2.5" stroke="currentColor" strokeWidth="1.8" width="14" x="5" y="5" />
      <path d="M8.5 9.5h7M8.5 12.5h7M8.5 15.5h4.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function ReturnsIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" {...props}>
      <path d="M7 8.5h10a2.5 2.5 0 0 1 0 5H9.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M10.5 5.5 7 8.5l3.5 3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="M17 15.5H7a2.5 2.5 0 0 0 0 5h7.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="m13.5 17.5 3.5 3-3.5 3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function AnalyticsIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" {...props}>
      <path d="M5 18.5h14" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M7.5 16V12M12 16V8M16.5 16v-5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function OperationsIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" {...props}>
      <path d="M6 7.5h12M6 12h8M6 16.5h10" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <circle cx="17.5" cy="7.5" fill="currentColor" r="1.2" />
      <circle cx="15.5" cy="12" fill="currentColor" r="1.2" />
      <circle cx="18.5" cy="16.5" fill="currentColor" r="1.2" />
    </svg>
  );
}

function HelpIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" {...props}>
      <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.8" />
      <path d="M10.8 10.3a1.9 1.9 0 1 1 2.6 1.8c-.8.3-1.4 1-1.4 1.9v.3" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <circle cx="12" cy="16.8" fill="currentColor" r="1" />
    </svg>
  );
}

function SettingsIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" {...props}>
      <path d="M12 8.8A3.2 3.2 0 1 1 8.8 12 3.2 3.2 0 0 1 12 8.8Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M19 12a7 7 0 0 0-.1-1.2l1.6-1.2-1.6-2.8-1.9.6a6.8 6.8 0 0 0-2-1.2l-.3-2h-3.2l-.3 2a6.8 6.8 0 0 0-2 1.2l-1.9-.6-1.6 2.8 1.6 1.2A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-1.6 1.2 1.6 2.8 1.9-.6a6.8 6.8 0 0 0 2 1.2l.3 2h3.2l.3-2a6.8 6.8 0 0 0 2-1.2l1.9.6 1.6-2.8-1.6-1.2c.1-.4.1-.8.1-1.2Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.4" />
    </svg>
  );
}

function LogoutIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" {...props}>
      <path d="M14 7.5V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5a2 2 0 0 0 2-2v-1.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="M10.5 12h8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M15.5 8.5 19 12l-3.5 3.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

const portalNavItems = [
  { href: "/portal", label: "Resumen", shortLabel: "Inicio", icon: HomeIcon },
  { href: "/portal/orders", label: "Pedidos", shortLabel: "Pedidos", icon: OrdersIcon },
  { href: "/portal/returns", label: "Devoluciones", shortLabel: "Devol.", icon: ReturnsIcon },
  { href: "/portal/reporting", label: "Reporting", shortLabel: "Report", icon: AnalyticsIcon },
  { href: "/portal/settings", label: "Ajustes", shortLabel: "Ajustes", icon: SettingsIcon },
];


function isActive(pathname: string, href: string) {
  if (href === "/portal") {
    return pathname === "/portal";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}


export function PortalShell({ children, user, shops }: PortalShellProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isHovered, setIsHovered] = useState(false);
  const tenantScope = resolveTenantScope(shops, searchParams.get("shop_id"));
  const primaryShop = tenantScope.selectedShop ?? shops[0];
  const branding = getTenantBranding(primaryShop);
  const isCollapsed = !isHovered;
  const style = {
    "--tenant-accent": branding.accentColor,
    "--tenant-accent-soft": `${branding.accentColor}14`,
  } as CSSProperties;

  return (
    <div className={`tenant-shell tenant-shell-branded ${isCollapsed ? "tenant-shell-collapsed" : ""}`} style={style}>
      <aside
        className="tenant-sidebar"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <div className="tenant-sidebar-header">
          <div className="tenant-brand-lockup">
            {branding.logoUrl ? (
              <img alt={branding.displayName} className="tenant-logo" src={branding.logoUrl} />
            ) : (
              <div className="tenant-logo tenant-logo-fallback">{branding.logoMark}</div>
            )}
            <div className="tenant-brand-copy">
              <span className="eyebrow">Powered by Brandeate</span>
              <h1 className="tenant-title">{branding.displayName}</h1>
            </div>
          </div>
        </div>

        <div className="tenant-sidebar-meta">
          <span className="tenant-sidebar-caption">Cuenta cliente</span>
          <span className="tenant-sidebar-slug">
            {tenantScope.hasMultipleShops
              ? `${tenantScope.selectedShop?.slug ?? "sin-slug"} · ${tenantScope.shops.length} tiendas`
              : (tenantScope.selectedShop?.slug ?? "sin-slug")}
          </span>
        </div>

        <nav className="tenant-nav">
          <div className="tenant-nav-section">Navegación</div>
          {portalNavItems.map((item) => (
            <Link
              className={`tenant-nav-link ${isActive(pathname, item.href) ? "tenant-nav-link-active" : ""}`}
              href={
                tenantScope.selectedShopId
                  ? { pathname: item.href, query: { shop_id: tenantScope.selectedShopId } }
                  : item.href
              }
              key={item.href}
              title={isCollapsed ? item.label : undefined}
            >
              <item.icon className="tenant-nav-icon" />
              <span className="tenant-nav-link-label">{isCollapsed ? item.shortLabel : item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="tenant-sidebar-footer">
          <div className="tenant-chip" title={user.role}>{user.role}</div>
          <LogoutButton />
          <button
            aria-label="Cerrar sesión"
            className="tenant-sidebar-icon-button"
            onClick={() => {
              const button = document.querySelector<HTMLButtonElement>(".tenant-sidebar-footer .tenant-logout-hidden");
              button?.click();
            }}
            title="Cerrar sesión"
            type="button"
          >
            <LogoutIcon className="tenant-nav-icon" />
          </button>
          <LogoutButton className="tenant-logout-hidden" label="Cerrar sesión" />
        </div>
      </aside>

      <div className="tenant-main">
        <div className="tenant-content">{children}</div>
      </div>
    </div>
  );
}
