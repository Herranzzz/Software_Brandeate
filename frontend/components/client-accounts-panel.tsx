"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type Dispatch,
  type SetStateAction,
} from "react";

import { AppModal } from "@/components/app-modal";
import type { AdminUser, Shop, UserRole } from "@/lib/types";

/* ══════════════════════════════════════════════════════════
   Types
   ══════════════════════════════════════════════════════════ */

type ClientAccountsPanelProps = {
  currentUser: { id: number; role: UserRole };
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

type PasswordFormState = { password: string; confirm: string };

// ── CRM ──────────────────────────────────────────────────
export type CRMStage = "lead" | "proposal" | "active" | "vip" | "at_risk";

type CRMRecord = {
  stage: CRMStage;
  deal_value: number;
  notes: string;
  last_contact: string; // ISO date string or ""
};

type CRMStore = Record<number, CRMRecord>;

const CRM_KEY = "brandeate_crm_v1";

const STAGES: { id: CRMStage; label: string; color: string }[] = [
  { id: "lead",     label: "Prospecto",    color: "#94a3b8" },
  { id: "proposal", label: "Propuesta",    color: "#6366f1" },
  { id: "active",   label: "Cliente activo", color: "#22c55e" },
  { id: "vip",      label: "VIP",          color: "#f59e0b" },
  { id: "at_risk",  label: "En riesgo",    color: "#ef4444" },
];

function stageById(id: CRMStage) {
  return STAGES.find((s) => s.id === id) ?? STAGES[0];
}

function emptyRecord(): CRMRecord {
  return { stage: "lead", deal_value: 0, notes: "", last_contact: "" };
}

function loadCRM(): CRMStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(CRM_KEY);
    return raw ? (JSON.parse(raw) as CRMStore) : {};
  } catch {
    return {};
  }
}

function saveCRM(store: CRMStore) {
  localStorage.setItem(CRM_KEY, JSON.stringify(store));
}

/* ══════════════════════════════════════════════════════════
   Account form helpers
   ══════════════════════════════════════════════════════════ */

const roleOptions = [
  { value: "shop_admin" as const,  label: "Shop admin",  hint: "Gestiona pedidos y operación." },
  { value: "shop_viewer" as const, label: "Shop viewer", hint: "Solo lectura al portal." },
];

function getEmptyForm(): ClientAccountFormState {
  return { name: "", email: "", password: "", role: "shop_admin", is_active: true, shop_ids: [] };
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function fmtCurrency(n: number) {
  if (!n) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
}

function fmtDate(iso: string) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short" }).format(new Date(iso));
}

async function readErrorMessage(response: Response) {
  try {
    const ct = response.headers.get("Content-Type") ?? "";
    if (ct.includes("application/json")) {
      const payload = (await response.json()) as { detail?: unknown; message?: unknown } | null;
      const raw = payload?.detail ?? payload?.message;
      if (typeof raw === "string" && raw.trim()) return raw.trim();
      if (Array.isArray(raw)) {
        const msgs = raw
          .map((i) =>
            typeof i === "string" ? i.trim()
            : i && typeof i === "object" && "msg" in i && typeof i.msg === "string" ? i.msg.trim()
            : null
          )
          .filter((v): v is string => Boolean(v));
        if (msgs.length) return msgs.join(" · ");
      }
    }
    const text = (await response.text()).trim();
    return text || "No se pudo completar la operación.";
  } catch {
    return "No se pudo completar la operación.";
  }
}

/* ══════════════════════════════════════════════════════════
   Icons
   ══════════════════════════════════════════════════════════ */

function DotsIcon() {
  return (
    <svg fill="none" height="16" viewBox="0 0 24 24" width="16">
      <circle cx="5" cy="12" fill="currentColor" r="1.5" />
      <circle cx="12" cy="12" fill="currentColor" r="1.5" />
      <circle cx="19" cy="12" fill="currentColor" r="1.5" />
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
function KeyIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
      <circle cx="8" cy="8" r="5" stroke="currentColor" strokeWidth="1.8" />
      <path d="m12.5 12.5 8.5 8.5M17 18l-2.5-2.5M19.5 15.5 17 18" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}
function EditIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}
function CartIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <line stroke="currentColor" strokeWidth="1.8" x1="3" x2="21" y1="6" y2="6" />
      <path d="M16 10a4 4 0 0 1-8 0" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
      <polyline points="3 6 5 6 21 6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}
function LinkIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}
function CloseIcon() {
  return (
    <svg fill="none" height="16" viewBox="0 0 24 24" width="16">
      <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </svg>
  );
}
function ListIcon() {
  return (
    <svg fill="none" height="15" viewBox="0 0 24 24" width="15">
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}
function KanbanIcon() {
  return (
    <svg fill="none" height="15" viewBox="0 0 24 24" width="15">
      <rect height="10" rx="2" stroke="currentColor" strokeWidth="1.8" width="6" x="3" y="3" />
      <rect height="16" rx="2" stroke="currentColor" strokeWidth="1.8" width="6" x="9" y="3" />
      <rect height="7" rx="2" stroke="currentColor" strokeWidth="1.8" width="6" x="15" y="3" />
    </svg>
  );
}

/* ══════════════════════════════════════════════════════════
   Dropdown menu
   ══════════════════════════════════════════════════════════ */

type DropdownItem = {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
};

function RowDropdown({ items }: { items: DropdownItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  return (
    <div className="crm-dropdown" ref={ref}>
      <button
        className="crm-dots-btn"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        type="button"
      >
        <DotsIcon />
      </button>
      {open && (
        <div className="crm-dropdown-menu">
          {items.map((item, i) => (
            <button
              className={`crm-dropdown-item${item.danger ? " crm-dropdown-item-danger" : ""}`}
              disabled={item.disabled}
              key={i}
              onClick={() => { setOpen(false); item.onClick(); }}
              type="button"
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Detail panel (CRM sidebar)
   ══════════════════════════════════════════════════════════ */

type DetailPanelProps = {
  account: AdminUser;
  record: CRMRecord;
  onClose: () => void;
  onUpdate: (patch: Partial<CRMRecord>) => void;
  onEdit: () => void;
  onPassword: () => void;
  onImpersonate: () => void;
};

function DetailPanel({ account, record, onClose, onUpdate, onEdit, onPassword, onImpersonate }: DetailPanelProps) {
  const [notes, setNotes] = useState(record.notes);
  const [dealValue, setDealValue] = useState(String(record.deal_value || ""));
  const [dirty, setDirty] = useState(false);

  function save() {
    onUpdate({ notes, deal_value: Number(dealValue) || 0, last_contact: new Date().toISOString().slice(0, 10) });
    setDirty(false);
  }

  return (
    <div className="crm-panel">
      <div className="crm-panel-header">
        <div className="crm-panel-identity">
          <div className="crm-avatar crm-avatar-lg">{getInitials(account.name)}</div>
          <div>
            <div className="crm-panel-name">{account.name}</div>
            <div className="crm-panel-email">{account.email}</div>
          </div>
        </div>
        <button className="crm-dots-btn" onClick={onClose} type="button"><CloseIcon /></button>
      </div>

      {/* Stage selector */}
      <div className="crm-panel-section">
        <div className="crm-panel-label">Etapa CRM</div>
        <div className="crm-stage-picker">
          {STAGES.map((s) => (
            <button
              className={`crm-stage-pill${record.stage === s.id ? " crm-stage-pill-active" : ""}`}
              key={s.id}
              onClick={() => onUpdate({ stage: s.id, last_contact: new Date().toISOString().slice(0, 10) })}
              style={{ "--stage-color": s.color } as React.CSSProperties}
              type="button"
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="crm-panel-stats">
        <div className="crm-panel-stat">
          <span className="crm-panel-stat-label">Tiendas</span>
          <span className="crm-panel-stat-value">{account.shops.length || "—"}</span>
        </div>
        <div className="crm-panel-stat">
          <span className="crm-panel-stat-label">Último contacto</span>
          <span className="crm-panel-stat-value">{fmtDate(record.last_contact)}</span>
        </div>
        <div className="crm-panel-stat">
          <span className="crm-panel-stat-label">Estado acceso</span>
          <span className={`crm-panel-stat-value ${account.is_active ? "crm-val-active" : "crm-val-inactive"}`}>
            {account.is_active ? "Activo" : "Inactivo"}
          </span>
        </div>
        <div className="crm-panel-stat">
          <span className="crm-panel-stat-label">Desde</span>
          <span className="crm-panel-stat-value">{fmtDate(account.created_at)}</span>
        </div>
      </div>

      {/* Deal value */}
      <div className="crm-panel-section">
        <div className="crm-panel-label">Valor estimado</div>
        <div className="crm-deal-input-wrap">
          <span className="crm-deal-prefix">€</span>
          <input
            className="crm-deal-input"
            min="0"
            onChange={(e) => { setDealValue(e.target.value); setDirty(true); }}
            placeholder="0"
            type="number"
            value={dealValue}
          />
        </div>
      </div>

      {/* Tiendas */}
      {account.shops.length > 0 && (
        <div className="crm-panel-section">
          <div className="crm-panel-label">Tiendas asignadas</div>
          <div className="crm-panel-shops">
            {account.shops.map((shop) => (
              <Link
                className="team-shop-pill team-shop-pill-active"
                href={`/tenant/${shop.id}/dashboard`}
                key={shop.id}
                target="_blank"
              >
                {shop.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Notes */}
      <div className="crm-panel-section crm-panel-section-grow">
        <div className="crm-panel-label">Notas internas</div>
        <textarea
          className="crm-notes-textarea"
          onChange={(e) => { setNotes(e.target.value); setDirty(true); }}
          placeholder="Añade notas sobre este cliente, acuerdos, próximos pasos…"
          rows={5}
          value={notes}
        />
      </div>

      {dirty && (
        <div className="crm-panel-save-bar">
          <button className="button" onClick={save} type="button">Guardar cambios</button>
          <button
            className="button-secondary"
            onClick={() => { setNotes(record.notes); setDealValue(String(record.deal_value || "")); setDirty(false); }}
            type="button"
          >
            Descartar
          </button>
        </div>
      )}

      {/* Actions */}
      <div className="crm-panel-actions">
        <button className="crm-panel-action-btn" onClick={onImpersonate} type="button">
          <EyeIcon /> Ver portal
        </button>
        <button className="crm-panel-action-btn" onClick={onEdit} type="button">
          <EditIcon /> Editar cuenta
        </button>
        <button className="crm-panel-action-btn" onClick={onPassword} type="button">
          <KeyIcon /> Contraseña
        </button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Pipeline (kanban) view
   ══════════════════════════════════════════════════════════ */

function PipelineView({
  accounts,
  crmStore,
  onSelectAccount,
  onMoveStage,
}: {
  accounts: AdminUser[];
  crmStore: CRMStore;
  onSelectAccount: (a: AdminUser) => void;
  onMoveStage: (id: number, stage: CRMStage) => void;
}) {
  const grouped = useMemo(() => {
    const map: Record<CRMStage, AdminUser[]> = { lead: [], proposal: [], active: [], vip: [], at_risk: [] };
    for (const a of accounts) {
      const stage = crmStore[a.id]?.stage ?? "lead";
      map[stage].push(a);
    }
    return map;
  }, [accounts, crmStore]);

  const totalValue = (stage: CRMStage) =>
    grouped[stage].reduce((sum, a) => sum + (crmStore[a.id]?.deal_value ?? 0), 0);

  return (
    <div className="crm-kanban">
      {STAGES.map((stage) => (
        <div className="crm-kanban-col" key={stage.id}>
          <div className="crm-kanban-col-header" style={{ "--stage-color": stage.color } as React.CSSProperties}>
            <div className="crm-kanban-col-title">
              <span className="crm-kanban-dot" />
              {stage.label}
            </div>
            <div className="crm-kanban-col-meta">
              <span className="crm-kanban-count">{grouped[stage.id].length}</span>
              {totalValue(stage.id) > 0 && (
                <span className="crm-kanban-value">{fmtCurrency(totalValue(stage.id))}</span>
              )}
            </div>
          </div>

          <div className="crm-kanban-cards">
            {grouped[stage.id].length === 0 ? (
              <div className="crm-kanban-empty">Sin contactos</div>
            ) : (
              grouped[stage.id].map((account) => {
                const rec = crmStore[account.id] ?? emptyRecord();
                return (
                  <div
                    className="crm-kanban-card"
                    key={account.id}
                    onClick={() => onSelectAccount(account)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && onSelectAccount(account)}
                  >
                    <div className="crm-kanban-card-top">
                      <div className="crm-avatar crm-avatar-sm">{getInitials(account.name)}</div>
                      <div className="crm-kanban-card-identity">
                        <div className="crm-kanban-card-name">{account.name}</div>
                        <div className="crm-kanban-card-shop">
                          {account.shops[0]?.name ?? "Sin tienda"}
                        </div>
                      </div>
                    </div>
                    {rec.deal_value > 0 && (
                      <div className="crm-kanban-card-value">{fmtCurrency(rec.deal_value)}</div>
                    )}
                    {rec.notes && (
                      <div className="crm-kanban-card-notes">{rec.notes.slice(0, 80)}{rec.notes.length > 80 ? "…" : ""}</div>
                    )}
                    <div className="crm-kanban-card-footer">
                      <span className={`crm-status-btn ${account.is_active ? "crm-status-active" : "crm-status-inactive"}`} style={{ pointerEvents: "none" }}>
                        <span className="crm-status-dot" />
                        {account.is_active ? "Activa" : "Inactiva"}
                      </span>
                      {rec.last_contact && (
                        <span className="crm-kanban-card-date">{fmtDate(rec.last_contact)}</span>
                      )}
                    </div>
                    {/* Quick move */}
                    <div className="crm-kanban-card-move" onClick={(e) => e.stopPropagation()}>
                      {STAGES.filter((s) => s.id !== stage.id).map((s) => (
                        <button
                          className="crm-kanban-move-btn"
                          key={s.id}
                          onClick={(e) => { e.stopPropagation(); onMoveStage(account.id, s.id); }}
                          style={{ "--stage-color": s.color } as React.CSSProperties}
                          title={`Mover a ${s.label}`}
                          type="button"
                        >
                          → {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Main component
   ══════════════════════════════════════════════════════════ */

export function ClientAccountsPanel({ currentUser, accounts, shops }: ClientAccountsPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  // Account modals
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<AdminUser | null>(null);

  // Account forms
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
  const [filterStage, setFilterStage] = useState<"all" | CRMStage>("all");

  // View
  const [view, setView] = useState<"list" | "pipeline">("list");

  // CRM store
  const [crmStore, setCrmStore] = useState<CRMStore>({});
  useEffect(() => { setCrmStore(loadCRM()); }, []);

  // CRM detail panel
  const [panelAccountId, setPanelAccountId] = useState<number | null>(null);
  const panelAccount = accounts.find((a) => a.id === panelAccountId) ?? null;
  const panelRecord = panelAccount ? (crmStore[panelAccount.id] ?? emptyRecord()) : null;

  function updateCRM(id: number, patch: Partial<CRMRecord>) {
    setCrmStore((prev) => {
      const next = { ...prev, [id]: { ...(prev[id] ?? emptyRecord()), ...patch } };
      saveCRM(next);
      return next;
    });
  }

  function movePipelineStage(id: number, stage: CRMStage) {
    updateCRM(id, { stage, last_contact: new Date().toISOString().slice(0, 10) });
  }

  // Total pipeline value
  const totalPipelineValue = useMemo(
    () => accounts.reduce((sum, a) => sum + (crmStore[a.id]?.deal_value ?? 0), 0),
    [accounts, crmStore]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return accounts.filter((a) => {
      if (q && !a.name.toLowerCase().includes(q) && !a.email.toLowerCase().includes(q)) return false;
      if (filterRole !== "all" && a.role !== filterRole) return false;
      if (filterStatus === "active" && !a.is_active) return false;
      if (filterStatus === "inactive" && a.is_active) return false;
      if (filterStage !== "all" && (crmStore[a.id]?.stage ?? "lead") !== filterStage) return false;
      return true;
    });
  }, [accounts, search, filterRole, filterStatus, filterStage, crmStore]);

  function updateForm(setter: Dispatch<SetStateAction<ClientAccountFormState>>, update: Partial<ClientAccountFormState>) {
    setter((c) => ({ ...c, ...update }));
  }
  function toggleShop(setter: Dispatch<SetStateAction<ClientAccountFormState>>, shopId: number) {
    setter((c) => ({
      ...c,
      shop_ids: c.shop_ids.includes(shopId) ? c.shop_ids.filter((id) => id !== shopId) : [...c.shop_ids, shopId],
    }));
  }

  function openEdit(account: AdminUser) {
    setSelectedAccount(account);
    setEditForm({ name: account.name, email: account.email, password: "", role: account.role === "shop_viewer" ? "shop_viewer" : "shop_admin", is_active: account.is_active, shop_ids: account.shops.map((s) => s.id) });
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
    const url = shopId ? `${window.location.origin}/portal?shop_id=${shopId}` : `${window.location.origin}/portal`;
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
    if (createForm.password.trim().length < 6) { setMessage({ kind: "error", text: "La contraseña debe tener mínimo 6 caracteres." }); return; }
    if (createForm.shop_ids.length === 0) { setMessage({ kind: "error", text: "Selecciona al menos una tienda." }); return; }
    const response = await fetch("/api/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: createForm.name.trim(), email: createForm.email.trim().toLowerCase(), password: createForm.password.trim(), role: createForm.role, is_active: createForm.is_active, shop_ids: createForm.shop_ids }) });
    if (!response.ok) { setMessage({ kind: "error", text: await readErrorMessage(response) }); return; }
    setCreateOpen(false);
    setCreateForm(getEmptyForm());
    setMessage({ kind: "success", text: "Cuenta cliente creada correctamente." });
    startTransition(() => router.refresh());
  }

  async function handleEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedAccount) return;
    setMessage(null);
    const nm = editForm.name.trim(), ne = editForm.email.trim().toLowerCase(), np = editForm.password.trim();
    const curShops = [...selectedAccount.shops.map((s) => s.id)].sort((a, b) => a - b);
    const nxtShops = [...editForm.shop_ids].sort((a, b) => a - b);
    const payload: Record<string, unknown> = {};
    if (nm !== selectedAccount.name) payload.name = nm;
    if (ne !== selectedAccount.email.toLowerCase()) payload.email = ne;
    if (editForm.role !== selectedAccount.role) payload.role = editForm.role;
    if (editForm.is_active !== selectedAccount.is_active) payload.is_active = editForm.is_active;
    if (np) payload.password = np;
    if (curShops.length !== nxtShops.length || curShops.some((id, i) => id !== nxtShops[i])) payload.shop_ids = nxtShops;
    if (!Object.keys(payload).length) { setMessage({ kind: "success", text: "No hay cambios." }); return; }
    if ("password" in payload && np.length < 6) { setMessage({ kind: "error", text: "Contraseña mínimo 6 caracteres." }); return; }
    if (!nxtShops.length) { setMessage({ kind: "error", text: "Asigna al menos una tienda." }); return; }
    const response = await fetch(`/api/users/${selectedAccount.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!response.ok) { setMessage({ kind: "error", text: await readErrorMessage(response) }); return; }
    setEditOpen(false);
    setSelectedAccount(null);
    setMessage({ kind: "success", text: "Cuenta actualizada." });
    startTransition(() => router.refresh());
  }

  async function handlePasswordChange(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedAccount) return;
    const pw = passwordForm.password.trim();
    if (pw.length < 6) { setMessage({ kind: "error", text: "Mínimo 6 caracteres." }); return; }
    if (pw !== passwordForm.confirm.trim()) { setMessage({ kind: "error", text: "Las contraseñas no coinciden." }); return; }
    setSavingPassword(true);
    setMessage(null);
    const response = await fetch(`/api/users/${selectedAccount.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pw }) });
    setSavingPassword(false);
    if (!response.ok) { setMessage({ kind: "error", text: await readErrorMessage(response) }); return; }
    setPasswordOpen(false);
    setSelectedAccount(null);
    setPasswordForm({ password: "", confirm: "" });
    setMessage({ kind: "success", text: `Contraseña de ${selectedAccount.name} actualizada.` });
    startTransition(() => router.refresh());
  }

  async function handleToggleStatus(account: AdminUser) {
    setTogglingUserId(account.id);
    setMessage(null);
    const response = await fetch(`/api/users/${account.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: !account.is_active }) });
    setTogglingUserId(null);
    if (!response.ok) { setMessage({ kind: "error", text: await readErrorMessage(response) }); return; }
    startTransition(() => router.refresh());
  }

  async function handleDelete() {
    if (!selectedAccount) return;
    setDeletingUserId(selectedAccount.id);
    setDeleteOpen(false);
    setMessage(null);
    const response = await fetch(`/api/users/${selectedAccount.id}`, { method: "DELETE" });
    setDeletingUserId(null);
    if (!response.ok) { setMessage({ kind: "error", text: await readErrorMessage(response) }); return; }
    setMessage({ kind: "success", text: "Cuenta eliminada." });
    setSelectedAccount(null);
    if (panelAccountId === selectedAccount.id) setPanelAccountId(null);
    startTransition(() => router.refresh());
  }

  async function handleImpersonate(account: AdminUser) {
    if (!account.is_active) { setMessage({ kind: "error", text: "Activa la cuenta antes de entrar al portal." }); return; }
    if (!account.shops.length) { setMessage({ kind: "error", text: "La cuenta no tiene tiendas asignadas." }); return; }
    setMessage(null);
    const response = await fetch(`/api/auth/impersonate/${account.id}`, { method: "POST" });
    if (!response.ok) { setMessage({ kind: "error", text: await readErrorMessage(response) }); return; }
    window.location.assign(account.shops[0]?.id ? `/portal?shop_id=${account.shops[0].id}` : "/portal");
  }

  function renderAccountForm(mode: "create" | "edit", form: ClientAccountFormState, setter: Dispatch<SetStateAction<ClientAccountFormState>>) {
    const pwLen = form.password.trim().length;
    return (
      <form className="stack" onSubmit={mode === "create" ? handleCreate : handleEdit}>
        <div className="crm-form-grid">
          <div className="field">
            <label htmlFor={`${mode}-client-name`}>Nombre</label>
            <input id={`${mode}-client-name`} onChange={(e) => updateForm(setter, { name: e.target.value })} placeholder="Nombre del cliente" value={form.name} />
          </div>
          <div className="field">
            <label htmlFor={`${mode}-client-email`}>Email</label>
            <input id={`${mode}-client-email`} onChange={(e) => updateForm(setter, { email: e.target.value })} placeholder="cliente@empresa.com" type="email" value={form.email} />
          </div>
          <div className="field">
            <label htmlFor={`${mode}-client-password`}>{mode === "create" ? "Contraseña" : "Nueva contraseña"}</label>
            <input id={`${mode}-client-password`} minLength={6} onChange={(e) => updateForm(setter, { password: e.target.value })} placeholder={mode === "create" ? "Mínimo 6 caracteres" : "Vacía = sin cambios"} type="password" value={form.password} />
          </div>
          <div className="field">
            <label htmlFor={`${mode}-client-role`}>Tipo de acceso</label>
            <select id={`${mode}-client-role`} onChange={(e) => updateForm(setter, { role: e.target.value as "shop_admin" | "shop_viewer" })} value={form.role}>
              {roleOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label} — {opt.hint}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="employees-form-switch">
          <span className="employees-form-switch-copy">
            Cuenta activa
            <small>{form.is_active ? "Puede acceder al portal." : "Bloqueada — sin acceso."}</small>
          </span>
          <button className={`employees-toggle ${form.is_active ? "is-active" : ""}`} onClick={(e) => { e.preventDefault(); updateForm(setter, { is_active: !form.is_active }); }} type="button"><span /></button>
        </div>
        <div className="team-shops-block">
          <div className="team-shops-head">
            <strong>Tiendas asignadas</strong>
            <span className="table-secondary">Qué tiendas verá en su portal.</span>
          </div>
          {shops.length === 0 ? (
            <p className="table-secondary">No hay tiendas disponibles.</p>
          ) : (
            <div className="team-shop-grid">
              {shops.map((shop) => {
                const selected = form.shop_ids.includes(shop.id);
                return (
                  <button className={`team-shop-pill ${selected ? "team-shop-pill-active" : ""}`} key={`${mode}-shop-${shop.id}`} onClick={(e) => { e.preventDefault(); toggleShop(setter, shop.id); }} type="button">{shop.name}</button>
                );
              })}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="button" disabled={isPending || !form.name.trim() || !form.email.trim() || (mode === "create" && pwLen < 6) || (mode === "edit" && pwLen > 0 && pwLen < 6) || !form.shop_ids.length} type="submit">
            {isPending ? "Guardando…" : mode === "create" ? "Crear cuenta" : "Guardar cambios"}
          </button>
        </div>
      </form>
    );
  }

  /* ── render ── */
  return (
    <div className={`crm-layout${panelAccount ? " crm-layout-with-panel" : ""}`}>
      {/* ═══ Main area ═══ */}
      <div className="crm-page">

        {/* Header */}
        <div className="crm-page-header">
          <div className="crm-page-title-block">
            <h1 className="crm-page-title">CRM · Cuentas cliente</h1>
            <span className="crm-page-count">{accounts.length} contacto{accounts.length !== 1 ? "s" : ""}</span>
            {totalPipelineValue > 0 && (
              <span className="crm-pipeline-total">{fmtCurrency(totalPipelineValue)} en pipeline</span>
            )}
          </div>
          <div className="crm-header-right">
            {/* View toggle */}
            <div className="crm-view-toggle">
              <button
                className={`crm-view-btn${view === "list" ? " crm-view-btn-active" : ""}`}
                onClick={() => setView("list")}
                type="button"
              >
                <ListIcon /> Lista
              </button>
              <button
                className={`crm-view-btn${view === "pipeline" ? " crm-view-btn-active" : ""}`}
                onClick={() => setView("pipeline")}
                type="button"
              >
                <KanbanIcon /> Pipeline
              </button>
            </div>
            <button className="button" onClick={() => { setMessage(null); setCreateOpen(true); }} type="button">
              + Nueva cuenta
            </button>
          </div>
        </div>

        {message ? <div className={`feedback feedback-${message.kind}`}>{message.text}</div> : null}

        {/* Toolbar (list only) */}
        {view === "list" && (
          <div className="crm-toolbar">
            <input className="crm-search" onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre o email…" type="search" value={search} />
            <select className="crm-filter-select" onChange={(e) => setFilterRole(e.target.value as typeof filterRole)} value={filterRole}>
              <option value="all">Todos los roles</option>
              <option value="shop_admin">Shop admin</option>
              <option value="shop_viewer">Shop viewer</option>
            </select>
            <select className="crm-filter-select" onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)} value={filterStatus}>
              <option value="all">Todos los estados</option>
              <option value="active">Solo activas</option>
              <option value="inactive">Solo inactivas</option>
            </select>
            <select className="crm-filter-select" onChange={(e) => setFilterStage(e.target.value as typeof filterStage)} value={filterStage}>
              <option value="all">Todas las etapas</option>
              {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
        )}

        {/* ── List view ── */}
        {view === "list" && (
          filtered.length === 0 ? (
            <div className="crm-empty">
              <div className="crm-empty-icon">👤</div>
              <p className="crm-empty-title">{accounts.length === 0 ? "Todavía no hay cuentas" : "Ninguna coincide con los filtros"}</p>
              <p className="crm-empty-sub">{accounts.length === 0 ? "Crea la primera cuenta para dar acceso a un cliente." : "Prueba a cambiar los filtros."}</p>
            </div>
          ) : (
            <div className="crm-list">
              {filtered.map((account) => {
                const rec = crmStore[account.id] ?? emptyRecord();
                const stage = stageById(rec.stage);
                const isToggling = togglingUserId === account.id;
                const isDeleting = deletingUserId === account.id;
                return (
                  <div
                    className={`crm-row${!account.is_active ? " crm-row-inactive" : ""}${panelAccountId === account.id ? " crm-row-selected" : ""}`}
                    key={account.id}
                    onClick={() => setPanelAccountId(panelAccountId === account.id ? null : account.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && setPanelAccountId(panelAccountId === account.id ? null : account.id)}
                  >
                    <div className="crm-avatar">{getInitials(account.name)}</div>
                    <div className="crm-identity">
                      <span className="crm-name">{account.name}</span>
                      <span className="crm-email">{account.email}</span>
                    </div>
                    <div className="crm-meta">
                      <span className={`crm-role-badge ${account.role === "shop_admin" ? "crm-role-admin" : "crm-role-viewer"}`}>
                        {account.role === "shop_admin" ? "Admin" : "Viewer"}
                      </span>
                      <span className="crm-shops-pill">{account.shops.length === 0 ? "Sin tiendas" : account.shops.length === 1 ? account.shops[0]?.name : `${account.shops.length} tiendas`}</span>
                    </div>
                    {/* CRM stage */}
                    <span className="crm-stage-badge" style={{ "--stage-color": stage.color } as React.CSSProperties}>
                      {stage.label}
                    </span>
                    {/* Deal value */}
                    <span className="crm-row-value">{fmtCurrency(rec.deal_value)}</span>
                    {/* Status */}
                    <button
                      className={`crm-status-btn${account.is_active ? " crm-status-active" : " crm-status-inactive"}`}
                      disabled={isToggling}
                      onClick={(e) => { e.stopPropagation(); void handleToggleStatus(account); }}
                      title={account.is_active ? "Desactivar" : "Activar"}
                      type="button"
                    >
                      <span className="crm-status-dot" />
                      {isToggling ? "…" : account.is_active ? "Activa" : "Inactiva"}
                    </button>
                    {/* Quick actions */}
                    <div className="crm-row-actions" onClick={(e) => e.stopPropagation()}>
                      <button className="crm-action-btn" onClick={() => void handleImpersonate(account)} title="Ver portal" type="button">
                        <EyeIcon /><span>Ver portal</span>
                      </button>
                      <Link className="crm-action-btn" href={`/orders?shop_id=${account.shops[0]?.id ?? ""}`} title="Ver pedidos" onClick={(e) => e.stopPropagation()}>
                        <CartIcon /><span>Pedidos</span>
                      </Link>
                    </div>
                    {/* Overflow */}
                    <div onClick={(e) => e.stopPropagation()}>
                      <RowDropdown items={[
                        { label: "Editar cuenta", icon: <EditIcon />, onClick: () => openEdit(account) },
                        { label: "Cambiar contraseña", icon: <KeyIcon />, onClick: () => openPasswordChange(account) },
                        { label: copiedId === account.id ? "¡Copiado!" : "Copiar enlace portal", icon: <LinkIcon />, onClick: () => void copyPortalLink(account) },
                        { label: isDeleting ? "Eliminando…" : "Eliminar cuenta", icon: <TrashIcon />, onClick: () => openDeleteConfirm(account), danger: true, disabled: isDeleting || account.id === currentUser.id },
                      ]} />
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}

        {/* ── Pipeline view ── */}
        {view === "pipeline" && (
          <PipelineView
            accounts={accounts}
            crmStore={crmStore}
            onSelectAccount={(a) => setPanelAccountId(a.id)}
            onMoveStage={movePipelineStage}
          />
        )}
      </div>

      {/* ═══ Detail panel ═══ */}
      {panelAccount && panelRecord && (
        <DetailPanel
          account={panelAccount}
          record={panelRecord}
          onClose={() => setPanelAccountId(null)}
          onUpdate={(patch) => updateCRM(panelAccount.id, patch)}
          onEdit={() => openEdit(panelAccount)}
          onPassword={() => openPasswordChange(panelAccount)}
          onImpersonate={() => void handleImpersonate(panelAccount)}
        />
      )}

      {/* ── Modals ── */}
      <AppModal actions={<button className="button-secondary" onClick={() => setCreateOpen(false)} type="button">Cancelar</button>} eyebrow="Nueva cuenta" onClose={() => setCreateOpen(false)} open={createOpen} subtitle="Crea un acceso cliente y asígnalo a sus tiendas." title="Nueva cuenta cliente" width="wide">
        {message && createOpen ? <div className={`feedback feedback-${message.kind}`}>{message.text}</div> : null}
        {renderAccountForm("create", createForm, setCreateForm)}
      </AppModal>

      <AppModal actions={<button className="button-secondary" onClick={() => setEditOpen(false)} type="button">Cancelar</button>} eyebrow="Editar cuenta" onClose={() => setEditOpen(false)} open={editOpen} subtitle={selectedAccount ? `Editando ${selectedAccount.name}` : "Editar cuenta"} title="Editar cuenta cliente" width="wide">
        {message && editOpen ? <div className={`feedback feedback-${message.kind}`}>{message.text}</div> : null}
        {renderAccountForm("edit", editForm, setEditForm)}
      </AppModal>

      <AppModal actions={<button className="button-secondary" onClick={() => setPasswordOpen(false)} type="button">Cancelar</button>} eyebrow="Seguridad" onClose={() => setPasswordOpen(false)} open={passwordOpen} subtitle={selectedAccount ? `Nueva contraseña para ${selectedAccount.name}` : "Cambiar contraseña"} title="Cambiar contraseña">
        {message && passwordOpen ? <div className={`feedback feedback-${message.kind}`}>{message.text}</div> : null}
        <form className="stack" onSubmit={(e) => void handlePasswordChange(e)}>
          <div className="crm-form-grid">
            <div className="field">
              <label htmlFor="new-password">Nueva contraseña</label>
              <input autoComplete="new-password" id="new-password" minLength={6} onChange={(e) => setPasswordForm((p) => ({ ...p, password: e.target.value }))} placeholder="Mínimo 6 caracteres" type="password" value={passwordForm.password} />
            </div>
            <div className="field">
              <label htmlFor="confirm-password">Confirmar</label>
              <input autoComplete="new-password" id="confirm-password" minLength={6} onChange={(e) => setPasswordForm((p) => ({ ...p, confirm: e.target.value }))} placeholder="Repite la contraseña" type="password" value={passwordForm.confirm} />
            </div>
          </div>
          {passwordForm.password.trim().length > 0 && passwordForm.confirm.trim().length > 0 && passwordForm.password.trim() !== passwordForm.confirm.trim() ? (
            <div className="feedback feedback-error" style={{ marginTop: 0 }}>Las contraseñas no coinciden.</div>
          ) : null}
          <div className="modal-footer">
            <button className="button" disabled={savingPassword || passwordForm.password.trim().length < 6 || passwordForm.password.trim() !== passwordForm.confirm.trim()} type="submit">
              {savingPassword ? "Guardando…" : "Actualizar contraseña"}
            </button>
          </div>
        </form>
      </AppModal>

      <AppModal actions={<button className="button-secondary" onClick={() => setDeleteOpen(false)} type="button">Cancelar</button>} eyebrow="Confirmación" onClose={() => setDeleteOpen(false)} open={deleteOpen} subtitle={selectedAccount ? `Esta acción eliminará permanentemente la cuenta de ${selectedAccount.name}.` : ""} title="¿Eliminar cuenta?">
        <div className="modal-footer">
          <button className="button button-danger" onClick={() => void handleDelete()} type="button">Sí, eliminar</button>
          <button className="button-secondary" onClick={() => setDeleteOpen(false)} type="button">Cancelar</button>
        </div>
      </AppModal>
    </div>
  );
}
