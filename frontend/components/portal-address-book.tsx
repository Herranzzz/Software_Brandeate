"use client";

import { useEffect, useMemo, useState } from "react";

type Address = {
  id: string;
  alias: string;
  kind: "sender" | "recipient";
  company?: string;
  contact: string;
  email?: string;
  phone?: string;
  street: string;
  street2?: string;
  city: string;
  postal: string;
  region?: string;
  country: string;
  notes?: string;
  isDefault?: boolean;
  createdAt: string;
};

const STORAGE_KEY = "brandeate.portal.addressBook.v1";

const EMPTY: Omit<Address, "id" | "createdAt"> = {
  alias: "",
  kind: "recipient",
  company: "",
  contact: "",
  email: "",
  phone: "",
  street: "",
  street2: "",
  city: "",
  postal: "",
  region: "",
  country: "ES",
  notes: "",
  isDefault: false,
};

function loadAddresses(): Address[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Address[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(addresses: Address[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(addresses));
}

function seedDemo(): Address[] {
  const now = new Date().toISOString();
  return [
    {
      id: crypto.randomUUID(),
      alias: "Almacén principal",
      kind: "sender",
      company: "Tu marca SL",
      contact: "Operaciones",
      email: "envios@tumarca.com",
      phone: "+34 900 123 456",
      street: "C/ Industria 12",
      street2: "Nave 3",
      city: "Madrid",
      postal: "28020",
      region: "Madrid",
      country: "ES",
      notes: "Recogidas L-V 9:00-18:00",
      isDefault: true,
      createdAt: now,
    },
  ];
}

export function PortalAddressBook() {
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "sender" | "recipient">("all");
  const [editing, setEditing] = useState<Address | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<Omit<Address, "id" | "createdAt">>({ ...EMPTY });
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const existing = loadAddresses();
    if (existing.length === 0) {
      const seeded = seedDemo();
      persist(seeded);
      setAddresses(seeded);
    } else {
      setAddresses(existing);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) persist(addresses);
  }, [addresses, hydrated]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return addresses.filter((a) => {
      if (filter !== "all" && a.kind !== filter) return false;
      if (!q) return true;
      return [a.alias, a.company, a.contact, a.city, a.postal, a.street, a.country]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q));
    });
  }, [addresses, query, filter]);

  function openCreate(kind: Address["kind"]) {
    setEditing(null);
    setDraft({ ...EMPTY, kind });
    setFormOpen(true);
  }

  function openEdit(address: Address) {
    setEditing(address);
    setDraft({
      alias: address.alias,
      kind: address.kind,
      company: address.company ?? "",
      contact: address.contact,
      email: address.email ?? "",
      phone: address.phone ?? "",
      street: address.street,
      street2: address.street2 ?? "",
      city: address.city,
      postal: address.postal,
      region: address.region ?? "",
      country: address.country,
      notes: address.notes ?? "",
      isDefault: address.isDefault ?? false,
    });
    setFormOpen(true);
  }

  function handleSave() {
    if (!draft.alias.trim() || !draft.contact.trim() || !draft.street.trim() || !draft.city.trim() || !draft.postal.trim()) {
      return;
    }
    const now = new Date().toISOString();
    setAddresses((prev) => {
      const list = editing
        ? prev.map((a) => (a.id === editing.id ? { ...a, ...draft } : a))
        : [...prev, { ...draft, id: crypto.randomUUID(), createdAt: now }];
      if (draft.isDefault) {
        return list.map((a) =>
          a.kind === draft.kind
            ? { ...a, isDefault: a.id === (editing?.id ?? list[list.length - 1].id) }
            : a,
        );
      }
      return list;
    });
    setFormOpen(false);
    setEditing(null);
  }

  function handleDelete(id: string) {
    setAddresses((prev) => prev.filter((a) => a.id !== id));
  }

  function handleMakeDefault(id: string) {
    setAddresses((prev) => {
      const target = prev.find((a) => a.id === id);
      if (!target) return prev;
      return prev.map((a) =>
        a.kind === target.kind ? { ...a, isDefault: a.id === id } : a,
      );
    });
  }

  function handleDuplicate(id: string) {
    const source = addresses.find((a) => a.id === id);
    if (!source) return;
    setAddresses((prev) => [
      ...prev,
      { ...source, id: crypto.randomUUID(), alias: `${source.alias} (copia)`, isDefault: false, createdAt: new Date().toISOString() },
    ]);
  }

  function handleCopy(address: Address) {
    const text = [
      address.company,
      address.contact,
      [address.street, address.street2].filter(Boolean).join(", "),
      `${address.postal} ${address.city}${address.region ? `, ${address.region}` : ""}`,
      address.country,
      address.phone,
    ].filter(Boolean).join("\n");
    if (navigator.clipboard) void navigator.clipboard.writeText(text);
  }

  return (
    <div className="stack">
      <section className="card portal-glass-card stack addrbook-toolbar">
        <div className="addrbook-toolbar-row">
          <div className="filter-pills">
            {([
              { id: "all", label: `Todas · ${addresses.length}` },
              { id: "sender", label: `Remitentes · ${addresses.filter((a) => a.kind === "sender").length}` },
              { id: "recipient", label: `Destinatarios · ${addresses.filter((a) => a.kind === "recipient").length}` },
            ] as const).map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`filter-pill${filter === opt.id ? " filter-pill-active" : ""}`}
                onClick={() => setFilter(opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <input
            className="addrbook-search"
            type="search"
            placeholder="Buscar por alias, ciudad, CP…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="addrbook-toolbar-actions">
            <button type="button" className="button button-secondary" onClick={() => openCreate("sender")}>
              + Remitente
            </button>
            <button type="button" className="button" onClick={() => openCreate("recipient")}>
              + Destinatario
            </button>
          </div>
        </div>
      </section>

      {filtered.length === 0 ? (
        <section className="card portal-glass-card addrbook-empty">
          <div className="addrbook-empty-inner">
            <span className="addrbook-empty-icon" aria-hidden>📮</span>
            <h3 className="section-title section-title-small">Tu libreta está vacía</h3>
            <p className="subtitle">
              Guarda aquí remitentes y destinatarios frecuentes para poder crear envíos en un solo clic.
            </p>
            <div className="addrbook-empty-actions">
              <button type="button" className="button" onClick={() => openCreate("recipient")}>
                Añadir primer destinatario
              </button>
            </div>
          </div>
        </section>
      ) : (
        <div className="addrbook-grid">
          {filtered.map((a) => (
            <article key={a.id} className={`card addrbook-card${a.isDefault ? " addrbook-card-default" : ""}`}>
              <header className="addrbook-card-head">
                <div>
                  <span className="eyebrow">
                    {a.kind === "sender" ? "📤 Remitente" : "📥 Destinatario"}
                    {a.isDefault ? " · ⭐ por defecto" : ""}
                  </span>
                  <h3 className="addrbook-card-title">{a.alias}</h3>
                </div>
                <span className="addrbook-country-badge">{a.country}</span>
              </header>
              <div className="addrbook-card-body">
                {a.company ? <div className="addrbook-line"><strong>{a.company}</strong></div> : null}
                <div className="addrbook-line">{a.contact}</div>
                <div className="addrbook-line">{a.street}{a.street2 ? `, ${a.street2}` : ""}</div>
                <div className="addrbook-line">{a.postal} {a.city}{a.region ? ` · ${a.region}` : ""}</div>
                {a.phone ? <div className="addrbook-line addrbook-muted">📞 {a.phone}</div> : null}
                {a.email ? <div className="addrbook-line addrbook-muted">✉️ {a.email}</div> : null}
                {a.notes ? <div className="addrbook-notes">💡 {a.notes}</div> : null}
              </div>
              <footer className="addrbook-card-footer">
                <button type="button" className="button button-ghost addrbook-action" onClick={() => openEdit(a)}>
                  Editar
                </button>
                <button type="button" className="button button-ghost addrbook-action" onClick={() => handleCopy(a)}>
                  Copiar
                </button>
                <button type="button" className="button button-ghost addrbook-action" onClick={() => handleDuplicate(a.id)}>
                  Duplicar
                </button>
                {!a.isDefault ? (
                  <button type="button" className="button button-ghost addrbook-action" onClick={() => handleMakeDefault(a.id)}>
                    Hacer por defecto
                  </button>
                ) : null}
                <button type="button" className="button button-ghost addrbook-action addrbook-action-danger" onClick={() => handleDelete(a.id)}>
                  Eliminar
                </button>
              </footer>
            </article>
          ))}
        </div>
      )}

      {formOpen ? (
        <div className="addrbook-modal-backdrop" onClick={() => setFormOpen(false)}>
          <div className="addrbook-modal" onClick={(e) => e.stopPropagation()}>
            <header className="addrbook-modal-head">
              <h3 className="section-title section-title-small">
                {editing ? "Editar dirección" : "Nueva dirección"}
              </h3>
              <button type="button" className="button button-ghost" onClick={() => setFormOpen(false)}>Cerrar</button>
            </header>
            <div className="addrbook-modal-body stack">
              <div className="calc-row">
                <div className="calc-field">
                  <label>Alias</label>
                  <input value={draft.alias} onChange={(e) => setDraft({ ...draft, alias: e.target.value })} placeholder="Almacén BCN" />
                </div>
                <div className="calc-field">
                  <label>Tipo</label>
                  <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as Address["kind"] })}>
                    <option value="recipient">Destinatario</option>
                    <option value="sender">Remitente</option>
                  </select>
                </div>
              </div>
              <div className="calc-row">
                <div className="calc-field">
                  <label>Empresa</label>
                  <input value={draft.company} onChange={(e) => setDraft({ ...draft, company: e.target.value })} />
                </div>
                <div className="calc-field">
                  <label>Persona de contacto</label>
                  <input value={draft.contact} onChange={(e) => setDraft({ ...draft, contact: e.target.value })} />
                </div>
              </div>
              <div className="calc-row">
                <div className="calc-field">
                  <label>Email</label>
                  <input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
                </div>
                <div className="calc-field">
                  <label>Teléfono</label>
                  <input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
                </div>
              </div>
              <div className="calc-field">
                <label>Dirección</label>
                <input value={draft.street} onChange={(e) => setDraft({ ...draft, street: e.target.value })} />
              </div>
              <div className="calc-field">
                <label>Dirección (línea 2)</label>
                <input value={draft.street2} onChange={(e) => setDraft({ ...draft, street2: e.target.value })} />
              </div>
              <div className="calc-row">
                <div className="calc-field">
                  <label>Código postal</label>
                  <input value={draft.postal} onChange={(e) => setDraft({ ...draft, postal: e.target.value })} />
                </div>
                <div className="calc-field">
                  <label>Ciudad</label>
                  <input value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} />
                </div>
                <div className="calc-field">
                  <label>Región</label>
                  <input value={draft.region} onChange={(e) => setDraft({ ...draft, region: e.target.value })} />
                </div>
                <div className="calc-field">
                  <label>País (ISO)</label>
                  <input value={draft.country} onChange={(e) => setDraft({ ...draft, country: e.target.value.toUpperCase() })} maxLength={3} />
                </div>
              </div>
              <div className="calc-field">
                <label>Notas internas</label>
                <textarea rows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
              </div>
              <label className="calc-toggle">
                <input type="checkbox" checked={draft.isDefault ?? false} onChange={(e) => setDraft({ ...draft, isDefault: e.target.checked })} />
                <span>Marcar como {draft.kind === "sender" ? "remitente" : "destinatario"} por defecto</span>
              </label>
            </div>
            <footer className="addrbook-modal-foot">
              <button type="button" className="button button-secondary" onClick={() => setFormOpen(false)}>Cancelar</button>
              <button type="button" className="button" onClick={handleSave}>
                {editing ? "Guardar cambios" : "Guardar dirección"}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
