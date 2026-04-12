import { Card } from "@/components/card";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PortalAccountSecurityForm } from "@/components/portal-account-security-form";
import { PortalClientAccountsManager } from "@/components/portal-client-accounts-manager";
import { PortalTenantControl } from "@/components/portal-tenant-control";
import { ShopCatalogManager } from "@/components/shop-catalog-manager";
import { TenantShopifyPanel } from "@/components/tenant-shopify-panel";
import { PortalTrackingSettings } from "@/components/portal-tracking-settings";
import { WebhookSettingsPanel } from "@/components/webhook-settings-panel";
import { PortalSustainabilityPanel } from "@/components/portal-sustainability-panel";
import { SettingsTabs } from "@/components/settings-tabs";
import { fetchMyClientAccounts, fetchShopCatalogProducts, fetchShopifyIntegrations, fetchOrders } from "@/lib/api";
import type { Order } from "@/lib/types";
import { fetchMyShops, requirePortalUser } from "@/lib/auth";
import { resolveTenantScope } from "@/lib/tenant-scope";

const PORTAL_TABS = [
  { id: "account",        label: "Mi cuenta",     icon: "🔐" },
  { id: "shopify",        label: "Shopify",        icon: "🔗" },
  { id: "tracking",       label: "Tracking",       icon: "📦" },
  { id: "webhooks",       label: "Webhooks",       icon: "🔔" },
  { id: "sustainability", label: "Sostenibilidad", icon: "🌱" },
];

type PortalSettingsPageProps = {
  searchParams?: Promise<{ shop_id?: string; tab?: string }>;
};

export default async function PortalSettingsPage({ searchParams }: PortalSettingsPageProps) {
  const user = await requirePortalUser();
  const params = (await searchParams) ?? {};
  const activeTab = params.tab ?? "account";

  const shops = await fetchMyShops();
  const tenantScope = resolveTenantScope(shops, params.shop_id);
  const primaryShop = tenantScope.selectedShop;

  const [integrationsResult, catalogResult, managedAccountsResult, ordersResult] = await Promise.allSettled([
    fetchShopifyIntegrations(),
    primaryShop ? fetchShopCatalogProducts(primaryShop.id) : Promise.resolve([]),
    user.role === "shop_admin" ? fetchMyClientAccounts() : Promise.resolve([]),
    fetchOrders({ page: 1, per_page: 500, ...(primaryShop ? { shop_id: primaryShop.id } : {}) }).catch(() => ({ orders: [] })),
  ]);

  const integrations = integrationsResult.status === "fulfilled" ? integrationsResult.value : [];
  const catalogProducts = catalogResult.status === "fulfilled" ? catalogResult.value : [];
  const activeIntegration = primaryShop
    ? integrations.find((i) => i.shop_id === primaryShop.id) ?? null
    : null;
  const catalogError = catalogResult.status === "rejected"
    ? "No pudimos cargar el catálogo Shopify. Puedes seguir usando el resto de ajustes."
    : null;
  const integrationsError = integrationsResult.status === "rejected"
    ? "No pudimos leer el estado de la integración Shopify."
    : null;
  const managedAccounts = managedAccountsResult.status === "fulfilled" ? managedAccountsResult.value : [];
  const managedAccountsError = managedAccountsResult.status === "rejected"
    ? "No pudimos cargar las cuentas cliente asignadas."
    : null;
  const sustainabilityOrders: Order[] = ordersResult.status === "fulfilled" && ordersResult.value
    ? ((ordersResult.value as { orders?: Order[] }).orders ?? [])
    : [];

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Ajustes"
        title="Tu cuenta en Brandeate"
        description="Gestiona el acceso, la conexión con Shopify, los webhooks y el aspecto de tu página de seguimiento."
      />

      <PortalTenantControl
        action="/portal/settings"
        selectedShopId={tenantScope.selectedShopId}
        shops={tenantScope.shops}
        submitLabel="Ver"
        description="Los ajustes aplican a la tienda seleccionada."
      />

      <SettingsTabs tabs={PORTAL_TABS} preserveParams={["shop_id"]} />

      {/* ── Mi cuenta ────────────────────────────────────────────── */}
      {activeTab === "account" && (
        <div className="stack">
          <Card className="stack settings-section-card portal-glass-card">
            <div className="settings-section-head">
              <div>
                <span className="eyebrow">🔐 Seguridad</span>
                <h3 className="section-title section-title-small">Acceso de tu usuario</h3>
                <p className="subtitle">
                  Cambia el email o la contraseña de tu cuenta para mantener el acceso seguro y actualizado.
                </p>
              </div>
            </div>
            <PortalAccountSecurityForm
              user={{ id: user.id, name: user.name, email: user.email, role: user.role }}
            />
          </Card>

          {user.role === "shop_admin" && (
            <Card className="stack settings-section-card portal-glass-card">
              <div className="settings-section-head">
                <div>
                  <span className="eyebrow">👥 Usuarios</span>
                  <h3 className="section-title section-title-small">Cuentas de tu organización</h3>
                  <p className="subtitle">
                    Gestiona los usuarios de tu cuenta y asigna roles con alcance controlado por tienda.
                  </p>
                </div>
              </div>
              {managedAccountsError && <div className="info-banner">{managedAccountsError}</div>}
              <PortalClientAccountsManager
                accounts={managedAccounts}
                currentUser={{ id: user.id, role: user.role }}
                shops={tenantScope.shops}
              />
            </Card>
          )}
        </div>
      )}

      {/* ── Shopify ──────────────────────────────────────────────── */}
      {activeTab === "shopify" && (
        <div className="stack">
          {primaryShop ? (
            <>
              <Card className="stack portal-glass-card portal-settings-hero">
                <div className="portal-glass-header">
                  <div>
                    <span className="eyebrow">🏪 Tienda activa</span>
                    <h3 className="section-title section-title-small">{primaryShop.name}</h3>
                    <p className="subtitle">
                      Conecta tu Shopify, lanza sincronizaciones manuales y revisa el estado de la integración.
                    </p>
                  </div>
                  <div className="portal-inline-pills">
                    <span className="portal-soft-pill">Slug: {primaryShop.slug}</span>
                    <span className="portal-soft-pill">
                      {activeIntegration ? "✅ Shopify conectado" : "⏳ Shopify pendiente"}
                    </span>
                  </div>
                </div>
              </Card>

              <Card className="stack settings-section-card portal-glass-card">
                <div className="settings-section-head">
                  <div>
                    <span className="eyebrow">🔗 Integración</span>
                    <h3 className="section-title section-title-small">Conexión Shopify</h3>
                    <p className="subtitle">
                      Conecta tu tienda, revisa la última sincronización y lanza importaciones manuales.
                    </p>
                  </div>
                </div>
                {integrationsError && <div className="info-banner">{integrationsError}</div>}
                <TenantShopifyPanel integration={activeIntegration} shop={primaryShop} />
              </Card>
            </>
          ) : (
            <Card className="stack portal-glass-card">
              <EmptyState
                title="Sin tienda asignada"
                description="Cuando tengas una tienda vinculada podrás conectarla a Shopify desde aquí."
              />
            </Card>
          )}
        </div>
      )}

      {/* ── Tracking ─────────────────────────────────────────────── */}
      {activeTab === "tracking" && (
        <div className="stack">
          {primaryShop ? (
            <>
              <Card className="stack settings-section-card portal-glass-card">
                <div className="settings-section-head">
                  <div>
                    <span className="eyebrow">📦 Seguimiento</span>
                    <h3 className="section-title section-title-small">Página de tracking del cliente</h3>
                    <p className="subtitle">
                      Personaliza lo que ve tu cliente final: mensaje, botón de vuelta a tu tienda y código de descuento.
                    </p>
                  </div>
                </div>
                <PortalTrackingSettings
                  shopId={primaryShop.id}
                  shopName={primaryShop.name}
                  initialConfig={primaryShop.tracking_config ?? null}
                  publicTrackingExample={null}
                />
              </Card>

              <Card className="stack settings-section-card portal-glass-card">
                {catalogError && <div className="info-banner">{catalogError}</div>}
                <ShopCatalogManager products={catalogProducts} shop={primaryShop} />
              </Card>
            </>
          ) : (
            <Card className="stack portal-glass-card">
              <EmptyState
                title="Sin tienda asignada"
                description="Selecciona una tienda para ver y configurar el tracking."
              />
            </Card>
          )}
        </div>
      )}

      {/* ── Webhooks ─────────────────────────────────────────────── */}
      {activeTab === "webhooks" && (
        <div className="stack">
          {primaryShop ? (
            <Card className="stack settings-section-card portal-glass-card">
              <div className="settings-section-head">
                <div>
                  <span className="eyebrow">🔔 Notificaciones</span>
                  <h3 className="section-title section-title-small">Webhooks de salida</h3>
                  <p className="subtitle">
                    Notifica automáticamente a tus sistemas cuando ocurren eventos: cambios de estado, envíos o incidencias.
                  </p>
                </div>
              </div>
              <WebhookSettingsPanel shopId={primaryShop.id} />
            </Card>
          ) : (
            <Card className="stack portal-glass-card">
              <EmptyState
                title="Sin tienda asignada"
                description="Selecciona una tienda para gestionar los webhooks."
              />
            </Card>
          )}
        </div>
      )}

      {/* ── Sostenibilidad ───────────────────────────────────────── */}
      {activeTab === "sustainability" && (
        <Card className="stack settings-section-card portal-glass-card">
          <div className="settings-section-head">
            <div>
              <span className="eyebrow">🌱 Sostenibilidad</span>
              <h3 className="section-title section-title-small">Huella de carbono logística</h3>
              <p className="subtitle">
                Estimación de emisiones CO₂ por envío, comparativa de carriers y badge Brandeate Green.
              </p>
            </div>
          </div>
          <PortalSustainabilityPanel orders={sustainabilityOrders} />
        </Card>
      )}
    </div>
  );
}
