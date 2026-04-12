"use client";

import { useEffect, useState } from "react";

type Prediction = {
  risk: "none" | "low" | "medium" | "high" | "unknown";
  risk_pct: number;
  message: string;
  estimated_delivery: string | null;
  days_in_transit?: number;
  expected_days?: number;
};

export function DeliveryRiskBadge({ orderId }: { orderId: number }) {
  const [data, setData] = useState<Prediction | null>(null);

  useEffect(() => {
    fetch(`/api/orders/${orderId}/delivery-prediction`)
      .then((res) => (res.ok ? res.json() : null))
      .then(setData)
      .catch(() => null);
  }, [orderId]);

  if (!data || data.risk === "none" || data.risk === "unknown") return null;

  const color =
    data.risk === "high" ? "drb-high" :
    data.risk === "medium" ? "drb-medium" : "drb-low";

  return (
    <div className={`drb ${color}`}>
      <div className="drb-header">
        <span className="drb-icon">
          {data.risk === "high" ? "\u{1F534}" : data.risk === "medium" ? "\u{1F7E1}" : "\u{1F7E2}"}
        </span>
        <span className="drb-label">Predicci&oacute;n de entrega</span>
        <span className="drb-pct">{data.risk_pct}% riesgo</span>
      </div>
      <div className="drb-bar-track">
        <div
          className="drb-bar-fill"
          style={{ width: `${data.risk_pct}%` }}
        />
      </div>
      <div className="drb-msg">{data.message}</div>
    </div>
  );
}
