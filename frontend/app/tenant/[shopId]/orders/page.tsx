import Link from "next/link";

import { Card } from "@/components/card";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PersonalizationBadge } from "@/components/personalization-badge";
import { ProductionBadge } from "@/components/production-badge";
import { StatusBadge } from "@/components/status-badge";
import { fetchOrders, fetchShopById } from "@/lib/api";


type TenantOrdersPageProps = {
  params: Promise<{ shopId: string }>;
};


export default async function TenantOrdersPage({ params }: TenantOrdersPageProps) {
  const { shopId } = await params;
  const [shopResult, ordersResult] = await Promise.allSettled([
    fetchShopById(shopId),
    fetchOrders({ shop_id: shopId, page: 1, per_page: 100 }, { cacheSeconds: 30 }).then(({ orders }) => orders),
  ]);
  const shop = shopResult.status === "fulfilled" ? shopResult.value : null;
  const orders = ordersResult.status === "fulfilled" ? ordersResult.value : [];

  if (!shop) {
    return null;
  }

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Tus pedidos"
        title={shop.name}
        description="Vista cliente filtrada automaticamente a tu tienda."
      />

      <Card className="stack">
        {orders.length === 0 ? (
          <EmptyState
            title="Sin pedidos"
            description="Aun no hay pedidos para esta tienda."
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Cliente</th>
                  <th>Tipo</th>
                  <th>Status</th>
                  <th>Producción</th>
                  <th>Envío</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr className="table-row" key={order.id}>
                    <td>
                      <Link className="table-link table-link-strong" href={`/orders/${order.id}`}>
                        {order.external_id}
                      </Link>
                    </td>
                    <td>{order.customer_name}</td>
                    <td><PersonalizationBadge isPersonalized={order.is_personalized} /></td>
                    <td><StatusBadge status={order.status} /></td>
                    <td><ProductionBadge status={order.production_status} /></td>
                    <td>{order.shipment?.tracking_number ?? "Pendiente"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
