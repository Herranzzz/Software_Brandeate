"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import type { IncidentPriority, IncidentType, Shipment } from "@/lib/types";

const incidentTypes: IncidentType[] = [
  "missing_asset",
  "personalization_error",
  "production_blocked",
  "shipping_exception",
  "address_issue",
  "stock_issue",
];

const incidentPriorities: IncidentPriority[] = ["low", "medium", "high", "urgent"];

const trackingEventOptions = [
  "label_created",
  "in_transit",
  "out_for_delivery",
  "pickup_available",
  "delivered",
  "exception",
] as const;

type TrackingEventOption = (typeof trackingEventOptions)[number];

type ModalKind = "shipment" | "incident" | "event" | null;

type OrderActionModalsProps = {
  orderId: number;
  shipment: Shipment | null;
};

function toDateTimeLocalValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function OrderActionModals({ orderId, shipment }: OrderActionModalsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [modal, setModal] = useState<ModalKind>(null);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const [carrier, setCarrier] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");

  const [incidentType, setIncidentType] = useState<IncidentType>("missing_asset");
  const [incidentPriority, setIncidentPriority] = useState<IncidentPriority>("medium");
  const [incidentTitle, setIncidentTitle] = useState("");
  const [incidentDescription, setIncidentDescription] = useState("");

  const [statusNorm, setStatusNorm] = useState<TrackingEventOption>("in_transit");
  const [statusRaw, setStatusRaw] = useState("");
  const [occurredAt, setOccurredAt] = useState(toDateTimeLocalValue(new Date()));

  const shipmentSummary = useMemo(() => {
    if (!shipment) {
      return "Sin envío creado";
    }

    return `${shipment.carrier} · ${shipment.tracking_number}`;
  }, [shipment]);

  function closeModal() {
    setModal(null);
    setMessage(null);
  }

  async function createShipment() {
    setMessage(null);
    const response = await fetch("/api/shipments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order_id: orderId,
        carrier,
        tracking_number: trackingNumber,
      }),
    });

    if (!response.ok) {
      setMessage({ kind: "error", text: "No se pudo crear el envío." });
      return;
    }

    setMessage({ kind: "success", text: "Envío creado correctamente." });
    setCarrier("");
    setTrackingNumber("");
    startTransition(() => {
      router.refresh();
      setModal(null);
    });
  }

  async function createIncident() {
    setMessage(null);
    const response = await fetch("/api/incidents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order_id: orderId,
        type: incidentType,
        priority: incidentPriority,
        status: "open",
        title: incidentTitle,
        description: incidentDescription || null,
      }),
    });

    if (!response.ok) {
      setMessage({ kind: "error", text: "No se pudo crear la incidencia." });
      return;
    }

    setMessage({ kind: "success", text: "Incidencia creada correctamente." });
    setIncidentTitle("");
    setIncidentDescription("");
    startTransition(() => {
      router.refresh();
      setModal(null);
    });
  }

  async function createTrackingEvent() {
    if (!shipment) {
      setMessage({ kind: "error", text: "Necesitas un envío para registrar un evento manual." });
      return;
    }

    setMessage(null);
    const response = await fetch(`/api/shipments/${shipment.id}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status_norm: statusNorm,
        status_raw: statusRaw || null,
        occurred_at: new Date(occurredAt).toISOString(),
      }),
    });

    if (!response.ok) {
      setMessage({ kind: "error", text: "No se pudo registrar el evento manual." });
      return;
    }

    setMessage({ kind: "success", text: "Evento manual registrado correctamente." });
    setStatusRaw("");
    setOccurredAt(toDateTimeLocalValue(new Date()));
    startTransition(() => {
      router.refresh();
      setModal(null);
    });
  }

  return (
    <>
      <div className="order-inline-actions">
        {!shipment ? (
          <button className="button-secondary" onClick={() => setModal("shipment")} type="button">
            Crear envío
          </button>
        ) : null}
        <button className="button-secondary" onClick={() => setModal("incident")} type="button">
          Nueva incidencia
        </button>
        {shipment ? (
          <button className="button-secondary" onClick={() => setModal("event")} type="button">
            Evento manual
          </button>
        ) : null}
      </div>

      {modal ? (
        <div className="modal-backdrop" onClick={closeModal} role="presentation">
          <div
            aria-modal="true"
            className="modal-sheet"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="modal-head">
              <div>
                <span className="eyebrow">Acciones</span>
                <h3 className="section-title section-title-small">
                  {modal === "shipment"
                    ? "Crear envío"
                    : modal === "incident"
                      ? "Crear incidencia"
                      : "Registrar evento manual"}
                </h3>
                <p className="subtitle">
                  {modal === "shipment"
                    ? "Crea el envío solo si este pedido todavía no tiene uno asociado."
                    : modal === "incident"
                      ? "Abre una incidencia sin salir del detalle del pedido."
                      : `El tracking se sincroniza automáticamente. Usa esto solo si necesitas añadir un hito puntual. ${shipmentSummary}`}
                </p>
              </div>
              <button className="button-secondary" onClick={closeModal} type="button">
                Cerrar
              </button>
            </div>

            {modal === "shipment" ? (
              <div className="stack">
                <div className="grid grid-2">
                  <div className="field">
                    <label htmlFor="modal-carrier">Carrier</label>
                    <input
                      id="modal-carrier"
                      onChange={(event) => setCarrier(event.target.value)}
                      placeholder="CTT Express, DHL, Correos..."
                      value={carrier}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="modal-tracking">Tracking number</label>
                    <input
                      id="modal-tracking"
                      onChange={(event) => setTrackingNumber(event.target.value)}
                      placeholder="ABC123456789"
                      value={trackingNumber}
                    />
                  </div>
                </div>
                <div className="modal-footer">
                  <button
                    className="button"
                    disabled={isPending || !carrier.trim() || !trackingNumber.trim()}
                    onClick={createShipment}
                    type="button"
                  >
                    {isPending ? "Guardando..." : "Crear envío"}
                  </button>
                </div>
              </div>
            ) : null}

            {modal === "incident" ? (
              <div className="stack">
                <div className="grid grid-2">
                  <div className="field">
                    <label htmlFor="modal-incident-type">Tipo</label>
                    <select
                      id="modal-incident-type"
                      onChange={(event) => setIncidentType(event.target.value as IncidentType)}
                      value={incidentType}
                    >
                      {incidentTypes.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="modal-incident-priority">Prioridad</label>
                    <select
                      id="modal-incident-priority"
                      onChange={(event) => setIncidentPriority(event.target.value as IncidentPriority)}
                      value={incidentPriority}
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
                  <label htmlFor="modal-incident-title">Título</label>
                  <input
                    id="modal-incident-title"
                    onChange={(event) => setIncidentTitle(event.target.value)}
                    placeholder="Falta diseño del cliente"
                    value={incidentTitle}
                  />
                </div>
                <div className="field">
                  <label htmlFor="modal-incident-description">Descripción</label>
                  <textarea
                    id="modal-incident-description"
                    onChange={(event) => setIncidentDescription(event.target.value)}
                    placeholder="Detalle corto para operaciones"
                    value={incidentDescription}
                  />
                </div>
                <div className="modal-footer">
                  <button
                    className="button"
                    disabled={isPending || !incidentTitle.trim()}
                    onClick={createIncident}
                    type="button"
                  >
                    {isPending ? "Guardando..." : "Crear incidencia"}
                  </button>
                </div>
              </div>
            ) : null}

            {modal === "event" ? (
              <div className="stack">
                <div className="grid grid-2">
                  <div className="field">
                    <label htmlFor="modal-status-norm">Estado</label>
                    <select
                      id="modal-status-norm"
                      onChange={(event) => setStatusNorm(event.target.value as TrackingEventOption)}
                      value={statusNorm}
                    >
                      {trackingEventOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="modal-occurred-at">Fecha</label>
                    <input
                      id="modal-occurred-at"
                      onChange={(event) => setOccurredAt(event.target.value)}
                      type="datetime-local"
                      value={occurredAt}
                    />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="modal-status-raw">Detalle</label>
                  <input
                    id="modal-status-raw"
                    onChange={(event) => setStatusRaw(event.target.value)}
                    placeholder="Package accepted by carrier"
                    value={statusRaw}
                  />
                </div>
                <div className="modal-footer">
                  <button className="button" disabled={isPending} onClick={createTrackingEvent} type="button">
                    {isPending ? "Guardando..." : "Registrar evento"}
                  </button>
                </div>
              </div>
            ) : null}

            {message ? <div className={`feedback feedback-${message.kind}`}>{message.text}</div> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
