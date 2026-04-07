"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { Shipment } from "@/lib/types";


const trackingEventOptions = [
  "label_created",
  "in_transit",
  "out_for_delivery",
  "pickup_available",
  "delivered",
  "exception",
] as const;

type TrackingEventOption = (typeof trackingEventOptions)[number];

type ShipmentOperationsProps = {
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


export function ShipmentOperations({ orderId, shipment }: ShipmentOperationsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [carrier, setCarrier] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [statusNorm, setStatusNorm] = useState<TrackingEventOption>("in_transit");
  const [statusRaw, setStatusRaw] = useState("");
  const [occurredAt, setOccurredAt] = useState(toDateTimeLocalValue(new Date()));
  const [shipmentMessage, setShipmentMessage] = useState<
    { kind: "success" | "error"; text: string } | null
  >(null);
  const [eventMessage, setEventMessage] = useState<
    { kind: "success" | "error"; text: string } | null
  >(null);

  async function createShipment() {
    setShipmentMessage(null);

    const response = await fetch("/api/shipments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        order_id: orderId,
        carrier,
        tracking_number: trackingNumber,
      }),
    });

    if (!response.ok) {
      setShipmentMessage({ kind: "error", text: "No se pudo crear el envio." });
      return;
    }

    setCarrier("");
    setTrackingNumber("");
    setShipmentMessage({ kind: "success", text: "Envio creado correctamente." });
    startTransition(() => {
      router.refresh();
    });
  }

  async function createTrackingEvent() {
    if (!shipment) {
      setEventMessage({ kind: "error", text: "Necesitas crear un shipment antes." });
      return;
    }

    setEventMessage(null);

    const response = await fetch(`/api/shipments/${shipment.id}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        status_norm: statusNorm,
        status_raw: statusRaw || null,
        occurred_at: new Date(occurredAt).toISOString(),
      }),
    });

    if (!response.ok) {
      setEventMessage({ kind: "error", text: "No se pudo crear el evento de tracking." });
      return;
    }

    setStatusRaw("");
    setOccurredAt(toDateTimeLocalValue(new Date()));
    setEventMessage({ kind: "success", text: "Evento de tracking creado correctamente." });
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <>
      {!shipment ? (
        <section className="card stack control-panel control-panel-compact">
          <div>
            <span className="eyebrow">Crear envio</span>
            <h3 className="section-title section-title-small">Generar shipment</h3>
            <p className="subtitle">
              Crea el envío para activar el flujo logístico y habilitar el tracking del pedido.
            </p>
          </div>

          <div className="grid grid-2">
            <div className="field field-panel">
              <label htmlFor="carrier">Carrier</label>
              <input
                id="carrier"
                onChange={(event) => setCarrier(event.target.value)}
                placeholder="DHL, UPS, Correos..."
                value={carrier}
              />
            </div>

            <div className="field field-panel">
              <label htmlFor="tracking-number">Tracking number</label>
              <input
                id="tracking-number"
                onChange={(event) => setTrackingNumber(event.target.value)}
                placeholder="ABC123456789"
                value={trackingNumber}
              />
            </div>
          </div>

          <button
            className="button"
            disabled={isPending || !carrier.trim() || !trackingNumber.trim()}
            onClick={createShipment}
            type="button"
          >
            {isPending ? "Guardando..." : "Crear envio"}
          </button>

          {shipmentMessage ? (
            <div className={`feedback feedback-${shipmentMessage.kind}`}>{shipmentMessage.text}</div>
          ) : null}
        </section>
      ) : null}

      {shipment ? (
        <section className="card stack control-panel control-panel-compact">
          <div>
            <span className="eyebrow">Añadir evento de tracking</span>
            <h3 className="section-title section-title-small">Actualizar tracking</h3>
            <p className="subtitle">
              Registra manualmente nuevos hitos del carrier para reflejar el estado real del envio.
            </p>
          </div>

            <div className="grid grid-2">
              <div className="field field-panel">
                <label htmlFor="status-norm">Status norm</label>
                <select
                  id="status-norm"
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

              <div className="field field-panel">
                <label htmlFor="occurred-at">Occurred at</label>
                <input
                  id="occurred-at"
                  onChange={(event) => setOccurredAt(event.target.value)}
                  type="datetime-local"
                  value={occurredAt}
                />
              </div>
            </div>

            <div className="field field-panel">
              <label htmlFor="status-raw">Status raw</label>
              <input
                id="status-raw"
                onChange={(event) => setStatusRaw(event.target.value)}
                placeholder="Package accepted by carrier"
                value={statusRaw}
              />
            </div>

            <button className="button" disabled={isPending} onClick={createTrackingEvent} type="button">
              {isPending ? "Guardando..." : "Añadir evento"}
            </button>

          {eventMessage ? (
            <div className={`feedback feedback-${eventMessage.kind}`}>{eventMessage.text}</div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
