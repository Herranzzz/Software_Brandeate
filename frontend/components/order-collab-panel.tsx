"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { useToast } from "@/components/toast";
import { useEntityPresence } from "@/lib/use-presence";
import { useRealtimeEvents, type RealtimeEvent } from "@/lib/use-realtime-events";
import type { Order, User } from "@/lib/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type Comment = {
  id: number;
  action: string;
  summary: string;
  created_at: string;
  actor_name: string | null;
  actor_id: number | null;
  edited_at: string | null;
  is_deleted: boolean;
  detail_json?: { role?: string; body?: string; mentions?: string[] } | null;
};

type CommentFilter = "comments" | "all";

type Props = {
  order: Order;
  currentUserId: number;
  currentUserName: string;
  currentUserRole: string;
  employees: Pick<User, "id" | "name">[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? `${parts[0][0]}${parts[1][0]}`.toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

function relative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "ahora";
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  return new Date(iso).toLocaleString("es-ES", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Highlight @name occurrences in a comment body */
function renderCommentText(text: string): React.ReactNode {
  const parts = text.split(/(@\w[\w\s]*\w|\@\w+)/g);
  return parts.map((part, i) =>
    part.startsWith("@") ? (
      <span key={i} className="collab-mention">
        {part}
      </span>
    ) : (
      part
    )
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function OrderCollabPanel({
  order,
  currentUserId,
  currentUserName,
  currentUserRole,
  employees,
}: Props) {
  const { toast } = useToast();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const viewers = useEntityPresence("order", order.id, currentUserId, order.shop_id);
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<CommentFilter>("comments");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");

  // Assignment
  const [assigneeId, setAssigneeId] = useState<number | null>(
    order.assigned_to_employee_id ?? null
  );
  const [isAssigning, setIsAssigning] = useState(false);
  const [showAssignDropdown, setShowAssignDropdown] = useState(false);
  const assignDropdownRef = useRef<HTMLDivElement>(null);

  // @mention autocomplete
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isAdmin = currentUserRole === "admin" || currentUserRole === "ops_admin" || currentUserRole === "super_admin";
  const assignedEmployee = employees.find((e) => e.id === assigneeId);

  // ── Data loading ────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/activity?entity_type=order&entity_id=${order.id}&limit=200`,
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const all = (await res.json()) as Comment[];
      setComments(all.filter((c) => !c.is_deleted));
    } finally {
      setLoading(false);
    }
  }, [order.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live append on peer comment
  useRealtimeEvents((event: RealtimeEvent) => {
    if (event.type !== "activity") return;
    if (event.entity_type !== "order" || event.entity_id !== order.id) return;
    if (event.action !== "comment_added") return;
    void load();
  });

  // Close assignment dropdown on outside click
  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (assignDropdownRef.current && !assignDropdownRef.current.contains(e.target as Node)) {
        setShowAssignDropdown(false);
      }
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  // ── @mention detection ──────────────────────────────────────────────────────

  function handleDraftChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setDraft(value);

    const cursor = e.target.selectionStart ?? value.length;
    const before = value.slice(0, cursor);
    const match = before.match(/@([\w\s]*)$/);
    if (match) {
      setMentionQuery(match[1]);
      setMentionStart(cursor - match[0].length);
    } else {
      setMentionQuery(null);
    }
  }

  function insertMention(name: string) {
    const before = draft.slice(0, mentionStart);
    const after = draft.slice(textareaRef.current?.selectionStart ?? draft.length);
    setDraft(`${before}@${name} ${after}`);
    setMentionQuery(null);
    textareaRef.current?.focus();
  }

  const mentionSuggestions =
    mentionQuery !== null
      ? employees.filter(
          (e) =>
            e.id !== currentUserId &&
            e.name.toLowerCase().includes(mentionQuery.toLowerCase())
        )
      : [];

  // ── Send comment ────────────────────────────────────────────────────────────

  async function sendComment() {
    const body = draft.trim();
    if (!body || isSending) return;

    // Optimistic insert
    const optimisticId = Date.now() * -1;
    const optimistic: Comment = {
      id: optimisticId,
      action: "comment_added",
      summary: body,
      created_at: new Date().toISOString(),
      actor_name: currentUserName,
      actor_id: currentUserId,
      edited_at: null,
      is_deleted: false,
      detail_json: { role: currentUserRole, body },
    };
    setComments((prev) => [optimistic, ...prev]);
    setDraft("");
    setMentionQuery(null);
    setIsSending(true);

    try {
      const res = await fetch("/api/activity/comment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity_type: "order", entity_id: order.id, body }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(err.detail ?? "No se pudo publicar el comentario");
      }
      const saved = (await res.json()) as Comment;
      // Replace optimistic entry with real one
      setComments((prev) => prev.map((c) => (c.id === optimisticId ? saved : c)));
    } catch (err) {
      // Rollback optimistic
      setComments((prev) => prev.filter((c) => c.id !== optimisticId));
      setDraft(body);
      toast(err instanceof Error ? err.message : "Error desconocido", "error");
    } finally {
      setIsSending(false);
    }
  }

  // ── Edit comment ────────────────────────────────────────────────────────────

  async function saveEdit(commentId: number) {
    const body = editDraft.trim();
    if (!body) return;

    const prev = comments.find((c) => c.id === commentId);
    setComments((cs) =>
      cs.map((c) =>
        c.id === commentId
          ? { ...c, summary: body, edited_at: new Date().toISOString() }
          : c
      )
    );
    setEditingId(null);

    try {
      const res = await fetch(`/api/activity/comment/${commentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) throw new Error("No se pudo editar");
      const saved = (await res.json()) as Comment;
      setComments((cs) => cs.map((c) => (c.id === commentId ? saved : c)));
    } catch {
      // Rollback
      if (prev) setComments((cs) => cs.map((c) => (c.id === commentId ? prev : c)));
      toast("No se pudo guardar la edición", "error");
    }
  }

  // ── Delete comment ──────────────────────────────────────────────────────────

  async function deleteComment(commentId: number) {
    const prev = comments.find((c) => c.id === commentId);
    setComments((cs) => cs.filter((c) => c.id !== commentId));

    try {
      const res = await fetch(`/api/activity/comment/${commentId}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 204) throw new Error("No se pudo borrar");
    } catch {
      if (prev) setComments((cs) => [prev, ...cs]);
      toast("No se pudo borrar el comentario", "error");
    }
  }

  // ── Assignment ──────────────────────────────────────────────────────────────

  async function handleAssign(employeeId: number | null) {
    setShowAssignDropdown(false);
    if (isAssigning) return;
    setIsAssigning(true);
    const prevId = assigneeId;
    setAssigneeId(employeeId);

    try {
      const res = await fetch(`/api/orders/${order.id}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employee_id: employeeId }),
      });
      if (!res.ok) throw new Error("No se pudo asignar");
      startTransition(() => router.refresh());
    } catch {
      setAssigneeId(prevId);
      toast("No se pudo cambiar la asignación", "error");
    } finally {
      setIsAssigning(false);
    }
  }

  // ── Filtered list ────────────────────────────────────────────────────────────

  const displayedComments =
    filter === "comments"
      ? comments.filter((c) => c.action === "comment_added")
      : comments;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <section className="collab-panel">
      {/* Header */}
      <header className="collab-panel-header">
        <div className="collab-panel-title-block">
          <span className="collab-panel-eyebrow">Colaboración</span>
          <h3 className="collab-panel-title">Conversación del pedido</h3>
        </div>

        <div className="collab-panel-header-right">
          {/* Viewers presence */}
          {viewers.length > 0 && (
            <div className="collab-viewers" aria-label="Personas viendo este pedido">
              {viewers.slice(0, 4).map((v) => (
                <span
                  key={v.user_id}
                  className="collab-viewer-avatar collab-viewer-active"
                  title={`${v.user_name ?? "Usuario"} está viendo`}
                >
                  {initials(v.user_name)}
                </span>
              ))}
              {viewers.length > 4 && (
                <span className="collab-viewer-avatar collab-viewer-more">
                  +{viewers.length - 4}
                </span>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Assignment widget */}
      <div className="collab-assignment-row" ref={assignDropdownRef}>
        <span className="collab-assignment-label">Asignado a</span>
        <button
          className={`collab-assignment-btn${assignedEmployee ? " is-assigned" : ""}`}
          onClick={() => setShowAssignDropdown((v) => !v)}
          type="button"
          disabled={isAssigning}
        >
          {assignedEmployee ? (
            <>
              <span className="collab-viewer-avatar collab-viewer-assignee">
                {initials(assignedEmployee.name)}
              </span>
              <span>{assignedEmployee.name}</span>
            </>
          ) : (
            <span className="collab-assignment-empty">Sin asignar</span>
          )}
          <span className="collab-assignment-chevron">▾</span>
        </button>

        {showAssignDropdown && (
          <div className="collab-assignment-dropdown">
            <button
              className="collab-assignment-option collab-assignment-unassign"
              type="button"
              onClick={() => void handleAssign(null)}
            >
              Sin asignar
            </button>
            {employees
              .filter((e) => e.id !== assigneeId)
              .map((emp) => (
                <button
                  key={emp.id}
                  className="collab-assignment-option"
                  type="button"
                  onClick={() => void handleAssign(emp.id)}
                >
                  <span className="collab-viewer-avatar">{initials(emp.name)}</span>
                  {emp.name}
                </button>
              ))}
          </div>
        )}
      </div>

      {/* Filter tabs */}
      <div className="collab-filter-tabs">
        <button
          className={`collab-filter-tab${filter === "comments" ? " is-active" : ""}`}
          type="button"
          onClick={() => setFilter("comments")}
        >
          Comentarios
          {comments.filter((c) => c.action === "comment_added").length > 0 && (
            <span className="collab-filter-count">
              {comments.filter((c) => c.action === "comment_added").length}
            </span>
          )}
        </button>
        <button
          className={`collab-filter-tab${filter === "all" ? " is-active" : ""}`}
          type="button"
          onClick={() => setFilter("all")}
        >
          Toda la actividad
        </button>
      </div>

      {/* Composer */}
      <div className="collab-composer">
        <span className="collab-viewer-avatar collab-viewer-self" title={currentUserName}>
          {initials(currentUserName)}
        </span>
        <div className="collab-composer-input-wrap">
          <textarea
            ref={textareaRef}
            className="collab-composer-input"
            placeholder="Escribe un comentario… usa @nombre para mencionar a alguien"
            value={draft}
            onChange={handleDraftChange}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void sendComment();
              }
              if (e.key === "Escape") setMentionQuery(null);
            }}
            rows={2}
            disabled={isSending}
          />

          {/* @mention suggestions */}
          {mentionSuggestions.length > 0 && (
            <div className="collab-mention-dropdown">
              {mentionSuggestions.slice(0, 5).map((emp) => (
                <button
                  key={emp.id}
                  className="collab-mention-option"
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault(); // keep focus in textarea
                    insertMention(emp.name);
                  }}
                >
                  <span className="collab-viewer-avatar">{initials(emp.name)}</span>
                  {emp.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          className="button collab-send-btn"
          onClick={() => void sendComment()}
          disabled={isSending || draft.trim() === ""}
          title="Ctrl+Enter"
        >
          {isSending ? "…" : "↑"}
        </button>
      </div>

      {/* Thread */}
      <div className="collab-thread">
        {loading ? (
          <div className="collab-empty">Cargando…</div>
        ) : displayedComments.length === 0 ? (
          <div className="collab-empty">
            {filter === "comments"
              ? "Sin comentarios todavía. Sé el primero en dejar una nota al equipo."
              : "Sin actividad registrada."}
          </div>
        ) : (
          displayedComments.map((c) => {
            const isOwnComment = c.action === "comment_added" && c.actor_id === currentUserId;
            const canDelete = c.action === "comment_added" && (isOwnComment || isAdmin);
            const isSystemEvent = c.action !== "comment_added";

            if (isSystemEvent) {
              return (
                <div key={c.id} className="collab-event-row">
                  <span className="collab-event-dot" />
                  <span className="collab-event-text">
                    {c.actor_name && (
                      <strong className="collab-event-actor">{c.actor_name}</strong>
                    )}
                    {" "}
                    {c.summary}
                  </span>
                  <span className="collab-event-time">{relative(c.created_at)}</span>
                </div>
              );
            }

            return (
              <article key={c.id} className={`collab-comment${isOwnComment ? " is-own" : ""}`}>
                <span className="collab-viewer-avatar" title={c.actor_name ?? "Sistema"}>
                  {initials(c.actor_name)}
                </span>
                <div className="collab-comment-body">
                  <div className="collab-comment-meta">
                    <strong>{c.actor_name ?? "Sistema"}</strong>
                    {c.detail_json?.role && (
                      <span className="collab-comment-role">{c.detail_json.role}</span>
                    )}
                    <span className="collab-comment-time">{relative(c.created_at)}</span>
                    {c.edited_at && (
                      <span className="collab-comment-edited" title={`Editado ${relative(c.edited_at)}`}>
                        (editado)
                      </span>
                    )}
                  </div>

                  {editingId === c.id ? (
                    <div className="collab-edit-wrap">
                      <textarea
                        className="collab-composer-input"
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void saveEdit(c.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        rows={2}
                        autoFocus
                      />
                      <div className="collab-edit-actions">
                        <button
                          className="button"
                          type="button"
                          onClick={() => void saveEdit(c.id)}
                        >
                          Guardar
                        </button>
                        <button
                          className="button-secondary"
                          type="button"
                          onClick={() => setEditingId(null)}
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="collab-comment-text">
                      {renderCommentText(c.summary)}
                    </div>
                  )}

                  {editingId !== c.id && (isOwnComment || canDelete) && (
                    <div className="collab-comment-actions">
                      {isOwnComment && (
                        <button
                          className="collab-comment-action-btn"
                          type="button"
                          onClick={() => {
                            setEditingId(c.id);
                            setEditDraft(c.summary);
                          }}
                        >
                          Editar
                        </button>
                      )}
                      {canDelete && (
                        <button
                          className="collab-comment-action-btn collab-comment-action-danger"
                          type="button"
                          onClick={() => void deleteComment(c.id)}
                        >
                          Borrar
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
