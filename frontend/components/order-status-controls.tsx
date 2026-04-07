"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { orderStatusOptions, productionStatusOptions } from "@/lib/format";
import type { OrderStatus, ProductionStatus } from "@/lib/types";


type OrderStatusControlsProps = {
  orderId: number;
  status: OrderStatus;
  productionStatus: ProductionStatus;
};


export function OrderStatusControls({
  orderId,
  status,
  productionStatus,
}: OrderStatusControlsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [statusValue, setStatusValue] = useState<OrderStatus>(status);
  const [productionValue, setProductionValue] = useState<ProductionStatus>(productionStatus);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function updateOrder(path: string, body: Record<string, string>) {
    setMessage(null);

    const response = await fetch(path, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      setMessage({ kind: "error", text: "No se pudo actualizar el pedido." });
      return;
    }

    setMessage({ kind: "success", text: "Pedido actualizado correctamente." });
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <section className="card stack control-panel control-panel-compact">
      <div>
        <span className="eyebrow">Acciones</span>
        <h3 className="section-title section-title-small">Estados del pedido</h3>
        <p className="subtitle">Actualiza el estado logístico y de producción desde una sola card.</p>
      </div>

      <div className="grid grid-2">
        <div className="field field-panel">
          <label htmlFor="status-select">Status</label>
          <select
            id="status-select"
            value={statusValue}
            onChange={(event) => setStatusValue(event.target.value as OrderStatus)}
          >
            {orderStatusOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <button
            className="button"
            disabled={isPending}
            onClick={() => updateOrder(`/api/orders/${orderId}/status`, { status: statusValue })}
            type="button"
          >
            {isPending ? "Guardando..." : "Guardar"}
          </button>
        </div>

        <div className="field field-panel">
          <label htmlFor="production-status-select">Production status</label>
          <select
            id="production-status-select"
            value={productionValue}
            onChange={(event) => setProductionValue(event.target.value as ProductionStatus)}
          >
            {productionStatusOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <button
            className="button"
            disabled={isPending}
            onClick={() =>
              updateOrder(`/api/orders/${orderId}/production-status`, {
                production_status: productionValue,
              })
            }
            type="button"
          >
            {isPending ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>

      {message ? (
        <div className={`feedback feedback-${message.kind}`}>{message.text}</div>
      ) : null}
    </section>
  );
}
