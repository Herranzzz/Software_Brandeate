"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";

import { AppModal } from "@/components/app-modal";
import { TenantShopifyPanel } from "@/components/tenant-shopify-panel";
import type { Shop, ShopIntegration, ShopifySyncResult, UserRole } from "@/lib/types";

/* ══════════════════════════════════════════════════════════
   Types
   ══════════════════════════════════════════════════════════ */

type Props = {
  currentUser: { id: number; role: UserRole };
  shops: Shop[];
  primaryShop: Shop | null;
  shopifyIntegration: ShopIntegration | null;
  allIntegrations: ShopIntegration[];
};

type WebhookEvent = "order.created" | "order.shipped" | "order.delivered" | "return.created" | "stock.low";

type WebhookConfig = {
  id: string;
  url: string;
  events: WebhookEvent[];
  active: boolean;
  created_at: string;
};

const WEBHOOK_KEY = "brandeate_webhooks_v1";
const WEBHOOK_EVENTS: { id: WebhookEvent; label: string; description: string }[] = [
  { id: "order.created",   label: "Pedido creado",     description: "Se recibe un nuevo pedido" },
  { id: "order.shipped",   label: "Pedido enviado",    description: "El pedido sale del almacén" },
  { id: "order.delivered", label: "Pedido entregado",  description: "El carrier confirma entrega" },
  { id: "return.created",  label: "Devolución abierta",description: "El cliente abre una devolución" },
  { id: "stock.low",       label: "Stock bajo",        description: "Un SKU cae por debajo del umbral" },
];

function loadWebhooks(): WebhookConfig[] {
  try {
    const raw = localStorage.getItem(WEBHOOK_KEY);
    return raw ? (JSON.parse(raw) as WebhookConfig[]) : [];
  } catch { return []; }
}
function saveWebhooks(items: WebhookConfig[]) {
  localStorage.setItem(WEBHOOK_KEY, JSON.stringify(items));
}

/* ══════════════════════════════════════════════════════════
   Icons
   ══════════════════════════════════════════════════════════ */

function CheckIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
      <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />
    </svg>
  );
}
function RefreshIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
      <path d="M23 4v6h-6M1 20v-6h6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}
function SettingsIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
      <path d="M12 8.8A3.2 3.2 0 1 1 8.8 12 3.2 3.2 0 0 1 12 8.8Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M19 12a7 7 0 0 0-.1-1.2l1.6-1.2-1.6-2.8-1.9.6a6.8 6.8 0 0 0-2-1.2l-.3-2h-3.2l-.3 2a6.8 6.8 0 0 0-2 1.2l-1.9-.6-1.6 2.8 1.6 1.2A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-1.6 1.2 1.6 2.8 1.9-.6a6.8 6.8 0 0 0 2 1.2l.3 2h3.2l.3-2a6.8 6.8 0 0 0 2-1.2l1.9.6 1.6-2.8-1.6-1.2c.1-.4.1-.8.1-1.2Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.4" />
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
function PlusIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </svg>
  );
}
function WebhookIcon() {
  return (
    <svg fill="none" height="16" viewBox="0 0 24 24" width="16">
      <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z" fill="currentColor" />
    </svg>
  );
}
function ExternalIcon() {
  return (
    <svg fill="none" height="12" viewBox="0 0 24 24" width="12">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </svg>
  );
}

/* ══════════════════════════════════════════════════════════
   Platform definitions
   ══════════════════════════════════════════════════════════ */

type PlatformStatus = "connected" | "available" | "soon";

type Platform = {
  id: string;
  name: string;
  description: string;
  status: PlatformStatus;
  logo: ReactNode;
  category: string;
  docsUrl?: string;
};

function ShopifyLogo() {
  return (
    <div className="integ-logo-box" style={{ background: "#96bf48" }}>
      <svg fill="white" height="20" viewBox="0 0 24 24" width="20">
        <path d="M15.34 3.65a.5.5 0 0 0-.45-.07l-.87.26a5.14 5.14 0 0 0-.34-.84C13.2 2.06 12.4 1.5 11.5 1.5a.5.5 0 0 0-.38.17c-.08.1-.58.7-.78 1.83-.12.69-.12 1.32-.04 1.85l-3.8 1.17a.5.5 0 0 0-.35.48v12a.5.5 0 0 0 .5.5h9.7a.5.5 0 0 0 .5-.5V4.1a.5.5 0 0 0-.51-.45zM11.5 2.5c.5 0 1 .4 1.34 1.1.12.24.2.5.27.76l-2.3.7c.07-.57.18-1.07.3-1.36.1-.23.2-.87.39-1.2zm.5 9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z" />
      </svg>
    </div>
  );
}

function WooLogo() {
  return (
    <div className="integ-logo-box" style={{ background: "#7f54b3" }}>
      <svg fill="white" height="20" viewBox="0 0 24 24" width="20">
        <path d="M2 6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6zm3.5 3a1 1 0 0 0 0 2c.5 2 1.5 3.5 2.5 3.5s1.5-1 2-2c.5 1 1 2 2 2s1.8-1.5 2.3-3.5a1 1 0 1 0-1-1.5c-.3 1.5-.8 2.8-1.3 2.8-.4 0-.8-.8-1.1-2-.2-.7-.9-.7-1.1 0-.3 1.2-.7 2-1.1 2-.5 0-1-1.3-1.3-2.8A1 1 0 0 0 5.5 9z" />
      </svg>
    </div>
  );
}

function AmazonLogo() {
  return (
    <div className="integ-logo-box" style={{ background: "#ff9900" }}>
      <svg fill="white" height="20" viewBox="0 0 24 24" width="20">
        <path d="M14.4 14.9c-2 1.4-4.9 2.1-7.4 2.1-3.5 0-6.7-1.3-9.1-3.4-.2-.2 0-.4.2-.3 2.6 1.5 5.8 2.4 9.1 2.4 2.2 0 4.7-.5 7-1.4.3-.1.6.2.2.6zM15.3 13.8c-.3-.4-1.8-.2-2.5-.1-.2 0-.2-.2-.1-.3 1.2-.9 3.2-.6 3.4-.3.2.3-.1 2.3-1.2 3.3-.2.2-.4.1-.3-.1.3-.6.9-2.1.7-2.5z" />
        <path d="M13 8.3V7.4c0-.1.1-.2.2-.2h3.7c.1 0 .2.1.2.2v.8c0 .1-.1.3-.3.5l-1.9 2.7c.7 0 1.5.1 2.1.5.1.1.2.2.2.3v1c0 .1-.1.2-.3.1-1.2-.6-2.7-.7-4 0-.1.1-.3 0-.3-.1v-.9c0-.2.1-.4.2-.5l2.2-3.2h-1.9c-.1 0-.2-.1-.2-.2z" />
        <path d="M5 7.3h-1c-.1 0-.2-.1-.2-.2V3.2c0-.1.1-.2.2-.2h1c.1 0 .2.1.2.2v.8h0c.3-.7.8-1.1 1.5-1.1.7 0 1.1.4 1.5 1.1.3-.7.9-1.1 1.6-1.1.5 0 1 .2 1.3.6.3.4.3 1 .3 1.6v2.1c0 .1-.1.2-.2.2H10c-.1 0-.2-.1-.2-.2V5.2c0-.2 0-.8-.1-1-.1-.2-.2-.3-.5-.3-.2 0-.4.1-.5.4-.1.2-.1.5-.1.9v1.9c0 .1-.1.2-.2.2H7.2c-.1 0-.2-.1-.2-.2V5.2c0-.6 0-1.3-.6-1.3-.6 0-.6.7-.6 1.3v1.9c0 .1-.1.2-.2.2z" />
      </svg>
    </div>
  );
}

function PrestaLogo() {
  return (
    <div className="integ-logo-box" style={{ background: "#df0067" }}>
      <span style={{ color: "white", fontWeight: 800, fontSize: 13 }}>PS</span>
    </div>
  );
}

function TikTokLogo() {
  return (
    <div className="integ-logo-box" style={{ background: "#010101" }}>
      <svg fill="white" height="18" viewBox="0 0 24 24" width="18">
        <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.95a8.16 8.16 0 0 0 4.77 1.52V7.02a4.85 4.85 0 0 1-1-.33z" />
      </svg>
    </div>
  );
}

function ZapierLogo() {
  return (
    <div className="integ-logo-box" style={{ background: "#ff4a00" }}>
      <span style={{ color: "white", fontWeight: 800, fontSize: 13 }}>Zap</span>
    </div>
  );
}

function MakeLogo() {
  return (
    <div className="integ-logo-box" style={{ background: "#6d00cc" }}>
      <span style={{ color: "white", fontWeight: 800, fontSize: 12 }}>Make</span>
    </div>
  );
}

function EtsyLogo() {
  return (
    <div className="integ-logo-box" style={{ background: "#f56400" }}>
      <span style={{ color: "white", fontWeight: 800, fontSize: 14 }}>E</span>
    </div>
  );
}

function RestApiLogo() {
  return (
    <div className="integ-logo-box" style={{ background: "#0f172a" }}>
      <span style={{ color: "white", fontWeight: 700, fontSize: 11 }}>API</span>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Sync result summary
   ══════════════════════════════════════════════════════════ */

function SyncResult({ result }: { result: ShopifySyncResult }) {
  const items = [
    { label: "Pedidos importados",  value: result.imported_count },
    { label: "Actualizados",        value: result.updated_count },
    { label: "Shipments creados",   value: result.shipments_created_count },
    { label: "Eventos tracking",    value: result.tracking_events_created_count },
    { label: "Clientes creados",    value: result.customers_created_count ?? 0 },
    { label: "Leídos en total",     value: result.total_fetched },
  ];
  return (
    <div className="integ-sync-result">
      {items.map((item) => (
        <div className="integ-sync-stat" key={item.label}>
          <span className="integ-sync-stat-value">{item.value}</span>
          <span className="integ-sync-stat-label">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Shopify connected card
   ══════════════════════════════════════════════════════════ */

function ShopifyCard({
  integration,
  shop,
  allIntegrations,
  shops,
}: {
  integration: ShopIntegration;
  shop: Shop;
  allIntegrations: ShopIntegration[];
  shops: Shop[];
}) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<"sync" | "import" | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [syncResult, setSyncResult] = useState<ShopifySyncResult | null>(null);
  const [, startTransition] = useTransition();

  const isOk = integration.last_sync_status === "ok" || integration.last_sync_status === "success";
  const hasError = !!integration.last_error_message;

  function fmtDate(iso: string | null) {
    if (!iso) return "Nunca";
    return new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  }

  async function runSync(action: "sync" | "import") {
    setMessage(null);
    setSyncResult(null);
    setPendingAction(action);
    try {
      const path = action === "import"
        ? `/api/integrations/shopify/${shop.id}/import-orders`
        : `/api/integrations/shopify/${shop.id}/sync-orders`;
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" } });
      const payload = await response.json().catch(() => null) as ShopifySyncResult | { detail?: string } | null;
      if (!response.ok) {
        setMessage({ kind: "error", text: (payload as { detail?: string } | null)?.detail ?? "Error al sincronizar." });
        return;
      }
      setSyncResult(payload as ShopifySyncResult);
      setMessage({ kind: "success", text: action === "import" ? "Importación histórica completada." : "Sincronización completada." });
      startTransition(() => router.refresh());
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <>
      <div className="integ-card integ-card-connected">
        <div className="integ-card-header">
          <div className="integ-card-logo-wrap">
            <ShopifyLogo />
            <div>
              <div className="integ-card-name">Shopify</div>
              <div className="integ-card-domain">{integration.shop_domain}</div>
            </div>
          </div>
          <span className={`integ-status-badge ${hasError ? "integ-status-error" : "integ-status-ok"}`}>
            {hasError ? "Error" : "Conectado"}
          </span>
        </div>

        <div className="integ-card-meta">
          <div className="integ-meta-row">
            <span className="integ-meta-label">Última sync</span>
            <span className="integ-meta-value">{fmtDate(integration.last_synced_at)}</span>
          </div>
          <div className="integ-meta-row">
            <span className="integ-meta-label">Estado</span>
            <span className={`integ-meta-value ${isOk ? "integ-val-ok" : ""}`}>
              {integration.last_sync_status ?? "Sin ejecutar"}
            </span>
          </div>
          {integration.last_error_message && (
            <div className="integ-meta-row integ-meta-error">
              <span className="integ-meta-label">Error</span>
              <span className="integ-meta-value">{integration.last_error_message}</span>
            </div>
          )}
        </div>

        {message && <div className={`feedback feedback-${message.kind}`}>{message.text}</div>}
        {syncResult && <SyncResult result={syncResult} />}

        <div className="integ-card-actions">
          <button
            className="crm-action-btn"
            disabled={!!pendingAction}
            onClick={() => void runSync("sync")}
            type="button"
          >
            <RefreshIcon />
            {pendingAction === "sync" ? "Sincronizando…" : "Sync rápida"}
          </button>
          <button
            className="crm-action-btn"
            disabled={!!pendingAction}
            onClick={() => void runSync("import")}
            type="button"
          >
            <RefreshIcon />
            {pendingAction === "import" ? "Importando…" : "Importar histórico"}
          </button>
          <button
            className="crm-action-btn"
            onClick={() => { setMessage(null); setConfigOpen(true); }}
            type="button"
          >
            <SettingsIcon /> Configurar
          </button>
        </div>
      </div>

      <AppModal
        eyebrow="Shopify"
        onClose={() => setConfigOpen(false)}
        open={configOpen}
        subtitle={`Configuración de la integración con ${integration.shop_domain}`}
        title="Conexión Shopify"
        width="wide"
        actions={
          <button className="button-secondary" onClick={() => setConfigOpen(false)} type="button">Cerrar</button>
        }
      >
        <TenantShopifyPanel
          integration={integration}
          shop={shop}
        />
      </AppModal>
    </>
  );
}

/* ══════════════════════════════════════════════════════════
   Shopify connect card (not yet connected)
   ══════════════════════════════════════════════════════════ */

function ShopifyConnectCard({ shop }: { shop: Shop }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="integ-card integ-card-available">
        <div className="integ-card-header">
          <div className="integ-card-logo-wrap">
            <ShopifyLogo />
            <div>
              <div className="integ-card-name">Shopify</div>
              <div className="integ-card-desc">Sincroniza pedidos, clientes y catálogo automáticamente.</div>
            </div>
          </div>
          <span className="integ-status-badge integ-status-available">Disponible</span>
        </div>
        <div className="integ-card-actions">
          <button className="button" onClick={() => setOpen(true)} type="button">
            Conectar Shopify
          </button>
        </div>
      </div>
      <AppModal
        eyebrow="Shopify"
        onClose={() => setOpen(false)}
        open={open}
        subtitle="Conecta tu tienda Shopify para empezar a sincronizar pedidos automáticamente."
        title="Conectar Shopify"
        width="wide"
        actions={<button className="button-secondary" onClick={() => setOpen(false)} type="button">Cancelar</button>}
      >
        <TenantShopifyPanel integration={null} shop={shop} />
      </AppModal>
    </>
  );
}

/* ══════════════════════════════════════════════════════════
   Platform card (soon / available)
   ══════════════════════════════════════════════════════════ */

function PlatformCard({ platform }: { platform: Platform }) {
  return (
    <div className={`integ-card ${platform.status === "soon" ? "integ-card-soon" : "integ-card-available"}`}>
      <div className="integ-card-header">
        <div className="integ-card-logo-wrap">
          {platform.logo}
          <div>
            <div className="integ-card-name">{platform.name}</div>
            <div className="integ-card-desc">{platform.description}</div>
          </div>
        </div>
        <span className={`integ-status-badge ${platform.status === "soon" ? "integ-status-soon" : "integ-status-available"}`}>
          {platform.status === "soon" ? "Próximamente" : "Disponible"}
        </span>
      </div>
      {platform.docsUrl && platform.status !== "soon" && (
        <div className="integ-card-actions">
          <a className="crm-action-btn" href={platform.docsUrl} rel="noreferrer" target="_blank">
            <ExternalIcon /> Ver documentación
          </a>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Webhooks section
   ══════════════════════════════════════════════════════════ */

function WebhooksSection() {
  const [webhooks, setWebhooks] = useState<WebhookConfig[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newEvents, setNewEvents] = useState<WebhookEvent[]>([]);

  useEffect(() => { setWebhooks(loadWebhooks()); }, []);

  function createWebhook() {
    if (!newUrl.trim() || !newEvents.length) return;
    const next: WebhookConfig = {
      id: crypto.randomUUID(),
      url: newUrl.trim(),
      events: newEvents,
      active: true,
      created_at: new Date().toISOString(),
    };
    const updated = [...webhooks, next];
    setWebhooks(updated);
    saveWebhooks(updated);
    setNewUrl("");
    setNewEvents([]);
    setCreateOpen(false);
  }

  function deleteWebhook(id: string) {
    const updated = webhooks.filter((w) => w.id !== id);
    setWebhooks(updated);
    saveWebhooks(updated);
  }

  function toggleWebhook(id: string) {
    const updated = webhooks.map((w) => w.id === id ? { ...w, active: !w.active } : w);
    setWebhooks(updated);
    saveWebhooks(updated);
  }

  function toggleEvent(event: WebhookEvent) {
    setNewEvents((prev) => prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]);
  }

  return (
    <div className="integ-section">
      <div className="integ-section-header">
        <div>
          <h2 className="integ-section-title"><WebhookIcon /> Webhooks</h2>
          <p className="integ-section-desc">Recibe notificaciones en tiempo real en tu sistema cuando ocurran eventos en Brandeate.</p>
        </div>
        <button className="button" onClick={() => setCreateOpen(true)} type="button">
          <PlusIcon /> Nuevo webhook
        </button>
      </div>

      {webhooks.length === 0 ? (
        <div className="integ-empty">
          <div className="integ-empty-icon">🔔</div>
          <p className="integ-empty-title">Sin webhooks configurados</p>
          <p className="integ-empty-sub">Añade un endpoint para recibir eventos de Brandeate en tu sistema.</p>
        </div>
      ) : (
        <div className="integ-webhook-list">
          {webhooks.map((wh) => (
            <div className="integ-webhook-row" key={wh.id}>
              <div className="integ-webhook-main">
                <div className="integ-webhook-url">{wh.url}</div>
                <div className="integ-webhook-events">
                  {wh.events.map((ev) => (
                    <span className="integ-event-pill" key={ev}>
                      {WEBHOOK_EVENTS.find((e) => e.id === ev)?.label ?? ev}
                    </span>
                  ))}
                </div>
              </div>
              <div className="integ-webhook-actions">
                <button
                  className={`crm-status-btn ${wh.active ? "crm-status-active" : "crm-status-inactive"}`}
                  onClick={() => toggleWebhook(wh.id)}
                  type="button"
                >
                  <span className="crm-status-dot" />
                  {wh.active ? "Activo" : "Pausado"}
                </button>
                <button className="crm-dots-btn" onClick={() => deleteWebhook(wh.id)} title="Eliminar webhook" type="button">
                  <TrashIcon />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <AppModal
        eyebrow="Webhooks"
        onClose={() => setCreateOpen(false)}
        open={createOpen}
        subtitle="Define la URL de destino y los eventos que quieres recibir."
        title="Nuevo webhook"
        actions={<button className="button-secondary" onClick={() => setCreateOpen(false)} type="button">Cancelar</button>}
      >
        <div className="stack">
          <div className="field">
            <label htmlFor="wh-url">URL del endpoint</label>
            <input
              id="wh-url"
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://tu-sistema.com/webhooks/brandeate"
              type="url"
              value={newUrl}
            />
          </div>
          <div className="field">
            <label>Eventos a escuchar</label>
            <div className="integ-event-picker">
              {WEBHOOK_EVENTS.map((ev) => (
                <button
                  className={`integ-event-option ${newEvents.includes(ev.id) ? "integ-event-option-active" : ""}`}
                  key={ev.id}
                  onClick={() => toggleEvent(ev.id)}
                  type="button"
                >
                  <div className="integ-event-option-check">
                    {newEvents.includes(ev.id) && <CheckIcon />}
                  </div>
                  <div>
                    <div className="integ-event-option-label">{ev.label}</div>
                    <div className="integ-event-option-desc">{ev.description}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
          <div className="modal-footer">
            <button
              className="button"
              disabled={!newUrl.trim() || !newEvents.length}
              onClick={createWebhook}
              type="button"
            >
              Crear webhook
            </button>
          </div>
        </div>
      </AppModal>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   API access section
   ══════════════════════════════════════════════════════════ */

function ApiAccessSection({ shop }: { shop: Shop | null }) {
  const [copied, setCopied] = useState(false);
  const apiBase = typeof window !== "undefined" ? `${window.location.origin}/api` : "https://app.brandeate.com/api";
  const shopSlug = shop?.slug ?? "tu-tienda";

  const exampleEndpoints = [
    { method: "GET",   path: `/shops/${shopSlug}/orders`,    desc: "Listar pedidos" },
    { method: "GET",   path: `/shops/${shopSlug}/stock`,     desc: "Estado del stock" },
    { method: "POST",  path: `/shops/${shopSlug}/orders`,    desc: "Crear pedido" },
    { method: "GET",   path: `/shops/${shopSlug}/shipments`, desc: "Seguimiento de envíos" },
  ];

  async function copyBase() {
    await navigator.clipboard.writeText(apiBase).catch(() => null);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="integ-section">
      <div className="integ-section-header">
        <div>
          <h2 className="integ-section-title"><RestApiLogo /> Acceso por API</h2>
          <p className="integ-section-desc">Integra Brandeate directamente en tu stack técnico con nuestra API REST. Autenticación por Bearer token.</p>
        </div>
        <a className="button-secondary" href="mailto:hola@brandeate.com?subject=Acceso API" rel="noreferrer" target="_blank">
          Solicitar acceso
        </a>
      </div>

      <div className="integ-api-box">
        <div className="integ-api-url-row">
          <span className="integ-api-label">Base URL</span>
          <div className="integ-api-code-wrap">
            <code className="integ-api-code">{apiBase}</code>
            <button className="crm-action-btn" onClick={() => void copyBase()} type="button">
              {copied ? <CheckIcon /> : null}
              {copied ? "Copiado" : "Copiar"}
            </button>
          </div>
        </div>

        <div className="integ-endpoint-list">
          {exampleEndpoints.map((ep) => (
            <div className="integ-endpoint-row" key={ep.path}>
              <span className={`integ-method integ-method-${ep.method.toLowerCase()}`}>{ep.method}</span>
              <code className="integ-endpoint-path">{ep.path}</code>
              <span className="integ-endpoint-desc">{ep.desc}</span>
            </div>
          ))}
        </div>

        <div className="info-banner" style={{ marginTop: 0 }}>
          La documentación completa y las API keys se entregan durante el proceso de onboarding. Escríbenos a <strong>hola@brandeate.com</strong> para solicitar acceso API.
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Main component
   ══════════════════════════════════════════════════════════ */

export function PortalIntegrationsHub({
  shops,
  primaryShop,
  shopifyIntegration,
  allIntegrations,
}: Props) {
  const platforms: Platform[] = [
    {
      id: "woocommerce",
      name: "WooCommerce",
      description: "Sincroniza pedidos desde tu tienda WordPress/WooCommerce.",
      status: "soon",
      logo: <WooLogo />,
      category: "ecommerce",
    },
    {
      id: "prestashop",
      name: "PrestaShop",
      description: "Conecta tu tienda PrestaShop y gestiona el fulfillment desde Brandeate.",
      status: "soon",
      logo: <PrestaLogo />,
      category: "ecommerce",
    },
    {
      id: "amazon",
      name: "Amazon",
      description: "Gestiona pedidos de Amazon FBM a través de Brandeate.",
      status: "soon",
      logo: <AmazonLogo />,
      category: "marketplace",
    },
    {
      id: "tiktok",
      name: "TikTok Shop",
      description: "Fulfillment automático para pedidos de TikTok Shop.",
      status: "soon",
      logo: <TikTokLogo />,
      category: "social",
    },
    {
      id: "etsy",
      name: "Etsy",
      description: "Sincroniza tus pedidos de Etsy y gestiona envíos desde aquí.",
      status: "soon",
      logo: <EtsyLogo />,
      category: "marketplace",
    },
    {
      id: "zapier",
      name: "Zapier",
      description: "Automatiza flujos con más de 5.000 apps sin escribir código.",
      status: "soon",
      logo: <ZapierLogo />,
      category: "automation",
    },
    {
      id: "make",
      name: "Make (Integromat)",
      description: "Crea automatizaciones avanzadas con escenarios visuales.",
      status: "soon",
      logo: <MakeLogo />,
      category: "automation",
    },
  ];

  const connectedCount = shopifyIntegration ? 1 : 0;

  return (
    <div className="integ-page">
      {/* Header */}
      <div className="integ-page-header">
        <div>
          <h1 className="integ-page-title">Integraciones</h1>
          <p className="integ-page-desc">Conecta tus plataformas de venta y automatiza el flujo de pedidos hacia Brandeate.</p>
        </div>
        <div className="integ-header-stats">
          <div className="integ-header-stat">
            <span className="integ-header-stat-value">{connectedCount}</span>
            <span className="integ-header-stat-label">Conectada{connectedCount !== 1 ? "s" : ""}</span>
          </div>
          <div className="integ-header-stat">
            <span className="integ-header-stat-value">{platforms.length + 1}</span>
            <span className="integ-header-stat-label">Disponibles</span>
          </div>
        </div>
      </div>

      {/* ── Mis conexiones ── */}
      <div className="integ-section">
        <div className="integ-section-header">
          <div>
            <h2 className="integ-section-title">Mis conexiones</h2>
            <p className="integ-section-desc">Plataformas actualmente conectadas con tu cuenta.</p>
          </div>
        </div>

        <div className="integ-grid">
          {primaryShop && shopifyIntegration ? (
            <ShopifyCard
              allIntegrations={allIntegrations}
              integration={shopifyIntegration}
              shop={primaryShop}
              shops={shops}
            />
          ) : primaryShop ? (
            <ShopifyConnectCard shop={primaryShop} />
          ) : (
            <div className="integ-empty">
              <div className="integ-empty-icon">🔗</div>
              <p className="integ-empty-title">Sin tienda asignada</p>
              <p className="integ-empty-sub">Necesitas tener una tienda vinculada para conectar integraciones.</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Otras plataformas ── */}
      <div className="integ-section">
        <div className="integ-section-header">
          <div>
            <h2 className="integ-section-title">Próximamente</h2>
            <p className="integ-section-desc">Más plataformas y automatizaciones en camino. Escríbenos si necesitas priorizar alguna.</p>
          </div>
        </div>
        <div className="integ-grid integ-grid-soon">
          {platforms.map((p) => (
            <PlatformCard key={p.id} platform={p} />
          ))}
        </div>
      </div>

      {/* ── Webhooks ── */}
      <WebhooksSection />

      {/* ── API Access ── */}
      <ApiAccessSection shop={primaryShop} />
    </div>
  );
}
