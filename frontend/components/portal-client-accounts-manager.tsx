"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type Dispatch, type SetStateAction } from "react";

import { AppModal } from "@/components/app-modal";
import { KpiCard } from "@/components/kpi-card";
import type { AdminUser, Shop, UserRole } from "@/lib/types";

type PortalClientAccountsManagerProps = {
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

type PasswordFormState = {
  password: string;
  confirm: string;
};

const roleOptions: Array<{
  value: "shop_admin" | "shop_viewer";
  label: string;
  hint: string;
}> = [
  {
    value: "shop_admin",
    label: "Shop admin",
    hint: "Gestiona operativa y usuarios dentro de sus tiendas asignadas.",
  },
  {
    value: "shop_viewer",
    label: "Shop viewer",
    hint: "Consulta pedidos y expediciones sin capacidad de gestión.",
  },
];

function getEmptyForm(): ClientAccountFormState {
  return {
    name: "",
    email: "",
    password: "",
    role: "shop_viewer",
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
      if (typeof rawDetail === "string" && rawDetail.trim()) return rawDetail.trim();
      if (Array.isArray(rawDetail)) {
        const messages = rawDetail
          .map((item) => {
            if (typeof item === "string" && item.trim()) return item.trim();
            if (item && typeof item === "object" && "msg" in item && typeof item.msg === "string") return item.msg.trim();
            return null;
          })
          .filter((v): v is string => Boolean(v));
        if (messages.length > 0) return messages.join(" · ");
      }
      if (rawDetail && typeof rawDetail === "object") return JSON.stringify(rawDetail);
      return "No se pudo completar la operación.";
    }
    const text = (await response.text()).trim();
    return text || "No se pudo completar la operación.";
  } catch {
    return "No se pudo completar la operación.";
  }
}

export function PortalClientAccountsManager({
  currentUser,
  accounts,
  shops,
}: PortalClientAccountsManagerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<AdminUser | null>(null);

  const [createForm, setCreateForm] = useState<ClientAccountFormState>(getEmptyForm);
  const [editForm, setEditForm] = useState<ClientAccountFormState>(getEmptyForm);
  const [passwordForm, setPasswordForm] = useState<PasswordFormState>({ password: "", confirm: "" });
  const [savingPassword, setSavingPassword] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<number | null>(null);
  const [togglingUserId, setTogglingUserId] = useState<number | null>(null);

  const totals = useMemo(() => {
    const active = accounts.filter((a) => a.is_active).length;
    const inactive = accounts.length - active;
    const admins = accounts.filter((a) => a.role === "shop_admin").length;
    const viewers = accounts.filter((a) => a.role === "shop_viewer").length;
    return { active, inactive, admins, viewers };
  }, [accounts]);

  function updateForm(setter: Dispatch<SetStateAction<ClientAccountFormState>>, update: Partial<ClientAccountFormState>) {
    setter((c) => ({ ...c, ...update }));
  }

  function toggleShop(setter: Dispatch<SetStateAction<ClientAccountFormState>>, shopId: number) {
    setter((c) => ({
      ...c,
      shop_ids: c.shop_ids.includes(shopId)
        ? c.shop_ids.filter((id) => id !== shopId)
        : [...c.shop_ids, shopId],
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
      shop_ids: account.shops.map((s) => s.id),
    });
    setMessage(null);
    setEditOpen(true);
  }

  function openPasswordChange(account: AdminUser) {
    setSelectedAccount(account);
    setPasswordForm({ password: "", confirm: "" });
    setMessage(null);
    setPasswordOpen(true);
  }

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    if (createForm.password.trim().length < 6) {
      setMessage({ kind: "error", text: "La contraseña debe tener mínimo 6 caracteres." });
      return;
    }
    if (createForm.shop_ids.length === 0) {
      setMessage({ kind: "error", text: "Selecciona al menos una tienda." });
      return;
    }
    const response = await fetch("/api/users/me/client-accounts", {
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
    setMessage({ kind: "success", text: "Cuenta creada correctamente." });
    startTransition(() => router.refresh());
  }

  async function handleEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedAccount) return;
    setMessage(null);
    const normalizedName = editForm.name.trim();
    const normalizedEmail = editForm.email.trim().toLowerCase();
    const normalizedPassword = editForm.password.trim();
    const currentShopIds = [...selectedAccount.shops.map((s) => s.id)].sort((a, b) => a - b);
    const nextShopIds = [...editForm.shop_ids].sort((a, b) => a - b);
    const payload: Record<string, unknown> = {};
    if (normalizedName !== selectedAccount.name) payload.name = normalizedName;
    if (normalizedEmail !== selectedAccount.email.toLowerCase()) payload.email = normalizedEmail;
    if (editForm.role !== selectedAccount.role) payload.role = editForm.role;
    if (editForm.is_active !== selectedAccount.is_active) payload.is_active = editForm.is_active;
    if (normalizedPassword) payload.password = normalizedPassword;
    if (currentShopIds.length !== nextShopIds.length || currentShopIds.some((id, i) => id !== nextShopIds[i])) {
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
      setMessage({ kind: "error", text: "La cuenta debe tener al menos una tienda asignada." });
      return;
    }
    const response = await fetch(`/api/users/me/client-accounts/${selectedAccount.id}`, {
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
    setMessage({ kind: "success", text: "Cuenta actualizada correctamente." });
    startTransition(() => router.refresh());
  }

  async function handlePasswordChange(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedAccount) return;
    const pw = passwordForm.password.trim();
    if (pw.length < 6) {
      setMessage({ kind: "error", text: "La contraseña debe tener mínimo 6 caracteres." });
      return;
    }
    if (pw !== passwordForm.confirm.trim()) {
      setMessage({ kind: "error", text: "Las contraseñas no coinciden." });
      return;
    }
    setSavingPassword(true);
    setMessage(null);
    const response = await fetch(`/api/users/me/client-accounts/${selectedAccount.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    setSavingPassword(false);
    if (!response.ok) {
      setMessage({ kind: "error", text: await readErrorMessage(response) });
      return;
    }
    setPasswordOpen(false);
    setPasswordForm({ password: "", confirm: "" });
    setMessage({ kind: "success", text: `Contraseña de ${selectedAccount.name} actualizada.` });
    setSelectedAccount(null);
    startTransition(() => router.refresh());
  }

  async function handleToggleStatus(account: AdminUser) {
    setTogglingUserId(account.id);
    setMessage(null);
    const response = await fetch(`/api/users/me/client-accounts/${account.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !account.is_active }),
    });
    setTogglingUserId(null);
    if (!response.ok) {
      setMessage({ kind: "error", text: await readErrorMessage(response) });
      return;
    }
    setMessage({
      kind: "success",
      text: account.is_active ? `Cuenta de ${account.name} desactivada.` : `Cuenta de ${account.name} activada.`,
    });
    startTransition(() => router.refresh());
  }

  async function handleDelete() {
    if (!selectedAccount) return;
    setDeletingUserId(selectedAccount.id);
    setDeleteOpen(false);
    setMessage(null);
    const response = await fetch(`/api/users/me/client-accounts/${selectedAccount.id}`, { method: "DELETE" });
    setDeletingUserId(null);
    if (!response.ok) {
      setMessage({ kind: "error", text: await readErrorMessage(response) });
      return;
    }
    setMessage({ kind: "success", text: "Cuenta eliminada correctamente." });
    setSelectedAccount(null);
    startTransition(() => router.refresh());
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
            <label htmlFor={`${mode}-pcl-name`}>Nombre completo</label>
            <input
              id={`${mode}-pcl-name`}
              onChange={(e) => updateForm(setter, { name: e.target.value })}
              placeholder="Nombre del usuario"
              value={form.name}
            />
          </div>
          <div className="field">
            <label htmlFor={`${mode}-pcl-email`}>Email de acceso</label>
            <input
              id={`${mode}-pcl-email`}
              onChange={(e) => updateForm(setter, { email: e.target.value })}
              placeholder="usuario@empresa.com"
              type="email"
              value={form.email}
            />
          </div>
          <div className="field">
            <label htmlFor={`${mode}-pcl-password`}>
              {mode === "create" ? "Contraseña inicial" : "Nueva contraseña"}
            </label>
            <input
              id={`${mode}-pcl-password`}
              minLength={6}
              onChange={(e) => updateForm(setter, { password: e.target.value })}
              placeholder={mode === "create" ? "Mínimo 6 caracteres" : "Déjala vacía si no cambia"}
              type="password"
              value={form.password}
            />
          </div>
          <div className="field">
            <label htmlFor={`${mode}-pcl-role`}>Tipo de cuenta</label>
            <select
              id={`${mode}-pcl-role`}
              onChange={(e) => updateForm(setter, { role: e.target.value as "shop_admin" | "shop_viewer" })}
              value={form.role}
            >
              {roleOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <div className="table-secondary">{roleOptions.find((o) => o.value === form.role)?.hint}</div>
          </div>
        </div>

        <div className="employees-form-switch">
          <span className="employees-form-switch-copy">
            Estado de la cuenta
            <small>{form.is_active ? "Acceso permitido al portal." : "Cuenta bloqueada."}</small>
          </span>
          <button
            className={`employees-toggle ${form.is_active ? "is-active" : ""}`}
            onClick={(e) => { e.preventDefault(); updateForm(setter, { is_active: !form.is_active }); }}
            type="button"
          >
            <span />
          </button>
        </div>

        <div className="team-shops-block">
          <div className="team-shops-head">
            <strong>Tiendas asignadas</strong>
            <span className="table-secondary">Solo puedes asignar tiendas dentro de tu alcance.</span>
          </div>
          <div className="team-shop-grid">
            {shops.map((shop) => {
              const selected = form.shop_ids.includes(shop.id);
              return (
                <button
                  className={`team-shop-pill ${selected ? "team-shop-pill-active" : ""}`}
                  key={`${mode}-pcl-shop-${shop.id}`}
                  onClick={(e) => { e.preventDefault(); toggleShop(setter, shop.id); }}
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
            {isPending ? "Guardando…" : mode === "create" ? "Crear cuenta" : "Guardar cambios"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="stack">
      <div className="actions-row">
        <button className="button" onClick={() => { setMessage(null); setCreateOpen(true); }} type="button">
          + Nueva cuenta
        </button>
      </div>

      {message ? <div className={`feedback feedback-${message.kind}`}>{message.text}</div> : null}

      <section className="admin-dashboard-kpis">
        <KpiCard label="Total" tone="default" value={String(accounts.length)} />
        <KpiCard label="Activas" tone="success" value={String(totals.active)} />
        <KpiCard label="Inactivas" tone="danger" value={String(totals.inactive)} />
        <KpiCard label="Admin" tone="accent" value={String(totals.admins)} />
        <KpiCard label="Viewer" tone="warning" value={String(totals.viewers)} />
      </section>

      {accounts.length === 0 ? (
        <div className="client-accounts-empty">
          <div className="client-accounts-empty-icon">👤</div>
          <p className="table-primary">Sin cuentas de usuario todavía</p>
          <p className="table-secondary">Crea la primera cuenta para dar acceso a un colaborador de tu equipo.</p>
        </div>
      ) : (
        <div className="pcl-accounts-grid">
          {accounts.map((account) => (
            <div className={`pcl-account-card ${account.is_active ? "" : "is-inactive"}`} key={account.id}>
              <div className="pcl-account-head">
                <div className="client-account-avatar">
                  {account.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="pcl-account-identity">
                  <div className="table-primary">{account.name}</div>
                  <div className="table-secondary">{account.email}</div>
                </div>
                <span className={`client-role-pill ${account.role === "shop_admin" ? "is-admin" : "is-viewer"}`}>
                  {account.role === "shop_admin" ? "Admin" : "Viewer"}
                </span>
              </div>

              <div className="pcl-account-shops">
                {account.shops.length === 0 ? (
                  <span className="table-secondary">Sin tiendas asignadas</span>
                ) : (
                  <div className="team-shop-grid">
                    {account.shops.map((shop) => (
                      <span className="team-shop-pill team-shop-pill-active" key={`pcl-shop-${account.id}-${shop.id}`}>
                        {shop.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="pcl-account-actions">
                <button
                  className={`client-status-toggle ${account.is_active ? "is-active" : "is-inactive"}`}
                  disabled={togglingUserId === account.id}
                  onClick={() => void handleToggleStatus(account)}
                  type="button"
                >
                  <span className="client-status-dot" />
                  {togglingUserId === account.id ? "…" : account.is_active ? "Activa" : "Inactiva"}
                </button>
                <div className="employees-actions" style={{ flex: 1, justifyContent: "flex-end" }}>
                  <button
                    className="button-secondary table-action"
                    onClick={() => openPasswordChange(account)}
                    type="button"
                  >
                    Contraseña
                  </button>
                  <button
                    className="button-secondary table-action"
                    onClick={() => openEdit(account)}
                    type="button"
                  >
                    Editar
                  </button>
                  <button
                    className="button-secondary table-action table-action-danger"
                    disabled={deletingUserId === account.id || account.id === currentUser.id}
                    onClick={() => { setSelectedAccount(account); setDeleteOpen(true); }}
                    type="button"
                  >
                    {deletingUserId === account.id ? "…" : "Borrar"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create */}
      <AppModal
        actions={<button className="button-secondary" onClick={() => setCreateOpen(false)} type="button">Cancelar</button>}
        eyebrow="Nueva cuenta"
        onClose={() => setCreateOpen(false)}
        open={createOpen}
        subtitle="Crea una cuenta y asígnala a las tiendas que administras."
        title="Nueva cuenta de usuario"
        width="wide"
      >
        {message && createOpen ? <div className={`feedback feedback-${message.kind}`}>{message.text}</div> : null}
        {renderForm("create", createForm, setCreateForm)}
      </AppModal>

      {/* Edit */}
      <AppModal
        actions={<button className="button-secondary" onClick={() => setEditOpen(false)} type="button">Cancelar</button>}
        eyebrow="Editar"
        onClose={() => setEditOpen(false)}
        open={editOpen}
        subtitle={selectedAccount ? `Edita el acceso de ${selectedAccount.name}.` : "Editar cuenta"}
        title="Editar cuenta de usuario"
        width="wide"
      >
        {message && editOpen ? <div className={`feedback feedback-${message.kind}`}>{message.text}</div> : null}
        {renderForm("edit", editForm, setEditForm)}
      </AppModal>

      {/* Password */}
      <AppModal
        actions={<button className="button-secondary" onClick={() => setPasswordOpen(false)} type="button">Cancelar</button>}
        eyebrow="Seguridad"
        onClose={() => setPasswordOpen(false)}
        open={passwordOpen}
        subtitle={selectedAccount ? `Nueva contraseña para ${selectedAccount.name}.` : "Cambiar contraseña"}
        title="Cambiar contraseña"
      >
        {message && passwordOpen ? <div className={`feedback feedback-${message.kind}`}>{message.text}</div> : null}
        <form className="stack" onSubmit={(e) => void handlePasswordChange(e)}>
          <div className="portal-settings-grid">
            <div className="field">
              <label htmlFor="pcl-new-password">Nueva contraseña</label>
              <input
                autoComplete="new-password"
                id="pcl-new-password"
                minLength={6}
                onChange={(e) => setPasswordForm((p) => ({ ...p, password: e.target.value }))}
                placeholder="Mínimo 6 caracteres"
                type="password"
                value={passwordForm.password}
              />
            </div>
            <div className="field">
              <label htmlFor="pcl-confirm-password">Confirmar contraseña</label>
              <input
                autoComplete="new-password"
                id="pcl-confirm-password"
                minLength={6}
                onChange={(e) => setPasswordForm((p) => ({ ...p, confirm: e.target.value }))}
                placeholder="Repite la contraseña"
                type="password"
                value={passwordForm.confirm}
              />
            </div>
          </div>
          {passwordForm.password.trim().length > 0 &&
            passwordForm.confirm.trim().length > 0 &&
            passwordForm.password.trim() !== passwordForm.confirm.trim() ? (
            <div className="feedback feedback-error" style={{ marginTop: 0 }}>Las contraseñas no coinciden.</div>
          ) : null}
          <div className="modal-footer">
            <button
              className="button"
              disabled={
                savingPassword ||
                passwordForm.password.trim().length < 6 ||
                passwordForm.password.trim() !== passwordForm.confirm.trim()
              }
              type="submit"
            >
              {savingPassword ? "Guardando…" : "Actualizar contraseña"}
            </button>
          </div>
        </form>
      </AppModal>

      {/* Delete confirm */}
      <AppModal
        actions={<button className="button-secondary" onClick={() => setDeleteOpen(false)} type="button">Cancelar</button>}
        eyebrow="Confirmación"
        onClose={() => setDeleteOpen(false)}
        open={deleteOpen}
        subtitle={selectedAccount ? `Se eliminará permanentemente la cuenta de ${selectedAccount.name}.` : ""}
        title="¿Borrar esta cuenta?"
      >
        <div className="modal-footer">
          <button className="button button-danger" onClick={() => void handleDelete()} type="button">
            Sí, borrar
          </button>
          <button className="button-secondary" onClick={() => setDeleteOpen(false)} type="button">
            Cancelar
          </button>
        </div>
      </AppModal>
    </div>
  );
}
