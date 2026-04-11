"use client";

import { useState, useTransition } from "react";

import { useToast } from "@/components/toast";
import { blockOrder, unblockOrder } from "@/lib/api";
import type { Order } from "@/lib/types";


type Props = {
  order: Order;
  onUpdate?: (updated: Order) => void;
};

export function OrderBlockButton({ order, onUpdate }: Props) {
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [showModal, setShowModal] = useState(false);
  const [reason, setReason] = useState("");

  function handleUnblock() {
    startTransition(async () => {
      try {
        const updated = await unblockOrder(order.id);
        toast("Pedido desbloqueado", "success");
        onUpdate?.(updated);
      } catch (err) {
        toast(err instanceof Error ? err.message : "Error al desbloquear", "error");
      }
    });
  }

  function handleBlock() {
    startTransition(async () => {
      try {
        const updated = await blockOrder(order.id, reason.trim() || undefined);
        toast("Pedido bloqueado", "success");
        setShowModal(false);
        setReason("");
        onUpdate?.(updated);
      } catch (err) {
        toast(err instanceof Error ? err.message : "Error al bloquear", "error");
      }
    });
  }

  if (order.is_blocked) {
    return (
      <button
        className="button button-warning"
        disabled={isPending}
        onClick={handleUnblock}
        type="button"
      >
        {isPending ? "..." : "Desbloquear"}
      </button>
    );
  }

  return (
    <>
      <button
        className="button button-secondary"
        disabled={isPending}
        onClick={() => setShowModal(true)}
        type="button"
      >
        Bloquear
      </button>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Bloquear pedido #{order.external_id}</h3>
            <p className="modal-subtitle">El pedido quedará retenido hasta que se desbloquee manualmente.</p>
            <div className="form-group" style={{ marginTop: 16 }}>
              <label className="form-label" htmlFor="block-reason">Motivo (opcional)</label>
              <input
                className="form-input"
                id="block-reason"
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ej: Pendiente de confirmación de dirección"
                type="text"
                value={reason}
              />
            </div>
            <div className="modal-actions" style={{ marginTop: 20 }}>
              <button
                className="button button-secondary"
                onClick={() => { setShowModal(false); setReason(""); }}
                type="button"
              >
                Cancelar
              </button>
              <button
                className="button button-warning"
                disabled={isPending}
                onClick={handleBlock}
                type="button"
              >
                {isPending ? "Bloqueando..." : "Bloquear pedido"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
