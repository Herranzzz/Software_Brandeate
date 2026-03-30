"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type CSSProperties, type ReactNode, type SVGProps } from "react";

import { LogoutButton } from "@/components/logout-button";


type AppShellProps = {
  children: ReactNode;
};

type IconProps = SVGProps<SVGSVGElement>;

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

function AccountsIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" {...props}>
      <path d="M8.5 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6ZM15.8 12.5a2.8 2.8 0 1 0 0-5.6" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4.5 18.5c.7-2.5 2.6-4 5.2-4s4.5 1.5 5.2 4M15 18.5c.5-1.7 1.8-2.8 3.8-3.1" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
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

const navItems = [
  { href: "/dashboard", label: "Dashboard", shortLabel: "Inicio", icon: DashboardIcon },
  { href: "/orders", label: "Pedidos", shortLabel: "Pedidos", icon: OrdersIcon },
  { href: "/customers", label: "Cuentas cliente", shortLabel: "Clientes", icon: AccountsIcon },
  { href: "/shipments", label: "Expediciones", shortLabel: "Envios", icon: ShipmentsIcon },
  { href: "/settings", label: "Ajustes", shortLabel: "Ajustes", icon: SettingsIcon },
];

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") {
    return pathname === "/dashboard";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const [isHovered, setIsHovered] = useState(false);
  const isCollapsed = !isHovered;
  const style = {
    "--tenant-accent": "var(--accent)",
    "--tenant-accent-soft": "rgba(var(--accent-rgb), 0.14)",
  } as CSSProperties;

  if (pathname.startsWith("/tracking/")) {
    return <div className="public-shell">{children}</div>;
  }

  if (pathname.startsWith("/tenant/")) {
    return <div className="public-shell">{children}</div>;
  }

  if (pathname.startsWith("/portal")) {
    return <div className="public-shell public-shell-portal">{children}</div>;
  }

  if (pathname.startsWith("/login")) {
    return <div className="public-shell">{children}</div>;
  }

  return (
    <div className={`tenant-shell tenant-shell-admin ${isCollapsed ? "tenant-shell-collapsed" : ""}`} style={style}>
      <aside
        className="tenant-sidebar tenant-sidebar-admin"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <div className="tenant-sidebar-header">
          <div className="tenant-brand-lockup">
            <div className="tenant-logo tenant-logo-fallback">BR</div>
            <div className="tenant-brand-copy">
              <span className="eyebrow">Brandeate Ops</span>
              <h1 className="tenant-title">Operations Hub</h1>
            </div>
          </div>
        </div>

        <div className="tenant-sidebar-meta">
          <span className="tenant-sidebar-caption">Cuenta admin</span>
          <span className="tenant-sidebar-slug">Brandeate</span>
        </div>

        <nav className="tenant-nav">
          <div className="tenant-nav-section">Navegación</div>
          {navItems.map((item) => (
            <Link
              className={`tenant-nav-link ${isActive(pathname, item.href) ? "tenant-nav-link-active" : ""}`}
              href={item.href}
              key={item.href}
              title={isCollapsed ? item.label : undefined}
            >
              <item.icon className="tenant-nav-icon" />
              <span className="tenant-nav-link-label">{isCollapsed ? item.shortLabel : item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="tenant-sidebar-footer">
          <div className="tenant-chip">Brandeate live</div>
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

      <div className="dashboard-main dashboard-main-admin">
        <main className="dashboard-content">{children}</main>
      </div>
    </div>
  );
}
