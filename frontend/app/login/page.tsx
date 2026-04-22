"use client";

import { useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsPending(true);
    setMessage(null);

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const payload = (await response.json().catch(() => null)) as
      | { user?: { role?: string }; detail?: string }
      | null;

    setIsPending(false);

    if (!response.ok) {
      setMessage({ kind: "error", text: payload?.detail ?? "No se pudo iniciar sesión." });
      return;
    }

    setMessage({ kind: "success", text: "Sesión iniciada." });
    const role = payload?.user?.role;
    const dest = role === "super_admin" || role === "ops_admin" ? "/dashboard" : "/portal";
    window.location.href = dest;
  }

  return (
    <div className="auth-shell">
      <aside className="auth-aside" aria-hidden="true">
        <div className="auth-aside-grid" />
        <div className="auth-aside-glow" />
        <div className="auth-aside-inner">
          <div className="auth-aside-brand">
            <span className="auth-aside-mark">BR</span>
            <span className="auth-aside-name">Brandeate</span>
          </div>

          <div className="auth-aside-copy">
            <h2 className="auth-aside-title">
              El centro de operaciones <em>de tu marca print-on-demand.</em>
            </h2>
            <p className="auth-aside-lede">
              Pedidos, producción, envíos y devoluciones — sincronizado en tiempo real entre tienda y taller.
            </p>
          </div>

          <ul className="auth-aside-bullets">
            <li>
              <span className="auth-aside-dot" />
              Realtime entre dispositivos
            </li>
            <li>
              <span className="auth-aside-dot" />
              Bulk design con cola de progreso
            </li>
            <li>
              <span className="auth-aside-dot" />
              Sincronización Shopify continua
            </li>
          </ul>

          <div className="auth-aside-status">
            <span className="auth-aside-pulse" aria-hidden="true" />
            Sistemas operativos
          </div>
        </div>
      </aside>

      <main className="auth-main">
        <div className="auth-main-inner">
          <div className="auth-mobile-brand">
            <span className="auth-aside-mark">BR</span>
            <span className="auth-aside-name">Brandeate</span>
          </div>

          <header className="auth-form-head">
            <span className="auth-eyebrow">Operations Hub</span>
            <h1 className="auth-form-title">Bienvenido de vuelta</h1>
            <p className="auth-form-lede">
              Inicia sesión para acceder al panel de administración o al portal cliente.
            </p>
          </header>

          <form className="auth-form" onSubmit={handleSubmit} noValidate>
            <div className="auth-field">
              <label htmlFor="email">Email</label>
              <input
                autoComplete="email"
                id="email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="tu@email.com"
                type="email"
                value={email}
              />
            </div>

            <div className="auth-field">
              <label htmlFor="password">Contraseña</label>
              <input
                autoComplete="current-password"
                id="password"
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
                type="password"
                value={password}
              />
            </div>

            {message ? (
              <div className={`feedback feedback-${message.kind}`} role="status">
                {message.text}
              </div>
            ) : null}

            <button
              className="button auth-form-submit"
              disabled={isPending || !email || !password}
              type="submit"
            >
              {isPending ? (
                <span className="auth-form-submit-loading">
                  <span className="auth-form-spinner" aria-hidden="true" />
                  Entrando…
                </span>
              ) : (
                "Acceder"
              )}
            </button>
          </form>

          <footer className="auth-form-footer">
            <span>¿Aún no tienes cuenta?</span>
            <a
              className="auth-form-link"
              href="https://brandeate.es/#reservar"
              target="_blank"
              rel="noopener noreferrer"
            >
              Hablar con ventas →
            </a>
          </footer>
        </div>
      </main>
    </div>
  );
}
