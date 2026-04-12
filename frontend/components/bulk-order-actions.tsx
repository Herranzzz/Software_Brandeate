"use client";

import { useState, useTransition } from "react";
import { useToast } from "@/components/toast";
import { useRouter } from "next/navigation";
import type { Order, OrderStatus } from "@/lib/types";

type BulkOrderActionsProps = {
  orders: Order[];
  selectedIds: number[];
  onSelectionChange: (ids: number[]) => void;
};

const BULK_STATUS_OPTIONS: { value: OrderStatus; label: string }[] = [
  { value: "pending", label: "Pendiente" },
  { value: "in_progress", label: "En proceso" },
  { value: "ready_to_ship", label: "Listo para enviar" },
  { value: "shipped", label: "Enviado" },
  { value: "delivered", label: "Entregado" },
  { value: "exception", label: "Excepción" },
];

export function BulkOrderActions({ selectedIds, onSelectionChange }: BulkOrderActionsProps) {
  const { toast } = useToast();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [targetStatus, setTargetStatus] = useState<OrderStatus | "">("");

  if (selectedIds.length === 0) return null;

  async function handleBulkStatus() {
    if (!targetStatus) return;
    startTransition(async () => {
      try {
        const results = await Promise.allSettled(
          selectedIds.map((id) =>
            fetch(`/api/orders/${id}/status`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: targetStatus }),
            })
          )
        );
        const ok = results.filter((r) => r.status === "fulfilled").length;
        toast(`${ok} pedidos actualizados`, "success");
        onSelectionChange([]);
        router.refresh();
      } catch {
        toast("Error actualizando pedidos", "error");
      }
    });
  }

  return (
    <div className="bulk-actions-bar">
      <span className="bulk-actions-count">{selectedIds.length} seleccionados</span>
      <select
        className="form-select-sm"
        value={targetStatus}
        onChange={(e) => setTargetStatus(e.target.value as OrderStatus)}
      >
        <option value="">Cambiar estado…</option>
        {BULK_STATUS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      {targetStatus && (
        <button
          className="button-primary button-sm"
          type="button"
          disabled={isPending}
          onClick={handleBulkStatus}
        >
          {isPending ? "Aplicando…" : "Aplicar"}
        </button>
      )}
      <button
        className="button-secondary button-sm"
        type="button"
        onClick={() => onSelectionChange([])}
      >
        Deseleccionar
      </button>
    </div>
  );
}
