"use client";

import { useState, useTransition } from "react";

const REASONS = [
  "Producto defectuoso",
  "Producto incorrecto",
  "No corresponde con la descripci\u00f3n",
  "Cambio de talla/color",
  "Ya no lo necesito",
  "Otro",
];

export function ReturnRequestForm() {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [orderId, setOrderId] = useState("");
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const res = await fetch("/api/returns/request-public", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            order_external_id: orderId.trim(),
            customer_email: email.trim(),
            reason,
            notes: notes.trim() || null,
          }),
        });
        const data = await res.json();
        if (res.ok) {
          setResult({ ok: true, message: data.message ?? "Solicitud recibida correctamente." });
        } else {
          setResult({ ok: false, message: data.detail ?? "Error al enviar la solicitud." });
        }
      } catch {
        setResult({ ok: false, message: "Error de conexi\u00f3n. Int\u00e9ntalo de nuevo." });
      }
    });
  }

  if (result?.ok) {
    return (
      <div className="return-request-success">
        <div className="return-request-success-icon">{"\u2705"}</div>
        <h2>Solicitud enviada</h2>
        <p>{result.message}</p>
      </div>
    );
  }

  return (
    <form className="return-request-form" onSubmit={handleSubmit}>
      {result && !result.ok && (
        <div className="return-request-error">{result.message}</div>
      )}
      <div className="return-request-field">
        <label htmlFor="rr-order">N&uacute;mero de pedido</label>
        <input
          id="rr-order"
          type="text"
          placeholder="#12345"
          value={orderId}
          onChange={(e) => setOrderId(e.target.value)}
          required
        />
      </div>
      <div className="return-request-field">
        <label htmlFor="rr-email">Email del pedido</label>
        <input
          id="rr-email"
          type="email"
          placeholder="tu@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <div className="return-request-field">
        <label htmlFor="rr-reason">Motivo de devoluci&oacute;n</label>
        <select
          id="rr-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
        >
          <option value="">Selecciona un motivo&hellip;</option>
          {REASONS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>
      <div className="return-request-field">
        <label htmlFor="rr-notes">Comentarios (opcional)</label>
        <textarea
          id="rr-notes"
          rows={3}
          placeholder="Cu&eacute;ntanos m&aacute;s detalles&hellip;"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      <button className="return-request-submit" type="submit" disabled={isPending}>
        {isPending ? "Enviando\u2026" : "Enviar solicitud"}
      </button>
    </form>
  );
}
