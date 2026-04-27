"use client";

import { useEffect, useMemo, useState } from "react";
import type { EmailFlowDraft } from "@/lib/types";

const FLOW_LABEL: Record<string, string> = {
  post_purchase: "Confirmación de pedido",
  shipping_update: "Pedido en camino",
  delivery: "Entrega confirmada",
  abandon_cart: "Carrito abandonado",
};

type Props = {
  shopId: number;
};

export function EmailFlowDraftsPanel({ shopId }: Props) {
  const [drafts, setDrafts] = useState<EmailFlowDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "review">("all");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ shop_id: String(shopId), limit: "50" });
    if (filter === "review") params.set("requires_review", "true");

    fetch(`/api/email-flows/drafts?${params.toString()}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: EmailFlowDraft[]) => {
        if (!cancelled) setDrafts(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Error al cargar");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [shopId, filter]);

  const reviewCount = useMemo(
    () => drafts.filter((d) => d.requires_human_review).length,
    [drafts],
  );

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <div className="table-primary">Borradores generados por IA</div>
          <div className="table-secondary">
            Versión del agente para revisión. En modo shadow el cliente recibe la plantilla determinista; al desactivar shadow, estos borradores son los que se envían.
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            className={`button ${filter === "all" ? "" : "button-secondary"}`}
            onClick={() => setFilter("all")}
            style={{ minWidth: 80 }}
          >
            Todos
          </button>
          <button
            type="button"
            className={`button ${filter === "review" ? "" : "button-secondary"}`}
            onClick={() => setFilter("review")}
            style={{ minWidth: 110 }}
          >
            A revisar{reviewCount > 0 && filter !== "review" ? ` (${reviewCount})` : ""}
          </button>
        </div>
      </div>

      {loading && <p className="subtitle">Cargando borradores…</p>}
      {error && <p className="subtitle" style={{ color: "var(--color-danger, #b91c1c)" }}>Error: {error}</p>}
      {!loading && !error && drafts.length === 0 && (
        <p className="subtitle">
          {filter === "review"
            ? "Sin borradores marcados para revisión."
            : "Aún no hay borradores. Activa EMAIL_AGENT_ENABLED y deja que el agente procese pedidos nuevos."}
        </p>
      )}

      <div className="stack" style={{ gap: 8 }}>
        {drafts.map((d) => (
          <DraftRow key={d.id} draft={d} />
        ))}
      </div>
    </div>
  );
}

function DraftRow({ draft }: { draft: EmailFlowDraft }) {
  const [expanded, setExpanded] = useState(false);
  const flowLabel = FLOW_LABEL[draft.flow_type] ?? draft.flow_type;
  const confidenceColor = confidenceTone(draft.confidence);

  return (
    <div className="shop-settings-card" style={{ gap: 10 }}>
      <div className="shop-settings-card-head" style={{ alignItems: "flex-start" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="table-primary" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span>#{draft.order_id}</span>
            <span className="portal-soft-pill">{flowLabel}</span>
            <span className="portal-soft-pill">{draft.locale}</span>
            {draft.shadow_mode && <span className="portal-soft-pill">shadow</span>}
            {draft.was_sent && <span className="portal-soft-pill" style={{ background: "#d1fae5" }}>enviado</span>}
            {draft.requires_human_review && (
              <span className="portal-soft-pill" style={{ background: "#fee2e2" }}>revisar</span>
            )}
          </div>
          <div className="table-secondary" style={{ marginTop: 4 }}>
            <span style={{ fontWeight: 600 }}>Asunto IA:</span> {draft.subject}
          </div>
          <div className="table-secondary" style={{ marginTop: 2, fontSize: 12, opacity: 0.75 }}>
            {new Date(draft.generated_at).toLocaleString()} · {draft.model}
            {draft.persona_name ? ` · ${draft.persona_name}` : ""}
            {draft.confidence !== null && (
              <>
                {" · "}
                <span style={{ color: confidenceColor, fontWeight: 600 }}>
                  conf. {(draft.confidence * 100).toFixed(0)}%
                </span>
              </>
            )}
          </div>
        </div>
        <button
          className="button button-ghost"
          type="button"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "▲" : "▼"}
        </button>
      </div>

      {expanded && (
        <div style={{ paddingTop: 4 }}>
          {draft.error_message && (
            <p className="subtitle" style={{ color: "var(--color-danger, #b91c1c)", marginBottom: 8 }}>
              Error agente: {draft.error_message}
            </p>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <DraftPane title="Versión del agente (IA)" subject={draft.subject} body={draft.body_text} />
            <DraftPane
              title="Plantilla determinista"
              subject={draft.template_subject ?? "—"}
              body={draft.template_body_text ?? "—"}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function DraftPane({ title, subject, body }: { title: string; subject: string; body: string }) {
  return (
    <div style={{ background: "#f9fafb", borderRadius: 8, padding: 12, minWidth: 0 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#111827", marginBottom: 8 }}>{subject}</div>
      <pre
        style={{
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 12,
          color: "#374151",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          margin: 0,
        }}
      >
        {body}
      </pre>
    </div>
  );
}

function confidenceTone(c: number | null): string {
  if (c === null) return "#6b7280";
  if (c >= 0.85) return "#15803d";
  if (c >= 0.7) return "#a16207";
  return "#b91c1c";
}
