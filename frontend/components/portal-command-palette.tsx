"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Command = {
  id: string;
  label: string;
  hint?: string;
  group: string;
  icon: string;
  keywords?: string[];
  href?: string;
  action?: () => void;
};

type PortalCommandPaletteProps = {
  shopQuery: string;
  onToggleTheme: () => void;
  onOpenHelp?: () => void;
};

export function PortalCommandPalette({ shopQuery, onToggleTheme }: PortalCommandPaletteProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const commands = useMemo<Command[]>(() => [
    { id: "nav-home", label: "Ir al inicio", group: "Navegar", icon: "🏠", href: `/portal${shopQuery}`, keywords: ["dashboard","resumen","home"] },
    { id: "nav-orders", label: "Ver pedidos", group: "Navegar", icon: "📦", href: `/portal/orders${shopQuery}` },
    { id: "nav-shipments", label: "Ver expediciones", group: "Navegar", icon: "🚚", href: `/portal/shipments${shopQuery}` },
    { id: "nav-incidencias", label: "Incidencias abiertas", group: "Navegar", icon: "⚠️", href: `/portal/incidencias${shopQuery}` },
    { id: "nav-returns", label: "Devoluciones", group: "Navegar", icon: "↩️", href: `/portal/returns${shopQuery}` },
    { id: "nav-inventory", label: "Inventario", group: "Navegar", icon: "📚", href: `/portal/inventory${shopQuery}` },
    { id: "nav-reports", label: "Informes", group: "Navegar", icon: "📊", href: `/portal/reports${shopQuery}` },
    { id: "nav-calculator", label: "Calculadora de envíos", hint: "Compara tarifas y carriers", group: "Herramientas", icon: "🧮", href: `/portal/calculator${shopQuery}`, keywords: ["tarifa","cotizar","price","rate"] },
    { id: "nav-addresses", label: "Libreta de direcciones", hint: "Remitentes y destinatarios", group: "Herramientas", icon: "📮", href: `/portal/addresses${shopQuery}`, keywords: ["address","contactos"] },
    { id: "nav-performance", label: "Rendimiento y SLA", hint: "On-time, tránsito y carriers", group: "Herramientas", icon: "🎯", href: `/portal/performance${shopQuery}`, keywords: ["sla","kpi","performance"] },
    { id: "nav-settings-account", label: "Ajustes · Mi cuenta", group: "Ajustes", icon: "🔐", href: `/portal/settings?tab=account` },
    { id: "nav-settings-tracking", label: "Ajustes · Tracking", group: "Ajustes", icon: "📦", href: `/portal/settings?tab=tracking` },
    { id: "nav-settings-billing", label: "Ajustes · Facturación", group: "Ajustes", icon: "💰", href: `/portal/settings?tab=billing` },
    { id: "nav-settings-notifications", label: "Ajustes · Notificaciones", group: "Ajustes", icon: "🔔", href: `/portal/settings?tab=notifications` },
    { id: "nav-settings-developers", label: "Ajustes · Desarrolladores (API)", group: "Ajustes", icon: "🧑‍💻", href: `/portal/settings?tab=developers`, keywords: ["api","key","token","webhook"] },
    { id: "act-theme", label: "Cambiar modo claro/oscuro", group: "Acciones", icon: "🌓", action: () => onToggleTheme(), keywords: ["dark","light","tema"] },
    { id: "act-help", label: "Abrir centro de ayuda", group: "Acciones", icon: "❓", href: `/portal/help${shopQuery}` },
  ], [shopQuery, onToggleTheme]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => {
      const hay = [c.label, c.hint, c.group, ...(c.keywords ?? [])].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [commands, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, Command[]>();
    for (const cmd of filtered) {
      const arr = map.get(cmd.group) ?? [];
      arr.push(cmd);
      map.set(cmd.group, arr);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const runCommand = useCallback((cmd: Command) => {
    setOpen(false);
    if (cmd.action) cmd.action();
    else if (cmd.href) router.push(cmd.href);
  }, [router]);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  useEffect(() => { setActiveIndex(0); }, [query]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = filtered[activeIndex];
      if (cmd) runCommand(cmd);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="cmdk-launcher"
        onClick={() => setOpen(true)}
        aria-label="Abrir paleta de comandos (⌘ K)"
        title="Buscar · ⌘ K"
      >
        <span aria-hidden>🔎</span>
        <span className="cmdk-launcher-label">Buscar en el portal…</span>
        <kbd className="cmdk-kbd">⌘ K</kbd>
      </button>
    );
  }

  let globalIndex = -1;

  return (
    <div className="cmdk-backdrop" onClick={() => setOpen(false)}>
      <div className="cmdk-panel" onClick={(e) => e.stopPropagation()}>
        <div className="cmdk-input-wrap">
          <span className="cmdk-input-icon" aria-hidden>🔎</span>
          <input
            ref={inputRef}
            className="cmdk-input"
            type="text"
            placeholder="Saltar a una página, cambiar un ajuste…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <kbd className="cmdk-kbd">Esc</kbd>
        </div>
        <div className="cmdk-results">
          {grouped.length === 0 ? (
            <div className="cmdk-empty">Sin coincidencias para “{query}”.</div>
          ) : (
            grouped.map(([group, items]) => (
              <div key={group} className="cmdk-group">
                <div className="cmdk-group-label">{group}</div>
                {items.map((cmd) => {
                  globalIndex += 1;
                  const isActive = globalIndex === activeIndex;
                  return (
                    <button
                      key={cmd.id}
                      type="button"
                      className={`cmdk-item${isActive ? " cmdk-item-active" : ""}`}
                      onMouseEnter={() => setActiveIndex(globalIndex)}
                      onClick={() => runCommand(cmd)}
                    >
                      <span className="cmdk-item-icon" aria-hidden>{cmd.icon}</span>
                      <span className="cmdk-item-body">
                        <span className="cmdk-item-label">{cmd.label}</span>
                        {cmd.hint ? <span className="cmdk-item-hint">{cmd.hint}</span> : null}
                      </span>
                      {cmd.href ? <span className="cmdk-item-meta">↵</span> : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <footer className="cmdk-footer">
          <span><kbd className="cmdk-kbd cmdk-kbd-small">↑↓</kbd> navegar</span>
          <span><kbd className="cmdk-kbd cmdk-kbd-small">↵</kbd> abrir</span>
          <span><kbd className="cmdk-kbd cmdk-kbd-small">Esc</kbd> cerrar</span>
        </footer>
      </div>
    </div>
  );
}
