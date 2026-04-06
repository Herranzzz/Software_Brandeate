"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
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
    router.push(role === "super_admin" || role === "ops_admin" ? "/dashboard" : "/portal");
    router.refresh();
  }

  return (
    <div className="auth-login-shell">
      <section className="auth-login-minimal-card">
        <div className="auth-login-minimal-brand">
          <span className="auth-login-brand-mark">BR</span>
          <div className="auth-login-brand-copy">
            <span className="eyebrow">Brandeate</span>
            <strong>Operations Hub</strong>
          </div>
        </div>

        <div className="auth-login-minimal-head">
          <h1 className="auth-login-panel-title">Iniciar sesión</h1>
          <p className="auth-login-panel-copy">
            Accede al entorno de administración o al portal cliente con las credenciales asignadas.
          </p>
        </div>

        <form className="auth-login-form" onSubmit={handleSubmit}>
          <div className="field">
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

          <div className="field">
            <label htmlFor="password">Contraseña</label>
            <input
              autoComplete="current-password"
              id="password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Introduce tu contraseña"
              type="password"
              value={password}
            />
          </div>

          <button className="button auth-login-submit" disabled={isPending || !email || !password} type="submit">
            {isPending ? "Entrando..." : "Acceder"}
          </button>
        </form>

        {message ? <div className={`feedback feedback-${message.kind}`}>{message.text}</div> : null}

        <div className="auth-login-footer auth-login-footer-minimal">
          <span>¿Necesitas acceso para una nueva tienda?</span>
          <Link className="table-link table-link-strong" href="/signup">
            Ponte en contacto con nosotros
          </Link>
        </div>
      </section>
    </div>
  );
}
