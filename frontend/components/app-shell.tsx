"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode, type SVGProps } from "react";


import { AdminCommandPalette } from "@/components/admin-command-palette";
import { BackgroundDesignJobChip } from "@/components/background-design-job-chip";
import { useLayoutState } from "@/components/layout-state-provider";
import { SidebarCollapseButton } from "@/components/sidebar-collapse-button";
import type { User } from "@/lib/types";

type AppShellUser = Pick<User, "name" | "role">;
type AppShellProps = { children: ReactNode; currentUser: AppShellUser | null };
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

function EmployeesIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" {...props}>
      <path d="M7.5 10.5a2.8 2.8 0 1 1 0-5.6 2.8 2.8 0 0 1 0 5.6Zm9 0a2.8 2.8 0 1 1 0-5.6 2.8 2.8 0 0 1 0 5.6Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.8 18.5c.7-2.7 2.7-4.2 5.4-4.2s4.7 1.5 5.4 4.2M12.6 18.5c.5-1.8 1.9-3 4.2-3.3 1.8-.2 3.3.7 3.9 3.3" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function ClientAccountsIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" {...props}>
      <circle cx="12" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5 19.5c.8-3 3.3-4.8 7-4.8s6.2 1.8 7 4.8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M17 12.5v5M14.5 15H19.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
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

function MenuIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" {...props}>
      <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function CloseIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" {...props}>
      <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function InventarioIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" {...props}>
      <rect height="6" rx="1.5" stroke="currentColor" strokeWidth="1.8" width="14" x="5" y="4" />
      <rect height="6" rx="1.5" stroke="currentColor" strokeWidth="1.8" width="14" x="5" y="14" />
      <path d="M9 7h6M9 17h4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function SuppliersIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" {...props}>
      <path d="M4 8h11v9H4zM15 11h4l2 2.5V17h-6" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
      <circle cx="8" cy="18.5" fill="currentColor" r="1.4" />
      <circle cx="17.5" cy="18.5" fill="currentColor" r="1.4" />
    </svg>
  );
}

function PurchaseOrdersIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" {...props}>
      <path d="M5 6.5h14l-1.3 10a2 2 0 0 1-2 1.7H8.3a2 2 0 0 1-2-1.7L5 6.5z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="M9 4.5h6v3H9z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9 11.5h6M9 14h4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
    </svg>
  );
}

function ReportingIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" {...props}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="M14 3v5h5" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="M9 13h6M9 17h4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function SustainabilityAdminIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" {...props}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 3c3 3 4.5 6 4.5 9s-1.5 6-4.5 9" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M12 3c-3 3-4.5 6-4.5 9s1.5 6 4.5 9" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M3 12h18" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
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

function InvoicesIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" {...props}>
      <rect height="16" rx="2.5" stroke="currentColor" strokeWidth="1.8" width="14" x="5" y="4" />
      <path d="M8.5 8.5h7M8.5 11.5h7M8.5 14.5h4.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M15 17l1.5 1.5L19 15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

/* ─── Nav structure ───────────────────────────────────────────────────────── */

type NavItem = {
  href: string;
  label: string;
  icon: (props: IconProps) => ReactNode;
  children?: Array<{
    href: string;
    label: string;
    icon: (props: IconProps) => ReactNode;
  }>;
};

type NavGroup = { label: string; items: NavItem[] };

const navGroups: NavGroup[] = [
  {
    label: "Operativa",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: DashboardIcon },
      { href: "/orders", label: "Pedidos", icon: OrdersIcon },
      { href: "/shipments", label: "Analítica", icon: ShipmentsIcon },
    ],
  },
  {
    label: "Postventa",
    items: [
      { href: "/returns", label: "Devoluciones", icon: ReturnsAdminIcon },
      { href: "/incidencias", label: "Incidencias", icon: IncidenciasIcon },
    ],
  },
  {
    label: "Cuentas",
    items: [
      { href: "/client-accounts", label: "Cuentas cliente", icon: ClientAccountsIcon },
      { href: "/invoices", label: "Facturación", icon: InvoicesIcon },
      { href: "/reporting", label: "Informes", icon: ReportingIcon },
    ],
  },
  {
    label: "Equipo",
    items: [
      { href: "/employees", label: "Empleados", icon: EmployeesIcon },
    ],
  },
  {
    label: "Aprovisionamiento",
    items: [
      {
        href: "/inventario",
        label: "Inventario",
        icon: InventarioIcon,
        children: [
          { href: "/suppliers", label: "Proveedores", icon: SuppliersIcon },
          { href: "/purchase-orders", label: "Órdenes de compra", icon: PurchaseOrdersIcon },
        ],
      },
    ],
  },
];

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  if (pathname === href) return true;
  if (!pathname.startsWith(`${href}/`)) return false;
  // Prefer the longest-matching nav href so a parent route (e.g. "/employees")
  // does not stay highlighted when a child route (e.g. "/employees/print-queue")
  // also exists in the sidebar.
  const allHrefs = navGroups.flatMap((group) =>
    group.items.flatMap((item) => [item.href, ...(item.children?.map((c) => c.href) ?? [])]),
  );
  const hasMoreSpecific = allHrefs.some(
    (other) => other !== href && other.length > href.length && (pathname === other || pathname.startsWith(`${other}/`)),
  );
  return !hasMoreSpecific;
}

function getInitials(name?: string | null) {
  if (!name) return "BR";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "BR";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

/* ─── AppShell ────────────────────────────────────────────────────────────── */

/* ─── Mobile bottom nav items ─────────────────────────────────────────────── */
const mobileNavItems = [
  { href: "/dashboard", label: "Dashboard", icon: DashboardIcon },
  { href: "/orders",    label: "Pedidos",   icon: OrdersIcon },
  { href: "/shipments", label: "Analítica", icon: ShipmentsIcon },
  { href: "/incidencias", label: "Incid.", icon: IncidenciasIcon },
];

export function AppShell({ children, currentUser }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { isSidebarCollapsed, theme, toggleTheme } = useLayoutState();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    navGroups.forEach((g) =>
      g.items.forEach((it) => {
        if (it.children?.length) {
          initial[it.href] = it.children.some((c) => pathname === c.href || pathname.startsWith(`${c.href}/`));
        }
      }),
    );
    return initial;
  });
  const toggleGroup = useCallback((href: string) => {
    setOpenGroups((prev) => ({ ...prev, [href]: !prev[href] }));
  }, []);

  // Close drawer on route change
  useEffect(() => { setIsMobileMenuOpen(false); }, [pathname]);
  const showEmployeeIdentity = Boolean(currentUser && currentUser.role !== "super_admin");
  const sidebarLogo = showEmployeeIdentity ? getInitials(currentUser?.name) : "BR";
  const sidebarTitle = showEmployeeIdentity ? currentUser?.name ?? "Brandeate" : "Brandeate";
  const sidebarEyebrow = showEmployeeIdentity ? "Empleado" : "Operaciones";

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

  if (pathname.startsWith("/tracking/") || pathname.startsWith("/tenant/") || pathname.startsWith("/returns-request")) {
    return <div className="public-shell">{children}</div>;
  }
  if (pathname.startsWith("/portal")) {
    return <div className="public-shell public-shell-portal">{children}</div>;
  }
  if (pathname.startsWith("/login")) {
    // Login owns its own full-bleed layout — skip the padded public-shell.
    return <>{children}</>;
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
            <div className="tenant-brand-lockup">
              <div className="tenant-logo tenant-logo-fallback">{sidebarLogo}</div>
              <div className="tenant-brand-copy">
                <span className="eyebrow">{sidebarEyebrow}</span>
                <h1 className="tenant-title">{sidebarTitle}</h1>
              </div>
            </div>
            <SidebarCollapseButton />
          </div>
        </div>

        {/* Navigation */}
        <nav className="tenant-nav">
          {navGroups.map((group) => (
            <div className="tenant-nav-group" key={group.label}>
              <div className="tenant-nav-section">{group.label}</div>
              {group.items.map((item) => {
                const hasChildren = (item.children?.length ?? 0) > 0;
                const isOpen = !!openGroups[item.href];
                return (
                  <div key={item.href} className="tenant-nav-item">
                    <div className="tenant-nav-link-row">
                      <Link
                        className={`tenant-nav-link${isActive(pathname, item.href) ? " tenant-nav-link-active" : ""}${hasChildren ? " tenant-nav-link-with-children" : ""}`}
                        href={item.href}
                        prefetch={false}
                        title={isSidebarCollapsed ? item.label : undefined}
                      >
                        <item.icon className="tenant-nav-icon" />
                        <span className="tenant-nav-link-label">{item.label}</span>
                      </Link>
                      {hasChildren && !isSidebarCollapsed ? (
                        <button
                          aria-expanded={isOpen}
                          aria-label={isOpen ? `Contraer ${item.label}` : `Expandir ${item.label}`}
                          className={`tenant-nav-caret${isOpen ? " tenant-nav-caret-open" : ""}`}
                          onClick={() => toggleGroup(item.href)}
                          type="button"
                        >
                          <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
                            <path d="m9 6 6 6-6 6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
                          </svg>
                        </button>
                      ) : null}
                    </div>
                    {hasChildren && isOpen && !isSidebarCollapsed
                      ? item.children!.map((child) => (
                          <Link
                            className={`tenant-nav-link tenant-nav-link-child${isActive(pathname, child.href) ? " tenant-nav-link-active" : ""}`}
                            href={child.href}
                            key={child.href}
                            prefetch={false}
                          >
                            <child.icon className="tenant-nav-icon" />
                            <span className="tenant-nav-link-label">{child.label}</span>
                          </Link>
                        ))
                      : null}
                  </div>
                );
              })}
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
        <div className="tenant-topbar tenant-topbar-admin">
          <AdminCommandPalette />
        </div>
        <main className="dashboard-content">{children}</main>
      </div>

      {/* Floating progress chip for any in-flight bulk-design ZIP. Renders
          itself only when localStorage has an active job, so it's a no-op
          for users who never trigger that flow. Mounted at shell level so
          it persists across page navigations. */}
      <BackgroundDesignJobChip />

      {/* ── Mobile bottom navigation ──────────────────────────── */}
      <nav className="mobile-bottom-nav" aria-label="Navegación principal">
        {mobileNavItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`mobile-bottom-nav-item${isActive(pathname, item.href) ? " is-active" : ""}`}
            prefetch={false}
          >
            <item.icon className="mobile-bottom-nav-icon" />
            <span className="mobile-bottom-nav-label">{item.label}</span>
          </Link>
        ))}
        <button
          className={`mobile-bottom-nav-item${isMobileMenuOpen ? " is-active" : ""}`}
          onClick={() => setIsMobileMenuOpen((v) => !v)}
          type="button"
          aria-label="Más opciones"
        >
          {isMobileMenuOpen
            ? <CloseIcon className="mobile-bottom-nav-icon" />
            : <MenuIcon className="mobile-bottom-nav-icon" />}
          <span className="mobile-bottom-nav-label">Más</span>
        </button>
      </nav>

      {/* ── Mobile drawer overlay ─────────────────────────────── */}
      {isMobileMenuOpen && (
        <div className="mobile-drawer-backdrop" onClick={() => setIsMobileMenuOpen(false)}>
          <div className="mobile-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="mobile-drawer-header">
              <div className="tenant-logo tenant-logo-fallback">{sidebarLogo}</div>
              <div>
                <span className="eyebrow">{sidebarEyebrow}</span>
                <p className="mobile-drawer-title">{sidebarTitle}</p>
              </div>
            </div>
            <nav className="mobile-drawer-nav">
              {navGroups.map((group) => (
                <div key={group.label} className="mobile-drawer-group">
                  <span className="mobile-drawer-section">{group.label}</span>
                  {group.items.map((item) => (
                    <div key={item.href}>
                      <Link
                        href={item.href}
                        className={`mobile-drawer-link${isActive(pathname, item.href) ? " is-active" : ""}`}
                        prefetch={false}
                      >
                        <item.icon className="mobile-bottom-nav-icon" />
                        <span>{item.label}</span>
                      </Link>
                      {item.children?.map((child) => (
                        <Link
                          href={child.href}
                          key={child.href}
                          className={`mobile-drawer-link mobile-drawer-link-child${isActive(pathname, child.href) ? " is-active" : ""}`}
                          prefetch={false}
                        >
                          <child.icon className="mobile-bottom-nav-icon" />
                          <span>{child.label}</span>
                        </Link>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </nav>
            <div className="mobile-drawer-footer">
              <button className="mobile-drawer-link" onClick={toggleTheme} type="button">
                {theme === "dark" ? <SunIcon className="mobile-bottom-nav-icon" /> : <MoonIcon className="mobile-bottom-nav-icon" />}
                <span>{theme === "dark" ? "Modo claro" : "Modo oscuro"}</span>
              </button>
              <Link
                href="/settings"
                className={`mobile-drawer-link${isActive(pathname, "/settings") ? " is-active" : ""}`}
                prefetch={false}
              >
                <SettingsIcon className="mobile-bottom-nav-icon" />
                <span>Ajustes</span>
              </Link>
              <button
                className="mobile-drawer-link is-logout"
                disabled={isLoggingOut}
                onClick={handleLogout}
                type="button"
              >
                <LogoutIcon className="mobile-bottom-nav-icon" />
                <span>{isLoggingOut ? "Saliendo…" : "Cerrar sesión"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
