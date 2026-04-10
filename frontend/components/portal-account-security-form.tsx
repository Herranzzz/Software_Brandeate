"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import type { User } from "@/lib/types";

type PortalAccountSecurityFormProps = {
  user: Pick<User, "id" | "name" | "email" | "role">;
};

async function readErrorMessage(response: Response) {
  try {
    const contentType = response.headers.get("Content-Type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as { detail?: unknown; message?: unknown } | null;
      const rawDetail = payload?.detail ?? payload?.message;
      if (typeof rawDetail === "string" && rawDetail.trim()) {
        return rawDetail.trim();
      }
      if (rawDetail && typeof rawDetail === "object") {
        return JSON.stringify(rawDetail);
      }
      return "No se pudo actualizar tu cuenta.";
    }

    const text = (await response.text()).trim();
    return text || "No se pudo actualizar tu cuenta.";
  } catch {
    return "No se pudo actualizar tu cuenta.";
  }
}

export function PortalAccountSecurityForm({ user }: PortalAccountSecurityFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [form, setForm] = useState({
    name: user.name,
    email: user.email,
    password: "",
  });
  const [baseline, setBaseline] = useState({
    name: user.name,
    email: user.email,
  });

  const passwordLength = form.password.trim().length;
  const hasChanges = useMemo(() => {
    const normalizedName = form.name.trim();
    const normalizedEmail = form.email.trim().toLowerCase();
    return (
      normalizedName !== baseline.name ||
      normalizedEmail !== baseline.email.toLowerCase() ||
      passwordLength > 0
    );
  }, [baseline.email, baseline.name, form.email, form.name, passwordLength]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    const normalizedName = form.name.trim();
    const normalizedEmail = form.email.trim().toLowerCase();
    const normalizedPassword = form.password.trim();

    if (normalizedPassword.length > 0 && normalizedPassword.length < 6) {
      setMessage({ kind: "error", text: "La contraseña debe tener mínimo 6 caracteres." });
      return;
    }

    const payload: Record<string, unknown> = {};
    if (normalizedName !== baseline.name) payload.name = normalizedName;
    if (normalizedEmail !== baseline.email.toLowerCase()) payload.email = normalizedEmail;
    if (normalizedPassword) payload.password = normalizedPassword;

    if (Object.keys(payload).length === 0) {
      setMessage({ kind: "success", text: "No hay cambios para guardar." });
      return;
    }

    const response = await fetch("/api/users/me/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      setMessage({ kind: "error", text: await readErrorMessage(response) });
      return;
    }

    const updated = (await response.json().catch(() => null)) as { name?: string; email?: string } | null;
    const nextName = (updated?.name ?? normalizedName).trim();
    const nextEmail = (updated?.email ?? normalizedEmail).trim().toLowerCase();
    setBaseline({ name: nextName, email: nextEmail });
    setForm((current) => ({
      ...current,
      name: nextName,
      email: nextEmail,
      password: "",
    }));
    setMessage({ kind: "success", text: "Cuenta actualizada correctamente." });
    startTransition(() => router.refresh());
  }

  return (
    <form className="stack" onSubmit={handleSubmit}>
      <div className="portal-settings-grid">
        <div className="field">
          <label htmlFor="portal-account-name">Nombre</label>
          <input
            id="portal-account-name"
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            placeholder="Nombre de la cuenta"
            value={form.name}
          />
        </div>
        <div className="field">
          <label htmlFor="portal-account-email">Email</label>
          <input
            id="portal-account-email"
            onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
            placeholder="cliente@empresa.com"
            type="email"
            value={form.email}
          />
        </div>
        <div className="field">
          <label htmlFor="portal-account-password">Nueva contraseña</label>
          <input
            id="portal-account-password"
            minLength={6}
            onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
            placeholder="Déjala vacía si no cambia"
            type="password"
            value={form.password}
          />
        </div>
        <div className="field">
          <label htmlFor="portal-account-role">Rol actual</label>
          <input id="portal-account-role" readOnly value={user.role === "shop_admin" ? "Shop admin" : "Shop viewer"} />
          <div className="table-secondary">El rol se gestiona desde las cuentas cliente por jerarquía.</div>
        </div>
      </div>

      {message ? <div className={`feedback feedback-${message.kind}`}>{message.text}</div> : null}

      <div className="actions-row">
        <button
          className="button"
          disabled={isPending || !form.name.trim() || !form.email.trim() || (passwordLength > 0 && passwordLength < 6) || !hasChanges}
          type="submit"
        >
          {isPending ? "Guardando..." : "Guardar cuenta"}
        </button>
      </div>
    </form>
  );
}
