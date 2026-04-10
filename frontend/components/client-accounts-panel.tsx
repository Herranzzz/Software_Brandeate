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

function CopyIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
      <rect height="13" rx="2" stroke="currentColor" strokeWidth="1.8" width="13" x="9" y="9" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
      <circle cx="8" cy="8" r="5" stroke="currentColor" strokeWidth="1.8" />
      <path d="m12.5 12.5 8.5 8.5M17 18l-2.5-2.5M19.5 15.5 17 18" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export function ClientAccountsPanel({ currentUser, accounts, shops }: ClientAccountsPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  // Modals
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<AdminUser | null>(null);

  // Forms
  const [createForm, setCreateForm] = useState<ClientAccountFormState>(getEmptyForm);
  const [editForm, setEditForm] = useState<ClientAccountFormState>(getEmptyForm);
  const [passwordForm, setPasswordForm] = useState<PasswordFormState>({ password: "", confirm: "" });

  // Inline ops
  const [togglingUserId, setTogglingUserId] = useState<number | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<number | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState<"all" | "shop_admin" | "shop_viewer">("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "inactive">("all");

  const totals = useMemo(() => {
    const active = accounts.filter((a) => a.is_active).length;
    const inactive = accounts.length - active;
    const admins = accounts.filter((a) => a.role === "shop_admin").length;
    const viewers = accounts.filter((a) => a.role === "shop_viewer").length;
    return { active, inactive, admins, viewers };
  }, [accounts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return accounts.filter((a) => {
      if (q && !a.name.toLowerCase().includes(q) && !a.email.toLowerCase().includes(q)) return false;
      if (filterRole !== "all" && a.role !== filterRole) return false;
      if (filterStatus === "active" && !a.is_active) return false;
      if (filterStatus === "inactive" && a.is_active) return false;
      return true;
    });
  }, [accounts, search, filterRole, filterStatus]);

  function updateForm(
    setter: Dispatch<SetStateAction<ClientAccountFormState>>,
    update: Partial<ClientAccountFormState>,
  ) {
    setter((current) => ({ ...current, ...update }));
  }

  function toggleShop(setter: Dispatch<SetStateAction<ClientAccountFormState>>, shopId: number) {
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

  function openPasswordChange(account: AdminUser) {
    setSelectedAccount(account);
    setPasswordForm({ password: "", confirm: "" });
    setMessage(null);
    setPasswordOpen(true);
  }

  function openDeleteConfirm(account: AdminUser) {
    setSelectedAccount(account);
    setDeleteOpen(true);
  }

  async function copyPortalLink(account: AdminUser) {
    const shopId = account.shops[0]?.id;
    const url = shopId
      ? `${window.location.origin}/portal?shop_id=${shopId}`
      : `${window.location.origin}/portal`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(account.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setMessage({ kind: "error", text: "No se pudo copiar el enlace." });
    }
  }

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    if (createForm.password.trim().length < 6) {
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
    const currentShopIds = [...selectedAccount.shops.map((s) => s.id)].sort((a, b) => a - b);
    const nextShopIds = [...editForm.shop_ids].sort((a, b) => a - b);
    const payload: Record<string, unknown> = {};
    if (normalizedName !== selectedAccount.name) payload.name = normalizedName;
    if (normalizedEmail !== selectedAccount.email.toLowerCase()) payload.email = normalizedEmail;
    if (editForm.role !== selectedAccount.role) payload.role = editForm.role;
    if (editForm.is_active !== selectedAccount.is_active) payload.is_active = editForm.is_active;
    if (normalizedPassword) payload.password = normalizedPassword;
    if (
      currentShopIds.length !== nextShopIds.length ||
      currentShopIds.some((id, i) => id !== nextShopIds[i])
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
    const response = await fetch(`/api/users/${selectedAccount.id}`, {
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
    setSelectedAccount(null);
    setPasswordForm({ password: "", confirm: "" });
    setMessage({ kind: "success", text: `Contraseña de ${selectedAccount.name} actualizada correctamente.` });
    startTransition(() => router.refresh());
  }

  async function handleToggleStatus(account: AdminUser) {
    setTogglingUserId(account.id);
    setMessage(null);
    const response = await fetch(`/api/users/${account.id}`, {
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
      text: account.is_active
        ? `Cuenta de ${account.name} desactivada.`
        : `Cuenta de ${account.name} activada.`,
    });
    startTransition(() => router.refresh());
  }

  async function handleDelete() {
    if (!selectedAccount) return;
    setDeletingUserId(selectedAccount.id);
    setDeleteOpen(false);
    setMessage(null);
    const response = await fetch(`/api/users/${selectedAccount.id}`, { method: "DELETE" });
    setDeletingUserId(null);
    if (!response.ok) {
      setMessage({ kind: "error", text: await readErrorMessage(response) });
      return;
    }
    setMessage({ kind: "success", text: "Cuenta cliente eliminada." });
    setSelectedAccount(null);
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
    const response = await fetch(`/api/auth/impersonate/${account.id}`, { method: "POST" });
    if (!response.ok) {
      setMessage({ kind: "error", text: await readErrorMessage(response) });
      return;
    }
    const preferredShopId = account.shops[0]?.id;
    window.location.assign(preferredShopId ? `/portal?shop_id=${preferredShopId}` : "/portal");
  }

  function renderAccountForm(
    mode: "create" | "edit",
    form: ClientAccountFormState,
    setter: Dispatch<SetStateAction<ClientAccountFormState>>,
  ) {
    const passwordLength = form.password.trim().length;
    return (
      <form className="stack" onSubmit={mode === "create" ? handleCreate : handleEdit}>
        <div className="portal-settings-grid">
          <div className="field">
            <label htmlFor={`${mode}-client-name`}>Nombre completo</label>
            <input
              id={`${mode}-client-name`}
              onChange={(e) => updateForm(setter, { name: e.target.value })}
              placeholder="Nombre del cliente"
              value={form.name}
            />
          </div>
          <div className="field">
            <label htmlFor={`${mode}-client-email`}>Email de acceso</label>
            <input
              id={`${mode}-client-email`}
              onChange={(e) => updateForm(setter, { email: e.target.value })}
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
              onChange={(e) => updateForm(setter, { password: e.target.value })}
              placeholder={mode === "create" ? "Mínimo 6 caracteres" : "Déjala vacía si no cambia"}
              type="password"
              value={form.password}
            />
          </div>
          <div className="field">
            <label htmlFor={`${mode}-client-role`}>Tipo de cuenta</label>
            <select
              id={`${mode}-client-role`}
              onChange={(e) => updateForm(setter, { role: e.target.value as "shop_admin" | "shop_viewer" })}
              value={form.role}
            >
              {roleOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <div className="table-secondary">{roleOptions.find((opt) => opt.value === form.role)?.hint}</div>
          </div>
        </div>

        <div className="employees-form-switch">
          <span className="employees-form-switch-copy">
            Estado de la cuenta
            <small>{form.is_active ? "Acceso activo al portal cliente." : "Cuenta creada pero bloqueada."}</small>
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
            <span className="table-secondary">Selecciona qué tiendas podrá ver en su portal.</span>
          </div>
          {shops.length === 0 ? (
            <p className="table-secondary">No hay tiendas disponibles.</p>
          ) : (
            <div className="team-shop-grid">
              {shops.map((shop) => {
                const selected = form.shop_ids.includes(shop.id);
                return (
                  <button
                    className={`team-shop-pill ${selected ? "team-shop-pill-active" : ""}`}
                    key={`${mode}-shop-${shop.id}`}
                    onClick={(e) => { e.preventDefault(); toggleShop(setter, shop.id); }}
                    type="button"
                  >
                    {shop.name}
                  </button>
                );
              })}
            </div>
          )}
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
            {isPending ? "Guardando…" : mode === "create" ? "Crear cuenta cliente" : "Guardar cambios"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="stack">
      <PageHeader
        actions={
          <button className="button" onClick={() => { setMessage(null); setCreateOpen(true); }} type="button">
            + Nueva cuenta cliente
          </button>
        }
        eyebrow="Cuentas cliente"
        title="Gestión de accesos al portal"
        description="Crea, edita y controla los accesos de cada cliente al portal. Cambia contraseñas, activa o bloquea cuentas y entra como cualquier cliente para revisar su experiencia."
      />

      {message ? (
        <div className={`feedback feedback-${message.kind}`}>{message.text}</div>
      ) : null}

      {/* KPIs */}
      <section className="admin-dashboard-kpis">
        <KpiCard label="Total cuentas" tone="default" value={String(accounts.length)} />
        <KpiCard label="Activas" tone="success" value={String(totals.active)} />
        <KpiCard label="Inactivas" tone="danger" value={String(totals.inactive)} />
        <KpiCard label="Shop admin" tone="accent" value={String(totals.admins)} />
        <KpiCard label="Shop viewer" tone="warning" value={String(totals.viewers)} />
      </section>

      {/* Filters */}
      <Card className="client-accounts-filters-bar">
        <div className="client-accounts-filters-inner">
          <div className="field client-accounts-search">
            <input
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre o email…"
              type="search"
              value={search}
            />
          </div>
          <div className="field">
            <select
              onChange={(e) => setFilterRole(e.target.value as typeof filterRole)}
              value={filterRole}
            >
              <option value="all">Todos los roles</option>
              <option value="shop_admin">Shop admin</option>
              <option value="shop_viewer">Shop viewer</option>
            </select>
          </div>
          <div className="field">
            <select
              onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
              value={filterStatus}
            >
              <option value="all">Todos los estados</option>
              <option value="active">Solo activas</option>
              <option value="inactive">Solo inactivas</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Table */}
      <Card className="stack table-card">
        <div className="table-header">
          <div>
            <span className="eyebrow">Directorio</span>
            <h3 className="section-title section-title-small">Cuentas registradas</h3>
          </div>
          <div className="muted">{filtered.length} de {accounts.length} cuentas</div>
        </div>

        {filtered.length === 0 ? (
          <div className="client-accounts-empty">
            <div className="client-accounts-empty-icon">👤</div>
            <p className="table-primary">
              {accounts.length === 0 ? "Todavía no hay cuentas cliente" : "Ninguna cuenta coincide con los filtros"}
            </p>
            <p className="table-secondary">
              {accounts.length === 0
                ? "Crea la primera cuenta cliente para que accedan al portal."
                : "Prueba a cambiar los filtros de búsqueda."}
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table employees-table client-accounts-table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Rol</th>
                  <th>Estado</th>
                  <th>Tiendas</th>
                  <th>Acciones rápidas</th>
                  <th>Gestión</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((account) => (
                  <tr className="table-row" key={account.id}>
                    {/* Identity */}
                    <td>
                      <div className="client-account-cell">
                        <div className="client-account-avatar" aria-hidden="true">
                          {account.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="table-primary">{account.name}</div>
                          <div className="table-secondary">{account.email}</div>
                        </div>
                      </div>
                    </td>

                    {/* Role */}
                    <td>
                      <span className={`client-role-pill ${account.role === "shop_admin" ? "is-admin" : "is-viewer"}`}>
                        {account.role === "shop_admin" ? "Admin" : "Viewer"}
                      </span>
                    </td>

                    {/* Status */}
                    <td>
                      <button
                        className={`client-status-toggle ${account.is_active ? "is-active" : "is-inactive"}`}
                        disabled={togglingUserId === account.id}
                        onClick={() => void handleToggleStatus(account)}
                        title={account.is_active ? "Desactivar cuenta" : "Activar cuenta"}
                        type="button"
                      >
                        <span className="client-status-dot" />
                        {togglingUserId === account.id ? "…" : account.is_active ? "Activa" : "Inactiva"}
                      </button>
                    </td>

                    {/* Shops */}
                    <td>
                      {account.shops.length === 0 ? (
                        <span className="table-secondary">Sin tiendas</span>
                      ) : (
                        <div className="team-shop-grid">
                          {account.shops.map((shop) => (
                            <Link
                              className="team-shop-pill team-shop-pill-active"
                              href={`/tenant/${shop.id}/dashboard`}
                              key={`shop-${account.id}-${shop.id}`}
                              target="_blank"
                              title={`Ver portal de ${shop.name}`}
                            >
                              {shop.name}
                            </Link>
                          ))}
                        </div>
                      )}
                    </td>

                    {/* Quick actions */}
                    <td>
                      <div className="employees-actions client-quick-actions">
                        <button
                          className="button-secondary table-action client-action-icon"
                          onClick={() => void handleImpersonate(account)}
                          title="Entrar al portal como este cliente"
                          type="button"
                        >
                          <EyeIcon />
                          <span>Ver portal</span>
                        </button>
                        <button
                          className="button-secondary table-action client-action-icon"
                          onClick={() => openPasswordChange(account)}
                          title="Cambiar contraseña"
                          type="button"
                        >
                          <KeyIcon />
                          <span>Contraseña</span>
                        </button>
                        <button
                          className={`button-secondary table-action client-action-icon ${copiedId === account.id ? "is-copied" : ""}`}
                          onClick={() => void copyPortalLink(account)}
                          title="Copiar enlace del portal"
                          type="button"
                        >
                          <CopyIcon />
                          <span>{copiedId === account.id ? "¡Copiado!" : "Copiar link"}</span>
                        </button>
                      </div>
                    </td>

                    {/* Edit / Delete */}
                    <td>
                      <div className="employees-actions">
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
                          onClick={() => openDeleteConfirm(account)}
                          type="button"
                        >
                          {deletingUserId === account.id ? "Borrando…" : "Borrar"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── Create modal ── */}
      <AppModal
        actions={
          <button className="button-secondary" onClick={() => setCreateOpen(false)} type="button">
            Cancelar
          </button>
        }
        eyebrow="Nueva cuenta"
        onClose={() => setCreateOpen(false)}
        open={createOpen}
        subtitle="Crea un acceso cliente y asígnalo a una o varias tiendas de la plataforma."
        title="Nueva cuenta cliente"
        width="wide"
      >
        {message && createOpen ? (
          <div className={`feedback feedback-${message.kind}`}>{message.text}</div>
        ) : null}
        {renderAccountForm("create", createForm, setCreateForm)}
      </AppModal>

      {/* ── Edit modal ── */}
      <AppModal
        actions={
          <button className="button-secondary" onClick={() => setEditOpen(false)} type="button">
            Cancelar
          </button>
        }
        eyebrow="Editar cuenta"
        onClose={() => setEditOpen(false)}
        open={editOpen}
        subtitle={selectedAccount ? `Edita permisos y datos de acceso de ${selectedAccount.name}.` : "Editar cuenta"}
        title="Editar cuenta cliente"
        width="wide"
      >
        {message && editOpen ? (
          <div className={`feedback feedback-${message.kind}`}>{message.text}</div>
        ) : null}
        {renderAccountForm("edit", editForm, setEditForm)}
      </AppModal>

      {/* ── Password change modal ── */}
      <AppModal
        actions={
          <button className="button-secondary" onClick={() => setPasswordOpen(false)} type="button">
            Cancelar
          </button>
        }
        eyebrow="Seguridad"
        onClose={() => setPasswordOpen(false)}
        open={passwordOpen}
        subtitle={
          selectedAccount
            ? `Establece una nueva contraseña para ${selectedAccount.name} (${selectedAccount.email}).`
            : "Cambiar contraseña"
        }
        title="Cambiar contraseña"
      >
        {message && passwordOpen ? (
          <div className={`feedback feedback-${message.kind}`}>{message.text}</div>
        ) : null}
        <form className="stack" onSubmit={(e) => void handlePasswordChange(e)}>
          <div className="portal-settings-grid">
            <div className="field">
              <label htmlFor="new-password">Nueva contraseña</label>
              <input
                autoComplete="new-password"
                id="new-password"
                minLength={6}
                onChange={(e) => setPasswordForm((p) => ({ ...p, password: e.target.value }))}
                placeholder="Mínimo 6 caracteres"
                type="password"
                value={passwordForm.password}
              />
            </div>
            <div className="field">
              <label htmlFor="confirm-password">Confirmar contraseña</label>
              <input
                autoComplete="new-password"
                id="confirm-password"
                minLength={6}
                onChange={(e) => setPasswordForm((p) => ({ ...p, confirm: e.target.value }))}
                placeholder="Repite la contraseña"
                type="password"
                value={passwordForm.confirm}
              />
            </div>
          </div>
          {passwordForm.password.trim().length > 0 && passwordForm.confirm.trim().length > 0 && passwordForm.password.trim() !== passwordForm.confirm.trim() ? (
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

      {/* ── Delete confirm modal ── */}
      <AppModal
        actions={
          <button className="button-secondary" onClick={() => setDeleteOpen(false)} type="button">
            Cancelar
          </button>
        }
        eyebrow="Confirmación"
        onClose={() => setDeleteOpen(false)}
        open={deleteOpen}
        subtitle={
          selectedAccount
            ? `Esta acción eliminará permanentemente la cuenta de ${selectedAccount.name} y su acceso al portal.`
            : ""
        }
        title="¿Borrar cuenta cliente?"
      >
        <div className="modal-footer">
          <button
            className="button button-danger"
            onClick={() => void handleDelete()}
            type="button"
          >
            Sí, borrar cuenta
          </button>
          <button className="button-secondary" onClick={() => setDeleteOpen(false)} type="button">
            Cancelar
          </button>
        </div>
      </AppModal>
    </div>
  );
}
