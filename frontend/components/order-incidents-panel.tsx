"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { IncidentStatusActions } from "@/components/incident-status-actions";
import type { Incident, IncidentPriority, IncidentType } from "@/lib/types";
import { formatDateTime } from "@/lib/format";


const incidentTypes: IncidentType[] = [
  "missing_asset",
  "personalization_error",
  "production_blocked",
  "shipping_exception",
  "address_issue",
  "stock_issue",
];

const incidentPriorities: IncidentPriority[] = ["low", "medium", "high", "urgent"];

type OrderIncidentsPanelProps = {
  orderId: number;
  incidents: Incident[];
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


export function OrderIncidentsPanel({ orderId, incidents }: OrderIncidentsPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [type, setType] = useState<IncidentType>("shipping_exception");
  const [priority, setPriority] = useState<IncidentPriority>("medium");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const activeIncidents = incidents.filter((incident) => incident.status !== "resolved");

  async function createIncident() {
    setMessage(null);
    const response = await fetch("/api/incidents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order_id: orderId,
        type,
        priority,
        status: "open",
        title: title.trim(),
        description: description.trim() || null,
      }),
    });
    if (!response.ok) {
      setMessage({ kind: "error", text: await readErrorDetail(response, "No se pudo crear la incidencia.") });
      return;
    }
    setTitle("");
    setDescription("");
    setMessage({ kind: "success", text: "Incidencia creada correctamente." });
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className="stack" style={{ gap: "14px" }}>
      <div className="stack" style={{ gap: "8px" }}>
        {activeIncidents.length > 0 ? (
          activeIncidents.map((incident) => (
            <article className="orders-drawer-incident" key={incident.id}>
              <div className="table-primary">{incident.title}</div>
              <div className="table-secondary">
                {incident.type} · {incident.priority} · {incident.status}
                {incident.is_automated ? " · automática" : ""}
              </div>
              <div className="table-secondary">{formatDateTime(incident.updated_at)}</div>
              <IncidentStatusActions incidentId={incident.id} status={incident.status} />
            </article>
          ))
        ) : (
          <div className="table-secondary">Sin incidencias activas en este pedido.</div>
        )}
      </div>

      <div className="stack" style={{ gap: "10px" }}>
        <span className="eyebrow">Crear incidencia</span>
        <div className="grid grid-2">
          <div className="field">
            <label htmlFor={`incident-type-${orderId}`}>Tipo</label>
            <select id={`incident-type-${orderId}`} onChange={(event) => setType(event.target.value as IncidentType)} value={type}>
              {incidentTypes.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`incident-priority-${orderId}`}>Prioridad</label>
            <select
              id={`incident-priority-${orderId}`}
              onChange={(event) => setPriority(event.target.value as IncidentPriority)}
              value={priority}
            >
              {incidentPriorities.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor={`incident-title-${orderId}`}>Título</label>
          <input
            id={`incident-title-${orderId}`}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Ejemplo: Pedido bloqueado en revisión de diseño"
            value={title}
          />
        </div>
        <div className="field">
          <label htmlFor={`incident-description-${orderId}`}>Descripción</label>
          <textarea
            id={`incident-description-${orderId}`}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Detalle operativo opcional"
            value={description}
          />
        </div>
        <button className="button-secondary" disabled={isPending || !title.trim()} onClick={() => void createIncident()} type="button">
          {isPending ? "Guardando..." : "Crear incidencia"}
        </button>
      </div>

      {message ? <div className={`feedback feedback-${message.kind}`}>{message.text}</div> : null}
    </div>
  );
}
