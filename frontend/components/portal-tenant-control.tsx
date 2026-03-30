import type { ReactNode } from "react";

import type { Shop } from "@/lib/types";


type PortalTenantControlProps = {
  shops: Shop[];
  selectedShopId: string;
  action: string;
  hiddenFields?: Record<string, string | number | boolean | null | undefined>;
  submitLabel?: string;
  title?: string;
  description?: string;
  trailingActions?: ReactNode;
};


export function PortalTenantControl({
  shops,
  selectedShopId,
  action,
  hiddenFields,
  submitLabel = "Aplicar",
  title = "Tienda visible",
  description = "La cuenta cliente reutiliza la misma base del admin, limitada a las tiendas que tienes asignadas.",
  trailingActions,
}: PortalTenantControlProps) {
  if (shops.length === 0) {
    return null;
  }

  const selectedShop = shops.find((shop) => String(shop.id) === selectedShopId) ?? shops[0];

  return (
    <div className="portal-tenant-control">
      <div className="portal-tenant-control-copy">
        <span className="eyebrow">{title}</span>
        <div className="portal-tenant-control-title">{selectedShop?.name ?? "Sin tienda asignada"}</div>
        <div className="table-secondary">{description}</div>
      </div>

      {shops.length > 1 ? (
        <form action={action} className="portal-tenant-control-form" method="get">
          {Object.entries(hiddenFields ?? {}).map(([key, value]) => {
            if (value === undefined || value === null || value === "") {
              return null;
            }
            return <input key={key} name={key} type="hidden" value={String(value)} />;
          })}
          <select className="portal-inline-select" defaultValue={selectedShopId} name="shop_id">
            {shops.map((shop) => (
              <option key={shop.id} value={shop.id}>
                {shop.name}
              </option>
            ))}
          </select>
          <button className="button button-secondary" type="submit">
            {submitLabel}
          </button>
          {trailingActions}
        </form>
      ) : (
        <div className="portal-tenant-control-single">
          <span className="portal-soft-pill">{selectedShop?.name ?? "Sin tienda"}</span>
          {trailingActions}
        </div>
      )}
    </div>
  );
}
