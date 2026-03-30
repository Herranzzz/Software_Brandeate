import Link from "next/link";
import type { ReactNode } from "react";

import type { Shop } from "@/lib/types";


type TenantShellProps = {
  children: ReactNode;
  shop: Shop;
};


export function TenantShell({ children, shop }: TenantShellProps) {
  const basePath = `/tenant/${shop.id}`;

  return (
    <div className="tenant-shell">
      <header className="tenant-header">
        <div>
          <span className="eyebrow">Portal cliente</span>
          <h1 className="tenant-title">{shop.name}</h1>
          <p className="subtitle">Vista enfocada en los pedidos y envios de tu tienda.</p>
        </div>
        <div className="tenant-chip">{shop.slug}</div>
      </header>

      <nav className="tenant-nav">
        <Link className="nav-link" href={`${basePath}/dashboard`}>
          Dashboard
        </Link>
        <Link className="nav-link" href={`${basePath}/orders`}>
          Pedidos
        </Link>
        <Link className="nav-link" href="/orders">
          Volver a admin
        </Link>
      </nav>

      <div className="tenant-content">{children}</div>
    </div>
  );
}
