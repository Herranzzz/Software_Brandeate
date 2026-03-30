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
      setMessage({ kind: "error", text: payload?.detail ?? "No se pudo iniciar sesion." });
      return;
    }

    setMessage({ kind: "success", text: "Sesion iniciada." });
    const role = payload?.user?.role;
    router.push(role === "super_admin" || role === "ops_admin" ? "/dashboard" : "/portal");
    router.refresh();
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="stack">
          <span className="eyebrow">Brandeate</span>
          <h1 className="title auth-title">Acceso</h1>
          <p className="subtitle">
            Entra al panel interno de Brandeate o al espacio de cliente con tus credenciales asignadas.
          </p>
          <div className="auth-meta-row">
            <span>¿Todavía no tienes cuenta de tienda?</span>
            <Link className="table-link table-link-strong" href="/signup">
              Crear cuenta
            </Link>
          </div>
          <div className="auth-meta-row auth-meta-row-brand">
            <span>Plataforma operativa y portal cliente impulsados por Brandeate.</span>
          </div>
        </div>

        <form className="stack" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" onChange={(event) => setEmail(event.target.value)} type="email" value={email} />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              value={password}
            />
          </div>

          <button className="button" disabled={isPending || !email || !password} type="submit">
            {isPending ? "Entrando..." : "Iniciar sesion"}
          </button>
        </form>

        {message ? <div className={`feedback feedback-${message.kind}`}>{message.text}</div> : null}
      </div>
    </div>
  );
}
