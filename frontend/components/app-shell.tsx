"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useState, type CSSProperties, type ReactNode, type SVGProps } from "react";

import { SidebarCollapseButton } from "@/components/sidebar-collapse-button";
import { useLayoutState } from "@/components/layout-state-provider";

type AppShellProps = { children: ReactNode };
type IconProps = SVGProps<SVGSVGElement>;

/* ─── Icons ──────────────────────────────────────────────────────────────── */

function DashboardIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" {...props}>
      <rect height="7" rx="2" stroke="currentColor" strokeWidth="1.8" width="7" x="4.5" y="4.5" />
      <rect height="7" rx="2" stroke="currentColor" strokeWidth="1.8" width="7" x="12.5" y="4.5" />
      <rect height="7" rx="2" stroke="currentColor" strokeWidth="1.8" width="7" x="4.5" y="12.5" />
      <rect height="7" rx="2" stroke="currentColor" strokeWidth="1.8" width="7" x="12.5" y="12.5" />
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

function ShipmentsIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" {...props}>
      <path d="M4.5 7.5h10v8h-10zM14.5 10h3.2l1.8 2.2v3.3h-5" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
      <circle cx="8" cy="17" fill="currentColor" r="1.4" />
      <circle cx="17" cy="17" fill="currentColor" r="1.4" />
    </svg>
  );
}

function AccountsIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" {...props}>
      <path d="M8.5 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6ZM15.8 12.5a2.8 2.8 0 1 0 0-5.6" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4.5 18.5c.7-2.5 2.6-4 5.2-4s4.5 1.5 5.2 4M15 18.5c.5-1.7 1.8-2.8 3.8-3.1" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
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

function ReturnsAdminIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" {...props}>
      <path d="M7 8.5h10a2.5 2.5 0 0 1 0 5H9.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M10.5 5.5 7 8.5l3.5 3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

/* ─── Nav structure ───────────────────────────────────────────────────────── */

const navGroups = [
  {
    label: "Operativa",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: DashboardIcon },
      { href: "/orders", label: "Pedidos", icon: OrdersIcon },
      { href: "/shipments", label: "Expediciones", icon: ShipmentsIcon },
    ],
  },
  {
    label: "Gestión",
    items: [
      { href: "/customers", label: "Clientes", icon: AccountsIcon },
      { href: "/returns", label: "Devoluciones", icon: ReturnsAdminIcon },
      { href: "/incidencias", label: "Incidencias", icon: IncidenciasIcon },
    ],
  },
];

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/* ─── AppShell ────────────────────────────────────────────────────────────── */

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const { isSidebarCollapsed, theme, toggleTheme } = useLayoutState();

  const handleLogout = useCallback(async () => {
    setIsLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }, [router]);

  const style = {
    "--tenant-accent": "var(--accent)",
    "--tenant-accent-soft": "rgba(var(--accent-rgb), 0.14)",
  } as CSSProperties;

  if (pathname.startsWith("/tracking/") || pathname.startsWith("/tenant/")) {
    return <div className="public-shell">{children}</div>;
  }
  if (pathname.startsWith("/portal")) {
    return <div className="public-shell public-shell-portal">{children}</div>;
  }
  if (pathname.startsWith("/login")) {
    return <div className="public-shell">{children}</div>;
  }

  return (
    <div
      className={`tenant-shell tenant-shell-admin${isSidebarCollapsed ? " tenant-shell-collapsed" : ""}`}
      style={style}
    >
      <aside className="tenant-sidebar tenant-sidebar-admin">
        {/* Brand */}
        <div className="tenant-sidebar-header">
          <div className="tenant-sidebar-header-actions">
            <SidebarCollapseButton />
          </div>
          <div className="tenant-brand-lockup">
            <div className="tenant-logo tenant-logo-fallback">BR</div>
            <div className="tenant-brand-copy">
              <span className="eyebrow">Operaciones</span>
              <h1 className="tenant-title">Brandeate</h1>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="tenant-nav">
          {navGroups.map((group) => (
            <div className="tenant-nav-group" key={group.label}>
              <div className="tenant-nav-section">{group.label}</div>
              {group.items.map((item) => (
                <Link
                  className={`tenant-nav-link${isActive(pathname, item.href) ? " tenant-nav-link-active" : ""}`}
                  href={item.href}
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

        {/* Footer */}
        <div className="tenant-sidebar-footer">
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
          <Link
            className={`tenant-nav-link${isActive(pathname, "/settings") ? " tenant-nav-link-active" : ""}`}
            href="/settings"
            title={isSidebarCollapsed ? "Ajustes" : undefined}
            prefetch={false}
          >
            <SettingsIcon className="tenant-nav-icon" />
            <span className="tenant-nav-link-label">Ajustes</span>
          </Link>
          <button
            className="tenant-nav-link admin-sidebar-logout"
            disabled={isLoggingOut}
            onClick={handleLogout}
            title={isSidebarCollapsed ? "Cerrar sesión" : undefined}
            type="button"
          >
            <LogoutIcon className="tenant-nav-icon" />
            <span className="tenant-nav-link-label">
              {isLoggingOut ? "Saliendo…" : "Cerrar sesión"}
            </span>
          </button>
        </div>
      </aside>

      <div className="dashboard-main dashboard-main-admin">
        <main className="dashboard-content">{children}</main>
      </div>
    </div>
  );
}
