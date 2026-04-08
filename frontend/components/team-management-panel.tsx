"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import type { AdminUser, Shop, UserRole } from "@/lib/types";

type TeamManagementPanelProps = {
  users: AdminUser[];
  shops: Shop[];
};

const roleOptions: Array<{ value: UserRole; label: string; hint: string }> = [
  { value: "ops_admin", label: "Ops admin", hint: "Acceso global a la operativa de Brandeate app." },
  { value: "shop_admin", label: "Shop admin", hint: "Gestiona una o varias tiendas cliente." },
  { value: "shop_viewer", label: "Shop viewer", hint: "Solo visibilidad sobre tiendas asignadas." },
];

const roleLabels: Record<UserRole, string> = {
  super_admin: "Super admin",
  ops_admin: "Ops admin",
  shop_admin: "Shop admin",
  shop_viewer: "Shop viewer",
};

export function TeamManagementPanel({ users, shops }: TeamManagementPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "shop_admin" as UserRole,
    shop_ids: [] as number[],
  });

  const visibleUsers = useMemo(
    () => users.filter((user) => user.role !== "super_admin"),
    [users],
  );

  function toggleShop(shopId: number) {
    setForm((current) => ({
      ...current,
      shop_ids: current.shop_ids.includes(shopId)
        ? current.shop_ids.filter((id) => id !== shopId)
        : [...current.shop_ids, shopId],
    }));
  }

  const needsShops = form.role === "shop_admin" || form.role === "shop_viewer";

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    const payload = {
      ...form,
      email: form.email.trim().toLowerCase(),
      shop_ids: needsShops ? form.shop_ids : [],
    };

    const response = await fetch("/api/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const result = (await response.json().catch(() => null)) as { detail?: string } | null;

    if (!response.ok) {
      setMessage({
        kind: "error",
        text: result?.detail ?? "No se pudo crear el empleado.",
      });
      return;
    }

    setMessage({
      kind: "success",
      text: "Empleado creado correctamente.",
    });
    setForm({
      name: "",
      email: "",
      password: "",
      role: "shop_admin",
      shop_ids: [],
    });
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className="stack">
      <div className="team-admin-grid">
        <section className="team-panel team-panel-form">
          <div className="team-panel-head">
            <div>
              <span className="eyebrow">Equipo</span>
              <h3 className="section-title section-title-small">Alta de empleados</h3>
              <p className="subtitle">
                Crea accesos internos para operaciones o accesos acotados para cuentas cliente sin salir del admin.
              </p>
            </div>
          </div>

          <form className="stack" onSubmit={handleSubmit}>
            <div className="portal-settings-grid">
              <div className="field">
                <label htmlFor="team-user-name">Nombre</label>
                <input
                  id="team-user-name"
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Nombre del empleado"
                  value={form.name}
                />
              </div>

              <div className="field">
                <label htmlFor="team-user-email">Email</label>
                <input
                  id="team-user-email"
                  onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                  placeholder="empleado@brandeate.com"
                  type="email"
                  value={form.email}
                />
              </div>

              <div className="field">
                <label htmlFor="team-user-password">Contraseña inicial</label>
                <input
                  id="team-user-password"
                  minLength={6}
                  onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                  placeholder="Mínimo 6 caracteres"
                  type="password"
                  value={form.password}
                />
              </div>

              <div className="field">
                <label htmlFor="team-user-role">Rol</label>
                <select
                  id="team-user-role"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      role: event.target.value as UserRole,
                      shop_ids:
                        event.target.value === "ops_admin" ? [] : current.shop_ids,
                    }))
                  }
                  value={form.role}
                >
                  {roleOptions.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                </select>
                <div className="table-secondary">
                  {roleOptions.find((role) => role.value === form.role)?.hint}
                </div>
              </div>
            </div>

            <div className="team-shops-block">
              <div className="team-shops-head">
                <strong>Tiendas asignadas</strong>
                <span className="table-secondary">
                  {needsShops
                    ? "Selecciona las tiendas que este usuario podrá ver."
                    : "Los ops admin tienen alcance global, no necesitan tiendas asignadas."}
                </span>
              </div>

              <div className="team-shop-grid">
                {shops.map((shop) => {
                  const isSelected = form.shop_ids.includes(shop.id);
                  return (
                    <button
                      className={`team-shop-pill ${isSelected ? "team-shop-pill-active" : ""}`}
                      disabled={!needsShops}
                      key={shop.id}
                      onClick={(event) => {
                        event.preventDefault();
                        if (needsShops) {
                          toggleShop(shop.id);
                        }
                      }}
                      type="button"
                    >
                      {shop.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {message ? <div className={`feedback feedback-${message.kind}`}>{message.text}</div> : null}

            <div className="actions-row">
              <button
                className="button"
                disabled={
                  isPending ||
                  !form.name.trim() ||
                  !form.email.trim() ||
                  form.password.length < 6 ||
                  (needsShops && form.shop_ids.length === 0)
                }
                type="submit"
              >
                {isPending ? "Creando..." : "Crear empleado"}
              </button>
            </div>
          </form>
        </section>

        <section className="team-panel team-panel-list">
          <div className="team-panel-head">
            <div>
              <span className="eyebrow">Accesos activos</span>
              <h3 className="section-title section-title-small">Equipo actual</h3>
              <p className="subtitle">
                Vista rápida de quién tiene acceso al admin o a tiendas cliente y con qué alcance.
              </p>
            </div>
            <div className="team-count-pill">{visibleUsers.length} usuarios</div>
          </div>

          <div className="team-user-list">
            {visibleUsers.length > 0 ? (
              visibleUsers.map((user) => (
                <article className="team-user-card" key={user.id}>
                  <div className="team-user-top">
                    <div>
                      <strong>{user.name}</strong>
                      <div className="table-secondary">{user.email}</div>
                    </div>
                    <span className="portal-soft-pill">{roleLabels[user.role]}</span>
                  </div>

                  <div className="team-user-meta">
                    <div className="team-user-meta-row">
                      <span>Tiendas</span>
                      <strong>
                        {user.role === "ops_admin"
                          ? "Todas"
                          : user.shops.length > 0
                            ? user.shops.map((shop) => shop.name).join(", ")
                            : "Sin tiendas"}
                      </strong>
                    </div>
                    <div className="team-user-meta-row">
                      <span>Alta</span>
                      <strong>{new Intl.DateTimeFormat("es-ES", { dateStyle: "medium" }).format(new Date(user.created_at))}</strong>
                    </div>
                    <div className="team-user-meta-row">
                      <span>Estado</span>
                      <strong>{user.is_active ? "Activo" : "Inactivo"}</strong>
                    </div>
                  </div>
                </article>
              ))
            ) : (
              <div className="table-secondary">Todavía no hay empleados adicionales dados de alta.</div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
