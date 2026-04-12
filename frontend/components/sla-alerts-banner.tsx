"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type SlaData = {
  no_shipment_3d: number;
  stalled_transit_7d: number;
  total_alerts: number;
};

export function SlaAlertsBanner({ basePath = "/orders" }: { basePath?: string }) {
  const [data, setData] = useState<SlaData | null>(null);

  useEffect(() => {
    fetch("/api/orders/sla-alerts")
      .then((res) => res.ok ? res.json() : null)
      .then(setData)
      .catch(() => null);
  }, []);

  if (!data || data.total_alerts === 0) return null;

  return (
    <div className="sla-alerts-banner">
      <div className="sla-alerts-icon">{"\u26A1"}</div>
      <div className="sla-alerts-content">
        <strong className="sla-alerts-title">Atenci&oacute;n: {data.total_alerts} pedido{data.total_alerts !== 1 ? "s" : ""} con SLA en riesgo</strong>
        <div className="sla-alerts-details">
          {data.no_shipment_3d > 0 && (
            <span>{data.no_shipment_3d} sin env&iacute;o ({">"}3 d&iacute;as)</span>
          )}
          {data.stalled_transit_7d > 0 && (
            <span>{data.stalled_transit_7d} en tr&aacute;nsito ({">"}7 d&iacute;as)</span>
          )}
        </div>
      </div>
      <Link className="button-small button-secondary" href={`${basePath}?overdue_sla=true`}>
        Ver pedidos
      </Link>
    </div>
  );
}
