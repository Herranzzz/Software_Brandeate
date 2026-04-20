import { Card } from "@/components/card";
import { CreateShopButton } from "@/components/create-shop-button";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { ShopShippingSettingsForm } from "@/components/shop-shipping-settings-form";
import { ShippingRulesManager } from "@/components/shipping-rules-manager";
import { ShopifySyncPanel } from "@/components/shopify-sync-panel";
import { PortalSustainabilityPanel } from "@/components/portal-sustainability-panel";
import { ShopifyTrackingLinkPanel } from "@/components/shopify-tracking-link-panel";
import { TrackingBrandingPanel } from "@/components/tracking-branding-panel";
import { WebhookSettingsPanel } from "@/components/webhook-settings-panel";
import { MarketingConfigPanel } from "@/components/marketing-config-panel";
import { EmailFlowsPanel } from "@/components/email-flows-panel";
import { PrintSettingsPanel } from "@/components/print-settings-panel";

import { SettingsTabs } from "@/components/settings-tabs";
import { fetchEmailFlows, fetchOrders, fetchShops, fetchShopifyIntegrations } from "@/lib/api";
import { requireAdminUser } from "@/lib/auth";
import type { EmailFlow, Order } from "@/lib/types";
import { formatDateTime } from "@/lib/format";
import { getTenantBranding } from "@/lib/tenant-branding";
import Link from "next/link";

const ADMIN_TABS = [
  { id: "shopify",       label: "Shopify",       icon: "🔗" },
  { id: "shipping",      label: "Expediciones",   icon: "🚚" },
  { id: "printing",      label: "Impresión",      icon: "🖨️" },
  { id: "branding",      label: "Branding",       icon: "🎨" },
  { id: "tracking",      label: "Tracking",       icon: "📦" },
  { id: "marketing",     label: "Marketing",      icon: "📊" },
  { id: "email-flows",   label: "Email flows",    icon: "✉️" },
  { id: "team",          label: "Equipo",         icon: "👥" },
  { id: "webhooks",      label: "Webhooks",       icon: "🔔" },
  { id: "sustainability",label: "Sostenibilidad", icon: "🌱" },
];

function renderSyncSummary(summary: Record<string, unknown> | null) {
  if (!summary) return "Sin datos de sincronización";
  const parts = [
    typeof summary.mode === "string" ? summary.mode : null,
    typeof summary.imported_count === "number" ? `+${summary.imported_count} nuevos` : null,
    typeof summary.updated_count === "number" ? `${summary.updated_count} actualizados` : null,
    typeof summary.customers_updated_count === "number" ? `${summary.customers_updated_count} clientes` : null,
    typeof summary.shipments_updated_count === "number" ? `${summary.shipments_updated_count} shipments` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Sin resumen útil";
}

type SettingsPageProps = {
  searchParams?: Promise<{ tab?: string }>;
};

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const params = (await searchParams) ?? {};
  const activeTab = params.tab ?? "shopify";

  const [userResult, shopsResult, integrationsResult, ordersResult] = await Promise.allSettled([
    requireAdminUser(),
    fetchShops(),
    fetchShopifyIntegrations(),
    fetchOrders({ page: 1, per_page: 500 }).catch(() => ({ orders: [] })),
  ]);
  if (userResult.status === "rejected") throw userResult.reason;
  const shops = shopsResult.status === "fulfilled" ? shopsResult.value : [];
  const integrations = integrationsResult.status === "fulfilled" ? integrationsResult.value : [];
  const sustainabilityOrders: Order[] =
    ordersResult.status === "fulfilled" && ordersResult.value
      ? ((ordersResult.value as { orders?: Order[] }).orders ?? [])
      : [];

  // Fetch email flows for all shops (only when on that tab, graceful empty on error)
  const emailFlowsByShop: Record<number, EmailFlow[]> = {};
  if (activeTab === "email-flows" && shops.length > 0) {
    await Promise.allSettled(
      shops.map(async (shop) => {
        try {
          emailFlowsByShop[shop.id] = await fetchEmailFlows(shop.id);
        } catch {
          emailFlowsByShop[shop.id] = [];
        }
      })
    );
  }

  return (
    <div className="stack">
      <PageHeader
        actions={
          <CreateShopButton
            buttonLabel="Crear tienda"
            description="Crea una nueva tienda y después podrás conectarla a Shopify, asignar equipo y configurar expediciones."
          />
        }
        eyebrow="Ajustes"
        title="Configuración del sistema"
        description="Gestiona tiendas, integraciones, equipo y los ajustes operativos de Brandeate."
      />

      <SettingsTabs tabs={ADMIN_TABS} />

      {/* ── Shopify ─────────────────────────────────────────────── */}
      {activeTab === "shopify" && (
        <div className="stack">
          {shops.length > 0 ? (
            <Card className="stack settings-section-card">
              <div className="settings-section-head">
                <div>
                  <span className="eyebrow">🔗 Integraciones</span>
                  <h3 className="section-title section-title-small">Shopify</h3>
                  <p className="subtitle">
                    Gestiona la tienda conectada, la última sincronización y las importaciones manuales desde un único lugar.
                  </p>
                </div>
              </div>
              <ShopifySyncPanel integrations={integrations} shops={shops} />
            </Card>
          ) : (
            <Card className="stack">
              <EmptyState
                title="Sin tiendas disponibles"
                description="Crea al menos una tienda para poder lanzar sincronizaciones de Shopify desde el panel."
              />
            </Card>
          )}

          {integrations.length > 0 && (
            <Card className="stack table-card">
              <div className="table-header">
                <div>
                  <span className="eyebrow">🔗 Estado</span>
                  <h3 className="section-title section-title-small">Estado por tienda</h3>
                </div>
                <div className="muted">{integrations.length} conectadas</div>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Tienda</th>
                      <th>Shopify</th>
                      <th>Última sync</th>
                      <th>Estado</th>
                      <th>Resumen</th>
                      <th>Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {integrations.map((integration) => {
                      const shop = shops.find((item) => item.id === integration.shop_id);
                      return (
                        <tr className="table-row" key={integration.id}>
                          <td className="table-primary">{shop?.name ?? `Shop #${integration.shop_id}`}</td>
                          <td>{integration.shop_domain}</td>
                          <td>{integration.last_synced_at ? formatDateTime(integration.last_synced_at) : "Nunca"}</td>
                          <td><span className="badge">{integration.last_sync_status ?? "Sin ejecutar"}</span></td>
                          <td className="table-secondary">{renderSyncSummary(integration.last_sync_summary)}</td>
                          <td className="table-secondary">{integration.last_error_message ?? "Sin errores"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ── Shipping ─────────────────────────────────────────────── */}
      {activeTab === "shipping" && shops.length > 0 && (
        <Card className="stack settings-section-card">
          <div className="settings-section-head">
            <div>
              <span className="eyebrow">🚚 Expediciones</span>
              <h3 className="section-title section-title-small">Configuración por tienda</h3>
              <p className="subtitle">
                Ajusta el origen de envío y los defaults operativos que usará CTT al crear etiquetas desde cada tienda.
              </p>
            </div>
          </div>
          <div className="settings-shipping-grid">
            {shops.map((shop) => (
              <article className="shop-settings-card" key={shop.id}>
                <div className="shop-settings-card-head">
                  <div>
                    <div className="table-primary">{shop.name}</div>
                    <div className="table-secondary">/{shop.slug}</div>
                  </div>
                  <span className="portal-soft-pill">Shop #{shop.id}</span>
                </div>
                <ShopShippingSettingsForm shop={shop} submitLabel="Guardar tienda" />
                <ShippingRulesManager shop={shop} />
              </article>
            ))}
          </div>
        </Card>
      )}

      {/* ── Impresión ────────────────────────────────────────────── */}
      {activeTab === "printing" && <PrintSettingsPanel />}

      {/* ── Branding ─────────────────────────────────────────────── */}
      {activeTab === "branding" && (
        <Card className="stack settings-section-card">
          <div className="settings-section-head">
            <div>
              <span className="eyebrow">🎨 Branding</span>
              <h3 className="section-title section-title-small">Portal cliente</h3>
              <p className="subtitle">
                Prepara visualmente el espacio cliente con marca propia sobre infraestructura Brandeate.
              </p>
            </div>
          </div>
          <div className="branding-grid">
            {shops.map((shop) => {
              const branding = getTenantBranding(shop);
              return (
                <article className="branding-card" key={shop.id}>
                  <div className="branding-card-top">
                    <div
                      className="branding-mark"
                      style={{ background: `${branding.accentColor}16`, color: branding.accentColor }}
                    >
                      {branding.logoMark}
                    </div>
                    <div>
                      <div className="table-primary">{branding.displayName}</div>
                      <div className="table-secondary">{shop.name}</div>
                    </div>
                  </div>
                  <div className="branding-preview">
                    <div className="branding-preview-bar" style={{ background: branding.accentColor }} />
                    <div className="branding-preview-copy">
                      <div className="branding-preview-title">{branding.displayName}</div>
                      <div className="branding-preview-subtitle">{branding.subtitle}</div>
                    </div>
                  </div>
                  <div className="kv">
                    <div className="kv-row">
                      <span className="kv-label">Color principal</span>
                      <div className="branding-color-row">
                        <span className="branding-color-swatch" style={{ background: branding.accentColor }} />
                        <span>{branding.accentColor}</span>
                      </div>
                    </div>
                    <div className="kv-row">
                      <span className="kv-label">Subtítulo</span>
                      <div>{branding.subtitle}</div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </Card>
      )}

      {/* ── Tracking ─────────────────────────────────────────────── */}
      {activeTab === "tracking" && (
        <Card className="stack settings-section-card">
          <div className="settings-section-head">
            <div>
              <span className="eyebrow">📦 Tracking</span>
              <h3 className="section-title section-title-small">Enlace de tracking en Shopify</h3>
              <p className="subtitle">
                Elige qué enlace recibe el cliente en el email de envío de Shopify: la página de seguimiento
                de Brandeate o el enlace nativo del transportista.
              </p>
            </div>
          </div>
          {shops.length === 0 ? (
            <EmptyState
              title="Sin tiendas disponibles"
              description="Crea al menos una tienda para configurar su tracking."
            />
          ) : (
            <div className="settings-shipping-grid">
              {shops.map((shop) => {
                const exampleToken = sustainabilityOrders
                  .find((o) => o.shop_id === shop.id && o.shipment?.public_token)
                  ?.shipment?.public_token;
                const trackingExample = exampleToken ? `/tracking/${exampleToken}` : null;
                return (
                  <article className="shop-settings-card" key={shop.id}>
                    <div className="shop-settings-card-head">
                      <div>
                        <div className="table-primary">{shop.name}</div>
                        <div className="table-secondary">/{shop.slug}</div>
                      </div>
                      <span className="portal-soft-pill">Shop #{shop.id}</span>
                    </div>
                    <TrackingBrandingPanel
                      shopId={shop.id}
                      shopName={shop.name}
                      initialConfig={shop.tracking_config ?? null}
                    />

                    <div className="trk-settings-layout">
                      <ShopifyTrackingLinkPanel shopId={shop.id} />
                      {trackingExample && (
                        <div className="trk-phone-wrap">
                          <div className="trk-phone-label">
                            <span>Vista del cliente</span>
                            <a href={trackingExample} target="_blank" rel="noreferrer" className="trk-phone-open-link">Abrir ↗</a>
                          </div>
                          <div className="trk-phone-frame">
                            <div className="trk-phone-notch" />
                            <iframe src={trackingExample} className="trk-phone-iframe" title="Vista previa tracking" sandbox="allow-scripts allow-same-origin" />
                          </div>
                          <p className="trk-phone-hint">Pedido real con tu configuración actual</p>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* ── Marketing ───────────────────────────────────────────── */}
      {activeTab === "marketing" && (
        <Card className="stack settings-section-card">
          <div className="settings-section-head">
            <div>
              <span className="eyebrow">📊 Marketing</span>
              <h3 className="section-title section-title-small">Píxeles de analítica</h3>
              <p className="subtitle">
                Conecta GA4, Meta Pixel y TikTok Pixel. Se inyectan en la página de tracking de cada pedido.
              </p>
            </div>
          </div>
          {shops.length === 0 ? (
            <EmptyState title="Sin tiendas" description="Crea una tienda para configurar sus píxeles." />
          ) : (
            <div className="settings-shipping-grid">
              {shops.map((shop) => (
                <article className="shop-settings-card" key={shop.id}>
                  <div className="shop-settings-card-head">
                    <div>
                      <div className="table-primary">{shop.name}</div>
                      <div className="table-secondary">/{shop.slug}</div>
                    </div>
                    <span className="portal-soft-pill">Shop #{shop.id}</span>
                  </div>
                  <MarketingConfigPanel
                    shopId={shop.id}
                    shopName={shop.name}
                    initialConfig={shop.marketing_config ?? null}
                  />
                </article>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ── Email flows ───────────────────────────────────────────── */}
      {activeTab === "email-flows" && (
        <Card className="stack settings-section-card">
          <div className="settings-section-head">
            <div>
              <span className="eyebrow">✉️ Email flows</span>
              <h3 className="section-title section-title-small">Automatización de emails</h3>
              <p className="subtitle">
                Configura los emails automáticos que recibe el cliente: confirmación, envío y entrega.
              </p>
            </div>
          </div>
          {shops.length === 0 ? (
            <EmptyState title="Sin tiendas" description="Crea una tienda para configurar sus flows." />
          ) : (
            <div className="settings-shipping-grid">
              {shops.map((shop) => (
                <article className="shop-settings-card" key={shop.id}>
                  <div className="shop-settings-card-head">
                    <div>
                      <div className="table-primary">{shop.name}</div>
                      <div className="table-secondary">/{shop.slug}</div>
                    </div>
                    <span className="portal-soft-pill">Shop #{shop.id}</span>
                  </div>
                  <EmailFlowsPanel flows={emailFlowsByShop[shop.id] ?? []} />
                </article>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ── Team ─────────────────────────────────────────────────── */}
      {activeTab === "team" && (
        <Card className="stack settings-section-card">
          <div className="settings-section-head">
            <div>
              <span className="eyebrow">👥 Equipo</span>
              <h3 className="section-title section-title-small">Gestión de empleados</h3>
              <p className="subtitle">
                Acceso, roles y rendimiento del equipo operativo desde su propio espacio dedicado.
              </p>
            </div>
            <Link className="button" href="/employees">
              Ir a empleados →
            </Link>
          </div>
        </Card>
      )}

      {/* ── Webhooks ─────────────────────────────────────────────── */}
      {activeTab === "webhooks" && shops.length > 0 && (
        <Card className="stack settings-section-card">
          <div className="settings-section-head">
            <div>
              <span className="eyebrow">🔔 Webhooks</span>
              <h3 className="section-title section-title-small">Webhooks salientes</h3>
              <p className="subtitle">
                Configura endpoints para recibir notificaciones cuando ocurran eventos (cambios de estado, envíos, incidencias).
              </p>
            </div>
          </div>
          <div className="stack">
            {shops.map((shop) => (
              <div key={shop.id}>
                {shops.length > 1 && (
                  <span className="eyebrow" style={{ marginBottom: 8, display: "block" }}>{shop.name}</span>
                )}
                <WebhookSettingsPanel shopId={shop.id} />
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Sustainability ────────────────────────────────────────── */}
      {activeTab === "sustainability" && (
        <Card className="stack settings-section-card">
          <div className="settings-section-head">
            <div>
              <span className="eyebrow">🌱 Sostenibilidad</span>
              <h3 className="section-title section-title-small">Huella de carbono logística</h3>
              <p className="subtitle">
                Estimación de emisiones CO₂ por envío, comparativa de carriers y badge Brandeate Green por cliente.
              </p>
            </div>
          </div>
          <PortalSustainabilityPanel orders={sustainabilityOrders} />
        </Card>
      )}
    </div>
  );
}
