"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useLayoutState } from "@/components/layout-state-provider";

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

export function AdminCommandPalette() {
  const router = useRouter();
  const { toggleTheme } = useLayoutState();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const commands = useMemo<Command[]>(() => [
    { id: "nav-dashboard", label: "Dashboard", group: "Navegar", icon: "🏠", href: "/dashboard", keywords: ["resumen","home","inicio"] },
    { id: "nav-orders", label: "Pedidos", group: "Navegar", icon: "📦", href: "/orders" },
    { id: "nav-shipments", label: "Analítica de envíos", group: "Navegar", icon: "🚚", href: "/shipments", keywords: ["expediciones","envios"] },
    { id: "nav-tracking", label: "Tracking", group: "Navegar", icon: "📍", href: "/tracking" },
    { id: "nav-returns", label: "Devoluciones", group: "Postventa", icon: "↩️", href: "/returns" },
    { id: "nav-incidencias", label: "Incidencias", group: "Postventa", icon: "⚠️", href: "/incidencias", keywords: ["alertas"] },
    { id: "nav-client-accounts", label: "Cuentas cliente", group: "Cuentas", icon: "🏢", href: "/client-accounts", keywords: ["tiendas","clientes"] },
    { id: "nav-customers", label: "Clientes finales", group: "Cuentas", icon: "👥", href: "/customers" },
    { id: "nav-invoices", label: "Facturación", group: "Cuentas", icon: "💰", href: "/invoices", keywords: ["invoices","facturas"] },
    { id: "nav-reporting", label: "Informes", group: "Cuentas", icon: "📊", href: "/reporting", keywords: ["reportes","analytics","reports"] },
    { id: "nav-analytics", label: "Analítica", group: "Cuentas", icon: "📈", href: "/analytics" },
    { id: "nav-employees", label: "Empleados", group: "Equipo", icon: "🧑‍💼", href: "/employees", keywords: ["equipo","staff"] },
    { id: "nav-employees-print", label: "Cola de impresión", group: "Equipo", icon: "🖨️", href: "/employees/print-queue", keywords: ["imprimir","etiquetas"] },
    { id: "nav-inventario", label: "Inventario", group: "Aprovisionamiento", icon: "📚", href: "/inventario", keywords: ["stock"] },
    { id: "nav-suppliers", label: "Proveedores", group: "Aprovisionamiento", icon: "🏭", href: "/suppliers" },
    { id: "nav-purchase-orders", label: "Órdenes de compra", group: "Aprovisionamiento", icon: "📝", href: "/purchase-orders", keywords: ["po","compras"] },
    { id: "nav-catalog", label: "Catálogo", group: "Aprovisionamiento", icon: "🗂️", href: "/catalog", keywords: ["productos","sku"] },
    { id: "nav-production", label: "Producción", group: "Aprovisionamiento", icon: "🛠️", href: "/production", keywords: ["personalizacion"] },
    { id: "nav-sustainability", label: "Sostenibilidad", group: "Otros", icon: "🌱", href: "/sustainability", keywords: ["co2","huella"] },
    { id: "nav-settings", label: "Ajustes", group: "Configuración", icon: "⚙️", href: "/settings" },
    { id: "act-theme", label: "Cambiar modo claro/oscuro", group: "Acciones", icon: "🌓", action: () => toggleTheme(), keywords: ["dark","light","tema"] },
  ], [toggleTheme]);

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
        <span className="cmdk-launcher-label">Buscar en el panel…</span>
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
