import { Card } from "@/components/card";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PortalAccountSecurityForm } from "@/components/portal-account-security-form";
import { PortalClientAccountsManager } from "@/components/portal-client-accounts-manager";
import { PortalTenantControl } from "@/components/portal-tenant-control";
import { ShopShippingSettingsForm } from "@/components/shop-shipping-settings-form";
import { ShopCatalogManager } from "@/components/shop-catalog-manager";
import { TenantProfileForm } from "@/components/tenant-profile-form";
import { TenantShopifyPanel } from "@/components/tenant-shopify-panel";
import { fetchMyClientAccounts, fetchShopCatalogProducts, fetchShopifyIntegrations } from "@/lib/api";
import { fetchMyShops, requirePortalUser } from "@/lib/auth";
import { resolveTenantScope } from "@/lib/tenant-scope";

type PortalSettingsPageProps = {
  searchParams?: Promise<{
    shop_id?: string;
  }>;
};


export default async function PortalSettingsPage({ searchParams }: PortalSettingsPageProps) {
  const user = await requirePortalUser();

  const params = (await searchParams) ?? {};
  const shops = await fetchMyShops();
  const tenantScope = resolveTenantScope(shops, params.shop_id);
  const primaryShop = tenantScope.selectedShop;

  const [integrationsResult, catalogResult, managedAccountsResult] = await Promise.allSettled([
    fetchShopifyIntegrations(),
    primaryShop ? fetchShopCatalogProducts(primaryShop.id) : Promise.resolve([]),
    user.role === "shop_admin" ? fetchMyClientAccounts() : Promise.resolve([]),
  ]);

  const integrations =
    integrationsResult.status === "fulfilled" ? integrationsResult.value : [];
  const catalogProducts =
    catalogResult.status === "fulfilled" ? catalogResult.value : [];
  const activeIntegration =
    primaryShop
      ? integrations.find((integration) => integration.shop_id === primaryShop.id) ?? null
      : null;
  const catalogError =
    catalogResult.status === "rejected"
      ? "No pudimos cargar el catálogo Shopify. Puedes seguir usando el resto de ajustes mientras revisamos la sincronización."
      : null;
  const integrationsError =
    integrationsResult.status === "rejected"
      ? "No pudimos leer el estado actual de la integración Shopify. Puedes volver a conectar la tienda desde esta misma página."
      : null;
  const managedAccounts =
    managedAccountsResult.status === "fulfilled" ? managedAccountsResult.value : [];
  const managedAccountsError =
    managedAccountsResult.status === "rejected"
      ? "No pudimos cargar las cuentas cliente asignadas. El resto de ajustes sigue disponible."
      : null;

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Ajustes"
        title="Perfil, marca y conexión"
        description="Gestiona la identidad de tu portal, la conexión con Shopify y qué productos deben seguir flujo de personalización."
      />

      <PortalTenantControl
        action="/portal/settings"
        selectedShopId={tenantScope.selectedShopId}
        shops={tenantScope.shops}
        submitLabel="Ver"
        description="Los ajustes usan la misma base del sistema, pero acotada a la tienda o tiendas que puedes administrar."
      />

      <Card className="stack settings-section-card portal-glass-card">
        <div className="settings-section-head">
          <div>
            <span className="eyebrow">🔐 Cuenta</span>
            <h3 className="section-title section-title-small">Acceso de tu usuario</h3>
            <p className="subtitle">
              Cambia email o contraseña de tu cuenta cliente para poder acceder con credenciales actualizadas cuando lo necesites.
            </p>
          </div>
        </div>
        <PortalAccountSecurityForm
          user={{
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
          }}
        />
      </Card>

      {user.role === "shop_admin" ? (
        <Card className="stack settings-section-card portal-glass-card">
          <div className="settings-section-head">
            <div>
              <span className="eyebrow">👥 Jerarquía</span>
              <h3 className="section-title section-title-small">Cuentas de tu cliente</h3>
              <p className="subtitle">
                Gestiona usuarios de tu cuenta cliente por tienda y define roles `shop_admin` o `shop_viewer` con alcance controlado.
              </p>
            </div>
          </div>
          {managedAccountsError ? <div className="info-banner">{managedAccountsError}</div> : null}
          <PortalClientAccountsManager
            accounts={managedAccounts}
            currentUser={{ id: user.id, role: user.role }}
            shops={tenantScope.shops}
          />
        </Card>
      ) : null}

      {primaryShop ? (
        <>
          <Card className="stack portal-glass-card portal-settings-hero">
            <div className="portal-glass-header">
              <div>
                <span className="eyebrow">🏪 Tienda activa</span>
                <h3 className="section-title section-title-small">{primaryShop.name}</h3>
                <p className="subtitle">
                  Desde aquí controlas cómo se presenta tu espacio cliente, cómo se conecta Shopify y qué referencias entran en flujo personalizado.
                </p>
              </div>
              <div className="portal-inline-pills">
                <span className="portal-soft-pill">Slug: {primaryShop.slug}</span>
                <span className="portal-soft-pill">{activeIntegration ? "Shopify conectado" : "Shopify pendiente"}</span>
              </div>
            </div>
          </Card>

          <div className="portal-feature-grid">
            <Card className="stack settings-section-card portal-glass-card">
              <div className="settings-section-head">
                <div>
                  <span className="eyebrow">👤 Perfil</span>
                  <h3 className="section-title section-title-small">Identidad de la tienda</h3>
                  <p className="subtitle">
                    Ajusta el nombre y el slug con el que tu tienda se muestra dentro del portal.
                  </p>
                </div>
              </div>

              <TenantProfileForm shop={primaryShop} />
            </Card>

            <Card className="stack settings-section-card portal-glass-card">
              <div className="settings-section-head">
                <div>
                  <span className="eyebrow">🔗 Integraciones</span>
                  <h3 className="section-title section-title-small">Conexión Shopify</h3>
                  <p className="subtitle">
                    Conecta tu tienda, revisa la última sincronización y lanza importaciones manuales sin depender del equipo interno.
                  </p>
                </div>
              </div>

              {integrationsError ? <div className="info-banner">{integrationsError}</div> : null}
              <TenantShopifyPanel integration={activeIntegration} shop={primaryShop} />
            </Card>
          </div>

          <Card className="stack settings-section-card portal-glass-card">
            <div className="settings-section-head">
              <div>
                <span className="eyebrow">🚚 Expediciones</span>
                <h3 className="section-title section-title-small">Configuración operativa</h3>
                <p className="subtitle">
                  Define la dirección de expedición de tu tienda y los defaults que usará el flujo de etiquetas CTT.
                </p>
              </div>
            </div>

            <ShopShippingSettingsForm shop={primaryShop} submitLabel="Guardar configuración de expediciones" />
          </Card>

          <Card className="stack settings-section-card portal-glass-card">
            {catalogError ? <div className="info-banner">{catalogError}</div> : null}
            <ShopCatalogManager products={catalogProducts} shop={primaryShop} />
          </Card>
        </>
      ) : (
        <Card className="stack portal-glass-card">
          <EmptyState
            title="Todavía no tienes una tienda asignada"
            description="Cuando tu perfil tenga una tienda vinculada, desde aquí podrás editar la identidad, conectar Shopify y gobernar tu catálogo."
          />
        </Card>
      )}
    </div>
  );
}
