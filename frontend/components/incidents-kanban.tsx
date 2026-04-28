"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { useToast } from "@/components/toast";
import type { Incident, IncidentStatus } from "@/lib/types";

type Column = {
  status: IncidentStatus;
  title: string;
  emoji: string;
  color: string;
};

const COLUMNS: Column[] = [
  { status: "open",        title: "Abierta",     emoji: "🔴", color: "#ef4444" },
  { status: "in_progress", title: "En progreso",  emoji: "🟡", color: "#f59e0b" },
  { status: "resolved",    title: "Resuelta",     emoji: "✅", color: "#22c55e" },
];

const PRIORITY_EMOJI: Record<string, string> = {
  urgent: "🔴",
  high:   "🟠",
  medium: "🟡",
  low:    "⚪",
};

const TYPE_LABEL: Record<string, string> = {
  missing_asset:          "Asset roto",
  personalization_error:  "Error personalización",
  production_blocked:     "Producción bloqueada",
  shipping_exception:     "Excepción envío",
  address_issue:          "Problema dirección",
  stock_issue:            "Stock",
};

const RESOLUTION_OPTIONS = [
  "Solución aplicada",
  "Pedido reimpreso",
  "Dirección corregida",
  "Stock repuesto",
  "Incidencia duplicada",
  "Otro",
];

type ResolveModal = {
  incidentId: number;
  fromStatus: IncidentStatus;
};

type Props = {
  initialIncidents: Incident[];
};

export function IncidentsKanban({ initialIncidents }: Props) {
  const { toast } = useToast();
  const [incidents, setIncidents] = useState<Incident[]>(initialIncidents);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [dragOverCol, setDragOverCol] = useState<IncidentStatus | null>(null);
  const dragData = useRef<{ incidentId: number; fromStatus: IncidentStatus } | null>(null);

  // Guided resolution modal
  const [resolveModal, setResolveModal] = useState<ResolveModal | null>(null);
  const [resolveOption, setResolveOption] = useState(RESOLUTION_OPTIONS[0]);
  const [resolveNotes, setResolveNotes] = useState("");
  const [resolving, setResolving] = useState(false);

  async function updateStatus(incidentId: number, newStatus: IncidentStatus, notes?: string) {
    const previous = incidents.find((i) => i.id === incidentId);
    setIncidents((cur) =>
      cur.map((i) => (i.id === incidentId ? { ...i, status: newStatus } : i)),
    );
    setLoadingId(incidentId);
    try {
      const body: Record<string, string> = { status: newStatus };
      if (notes) body.resolution_notes = notes;
      const res = await fetch(`/api/incidents/${incidentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      const updated: Incident = await res.json();
      setIncidents((cur) => cur.map((i) => (i.id === incidentId ? updated : i)));
      const col = COLUMNS.find((c) => c.status === newStatus);
      toast(`Movido a "${col?.title}"`, "success");
    } catch {
      if (previous) setIncidents((cur) => cur.map((i) => (i.id === incidentId ? previous : i)));
      toast("No se pudo actualizar la incidencia", "error");
    } finally {
      setLoadingId(null);
    }
  }

  // Drag & drop
  const handleDragStart = useCallback((e: React.DragEvent, incident: Incident) => {
    dragData.current = { incidentId: incident.id, fromStatus: incident.status };
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, col: IncidentStatus) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverCol(col);
  }, []);

  const handleDragLeave = useCallback(() => setDragOverCol(null), []);

  const handleDrop = useCallback(
    (e: React.DragEvent, targetStatus: IncidentStatus) => {
      e.preventDefault();
      setDragOverCol(null);
      const data = dragData.current;
      dragData.current = null;
      if (!data || data.fromStatus === targetStatus) return;

      if (targetStatus === "resolved") {
        // Show guided resolution modal
        setResolveOption(RESOLUTION_OPTIONS[0]);
        setResolveNotes("");
        setResolveModal({ incidentId: data.incidentId, fromStatus: data.fromStatus });
      } else {
        updateStatus(data.incidentId, targetStatus);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [incidents],
  );

  async function confirmResolve() {
    if (!resolveModal) return;
    setResolving(true);
    const notes = `${resolveOption}${resolveNotes ? `: ${resolveNotes}` : ""}`;
    await updateStatus(resolveModal.incidentId, "resolved", notes);
    setResolveModal(null);
    setResolving(false);
  }

  const byStatus = new Map<IncidentStatus, Incident[]>();
  for (const col of COLUMNS) {
    byStatus.set(col.status, incidents.filter((i) => i.status === col.status));
  }

  return (
    <>
      <div className="kanban-board">
        {COLUMNS.map((col) => {
          const items = byStatus.get(col.status) ?? [];
          const isDropTarget = dragOverCol === col.status;

          return (
            <div
              className={`kanban-col ${isDropTarget ? "kanban-col-drop-active" : ""}`}
              key={col.status}
              onDragLeave={handleDragLeave}
              onDragOver={(e) => handleDragOver(e, col.status)}
              onDrop={(e) => handleDrop(e, col.status)}
              style={{ "--kanban-col-accent": col.color } as React.CSSProperties}
            >
              <div className="kanban-col-header">
                <div className="kanban-col-title">
                  <span className="kanban-col-emoji">{col.emoji}</span>
                  <span>{col.title}</span>
                </div>
                <span className="kanban-col-count">{items.length}</span>
              </div>

              <div className="kanban-cards">
                {items.length === 0 ? (
                  <div className="kanban-empty">
                    {isDropTarget ? "Soltar aquí" : "Sin incidencias"}
                  </div>
                ) : (
                  items.map((incident) => {
                    const isLoading = loadingId === incident.id;
                    return (
                      <div
                        className={`kanban-card icard ${isLoading ? "kanban-card-loading" : ""}`}
                        draggable
                        key={incident.id}
                        onDragStart={(e) => handleDragStart(e, incident)}
                      >
                        <div className="kanban-card-top">
                          <div className="kanban-card-id-row">
                            <span className="kanban-card-priority">{PRIORITY_EMOJI[incident.priority] ?? "⚪"}</span>
                            <span className="kanban-card-id">#{incident.id}</span>
                            {incident.is_automated && (
                              <span className="icard-auto-badge">Auto</span>
                            )}
                          </div>
                          <div className="kanban-card-customer icard-title">{incident.title}</div>
                        </div>

                        <div className="icard-meta">
                          <span className="icard-type">{TYPE_LABEL[incident.type] ?? incident.type}</span>
                          <Link className="icard-order-link" href={`/orders/${incident.order.id}`}>
                            {incident.order.external_id}
                          </Link>
                        </div>

                        <div className="kanban-card-footer">
                          <span className={`icard-priority-badge icard-priority-${incident.priority}`}>
                            {incident.priority}
                          </span>
                          {incident.assignee && (
                            <span className="kanban-assignee" title={`Responsable: ${incident.assignee}`}>
                              👤 {incident.assignee.split(" ")[0]}
                            </span>
                          )}
                          {/* Quick action buttons */}
                          {incident.status === "open" && (
                            <button
                              className="icard-action-btn"
                              disabled={isLoading}
                              onClick={() => updateStatus(incident.id, "in_progress")}
                              title="Marcar en progreso"
                              type="button"
                            >
                              → Progreso
                            </button>
                          )}
                          {incident.status === "in_progress" && (
                            <button
                              className="icard-action-btn icard-action-resolve"
                              disabled={isLoading}
                              onClick={() => {
                                setResolveOption(RESOLUTION_OPTIONS[0]);
                                setResolveNotes("");
                                setResolveModal({ incidentId: incident.id, fromStatus: incident.status });
                              }}
                              title="Resolver incidencia"
                              type="button"
                            >
                              ✓ Resolver
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Guided resolution modal ─────────────────────────────── */}
      {resolveModal ? (
        <div className="modal-backdrop" onClick={() => !resolving && setResolveModal(null)}>
          <div className="modal-box imodal" onClick={(e) => e.stopPropagation()}>
            <h3 className="imodal-title">✅ Resolver incidencia #{resolveModal.incidentId}</h3>
            <p className="imodal-hint">¿Cómo se resolvió esta incidencia?</p>

            <div className="imodal-options">
              {RESOLUTION_OPTIONS.map((opt) => (
                <button
                  className={`imodal-option ${resolveOption === opt ? "imodal-option-active" : ""}`}
                  key={opt}
                  onClick={() => setResolveOption(opt)}
                  type="button"
                >
                  {opt}
                </button>
              ))}
            </div>

            <div className="field imodal-notes-field">
              <label htmlFor="resolve-notes">Notas adicionales (opcional)</label>
              <textarea
                className="imodal-notes"
                id="resolve-notes"
                onChange={(e) => setResolveNotes(e.target.value)}
                placeholder="Describe brevemente qué se hizo…"
                rows={3}
                value={resolveNotes}
              />
            </div>

            <div className="imodal-actions">
              <button
                className="button-ghost"
                disabled={resolving}
                onClick={() => setResolveModal(null)}
                type="button"
              >
                Cancelar
              </button>
              <button
                className="button"
                disabled={resolving}
                onClick={confirmResolve}
                type="button"
              >
                {resolving ? "Guardando…" : "Confirmar resolución"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
