"use client";

import { useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "brandeate.portal.apiKeys.v1";

type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  secret: string;
  createdAt: string;
  lastUsedAt: string | null;
  scope: "read" | "write";
  environment: "sandbox" | "production";
};

function randomKey(env: ApiKey["environment"]): { prefix: string; secret: string } {
  const bytes = new Uint8Array(24);
  (globalThis.crypto ?? window.crypto).getRandomValues(bytes);
  const body = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  const envTag = env === "production" ? "live" : "test";
  return {
    prefix: `bde_${envTag}_${body.slice(0, 6)}`,
    secret: body.slice(6),
  };
}

function loadKeys(): ApiKey[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ApiKey[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(keys: ApiKey[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
}

export function PortalDevelopersPanel() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [name, setName] = useState("");
  const [environment, setEnvironment] = useState<ApiKey["environment"]>("sandbox");
  const [scope, setScope] = useState<ApiKey["scope"]>("read");
  const [justCreated, setJustCreated] = useState<ApiKey | null>(null);

  useEffect(() => {
    setKeys(loadKeys());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) persist(keys);
  }, [keys, hydrated]);

  function handleCreate() {
    if (!name.trim()) return;
    const { prefix, secret } = randomKey(environment);
    const key: ApiKey = {
      id: crypto.randomUUID(),
      name: name.trim(),
      prefix,
      secret,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      scope,
      environment,
    };
    setKeys((k) => [key, ...k]);
    setJustCreated(key);
    setName("");
  }

  function handleRevoke(id: string) {
    setKeys((k) => k.filter((x) => x.id !== id));
  }

  function copy(text: string) {
    if (navigator.clipboard) void navigator.clipboard.writeText(text);
  }

  const curlExample = useMemo(() => {
    const sample = justCreated ?? keys[0];
    const token = sample ? `${sample.prefix}_${sample.secret}` : "bde_test_xxxxxxxxxxxxxxxxxxxxxxxx";
    return [
      `curl https://api.brandeate.com/v1/shipments \\`,
      `  -H "Authorization: Bearer ${token}" \\`,
      `  -H "Content-Type: application/json"`,
    ].join("\n");
  }, [justCreated, keys]);

  return (
    <div className="stack">
      {justCreated ? (
        <section className="card dev-keys-flash">
          <div>
            <span className="eyebrow">🎉 Guarda este token ahora</span>
            <h3 className="section-title section-title-small">{justCreated.name}</h3>
            <p className="subtitle">
              Este es el único momento en que puedes copiar el secreto completo. Después solo verás el prefijo.
            </p>
          </div>
          <code className="dev-keys-token">{justCreated.prefix}_{justCreated.secret}</code>
          <div className="addrbook-toolbar-actions">
            <button type="button" className="button" onClick={() => copy(`${justCreated.prefix}_${justCreated.secret}`)}>Copiar token</button>
            <button type="button" className="button button-secondary" onClick={() => setJustCreated(null)}>Entendido</button>
          </div>
        </section>
      ) : null}

      <section className="card portal-glass-card stack">
        <div className="settings-section-head">
          <div>
            <span className="eyebrow">🧑‍💻 API Keys</span>
            <h3 className="section-title section-title-small">Integra Brandeate en tu stack</h3>
            <p className="subtitle">
              Crea claves para tus herramientas internas. Diferencia sandbox y producción, y revoca cualquier clave al instante.
            </p>
          </div>
        </div>

        <div className="calc-row">
          <div className="calc-field">
            <label>Nombre descriptivo</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ERP interno · integración Shopify…" />
          </div>
          <div className="calc-field">
            <label>Entorno</label>
            <select value={environment} onChange={(e) => setEnvironment(e.target.value as ApiKey["environment"])}>
              <option value="sandbox">Sandbox</option>
              <option value="production">Producción</option>
            </select>
          </div>
          <div className="calc-field">
            <label>Permisos</label>
            <select value={scope} onChange={(e) => setScope(e.target.value as ApiKey["scope"])}>
              <option value="read">Solo lectura</option>
              <option value="write">Lectura + escritura</option>
            </select>
          </div>
          <div className="calc-field" style={{ alignSelf: "end" }}>
            <label style={{ visibility: "hidden" }}>.</label>
            <button type="button" className="button" onClick={handleCreate} disabled={!name.trim()}>
              Generar API key
            </button>
          </div>
        </div>

        {keys.length === 0 ? (
          <p className="subtitle">Aún no has creado ninguna clave. Genera tu primera key sandbox para empezar a probar la API.</p>
        ) : (
          <div className="dev-keys-list">
            {keys.map((k) => (
              <div key={k.id} className="dev-keys-row">
                <div>
                  <strong>{k.name}</strong>
                  <div className="dev-keys-meta">
                    <span className={`portal-soft-pill${k.environment === "production" ? " portal-soft-pill-accent" : ""}`}>
                      {k.environment === "production" ? "🟢 Producción" : "🧪 Sandbox"}
                    </span>
                    <span className="portal-soft-pill">{k.scope === "read" ? "Lectura" : "Lectura + escritura"}</span>
                    <span>Creada {new Date(k.createdAt).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" })}</span>
                  </div>
                </div>
                <code className="dev-keys-prefix">{k.prefix}…</code>
                <div className="addrbook-toolbar-actions">
                  <button type="button" className="button button-ghost" onClick={() => copy(k.prefix)}>Copiar prefijo</button>
                  <button type="button" className="button button-ghost addrbook-action-danger" onClick={() => handleRevoke(k.id)}>Revocar</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card portal-glass-card stack">
        <div className="settings-section-head">
          <div>
            <span className="eyebrow">📖 Guía rápida</span>
            <h3 className="section-title section-title-small">Tu primer request</h3>
            <p className="subtitle">Autentica con tu token en la cabecera Authorization y consulta el endpoint de envíos.</p>
          </div>
        </div>
        <pre className="dev-keys-code">{curlExample}</pre>
        <div className="dev-links-grid">
          <a className="dev-link-card" href="https://api.brandeate.com/docs" target="_blank" rel="noreferrer">
            <span>📘 Referencia completa</span>
            <small>OpenAPI 3.1 · ejemplos por lenguaje</small>
          </a>
          <a className="dev-link-card" href="/portal/settings?tab=webhooks">
            <span>🔔 Webhooks</span>
            <small>Recibe eventos en tu endpoint</small>
          </a>
          <a className="dev-link-card" href="https://github.com/brandeate" target="_blank" rel="noreferrer">
            <span>🧰 SDKs oficiales</span>
            <small>Node · Python · PHP</small>
          </a>
        </div>
      </section>
    </div>
  );
}
