"use client";

import { useRef, useState, useTransition } from "react";

type OrderInternalNoteProps = {
  orderId: number;
  initialNote: string | null;
};

export function OrderInternalNote({ orderId, initialNote }: OrderInternalNoteProps) {
  const [note, setNote] = useState(initialNote ?? "");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialNote ?? "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleEdit() {
    setDraft(note);
    setEditing(true);
    setError(null);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function handleCancel() {
    setEditing(false);
    setDraft(note);
    setError(null);
  }

  function handleSave() {
    startTransition(async () => {
      try {
        const { updateOrderInternalNote } = await import("@/lib/api");
        await updateOrderInternalNote(orderId, draft.trim() || null);
        setNote(draft.trim());
        setEditing(false);
        setSaved(true);
        setError(null);
        setTimeout(() => setSaved(false), 2500);
      } catch {
        setError("No se pudo guardar la nota. Inténtalo de nuevo.");
      }
    });
  }

  return (
    <div className="internal-note-block">
      {!editing ? (
        <div className="internal-note-view">
          {note ? (
            <p className="internal-note-text">{note}</p>
          ) : (
            <p className="internal-note-placeholder">Sin nota interna. Haz clic en Editar para añadir una.</p>
          )}
          <div className="internal-note-actions">
            <button
              className="internal-note-btn"
              onClick={handleEdit}
              type="button"
            >
              {note ? "Editar nota" : "Añadir nota"}
            </button>
            {saved && <span className="internal-note-saved">✓ Guardado</span>}
          </div>
        </div>
      ) : (
        <div className="internal-note-editor">
          <textarea
            className="internal-note-textarea"
            disabled={isPending}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Escribe una nota interna sobre este pedido…"
            ref={textareaRef}
            rows={4}
            value={draft}
          />
          {error && <div className="internal-note-error">{error}</div>}
          <div className="internal-note-editor-actions">
            <button
              className="button button-primary"
              disabled={isPending}
              onClick={handleSave}
              type="button"
            >
              {isPending ? "Guardando…" : "Guardar"}
            </button>
            <button
              className="button button-secondary"
              disabled={isPending}
              onClick={handleCancel}
              type="button"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
