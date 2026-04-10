"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import type { Shop } from "@/lib/types";


type TenantShellProps = {
  children: ReactNode;
  shop: Shop;
};


export function TenantShell({ children, shop }: TenantShellProps) {
  const pathname = usePathname();
  const basePath = `/tenant/${shop.id}`;
  const dashboardHref = `${basePath}/dashboard`;
  const ordersHref = `${basePath}/orders`;

  const navLinkClass = (href: string) =>
    pathname.startsWith(href) ? "tenant-nav-link tenant-nav-link-active" : "tenant-nav-link";

  return (
    <div className="tenant-shell tenant-shell-branded">
      <aside className="tenant-sidebar">
        <div className="tenant-sidebar-header">
          <div className="tenant-brand-lockup">
            <div className="tenant-logo tenant-logo-fallback" aria-hidden="true">
              {shop.name.slice(0, 2).toUpperCase()}
            </div>
            <div className="tenant-brand-copy">
              <span className="eyebrow">Portal cliente</span>
              <h1 className="tenant-title">{shop.name}</h1>
            </div>
          </div>
          <div className="tenant-sidebar-meta">
            <span className="tenant-sidebar-caption">Tienda activa</span>
            <span className="tenant-chip">{shop.slug}</span>
          </div>
        </div>

        <nav className="tenant-nav">
          <div className="tenant-nav-group">
            <span className="tenant-nav-section">Panel</span>
            <Link className={navLinkClass(dashboardHref)} href={dashboardHref}>
              <svg aria-hidden="true" className="tenant-nav-icon" fill="none" viewBox="0 0 24 24">
                <path d="M3 13h8V3H3v10Zm10 8h8V11h-8v10ZM3 21h8v-6H3v6Zm10-10h8V3h-8v8Z" fill="currentColor" />
              </svg>
              <span className="tenant-nav-link-label">Dashboard</span>
            </Link>
            <Link className={navLinkClass(ordersHref)} href={ordersHref}>
              <svg aria-hidden="true" className="tenant-nav-icon" fill="none" viewBox="0 0 24 24">
                <path d="M6 4h12a2 2 0 0 1 2 2v12H4V6a2 2 0 0 1 2-2Zm0 4h12V6H6v2Zm0 8h5v-2H6v2Z" fill="currentColor" />
              </svg>
              <span className="tenant-nav-link-label">Pedidos</span>
            </Link>
            <Link className="tenant-nav-link" href="/dashboard">
              <svg aria-hidden="true" className="tenant-nav-icon" fill="none" viewBox="0 0 24 24">
                <path d="m10 17-5-5 5-5v3h9v4h-9v3Z" fill="currentColor" />
              </svg>
              <span className="tenant-nav-link-label">Volver a admin</span>
            </Link>
          </div>
        </nav>
      </aside>

      <main className="tenant-main">
        <div className="tenant-content">{children}</div>
      </main>
    </div>
  );
}
