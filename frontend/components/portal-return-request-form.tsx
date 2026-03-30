"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import type { Order } from "@/lib/types";

type PortalReturnRequestFormProps = {
  orders: Order[];
  shopId?: string;
};

const reasonOptions = [
  {
    value: "shipping_exception",
    label: "Problema con el envío",
    title: "Devolución por problema con el envío",
    hint: "Golpe, retraso o incidencia con el transporte.",
  },
  {
    value: "personalization_error",
    label: "Producto o personalización incorrecta",
    title: "Devolución por personalización incorrecta",
    hint: "Texto, foto, diseño o acabado no coincide con lo esperado.",
  },
  {
    value: "address_issue",
    label: "No entregado o dirección",
    title: "Devolución por no entrega o dirección",
    hint: "El carrier no pudo completar la entrega correctamente.",
  },
  {
    value: "stock_issue",
    label: "Producto defectuoso o dañado",
    title: "Devolución por producto defectuoso",
    hint: "El producto llegó roto, con daño o con un fallo visible.",
  },
  {
    value: "missing_asset",
    label: "Falta material o evidencia",
    title: "Solicitud de revisión con material pendiente",
    hint: "Necesitas adjuntar más contexto o referencias para revisar el caso.",
  },
] as const;

export function PortalReturnRequestForm({ orders, shopId }: PortalReturnRequestFormProps) {
  const router = useRouter();
  const defaultOrderId = String(orders[0]?.id ?? "");
  const [orderId, setOrderId] = useState(defaultOrderId);
  const [reason, setReason] = useState<(typeof reasonOptions)[number]["value"]>("shipping_exception");
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");
  const [description, setDescription] = useState("");
  const [imageLinks, setImageLinks] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedReason = useMemo(
    () => reasonOptions.find((option) => option.value === reason) ?? reasonOptions[0],
    [reason],
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!orderId) {
      setError("Selecciona un pedido para crear la solicitud.");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setMessage(null);

    const composedDescription = [
      description.trim(),
      imageLinks.trim() ? `Enlaces de apoyo:\n${imageLinks.trim()}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const response = await fetch("/api/incidents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order_id: Number(orderId),
        type: reason,
        priority,
        status: "open",
        title: selectedReason.title,
        description: composedDescription || selectedReason.hint,
      }),
    });

    setIsSubmitting(false);

    if (!response.ok) {
      let detail = "No hemos podido crear la solicitud ahora mismo.";
      try {
        const payload = (await response.json()) as { detail?: string };
        if (payload.detail) {
          detail = payload.detail;
        }
      } catch {
        // ignore
      }
      setError(detail);
      return;
    }

    setMessage("Solicitud creada. Ya la verás en la lista de devoluciones activas.");
    setDescription("");
    setImageLinks("");
    router.refresh();
  }

  return (
    <form className="portal-return-form" onSubmit={handleSubmit}>
      <div className="portal-return-form-grid">
        <label className="field">
          <span>Pedido</span>
          <select onChange={(event) => setOrderId(event.target.value)} value={orderId}>
            {orders.map((order) => (
              <option key={order.id} value={String(order.id)}>
                {order.external_id} · {order.customer_name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Motivo</span>
          <select
            onChange={(event) => setReason(event.target.value as (typeof reasonOptions)[number]["value"])}
            value={reason}
          >
            {reasonOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Prioridad</span>
          <select
            onChange={(event) => setPriority(event.target.value as "low" | "medium" | "high")}
            value={priority}
          >
            <option value="low">Baja</option>
            <option value="medium">Media</option>
            <option value="high">Alta</option>
          </select>
        </label>
      </div>

      <div className="portal-return-reason-hint">
        <strong>{selectedReason.label}</strong>
        <span>{selectedReason.hint}</span>
      </div>

      <label className="field">
        <span>Qué ha ocurrido</span>
        <textarea
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Describe brevemente el problema y qué esperas que revisemos."
          rows={5}
          value={description}
        />
      </label>

      <label className="field">
        <span>Enlaces a imágenes o pruebas</span>
        <textarea
          onChange={(event) => setImageLinks(event.target.value)}
          placeholder="Pega uno o varios enlaces, uno por línea, si quieres adjuntar fotos o capturas."
          rows={3}
          value={imageLinks}
        />
      </label>

      <div className="portal-return-form-actions">
        <button className="button" disabled={isSubmitting || !orders.length} type="submit">
          {isSubmitting ? "Enviando..." : "Crear solicitud"}
        </button>
        <a
          className="button button-secondary"
          href={`/portal/orders${shopId ? `?shop_id=${shopId}` : ""}`}
        >
          Revisar pedidos
        </a>
      </div>

      {message ? <p className="portal-return-form-message">{message}</p> : null}
      {error ? <p className="portal-return-form-error">{error}</p> : null}
    </form>
  );
}
