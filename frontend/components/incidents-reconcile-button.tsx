"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";


type ReconcilePayload = {
  orders_rechecked: number;
  open_before: number;
  open_after: number;
  resolved_total: number;
  automated_open_before: number;
  automated_open_after: number;
  automated_resolved: number;
  lifecycle_resolved_terminal_orders: number;
  lifecycle_resolved_stale: number;
  lifecycle_resolved_total: number;
};


async function readErrorDetail(response: Response, fallback: string) {
  const text = (await response.text()).trim();
  if (!text) return fallback;
  try {
    const payload = JSON.parse(text) as { detail?: unknown };
    if (typeof payload.detail === "string" && payload.detail.trim()) {
      return payload.detail.trim();
    }
  } catch {
    // keep text fallback
  }
  return text || fallback;
}


export function IncidentsReconcileButton() {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  async function reconcile() {
    setFeedback(null);
    const shopId = params.get("shop_id");
    const query = shopId ? `?shop_id=${encodeURIComponent(shopId)}` : "";
    const response = await fetch(`/api/incidents/reconcile${query}`, { method: "POST" });
    if (!response.ok) {
      setFeedback(await readErrorDetail(response, "No se pudo recalcular incidencias automáticas."));
      return;
    }
    const payload = (await response.json()) as ReconcilePayload;
    setFeedback(
      `Revisión completada: ${payload.orders_rechecked} pedidos comprobados, ${payload.resolved_total} incidencias cerradas (${payload.automated_resolved} automáticas, ${payload.lifecycle_resolved_total} por ciclo de vida).`,
    );
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className="stack" style={{ gap: "6px" }}>
      <button className="button-secondary" disabled={isPending} onClick={() => void reconcile()} type="button">
        {isPending ? "Recalculando..." : "Recalcular incidencias automáticas"}
      </button>
      {feedback ? <div className="table-secondary">{feedback}</div> : null}
    </div>
  );
}
