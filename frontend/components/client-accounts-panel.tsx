"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type Dispatch, type SetStateAction } from "react";

import { AppModal } from "@/components/app-modal";
import { Card } from "@/components/card";
import { KpiCard } from "@/components/kpi-card";
import { PageHeader } from "@/components/page-header";
import type { AdminUser, Shop, UserRole } from "@/lib/types";

type ClientAccountsPanelProps = {
  currentUser: {
    id: number;
    role: UserRole;
  };
  accounts: AdminUser[];
  shops: Shop[];
};

type ClientAccountFormState = {
  name: string;
  email: string;
  password: string;
  role: "shop_admin" | "shop_viewer";
  is_active: boolean;
  shop_ids: number[];
};

const roleOptions: Array<{
  value: "shop_admin" | "shop_viewer";
  label: string;
  hint: string;
}> = [
  {
    value: "shop_admin",
    label: "Shop admin",
    hint: "Gestiona pedidos y operación de sus tiendas asignadas.",
  },
  {
    value: "shop_viewer",
    label: "Shop viewer",
    hint: "Acceso de solo lectura al portal y pedidos de sus tiendas.",
  },
];

function getEmptyForm(): ClientAccountFormState {
  return {
    name: "",
    email: "",
    password: "",
    role: "shop_admin",
    is_active: true,
    shop_ids: [],
  };
}

async function readErrorMessage(response: Response) {
  try {
    const contentType = response.headers.get("Content-Type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as { detail?: unknown; message?: unknown } | null;
      const rawDetail = payload?.detail ?? payload?.message;
      if (typeof rawDetail === "string" && rawDetail.trim()) {
        return rawDetail.trim();
      }
      if (Array.isArray(rawDetail)) {
        const messages = rawDetail
          .map((item) => {
            if (typeof item === "string" && item.trim()) return item.trim();
            if (item && typeof item === "object" && "msg" in item && typeof item.msg === "string") {
              return item.msg.trim();
            }
            return null;
          })
          .filter((value): value is string => Boolean(value));
        if (messages.length > 0) {
          return messages.join(" · ");
        }
      }
      if (rawDetail && typeof rawDetail === "object") {
        return JSON.stringify(rawDetail);
      }
      return "No se pudo completar la operación.";
    }

    const text = (await response.text()).trim();
    return text || "No se pudo completar la operación.";
  } catch {
    return "No se pudo completar la operación.";
  }
}

export function ClientAccountsPanel({ currentUser, accounts, shops }: ClientAccountsPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<AdminUser | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<number | null>(null);
  const [createForm, setCreateForm] = useState<ClientAccountFormState>(getEmptyForm);
  const [editForm, setEditForm] = useState<ClientAccountFormState>(getEmptyForm);

  const totals = useMemo(() => {
    const active = accounts.filter((account) => account.is_active).length;
    const inactive = accounts.length - active;
    const admins = accounts.filter((account) => account.role === "shop_admin").length;
    const viewers = accounts.filter((account) => account.role === "shop_viewer").length;
    return { active, inactive, admins, viewers };
  }, [accounts]);

  function updateForm(
    setter: Dispatch<SetStateAction<ClientAccountFormState>>,
    update: Partial<ClientAccountFormState>,
  ) {
    setter((current) => ({ ...current, ...update }));
  }

  function toggleShop(
    setter: Dispatch<SetStateAction<ClientAccountFormState>>,
    shopId: number,
  ) {
    setter((current) => ({
      ...current,
      shop_ids: current.shop_ids.includes(shopId)
        ? current.shop_ids.filter((id) => id !== shopId)
        : [...current.shop_ids, shopId],
    }));
  }

  function openEdit(account: AdminUser) {
    setSelectedAccount(account);
    setEditForm({
      name: account.name,
      email: account.email,
      password: "",
      role: account.role === "shop_viewer" ? "shop_viewer" : "shop_admin",
      is_active: account.is_active,
      shop_ids: account.shops.map((shop) => shop.id),
    });
    setMessage(null);
    setEditOpen(true);
  }

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    const normalizedPasswordLength = createForm.password.trim().length;
    if (normalizedPasswordLength < 6) {
      setMessage({ kind: "error", text: "La contraseña debe tener mínimo 6 caracteres." });
      return;
    }
    if (createForm.shop_ids.length === 0) {
      setMessage({ kind: "error", text: "Selecciona al menos una tienda para la cuenta cliente." });
      return;
    }

    const response = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: createForm.name.trim(),
        email: createForm.email.trim().toLowerCase(),
        password: createForm.password.trim(),
        role: createForm.role,
        is_active: createForm.is_active,
        shop_ids: createForm.shop_ids,
      }),
    });

    if (!response.ok) {
      setMessage({ kind: "error", text: await readErrorMessage(response) });
      return;
    }

    setCreateOpen(false);
    setCreateForm(getEmptyForm());
    setMessage({ kind: "success", text: "Cuenta cliente creada correctamente." });
    startTransition(() => router.refresh());
  }

  async function handleEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedAccount) return;
    setMessage(null);

    const normalizedName = editForm.name.trim();
    const normalizedEmail = editForm.email.trim().toLowerCase();
    const normalizedPassword = editForm.password.trim();
    const currentShopIds = [...selectedAccount.shops.map((shop) => shop.id)].sort((a, b) => a - b);
    const nextShopIds = [...editForm.shop_ids].sort((a, b) => a - b);

    const payload: Record<string, unknown> = {};
    if (normalizedName !== selectedAccount.name) payload.name = normalizedName;
    if (normalizedEmail !== selectedAccount.email.toLowerCase()) payload.email = normalizedEmail;
    if (editForm.role !== selectedAccount.role) payload.role = editForm.role;
    if (editForm.is_active !== selectedAccount.is_active) payload.is_active = editForm.is_active;
    if (normalizedPassword) payload.password = normalizedPassword;
    if (
      currentShopIds.length !== nextShopIds.length ||
      currentShopIds.some((shopId, index) => shopId !== nextShopIds[index])
    ) {
      payload.shop_ids = nextShopIds;
    }

    if (Object.keys(payload).length === 0) {
      setMessage({ kind: "success", text: "No hay cambios para guardar." });
      return;
    }
    if ("password" in payload && normalizedPassword.length < 6) {
      setMessage({ kind: "error", text: "La contraseña debe tener mínimo 6 caracteres." });
      return;
    }
    if (nextShopIds.length === 0) {
      setMessage({ kind: "error", text: "Cada cuenta cliente debe tener al menos una tienda asignada." });
      return;
    }

    const response = await fetch(`/api/users/${selectedAccount.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      setMessage({ kind: "error", text: await readErrorMessage(response) });
      return;
    }

    setEditOpen(false);
    setSelectedAccount(null);
    setMessage({ kind: "success", text: "Cuenta cliente actualizada." });
    startTransition(() => router.refresh());
  }

  async function handleDelete(account: AdminUser) {
    if (!window.confirm(`¿Borrar la cuenta cliente ${account.email}?`)) return;

    setDeletingUserId(account.id);
    setMessage(null);

    const response = await fetch(`/api/users/${account.id}`, { method: "DELETE" });

    setDeletingUserId(null);
    if (!response.ok) {
      setMessage({ kind: "error", text: await readErrorMessage(response) });
      return;
    }

    setMessage({ kind: "success", text: "Cuenta cliente eliminada." });
    startTransition(() => router.refresh());
  }

  async function handleImpersonate(account: AdminUser) {
    if (!account.is_active) {
      setMessage({ kind: "error", text: "Activa la cuenta cliente antes de entrar en su portal." });
      return;
    }
    if (account.shops.length === 0) {
      setMessage({ kind: "error", text: "La cuenta cliente no tiene tiendas asignadas." });
      return;
    }

    setMessage(null);
    const response = await fetch(`/api/auth/impersonate/${account.id}`, {
      method: "POST",
    });
    if (!response.ok) {
      setMessage({ kind: "error", text: await readErrorMessage(response) });
      return;
    }

    const preferredShopId = account.shops[0]?.id;
    const targetHref = preferredShopId ? `/portal?shop_id=${preferredShopId}` : "/portal";
    window.location.assign(targetHref);
  }

  function renderShops(account: AdminUser) {
    if (account.shops.length === 0) {
      return <span className="table-secondary">Sin tiendas</span>;
    }
    return (
      <div className="team-shop-grid">
        {account.shops.map((shop) => (
          <span className="team-shop-pill team-shop-pill-active" key={`${account.id}-${shop.id}`}>
            {shop.name}
          </span>
        ))}
      </div>
    );
  }

  function renderPortalLinks(account: AdminUser) {
    if (account.shops.length === 0) {
      return <span className="table-secondary">Sin acceso portal</span>;
    }

    return (
      <div className="team-shop-grid">
        {account.shops.map((shop) => (
          <Link
            className="button-secondary table-action"
            href={`/tenant/${shop.id}/dashboard/overview`}
            key={`portal-${account.id}-${shop.id}`}
            target="_blank"
          >
            {shop.name}
          </Link>
        ))}
      </div>
    );
  }

  function renderForm(
    mode: "create" | "edit",
    form: ClientAccountFormState,
    setter: Dispatch<SetStateAction<ClientAccountFormState>>,
  ) {
    const passwordLength = form.password.trim().length;

    return (
      <form className="stack" onSubmit={mode === "create" ? handleCreate : handleEdit}>
        <div className="portal-settings-grid">
          <div className="field">
            <label htmlFor={`${mode}-client-name`}>Nombre</label>
            <input
              id={`${mode}-client-name`}
              onChange={(event) => updateForm(setter, { name: event.target.value })}
              placeholder="Nombre del cliente"
              value={form.name}
            />
          </div>
          <div className="field">
            <label htmlFor={`${mode}-client-email`}>Email</label>
            <input
              id={`${mode}-client-email`}
              onChange={(event) => updateForm(setter, { email: event.target.value })}
              placeholder="cliente@empresa.com"
              type="email"
              value={form.email}
            />
          </div>
          <div className="field">
            <label htmlFor={`${mode}-client-password`}>
              {mode === "create" ? "Contraseña inicial" : "Nueva contraseña"}
            </label>
            <input
              id={`${mode}-client-password`}
              minLength={6}
              onChange={(event) => updateForm(setter, { password: event.target.value })}
              placeholder={mode === "create" ? "Mínimo 6 caracteres" : "Déjala vacía si no cambia"}
              type="password"
              value={form.password}
            />
          </div>
          <div className="field">
            <label htmlFor={`${mode}-client-role`}>Tipo de cuenta</label>
            <select
              id={`${mode}-client-role`}
              onChange={(event) => updateForm(setter, { role: event.target.value as "shop_admin" | "shop_viewer" })}
              value={form.role}
            >
              {roleOptions.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
            <div className="table-secondary">{roleOptions.find((role) => role.value === form.role)?.hint}</div>
          </div>
        </div>

        <div className="employees-form-switch">
          <span className="employees-form-switch-copy">
            Estado de la cuenta
            <small>{form.is_active ? "Acceso activo al portal cliente." : "Cuenta creada pero bloqueada."}</small>
          </span>
          <button
            className={`employees-toggle ${form.is_active ? "is-active" : ""}`}
            onClick={(event) => {
              event.preventDefault();
              updateForm(setter, { is_active: !form.is_active });
            }}
            type="button"
          >
            <span />
          </button>
        </div>

        <div className="team-shops-block">
          <div className="team-shops-head">
            <strong>Tiendas asignadas</strong>
            <span className="table-secondary">Selecciona qué tiendas podrá abrir esta cuenta cliente.</span>
          </div>
          <div className="team-shop-grid">
            {shops.map((shop) => {
              const selected = form.shop_ids.includes(shop.id);
              return (
                <button
                  className={`team-shop-pill ${selected ? "team-shop-pill-active" : ""}`}
                  key={`${mode}-shop-${shop.id}`}
                  onClick={(event) => {
                    event.preventDefault();
                    toggleShop(setter, shop.id);
                  }}
                  type="button"
                >
                  {shop.name}
                </button>
              );
            })}
          </div>
        </div>

        <div className="modal-footer">
          <button
            className="button"
            disabled={
              isPending ||
              !form.name.trim() ||
              !form.email.trim() ||
              (mode === "create" && passwordLength < 6) ||
              (mode === "edit" && passwordLength > 0 && passwordLength < 6) ||
              form.shop_ids.length === 0
            }
            type="submit"
          >
            {mode === "create" ? "Crear cuenta cliente" : "Guardar cambios"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="stack">
      <PageHeader
        actions={
          <button className="button" onClick={() => setCreateOpen(true)} type="button">
            Nueva cuenta cliente
          </button>
        }
        eyebrow="Cuentas cliente"
        title="Accesos del portal cliente"
        description="Gestiona cuentas cliente por tienda y entra al portal de cada cliente desde admin para revisar su experiencia."
      />

      {message ? <div className={`feedback feedback-${message.kind}`}>{message.text}</div> : null}

      <section className="admin-dashboard-kpis">
        <KpiCard label="Cuentas totales" tone="default" value={String(accounts.length)} />
        <KpiCard label="Activas" tone="success" value={String(totals.active)} />
        <KpiCard label="Inactivas" tone="danger" value={String(totals.inactive)} />
        <KpiCard label="Shop admin" tone="accent" value={String(totals.admins)} />
        <KpiCard label="Shop viewer" tone="warning" value={String(totals.viewers)} />
      </section>

      <Card className="stack table-card">
        <div className="table-header">
          <div>
            <span className="eyebrow">Accesos</span>
            <h3 className="section-title section-title-small">Cuentas cliente registradas</h3>
          </div>
          <div className="muted">{accounts.length} cuentas</div>
        </div>

        <div className="table-wrap">
          <table className="table employees-table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Rol</th>
                <th>Estado</th>
                <th>Tiendas</th>
                <th>Portal</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr className="table-row" key={account.id}>
                  <td>
                    <div className="table-primary">{account.name}</div>
                    <div className="table-secondary">{account.email}</div>
                  </td>
                  <td>
                    <span className="portal-soft-pill">{account.role === "shop_admin" ? "Shop admin" : "Shop viewer"}</span>
                  </td>
                  <td>
                    <span className={`employees-status-pill ${account.is_active ? "is-active" : "is-inactive"}`}>
                      {account.is_active ? "Activa" : "Inactiva"}
                    </span>
                  </td>
                  <td>{renderShops(account)}</td>
                  <td>{renderPortalLinks(account)}</td>
                  <td>
                    <div className="employees-actions">
                      <button className="button-secondary table-action" onClick={() => void handleImpersonate(account)} type="button">
                        Entrar portal
                      </button>
                      <button className="button-secondary table-action" onClick={() => openEdit(account)} type="button">
                        Editar
                      </button>
                      <button
                        className="button-secondary table-action"
                        onClick={() => void handleDelete(account)}
                        type="button"
                        disabled={deletingUserId === account.id || account.id === currentUser.id}
                      >
                        {deletingUserId === account.id ? "Borrando..." : "Borrar"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <AppModal
        actions={(
          <button className="button-secondary" onClick={() => setCreateOpen(false)} type="button">
            Cerrar
          </button>
        )}
        eyebrow="Gestión"
        onClose={() => setCreateOpen(false)}
        open={createOpen}
        subtitle="Crea un acceso cliente y asígnalo a una o varias tiendas."
        title="Nueva cuenta cliente"
        width="wide"
      >
        {renderForm("create", createForm, setCreateForm)}
      </AppModal>

      <AppModal
        actions={(
          <button className="button-secondary" onClick={() => setEditOpen(false)} type="button">
            Cerrar
          </button>
        )}
        eyebrow="Gestión"
        onClose={() => setEditOpen(false)}
        open={editOpen}
        subtitle={selectedAccount ? `Edita permisos y acceso de ${selectedAccount.name}.` : "Edita cuenta"}
        title="Editar cuenta cliente"
        width="wide"
      >
        {renderForm("edit", editForm, setEditForm)}
      </AppModal>
    </div>
  );
}
