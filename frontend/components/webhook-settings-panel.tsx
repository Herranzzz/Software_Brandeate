"use client";

import { useEffect, useState, useTransition } from "react";

import { useToast } from "@/components/toast";
import {
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  fetchWebhookEndpoints,
  testWebhookEndpoint,
  updateWebhookEndpoint,
} from "@/lib/api";
import type { WebhookEndpoint } from "@/lib/types";

const ALL_EVENTS = [
  "order.status_changed",
  "shipment.created",
  "tracking.updated",
  "incident.created",
  "invoice.sent",
];

type WebhookSettingsPanelProps = {
  shopId: number;
};

export function WebhookSettingsPanel({ shopId }: WebhookSettingsPanelProps) {
  const { toast } = useToast();
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  // New endpoint form
  const [showAdd, setShowAdd] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newSecret, setNewSecret] = useState("");
  const [newEvents, setNewEvents] = useState<string[]>([]);

  useEffect(() => {
    fetchWebhookEndpoints(shopId)
      .then(setEndpoints)
      .catch(() => toast("Error cargando webhooks", "error"))
      .finally(() => setLoading(false));
  }, [shopId, toast]);

  function handleCreate() {
    if (!newUrl.trim()) return;
    startTransition(async () => {
      try {
        const ep = await createWebhookEndpoint({
          shop_id: shopId,
          url: newUrl.trim(),
          secret: newSecret.trim() || null,
          events: newEvents,
        });
        setEndpoints((prev) => [ep, ...prev]);
        setShowAdd(false);
        setNewUrl("");
        setNewSecret("");
        setNewEvents([]);
        toast("Webhook creado", "success");
      } catch (e) {
        toast(e instanceof Error ? e.message : "Error", "error");
      }
    });
  }

  function handleToggle(ep: WebhookEndpoint) {
    startTransition(async () => {
      try {
        const updated = await updateWebhookEndpoint(ep.id, { is_active: !ep.is_active });
        setEndpoints((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
        toast(updated.is_active ? "Webhook activado" : "Webhook desactivado", "info");
      } catch {
        toast("Error al actualizar", "error");
      }
    });
  }

  function handleDelete(ep: WebhookEndpoint) {
    if (!confirm(`¿Eliminar webhook ${ep.url}?`)) return;
    startTransition(async () => {
      try {
        await deleteWebhookEndpoint(ep.id);
        setEndpoints((prev) => prev.filter((e) => e.id !== ep.id));
        toast("Webhook eliminado", "success");
      } catch {
        toast("Error al eliminar", "error");
      }
    });
  }

  function handleTest(ep: WebhookEndpoint) {
    startTransition(async () => {
      try {
        const result = await testWebhookEndpoint(ep.id);
        if (result.success) {
          toast(`Test OK (${result.status_code})`, "success");
        } else {
          toast(`Test falló: ${result.error ?? result.status_code}`, "error");
        }
      } catch {
        toast("Error enviando test", "error");
      }
    });
  }

  function toggleEvent(event: string) {
    setNewEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event],
    );
  }

  if (loading) {
    return <div className="webhook-empty">Cargando webhooks…</div>;
  }

  return (
    <div className="webhook-panel">
      {endpoints.length === 0 && !showAdd && (
        <div className="webhook-empty">
          No hay webhooks configurados. Los webhooks permiten notificar a sistemas externos cuando ocurren eventos.
        </div>
      )}

      {endpoints.map((ep) => (
        <div key={ep.id} className="webhook-row">
          <div className="webhook-row-main">
            <div className="webhook-url">{ep.url}</div>
            <div className="webhook-meta">
              <span className={`webhook-status-dot ${ep.is_active ? "webhook-active" : "webhook-inactive"}`} />
              <span>{ep.is_active ? "Activo" : "Inactivo"}</span>
              {ep.last_triggered_at && (
                <>
                  <span className="webhook-sep">·</span>
                  <span>
                    Último: {ep.last_status_code ?? "—"}
                    {ep.last_error && <span className="webhook-error-hint" title={ep.last_error}> ⚠</span>}
                  </span>
                </>
              )}
            </div>
            <div className="webhook-events">
              {ep.events.map((ev) => (
                <span key={ev} className="webhook-event-tag">{ev}</span>
              ))}
            </div>
          </div>
          <div className="webhook-row-actions">
            <button className="button-small button-secondary" onClick={() => handleTest(ep)} type="button" disabled={isPending}>
              Test
            </button>
            <button className="button-small button-secondary" onClick={() => handleToggle(ep)} type="button" disabled={isPending}>
              {ep.is_active ? "Desactivar" : "Activar"}
            </button>
            <button className="button-small button-danger-secondary" onClick={() => handleDelete(ep)} type="button" disabled={isPending}>
              Eliminar
            </button>
          </div>
        </div>
      ))}

      {showAdd ? (
        <div className="webhook-add-form">
          <div className="form-field">
            <label className="form-label">URL del endpoint</label>
            <input
              className="form-input"
              placeholder="https://api.example.com/webhook"
              type="url"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
            />
          </div>
          <div className="form-field">
            <label className="form-label">Secret (HMAC-SHA256, opcional)</label>
            <input
              className="form-input"
              placeholder="whsec_..."
              value={newSecret}
              onChange={(e) => setNewSecret(e.target.value)}
            />
          </div>
          <div className="form-field">
            <label className="form-label">Eventos</label>
            <div className="webhook-event-checkboxes">
              {ALL_EVENTS.map((ev) => (
                <label key={ev} className="webhook-event-check">
                  <input
                    type="checkbox"
                    checked={newEvents.includes(ev)}
                    onChange={() => toggleEvent(ev)}
                  />
                  <span>{ev}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="webhook-add-actions">
            <button className="button-primary" onClick={handleCreate} type="button" disabled={isPending || !newUrl.trim()}>
              {isPending ? "Creando…" : "Crear webhook"}
            </button>
            <button className="button-secondary" onClick={() => setShowAdd(false)} type="button">
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button className="button-secondary" onClick={() => setShowAdd(true)} type="button">
          + Añadir webhook
        </button>
      )}
    </div>
  );
}
