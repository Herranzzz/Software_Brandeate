"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

/* ── useKeyNav: G P/D/A/I navigation ────────────────────────────────────── */
export function useKeyNav() {
  const router = useRouter();

  useEffect(() => {
    let pendingG = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function isInputFocused() {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName.toLowerCase();
      return tag === "input" || tag === "textarea" || tag === "select" || (el as HTMLElement).isContentEditable;
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (isInputFocused()) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key.toLowerCase();

      if (pendingG) {
        pendingG = false;
        if (timer) { clearTimeout(timer); timer = null; }
        switch (key) {
          case "p": router.push("/orders"); break;
          case "d": router.push("/dashboard"); break;
          case "a": router.push("/shipments"); break;
          case "i": router.push("/incidencias"); break;
        }
        return;
      }

      if (key === "g") {
        pendingG = true;
        timer = setTimeout(() => { pendingG = false; }, 800);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (timer) clearTimeout(timer);
    };
  }, [router]);
}

/* ── Shortcut data ───────────────────────────────────────────────────────── */
const GROUPS = [
  {
    title: "Navegación",
    rows: [
      { keys: ["G", "P"], desc: "Pedidos" },
      { keys: ["G", "D"], desc: "Dashboard" },
      { keys: ["G", "A"], desc: "Analítica" },
      { keys: ["G", "I"], desc: "Incidencias" },
    ],
  },
  {
    title: "Pedidos",
    rows: [
      { keys: ["⌘K"], desc: "Command palette" },
      { keys: ["⌘F"], desc: "Buscar" },
      { keys: ["Escape"], desc: "Cerrar panel / modal" },
    ],
  },
  {
    title: "Acciones",
    rows: [
      { keys: ["B"], desc: "Modo escáner de código de barras" },
      { keys: ["?"], desc: "Esta ayuda" },
    ],
  },
];

/* ── KeyboardShortcutsOverlay ────────────────────────────────────────────── */
export function KeyboardShortcutsOverlay() {
  const [open, setOpen] = useState(false);

  // Also activate G-nav from this component
  useKeyNav();

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    function isInputFocused() {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName.toLowerCase();
      return tag === "input" || tag === "textarea" || tag === "select" || (el as HTMLElement).isContentEditable;
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") { setOpen(false); return; }
      if (e.key === "?" && !isInputFocused() && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (!open) return null;

  return (
    <div className="kbhelp-overlay" onClick={close} role="dialog" aria-modal="true" aria-label="Atajos de teclado">
      <div className="kbhelp-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Atajos de teclado</h3>
        {GROUPS.map((group) => (
          <div className="kbhelp-group" key={group.title}>
            <div className="kbhelp-group-title">{group.title}</div>
            {group.rows.map((row) => (
              <div className="kbhelp-row" key={row.desc}>
                <span className="kbhelp-desc">{row.desc}</span>
                <span className="kbhelp-keys">
                  {row.keys.map((k) => (
                    <kbd className="kbhelp-key" key={k}>{k}</kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
