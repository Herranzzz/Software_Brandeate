"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { IncidentPriority, IncidentType } from "@/lib/types";


const incidentTypes: IncidentType[] = [
  "missing_asset",
  "personalization_error",
  "production_blocked",
  "shipping_exception",
  "address_issue",
  "stock_issue",
];

const incidentPriorities: IncidentPriority[] = ["low", "medium", "high", "urgent"];

type IncidentQuickCreateProps = {
  orderId: number;
};


export function IncidentQuickCreate({ orderId }: IncidentQuickCreateProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [type, setType] = useState<IncidentType>("missing_asset");
  const [priority, setPriority] = useState<IncidentPriority>("medium");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(
    null,
  );

  async function createIncident() {
    setMessage(null);

    const response = await fetch("/api/incidents", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        order_id: orderId,
        type,
        priority,
        status: "open",
        title,
        description: description || null,
      }),
    });

    if (!response.ok) {
      setMessage({ kind: "error", text: "No se pudo crear la incidencia." });
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
    <section className="card stack control-panel control-panel-compact">
      <div>
        <span className="eyebrow">Incidencias</span>
        <h3 className="section-title section-title-small">Crear incidencia</h3>
        <p className="subtitle">
          Registra bloqueos de personalización, producción o envío sin salir de la operativa.
        </p>
      </div>

      <div className="grid grid-2">
        <div className="field field-panel">
          <label htmlFor="incident-type">Tipo</label>
          <select
            id="incident-type"
            onChange={(event) => setType(event.target.value as IncidentType)}
            value={type}
          >
            {incidentTypes.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        <div className="field field-panel">
          <label htmlFor="incident-priority">Priority</label>
          <select
            id="incident-priority"
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

      <div className="field field-panel">
        <label htmlFor="incident-title">Title</label>
        <input
          id="incident-title"
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Falta asset del cliente"
          value={title}
        />
      </div>

      <div className="field field-panel">
        <label htmlFor="incident-description">Description</label>
        <textarea
          className="textarea"
          id="incident-description"
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Detalle operativo para el equipo"
          value={description}
        />
      </div>

      <button
        className="button"
        disabled={isPending || !title.trim()}
        onClick={createIncident}
        type="button"
      >
        {isPending ? "Guardando..." : "Crear incidencia"}
      </button>

      {message ? <div className={`feedback feedback-${message.kind}`}>{message.text}</div> : null}
    </section>
  );
}
