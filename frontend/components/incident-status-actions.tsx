"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { IncidentStatus } from "@/lib/types";


type IncidentStatusActionsProps = {
  incidentId: number;
  status: IncidentStatus;
  compact?: boolean;
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
    // keep plain text below
  }
  return text || fallback;
}


export function IncidentStatusActions({ incidentId, status, compact = false }: IncidentStatusActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  async function resolveIncident() {
    setFeedback(null);
    const response = await fetch(`/api/incidents/${incidentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "resolved" }),
    });
    if (!response.ok) {
      setFeedback(await readErrorDetail(response, "No se pudo marcar la incidencia como solucionada."));
      return;
    }
    startTransition(() => {
      router.refresh();
    });
  }

  if (status === "resolved") {
    return compact ? <span className="table-secondary">Solucionada</span> : <span className="feedback feedback-success">Incidencia solucionada</span>;
  }

  return (
    <div className={compact ? "order-inline-actions" : "stack"} style={compact ? undefined : { gap: "6px" }}>
      <button
        className={compact ? "button-secondary" : "button-secondary"}
        disabled={isPending}
        onClick={() => void resolveIncident()}
        type="button"
      >
        {isPending ? "Guardando..." : "Marcar solucionada"}
      </button>
      {feedback ? <div className="feedback feedback-error">{feedback}</div> : null}
    </div>
  );
}
