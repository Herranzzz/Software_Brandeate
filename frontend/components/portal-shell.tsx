"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { type CSSProperties, type ReactNode, type SVGProps } from "react";

import { LogoutButton } from "@/components/logout-button";
import { NotificationBell } from "@/components/notification-bell";
import { SidebarCollapseButton } from "@/components/sidebar-collapse-button";
import { useLayoutState } from "@/components/layout-state-provider";
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

function ChartIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" {...props}>
      <path d="M3 3v18h18" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M7 14l4-5 4 3 4-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function IncidenciasIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" {...props}>
      <path d="M12 9v4m0 3.5v.01" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
      <path d="M10.29 4.04a2 2 0 0 1 3.42 0l7.33 12.43A2 2 0 0 1 19.33 19H4.67a2 2 0 0 1-1.71-2.53z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
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

function SustainabilityIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" {...props}>
      <path d="M12 3C7 3 3 7.5 3 12c0 1.8.5 3.4 1.4 4.8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M12 3c3 3 4.5 6 4.5 9s-1.5 6-4.5 9" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M12 3c-3 3-4.5 6-4.5 9s1.5 6 4.5 9" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M3 12h18" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M12 3c5 0 9 4 9 9s-4 9-9 9" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function ReportsIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" {...props}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="M14 3v5h5" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="M9 13h6M9 17h4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function InventoryIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" {...props}>
      <rect height="6" rx="1.5" stroke="currentColor" strokeWidth="1.8" width="14" x="5" y="4" />
      <rect height="6" rx="1.5" stroke="currentColor" strokeWidth="1.8" width="14" x="5" y="14" />
      <path d="M9 7h6M9 17h4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function IntegrationsIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" {...props}>
      <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z" stroke="currentColor" strokeWidth="1.6" fill="none" />
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

function SunIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" {...props}>
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 3.5v2.2M12 18.3v2.2M5.64 5.64l1.56 1.56M16.8 16.8l1.56 1.56M3.5 12h2.2M18.3 12h2.2M5.64 18.36l1.56-1.56M16.8 7.2l1.56-1.56" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function MoonIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" {...props}>
      <path d="M19 14.8A7.8 7.8 0 0 1 9.2 5a8.4 8.4 0 1 0 9.8 9.8Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
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

const portalNavGroups = [
  {
    label: "Mi tienda",
    items: [
      { href: "/portal", label: "Resumen", shortLabel: "Inicio", icon: HomeIcon },
      { href: "/portal/orders", label: "Pedidos", shortLabel: "Pedidos", icon: OrdersIcon },
      { href: "/portal/shipments", label: "Analítica", shortLabel: "Stats", icon: AnalyticsIcon },
    ],
  },
  {
    label: "Postventa",
    items: [
      { href: "/portal/incidencias", label: "Incidencias", shortLabel: "Incid.", icon: IncidenciasIcon },
      { href: "/portal/returns", label: "Devoluciones", shortLabel: "Devol.", icon: ReturnsIcon },
    ],
  },
  {
    label: "Almacén",
    items: [
      { href: "/portal/inventory", label: "Inventario", shortLabel: "Stock", icon: InventoryIcon },
      { href: "/portal/reports", label: "Informes", shortLabel: "Report.", icon: ReportsIcon },
    ],
  },
  {
    label: "Configuración",
    items: [
      { href: "/portal/settings", label: "Ajustes", shortLabel: "Ajustes", icon: SettingsIcon },
    ],
  },
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
  const { isSidebarCollapsed, theme, toggleTheme } = useLayoutState();
  const tenantScope = resolveTenantScope(shops, searchParams.get("shop_id"));
  const primaryShop = tenantScope.selectedShop ?? shops[0];
  const branding = getTenantBranding(primaryShop);
  const style = {
    "--tenant-accent": branding.accentColor,
    "--tenant-accent-soft": `${branding.accentColor}14`,
  } as CSSProperties;

  return (
    <div
      className={`tenant-shell tenant-shell-branded${isSidebarCollapsed ? " tenant-shell-collapsed" : ""}`}
      style={style}
    >
      <aside className="tenant-sidebar">
        <div className="tenant-sidebar-header">
          <div className="tenant-sidebar-header-actions">
            <SidebarCollapseButton />
          </div>
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
          {portalNavGroups.map((group) => (
            <div className="tenant-nav-group" key={group.label}>
              <div className="tenant-nav-section">{group.label}</div>
              {group.items.map((item) => (
                <Link
                  className={`tenant-nav-link ${isActive(pathname, item.href) ? "tenant-nav-link-active" : ""}`}
                  href={
                    tenantScope.selectedShopId
                      ? { pathname: item.href, query: { shop_id: tenantScope.selectedShopId } }
                      : item.href
                  }
                  key={item.href}
                  prefetch={false}
                  title={isSidebarCollapsed ? item.label : undefined}
                >
                  <item.icon className="tenant-nav-icon" />
                  <span className="tenant-nav-link-label">{item.label}</span>
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="tenant-sidebar-footer">
          <div className="tenant-chip" title={user.role}>{user.role}</div>
          <NotificationBell />
          <button
            className="tenant-nav-link admin-sidebar-logout"
            onClick={toggleTheme}
            title={isSidebarCollapsed ? (theme === "dark" ? "Modo claro" : "Modo oscuro") : undefined}
            type="button"
          >
            {theme === "dark" ? <SunIcon className="tenant-nav-icon" /> : <MoonIcon className="tenant-nav-icon" />}
            <span className="tenant-nav-link-label">
              {theme === "dark" ? "Modo claro" : "Modo oscuro"}
            </span>
          </button>
          <LogoutButton className="button-secondary tenant-logout-button" />
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
