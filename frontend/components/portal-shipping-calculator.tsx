"use client";

import { useMemo, useState } from "react";

/**
 * NOTA: Brandeate es un 3PL con un único carrier. Las tarifas que aparecen
 * más abajo son placeholders editables por zona/servicio — el cliente
 * facilitará la tabla oficial de precios y este archivo será la única
 * fuente de verdad a ajustar.
 *
 * Estructura:
 *   - ZONES: tramos geográficos con tarifa base (primer kilo) y precio por kg extra.
 *   - SERVICES: niveles de servicio del carrier (economy/standard/express).
 */

type Zone = {
  id: string;
  label: string;
  /** Transit days range (business). */
  transit: [number, number];
  /** Base rate in EUR for the first weight tier. */
  base: number;
  /** EUR per extra kg above 1kg. */
  perKg: number;
};

const ZONES: Zone[] = [
  { id: "es_peninsula", label: "España península", transit: [1, 2], base: 3.95, perKg: 0.6 },
  { id: "es_baleares",  label: "Baleares",          transit: [2, 3], base: 6.50, perKg: 1.2 },
  { id: "es_canarias",  label: "Canarias",          transit: [3, 5], base: 9.90, perKg: 2.1 },
  { id: "pt",           label: "Portugal",           transit: [2, 3], base: 4.80, perKg: 0.9 },
  { id: "eu_z1",        label: "UE Zona 1 (FR · DE · IT · BE · NL · LU)", transit: [2, 4], base: 7.95, perKg: 1.6 },
  { id: "eu_z2",        label: "UE Zona 2 (resto UE)", transit: [3, 6], base: 12.50, perKg: 2.4 },
  { id: "uk",           label: "Reino Unido",        transit: [4, 7], base: 15.00, perKg: 3.0 },
  { id: "world",        label: "Resto del mundo",    transit: [6, 12], base: 24.90, perKg: 5.5 },
];

type Service = {
  id: "standard" | "express" | "economy";
  label: string;
  description: string;
  multiplier: number;
  transitShift: number;
  badge: string;
};

const SERVICES: Service[] = [
  { id: "economy",  label: "Economy",  description: "Plazo extendido, menor coste.", multiplier: 0.88, transitShift: 1,  badge: "🌱" },
  { id: "standard", label: "Standard", description: "Nuestra opción recomendada.",   multiplier: 1.00, transitShift: 0,  badge: "📦" },
  { id: "express",  label: "Express",  description: "Entrega prioritaria.",          multiplier: 1.45, transitShift: -1, badge: "⚡" },
];

function volumetricKg(l: number, w: number, h: number) {
  // Estándar del carrier para paquetería terrestre: L×A×H (cm) / 5000
  return (l * w * h) / 5000;
}

function calcPrice(weightKg: number, zone: Zone, service: Service) {
  const billable = Math.max(weightKg, 0.1);
  const base = zone.base + Math.max(billable - 1, 0) * zone.perKg;
  return Math.round(base * service.multiplier * 100) / 100;
}

function formatTransit(zone: Zone, service: Service) {
  const lo = Math.max(zone.transit[0] + service.transitShift, 1);
  const hi = Math.max(zone.transit[1] + service.transitShift, lo);
  return lo === hi ? `${lo} día laborable` : `${lo}–${hi} días laborables`;
}

export function PortalShippingCalculator() {
  const [zoneId, setZoneId] = useState<string>(ZONES[0].id);
  const [weight, setWeight] = useState<string>("1");
  const [length, setLength] = useState<string>("30");
  const [width, setWidth] = useState<string>("20");
  const [height, setHeight] = useState<string>("10");
  const [insured, setInsured] = useState(false);
  const [declaredValue, setDeclaredValue] = useState<string>("0");

  const zone = ZONES.find((z) => z.id === zoneId) ?? ZONES[0];
  const realKg = Math.max(parseFloat(weight) || 0, 0);
  const volKg = volumetricKg(parseFloat(length) || 0, parseFloat(width) || 0, parseFloat(height) || 0);
  const billableKg = Math.max(realKg, volKg);

  const quotes = useMemo(() => {
    const insurance = insured ? Math.max((parseFloat(declaredValue) || 0) * 0.012, 1.5) : 0;
    return SERVICES.map((service) => {
      const price = calcPrice(billableKg, zone, service);
      return {
        service,
        price,
        insurance,
        total: Math.round((price + insurance) * 100) / 100,
        eta: formatTransit(zone, service),
      };
    });
  }, [billableKg, zone, insured, declaredValue]);

  const recommended = quotes.find((q) => q.service.id === "standard") ?? quotes[0];
  const cheapest = [...quotes].sort((a, b) => a.total - b.total)[0];

  return (
    <div className="stack">
      <div className="calc-grid">
        {/* ── Inputs ─────────────────────────────────────────────────── */}
        <section className="card calc-form-card portal-glass-card">
          <header className="calc-form-head">
            <span className="eyebrow">📐 Paquete</span>
            <h3 className="section-title section-title-small">Dime cómo es tu envío</h3>
            <p className="subtitle">Calcula el coste estimado por zona y nivel de servicio.</p>
          </header>

          <div className="calc-field">
            <label>Destino</label>
            <select value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
              {ZONES.map((z) => (
                <option key={z.id} value={z.id}>{z.label}</option>
              ))}
            </select>
          </div>

          <div className="calc-field">
            <label>Peso real (kg)</label>
            <input type="number" step="0.1" min="0" value={weight} onChange={(e) => setWeight(e.target.value)} />
          </div>

          <div className="calc-row">
            <div className="calc-field">
              <label>Largo (cm)</label>
              <input type="number" min="0" value={length} onChange={(e) => setLength(e.target.value)} />
            </div>
            <div className="calc-field">
              <label>Ancho (cm)</label>
              <input type="number" min="0" value={width} onChange={(e) => setWidth(e.target.value)} />
            </div>
            <div className="calc-field">
              <label>Alto (cm)</label>
              <input type="number" min="0" value={height} onChange={(e) => setHeight(e.target.value)} />
            </div>
          </div>

          <div className="calc-callouts">
            <div className="calc-callout">
              <span>Peso real</span>
              <strong>{realKg.toFixed(2)} kg</strong>
            </div>
            <div className="calc-callout">
              <span>Volumétrico</span>
              <strong>{volKg.toFixed(2)} kg</strong>
            </div>
            <div className="calc-callout calc-callout-primary">
              <span>Facturable</span>
              <strong>{billableKg.toFixed(2)} kg</strong>
            </div>
          </div>

          <label className="calc-toggle">
            <input type="checkbox" checked={insured} onChange={(e) => setInsured(e.target.checked)} />
            <span>Añadir seguro todo-riesgo</span>
          </label>

          {insured ? (
            <div className="calc-field">
              <label>Valor declarado (€)</label>
              <input type="number" min="0" value={declaredValue} onChange={(e) => setDeclaredValue(e.target.value)} />
              <small className="calc-hint">Prima 1,2 % del valor · mínimo 1,50 €.</small>
            </div>
          ) : null}
        </section>

        {/* ── Highlights ────────────────────────────────────────────── */}
        <section className="stack calc-highlights">
          {recommended ? (
            <article className="card calc-highlight calc-highlight-cheap">
              <span className="eyebrow">✨ Opción recomendada</span>
              <h3 className="calc-highlight-price">{recommended.total.toFixed(2)} €</h3>
              <p className="calc-highlight-line">
                {recommended.service.badge} <strong>{recommended.service.label}</strong>
              </p>
              <p className="calc-highlight-sub">{recommended.eta}</p>
            </article>
          ) : null}
          <article className="card calc-insights portal-glass-card">
            <span className="eyebrow">🧠 Consejo Brandeate</span>
            <p>
              {volKg > realKg
                ? "Tu paquete factura por volumen. Ajusta la caja al producto para ahorrar hasta un 25 %."
                : "Tu paquete está bien optimizado. Si sube el peso, revisa las dimensiones."}
            </p>
            <p className="calc-insights-sub">
              Tarifas orientativas sin IVA. El coste definitivo depende del contrato activo con tu cuenta.
            </p>
          </article>
          {cheapest && cheapest.service.id !== recommended?.service.id ? (
            <article className="card calc-highlight calc-highlight-fast">
              <span className="eyebrow">💶 Opción más económica</span>
              <h3 className="calc-highlight-price">{cheapest.total.toFixed(2)} €</h3>
              <p className="calc-highlight-line">
                {cheapest.service.badge} <strong>{cheapest.service.label}</strong>
              </p>
              <p className="calc-highlight-sub">{cheapest.eta}</p>
            </article>
          ) : null}
        </section>
      </div>

      {/* ── Services table ───────────────────────────────────────────── */}
      <section className="card portal-glass-card stack">
        <header className="calc-form-head">
          <span className="eyebrow">📋 Niveles de servicio</span>
          <h3 className="section-title section-title-small">Elige cómo quieres que llegue tu envío</h3>
          <p className="subtitle">Mismo transportista, tres ritmos de entrega. Precios calculados para el paquete y zona de arriba.</p>
        </header>
        <div className="calc-service-grid">
          {quotes.map((q) => (
            <article key={q.service.id} className="calc-service-card">
              <header className="calc-service-head">
                <span className="calc-service-badge">{q.service.badge}</span>
                <div>
                  <strong>{q.service.label}</strong>
                  <small>{q.service.description}</small>
                </div>
              </header>
              <div className="calc-service-rows">
                <div><span>Tránsito estimado</span><strong>{q.eta}</strong></div>
                <div><span>Tarifa base</span><strong>{q.price.toFixed(2)} €</strong></div>
                <div><span>Seguro</span><strong>{q.insurance.toFixed(2)} €</strong></div>
              </div>
              <footer className="calc-service-total">
                <span>Total estimado</span>
                <strong>{q.total.toFixed(2)} €</strong>
              </footer>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
