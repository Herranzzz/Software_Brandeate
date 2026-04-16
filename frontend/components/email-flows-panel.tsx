"use client";

import { useState, useTransition } from "react";
import { useToast } from "@/components/toast";
import type { EmailFlow } from "@/lib/types";

const FLOW_META: Record<string, { icon: string; title: string; description: string }> = {
  post_purchase: {
    icon: "📦",
    title: "Confirmación de pedido",
    description: "Se envía al cliente cuando se confirma un nuevo pedido.",
  },
  shipping_update: {
    icon: "🚚",
    title: "Pedido en camino",
    description: "Se envía cuando el pedido entra en tránsito con el transportista.",
  },
  delivery: {
    icon: "✅",
    title: "Entrega confirmada",
    description: "Se envía cuando el pedido ha sido entregado al destinatario.",
  },
  abandon_cart: {
    icon: "🛒",
    title: "Carrito abandonado",
    description: "Se envía tras X minutos si el cliente no completó la compra. Requiere webhook de Shopify checkouts.",
  },
};

async function updateFlow(flowId: number, data: Partial<EmailFlow>): Promise<EmailFlow> {
  const res = await fetch(`/api/email-flows/${flowId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Error al guardar");
  return res.json();
}

type FlowCardProps = {
  flow: EmailFlow;
  onUpdate: (updated: EmailFlow) => void;
};

function FlowCard({ flow, onUpdate }: FlowCardProps) {
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [isExpanded, setIsExpanded] = useState(false);

  const [fromName, setFromName] = useState(flow.from_name ?? "");
  const [fromEmail, setFromEmail] = useState(flow.from_email ?? "");
  const [replyTo, setReplyTo] = useState(flow.reply_to ?? "");
  const [subjectTemplate, setSubjectTemplate] = useState(flow.subject_template ?? "");
  const [delayMinutes, setDelayMinutes] = useState(String(flow.delay_minutes ?? 0));

  const meta = FLOW_META[flow.flow_type] ?? { icon: "✉️", title: flow.flow_type, description: "" };

  function toggleEnabled() {
    startTransition(async () => {
      try {
        const updated = await updateFlow(flow.id, { is_enabled: !flow.is_enabled });
        onUpdate(updated);
        toast(updated.is_enabled ? "Flow activado" : "Flow desactivado");
      } catch {
        toast("Error al guardar", "error");
      }
    });
  }

  function handleSaveConfig() {
    startTransition(async () => {
      try {
        const updated = await updateFlow(flow.id, {
          from_name: fromName.trim() || null,
          from_email: fromEmail.trim() || null,
          reply_to: replyTo.trim() || null,
          subject_template: subjectTemplate.trim() || null,
          delay_minutes: parseInt(delayMinutes, 10) || 0,
        });
        onUpdate(updated);
        toast("Flow actualizado");
        setIsExpanded(false);
      } catch {
        toast("Error al guardar", "error");
      }
    });
  }

  return (
    <div className="shop-settings-card" style={{ gap: 12 }}>
      <div className="shop-settings-card-head">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 22 }}>{meta.icon}</span>
          <div>
            <div className="table-primary">{meta.title}</div>
            <div className="table-secondary">{meta.description}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            className={`button ${flow.is_enabled ? "" : "button-secondary"}`}
            disabled={isPending}
            onClick={toggleEnabled}
            type="button"
            style={{ minWidth: 90 }}
          >
            {flow.is_enabled ? "Activo" : "Inactivo"}
          </button>
          <button
            className="button button-ghost"
            onClick={() => setIsExpanded((v) => !v)}
            type="button"
          >
            {isExpanded ? "▲" : "▼"}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="stack" style={{ gap: 12, paddingTop: 4 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="form-field">
              <label className="form-label">Nombre remitente</label>
              <input
                className="input"
                placeholder="Mi Tienda"
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label className="form-label">Email remitente</label>
              <input
                className="input"
                placeholder="hola@mitienda.com"
                type="email"
                value={fromEmail}
                onChange={(e) => setFromEmail(e.target.value)}
              />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="form-field">
              <label className="form-label">Reply-to</label>
              <input
                className="input"
                placeholder="soporte@mitienda.com"
                type="email"
                value={replyTo}
                onChange={(e) => setReplyTo(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label className="form-label">Retraso (minutos)</label>
              <input
                className="input"
                min="0"
                max="10080"
                type="number"
                value={delayMinutes}
                onChange={(e) => setDelayMinutes(e.target.value)}
              />
              <span className="form-hint">0 = inmediato</span>
            </div>
          </div>

          <div className="form-field">
            <label className="form-label">Asunto del email</label>
            <input
              className="input"
              placeholder="Tu pedido {order_id} – {shop_name}"
              value={subjectTemplate}
              onChange={(e) => setSubjectTemplate(e.target.value)}
            />
            <span className="form-hint">Variables: {"{order_id}"}, {"{shop_name}"}</span>
          </div>

          <button className="button" disabled={isPending} onClick={handleSaveConfig} type="button">
            {isPending ? "Guardando…" : "Guardar configuración"}
          </button>
        </div>
      )}
    </div>
  );
}


type Props = {
  flows: EmailFlow[];
};

export function EmailFlowsPanel({ flows: initialFlows }: Props) {
  const [flows, setFlows] = useState<EmailFlow[]>(initialFlows);

  function handleUpdate(updated: EmailFlow) {
    setFlows((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
  }

  if (flows.length === 0) {
    return (
      <p className="subtitle">
        No hay flows configurados. Guarda la tienda y recarga para inicializarlos.
      </p>
    );
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      {flows.map((flow) => (
        <FlowCard key={flow.id} flow={flow} onUpdate={handleUpdate} />
      ))}
    </div>
  );
}
