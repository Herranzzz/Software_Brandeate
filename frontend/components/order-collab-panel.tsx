"use client";

import { useCallback, useEffect, useState } from "react";

import { useToast } from "@/components/toast";
import { useEntityPresence } from "@/lib/use-presence";
import { useRealtimeEvents, type RealtimeEvent } from "@/lib/use-realtime-events";

type Comment = {
  id: number;
  action: string;
  summary: string;
  created_at: string;
  actor_name: string | null;
  actor_id: number | null;
  detail_json?: { role?: string; body?: string } | null;
};

type Props = {
  orderId: number;
  shopId: number | null;
  currentUserId: number;
  currentUserName: string;
};

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
  return new Date(iso).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function OrderCollabPanel({ orderId, shopId, currentUserId, currentUserName }: Props) {
  const { toast } = useToast();
  const viewers = useEntityPresence("order", orderId, currentUserId, shopId);
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/activity?entity_type=order&entity_id=${orderId}&limit=200`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const all = (await res.json()) as Comment[];
      setComments(all.filter((c) => c.action === "comment_added"));
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => { void load(); }, [load]);

  // Live append: if a peer posts on this order, refetch the list.
  useRealtimeEvents((event: RealtimeEvent) => {
    if (event.type !== "activity") return;
    if (event.entity_type !== "order" || event.entity_id !== orderId) return;
    if (event.action !== "comment_added") return;
    void load();
  });

  async function sendComment() {
    const body = draft.trim();
    if (!body || isSending) return;
    setIsSending(true);
    try {
      const res = await fetch("/api/activity/comment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity_type: "order", entity_id: orderId, body }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(err.detail ?? "No se pudo publicar el comentario");
      }
      setDraft("");
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Error desconocido", "error");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <section className="collab-panel">
      <header className="collab-panel-header">
        <div>
          <span className="eyebrow">👥 Colaboración</span>
          <h3>Conversación del pedido</h3>
        </div>
        {viewers.length > 0 ? (
          <div className="collab-viewers" aria-label="Personas viendo este pedido">
            {viewers.slice(0, 5).map((v) => (
              <span
                key={v.user_id}
                className="collab-viewer-avatar"
                title={`${v.user_name ?? "Usuario"} está viendo este pedido`}
              >
                {initials(v.user_name)}
              </span>
            ))}
            {viewers.length > 5 ? (
              <span className="collab-viewer-avatar collab-viewer-more">+{viewers.length - 5}</span>
            ) : null}
          </div>
        ) : null}
      </header>

      <div className="collab-composer">
        <div className="collab-viewer-avatar collab-viewer-self" title={currentUserName}>
          {initials(currentUserName)}
        </div>
        <textarea
          className="collab-composer-input"
          placeholder="Escribe una nota visible para el equipo y la tienda…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void sendComment();
            }
          }}
          rows={2}
          disabled={isSending}
        />
        <button
          type="button"
          className="button"
          onClick={() => void sendComment()}
          disabled={isSending || draft.trim() === ""}
        >
          {isSending ? "Enviando…" : "Publicar"}
        </button>
      </div>

      <div className="collab-thread">
        {loading ? (
          <div className="collab-empty">Cargando conversación…</div>
        ) : comments.length === 0 ? (
          <div className="collab-empty">
            Sin comentarios todavía. Escribe el primero para dejar constancia visible a todo el equipo.
          </div>
        ) : (
          comments.map((c) => (
            <article key={c.id} className="collab-comment">
              <div className="collab-viewer-avatar" title={c.actor_name ?? "Sistema"}>
                {initials(c.actor_name)}
              </div>
              <div className="collab-comment-body">
                <div className="collab-comment-meta">
                  <strong>{c.actor_name ?? "Sistema"}</strong>
                  {c.detail_json?.role ? (
                    <span className="collab-comment-role">{c.detail_json.role}</span>
                  ) : null}
                  <span className="collab-comment-time">{relative(c.created_at)}</span>
                </div>
                <div className="collab-comment-text">{c.summary}</div>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
