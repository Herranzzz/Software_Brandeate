import Link from "next/link";

import { Card } from "@/components/card";
import { FaqAccordion } from "@/components/faq-accordion";
import { HelpCategoryCard } from "@/components/help-category-card";
import { PageHeader } from "@/components/page-header";
import { StatusGuide } from "@/components/status-guide";
import { fetchMyShops, requirePortalUser } from "@/lib/auth";
import { resolveTenantScope } from "@/lib/tenant-scope";


type PortalHelpPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function PortalHelpPage({ searchParams }: PortalHelpPageProps) {
  await requirePortalUser();
  const shops = await fetchMyShops();
  const params = (await searchParams) ?? {};
  const query = (readValue(params.q) ?? "").trim().toLowerCase();
  const tenantScope = resolveTenantScope(shops, readValue(params.shop_id));
  const primaryShop = tenantScope.selectedShop ?? shops[0] ?? null;
  const shopQuery = tenantScope.selectedShopId ? `?shop_id=${tenantScope.selectedShopId}` : "";

  const quickActions = [
    {
      eyebrow: "Pedidos",
      title: "Estado de pedidos",
      description: "Entiende en qué fase está cada pedido y detecta qué necesita atención antes de que se convierta en problema.",
      href: `/portal/orders${shopQuery}`,
      cta: "Ver pedidos",
    },
    {
      eyebrow: "Envíos",
      title: "Estado de envíos",
      description: "Consulta tracking, últimas actualizaciones y señales de retraso para saber si el servicio va estable.",
      href: `/portal/shipments${shopQuery}`,
      cta: "Ver envíos",
    },
    {
      eyebrow: "Personalización",
      title: "Diseños y assets",
      description: "Aprende a interpretar cuándo un pedido tiene diseño listo, cuándo falta material y qué puede bloquear la preparación.",
      href: `/portal/orders${shopQuery}`,
      cta: "Revisar personalizados",
    },
    {
      eyebrow: "Incidencias",
      title: "Incidencias y devoluciones",
      description: "Abre un caso, sigue el estado y entiende el siguiente paso con lenguaje claro y sin burocracia.",
      href: `/portal/returns${shopQuery}`,
      cta: "Abrir devoluciones",
    },
    {
      eyebrow: "Shopify",
      title: "Sincronización de Shopify",
      description: "Comprueba si la tienda está bien conectada, cuándo fue la última sync y cómo actuar si algo no entra.",
      href: `/portal/settings${shopQuery}`,
      cta: "Ir a Ajustes",
    },
    {
      eyebrow: "Soporte",
      title: "Contacto y escalado",
      description: "Cuando algo necesita ayuda humana, aquí tienes el camino corto para contactar con nosotros con contexto suficiente.",
      href: `/portal/help${shopQuery}#support`,
      cta: "Ver soporte",
    },
  ];

  const faqItems = [
    {
      question: "¿Por qué un pedido aparece como pendiente?",
      answer: "Normalmente significa que el pedido ha entrado en el sistema, pero aún no ha pasado a preparación o todavía no tiene shipment creado. Si se mantiene así demasiado tiempo, conviene revisar la sección de pedidos o contactar con soporte.",
    },
    {
      question: "¿Qué significa “Diseño disponible”?",
      answer: "Significa que el pedido personalizado ya tiene diseño o material suficiente para avanzar. En ese punto el equipo puede seguir con la producción sin esperar nuevos assets.",
    },
    {
      question: "¿Qué pasa si falta un asset del cliente?",
      answer: "El pedido puede quedar bloqueado hasta que exista el archivo, enlace o material necesario. Lo verás como pendiente de asset o sin diseño, y suele requerir una acción tuya o una revisión conjunta.",
    },
    {
      question: "¿Cómo sé si un envío está atascado?",
      answer: "Si el tracking no muestra movimiento desde hace demasiado tiempo o aparece en excepción, el portal lo reflejará como una señal de riesgo. En ese caso revisa la ficha del pedido o abre incidencia.",
    },
    {
      question: "¿Qué significa una incidencia?",
      answer: "Una incidencia indica que hay una desviación respecto al flujo esperado: puede ser logística, de personalización, de material o de datos. La ficha del caso te dirá qué está pasando y cuál es el siguiente paso.",
    },
    {
      question: "¿Cómo se actualiza Shopify?",
      answer: "La plataforma sincroniza automáticamente cuando la integración está activa. Además, desde Ajustes puedes revisar la última sincronización y lanzar una actualización manual si hace falta.",
    },
    {
      question: "¿Cuándo se actualizan mis pedidos?",
      answer: "Depende de la frecuencia de sincronización activa y de la llegada de eventos de tracking. Siempre mostramos el último estado conocido y la última sync para que tengas contexto.",
    },
    {
      question: "¿Dónde puedo ver el tracking?",
      answer: "Dentro de pedidos y envíos verás el tracking del carrier, el enlace oficial y el último evento disponible. Si aún no existe, aparecerá como pendiente.",
    },
    {
      question: "¿Qué ocurre si un envío está en excepción?",
      answer: "Quiere decir que el carrier ha informado de una incidencia o una situación fuera de flujo normal. Lo recomendable es abrir la ficha del pedido y, si sigue sin resolverse, contactar con soporte.",
    },
    {
      question: "¿Cómo contactar soporte?",
      answer: "Puedes usar la sección de ayuda como punto de escalado y abrir un caso desde devoluciones o incidencias. Si necesitas contexto humano rápido, usa el acceso de soporte que aparece más abajo.",
    },
  ];

  const filteredFaqs = query
    ? faqItems.filter((item) => `${item.question} ${item.answer}`.toLowerCase().includes(query))
    : faqItems;

  const quickGuides = [
    {
      title: "Cómo revisar un pedido",
      steps: [
        "Abre Pedidos y busca por número, nombre, email o tracking.",
        "Revisa el estado principal y la última actualización del pedido.",
        "Entra en la ficha si necesitas ver diseño, timeline o seguimiento oficial.",
      ],
    },
    {
      title: "Cómo ver el estado del envío",
      steps: [
        "Consulta el bloque de tracking y el estado del carrier.",
        "Si existe enlace oficial, úsalo para ver el seguimiento completo.",
        "Si no hay movimiento reciente, trátalo como señal de atención.",
      ],
    },
    {
      title: "Cómo saber si un personalizado está listo",
      steps: [
        "Busca el estado de personalización dentro del pedido.",
        "Diseño disponible significa que el trabajo creativo ya no bloquea el flujo.",
        "Pendiente de asset o sin diseño indica que todavía falta material o validación.",
      ],
    },
    {
      title: "Cómo detectar un problema rápido",
      steps: [
        "Revisa incidencias abiertas, tracking parado o envíos en excepción.",
        "Si el pedido lleva demasiado tiempo sin cambiar, entra al detalle.",
        "Si sigue sin estar claro, abre un caso desde devoluciones/incidencias.",
      ],
    },
  ];

  const tips = [
    "Si tienes una sola tienda, el portal ya filtra todo automáticamente a tu cuenta.",
    "Cuando un tracking existe, lo más fiable siempre será el último evento del carrier.",
    "Los pedidos personalizados necesitan diseño o assets válidos antes de avanzar sin fricción.",
  ];

  return (
    <div className="stack help-page">
      <PageHeader
        eyebrow="Ayuda"
        title="Resuelve dudas sobre pedidos, envíos y personalización"
        description="Un centro de ayuda pensado para darte claridad, contexto y un siguiente paso rápido sin depender siempre de soporte."
      />

      <Card className="portal-glass-card help-hero-card">
        <div className="help-hero-top">
          <div className="help-hero-copy">
            <span className="eyebrow">Centro de ayuda</span>
            <h3 className="section-title section-title-small">
              {primaryShop ? `Acompañamiento operativo para ${primaryShop.name}` : "Acompañamiento operativo para tu tienda"}
            </h3>
            <p className="subtitle">
              Encuentra respuestas rápidas sobre estados, incidencias, envíos y pedidos personalizados. La idea es que tengas contexto suficiente para decidir sin navegar a ciegas.
            </p>
          </div>

          <form action="/portal/help" className="help-search-form" method="get">
            {tenantScope.selectedShopId ? <input name="shop_id" type="hidden" value={tenantScope.selectedShopId} /> : null}
            <label className="help-search-label" htmlFor="portal-help-query">
              Buscar en ayuda
            </label>
            <div className="help-search-row">
              <input
                className="help-search-input"
                defaultValue={query}
                id="portal-help-query"
                name="q"
                placeholder="Pedidos, tracking, diseño, Shopify, incidencias..."
                type="search"
              />
              <button className="button button-secondary" type="submit">
                Buscar
              </button>
            </div>
          </form>
        </div>

        <div className="help-inline-list">
          <div className="help-inline-item">
            <strong>Lee el estado real</strong>
            <span>Pedidos, envíos y personalización con lenguaje claro para que sepas qué pasa sin interpretar códigos internos.</span>
          </div>
          <div className="help-inline-item">
            <strong>Detecta riesgos antes</strong>
            <span>Tracking parado, falta de assets, incidencias o pedidos bloqueados explicados de forma comprensible.</span>
          </div>
          <div className="help-inline-item">
            <strong>Escala con contexto</strong>
            <span>Cuando necesites ayuda humana, tendrás una ruta clara y un punto de contacto más útil que un FAQ frío.</span>
          </div>
        </div>
      </Card>

      <section className="help-resource-grid">
        {quickActions.map((action) => (
          <Card className="portal-glass-card help-resource-card" key={action.title}>
            <HelpCategoryCard {...action} />
          </Card>
        ))}
      </section>

      <section className="help-status-grid">
        <StatusGuide
          description="Estados simples para entender en qué fase se encuentra la operativa del pedido."
          items={[
            { label: "Pendiente", description: "El pedido ha entrado pero todavía no ha avanzado a una fase posterior.", badgeClassName: "badge-status-pending" },
            { label: "En progreso", description: "Ya se está trabajando en él o está dentro del flujo activo.", badgeClassName: "badge-status-in-progress" },
            { label: "Enviado", description: "El shipment ya existe y el pedido ha salido del almacén.", badgeClassName: "badge-status-shipped" },
            { label: "Entregado", description: "La entrega ya se ha completado correctamente.", badgeClassName: "badge-status-delivered" },
            { label: "Excepción", description: "Hay una desviación, incidencia o situación fuera del flujo normal.", badgeClassName: "badge-status-exception" },
          ]}
          title="Cómo interpretar los estados del pedido"
        />
        <StatusGuide
          description="Claves para entender en qué punto está un pedido personalizado dentro del flujo creativo y productivo."
          items={[
            { label: "Diseño disponible", description: "El pedido ya tiene diseño o material suficiente para avanzar.", badgeClassName: "badge-status-delivered" },
            { label: "Pendiente de asset", description: "Falta material, archivo o información para seguir con normalidad.", badgeClassName: "badge-status-ready-to-ship" },
            { label: "Sin diseño", description: "Todavía no existe diseño asociado o no se ha enlazado correctamente.", badgeClassName: "badge-status-pending" },
            { label: "En producción", description: "El equipo ya está preparando físicamente el pedido.", badgeClassName: "badge-status-in-progress" },
            { label: "Empaquetado", description: "La fase de preparación interna está completada y listo para salir.", badgeClassName: "badge-status-ready-to-ship" },
          ]}
          title="Cómo interpretar personalización y producción"
        />
        <StatusGuide
          description="Referencia rápida para leer los estados del carrier sin necesidad de conocimiento logístico previo."
          items={[
            { label: "Pendiente", description: "Aún no existe movimiento del carrier o el envío no ha arrancado.", badgeClassName: "badge-status-pending" },
            { label: "En tránsito", description: "El envío está en red y moviéndose entre nodos logísticos.", badgeClassName: "badge-status-shipped" },
            { label: "En reparto", description: "El envío está en última milla o muy cerca de entregarse.", badgeClassName: "badge-status-out-for-delivery" },
            { label: "Entregado", description: "El carrier ha confirmado la entrega.", badgeClassName: "badge-status-delivered" },
            { label: "Incidencia", description: "El carrier ha marcado una excepción o hay una situación a revisar.", badgeClassName: "badge-status-exception" },
          ]}
          title="Cómo interpretar los estados de envío"
        />
      </section>

      <section className="help-content-grid">
        <Card className="portal-glass-card stack">
          <div className="section-header-inline">
            <div>
              <span className="eyebrow">Preguntas frecuentes</span>
              <h3 className="section-title section-title-small">Respuestas rápidas y directas</h3>
              <p className="subtitle">Pensadas para que puedas entender el portal y la operativa sin jerga innecesaria.</p>
            </div>
          </div>
          {filteredFaqs.length > 0 ? (
            <FaqAccordion items={filteredFaqs} />
          ) : (
            <div className="help-empty-state">
              <strong>No hemos encontrado resultados para tu búsqueda.</strong>
              <span>Prueba con términos como tracking, diseño, Shopify, pendiente o incidencia.</span>
            </div>
          )}
        </Card>

        <div className="help-side-stack">
          <Card className="portal-glass-card stack">
            <div className="section-header-inline">
              <div>
                <span className="eyebrow">Guías rápidas</span>
                <h3 className="section-title section-title-small">Cómo usar el portal sin fricción</h3>
              </div>
            </div>
            <div className="help-guide-list">
              {quickGuides.map((guide) => (
                <article className="help-guide-card" key={guide.title}>
                  <strong>{guide.title}</strong>
                  <ol className="help-guide-steps">
                    {guide.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                </article>
              ))}
            </div>
          </Card>

          <Card className="portal-glass-card stack" id="support">
            <div className="section-header-inline">
              <div>
                <span className="eyebrow">Soporte</span>
                <h3 className="section-title section-title-small">¿Necesitas ayuda humana?</h3>
              </div>
            </div>
            <p className="subtitle">
              Si ya has revisado el pedido, el tracking o la incidencia y aún necesitas apoyo, usa uno de estos caminos para escalarlo con contexto.
            </p>
            <div className="help-support-actions">
              <Link className="button button-secondary" href={`/portal/returns${shopQuery}`}>
                Abrir incidencia
              </Link>
              <Link className="button button-secondary" href={`/portal/orders${shopQuery}`}>
                Revisar pedidos
              </Link>
              <Link className="button button-secondary" href={`/portal/settings${shopQuery}`}>
                Revisar conexión Shopify
              </Link>
            </div>
            <div className="help-support-note">
              <strong>Consejo</strong>
              <span>Cuando contactes con soporte, incluir número de pedido, tracking y motivo acelera mucho la resolución.</span>
            </div>
          </Card>
        </div>
      </section>

      <Card className="portal-glass-card stack">
        <div className="section-header-inline">
          <div>
            <span className="eyebrow">Consejos y actualizaciones</span>
            <h3 className="section-title section-title-small">Pequeñas claves para usar mejor el portal</h3>
          </div>
        </div>
        <div className="help-tip-grid">
          {tips.map((tip) => (
            <article className="help-tip-card" key={tip}>
              <span className="help-tip-marker" />
              <p>{tip}</p>
            </article>
          ))}
        </div>
      </Card>
    </div>
  );
}
