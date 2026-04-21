"use client";

import { useMemo, useState } from "react";

type Zone = {
  id: string;
  label: string;
  countries: string[];
  /** Transit days range (business). */
  transit: [number, number];
  /** Base rate in EUR for the first weight tier. */
  base: number;
  /** EUR per extra kg above 1kg. */
  perKg: number;
};

const ZONES: Zone[] = [
  { id: "es_peninsula", label: "España península", countries: ["ES"], transit: [1, 2], base: 3.95, perKg: 0.6 },
  { id: "es_baleares",  label: "Baleares",          countries: ["ES-PM"], transit: [2, 3], base: 6.50, perKg: 1.2 },
  { id: "es_canarias",  label: "Canarias",          countries: ["ES-CN"], transit: [3, 5], base: 9.90, perKg: 2.1 },
  { id: "pt",           label: "Portugal",           countries: ["PT"], transit: [2, 3], base: 4.80, perKg: 0.9 },
  { id: "eu_z1",        label: "UE Zona 1 (FR · DE · IT · BE · NL · LU)", countries: ["FR","DE","IT","BE","NL","LU"], transit: [2, 4], base: 7.95, perKg: 1.6 },
  { id: "eu_z2",        label: "UE Zona 2 (resto UE)", countries: ["AT","DK","FI","IE","SE","PL","CZ","GR"], transit: [3, 6], base: 12.50, perKg: 2.4 },
  { id: "uk",           label: "Reino Unido",        countries: ["GB"], transit: [4, 7], base: 15.00, perKg: 3.0 },
  { id: "world",        label: "Resto del mundo",    countries: ["US","MX","CA","AR","CL","AU","JP"], transit: [6, 12], base: 24.90, perKg: 5.5 },
];

type Service = {
  id: "standard" | "express" | "economy";
  label: string;
  multiplier: number;
  transitShift: number;
  badge: string;
};

const SERVICES: Service[] = [
  { id: "economy",  label: "Economy",  multiplier: 0.88, transitShift: 1,  badge: "🌱" },
  { id: "standard", label: "Standard", multiplier: 1.00, transitShift: 0,  badge: "📦" },
  { id: "express",  label: "Express",  multiplier: 1.45, transitShift: -1, badge: "⚡" },
];

type Carrier = {
  id: string;
  label: string;
  adj: number;
  note: string;
};

const CARRIERS: Carrier[] = [
  { id: "ctt",       label: "CTT Express",     adj: 1.00, note: "Integración nativa" },
  { id: "seur",      label: "SEUR",            adj: 1.08, note: "Cobertura nacional" },
  { id: "correos",   label: "Correos",         adj: 0.95, note: "Punto de entrega amplio" },
  { id: "gls",       label: "GLS",             adj: 1.04, note: "Fuerte en Europa" },
  { id: "ups",       label: "UPS",             adj: 1.18, note: "Premium internacional" },
];

function volumetricKg(l: number, w: number, h: number) {
  // Industry standard for road/parcel: L×W×H (cm) / 5000
  return (l * w * h) / 5000;
}

function calcPrice(weightKg: number, zone: Zone, service: Service, carrier: Carrier) {
  const billable = Math.max(weightKg, 0.1);
  const base = zone.base + Math.max(billable - 1, 0) * zone.perKg;
  return Math.round(base * service.multiplier * carrier.adj * 100) / 100;
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
    const rows = CARRIERS.flatMap((carrier) =>
      SERVICES.map((service) => ({
        carrier,
        service,
        price: calcPrice(billableKg, zone, service, carrier),
        eta: formatTransit(zone, service),
      })),
    );
    const insurance = insured ? Math.max((parseFloat(declaredValue) || 0) * 0.012, 1.5) : 0;
    return rows
      .map((r) => ({ ...r, total: Math.round((r.price + insurance) * 100) / 100, insurance }))
      .sort((a, b) => a.total - b.total);
  }, [billableKg, zone, insured, declaredValue]);

  const cheapest = quotes[0];
  const fastest = [...quotes].sort((a, b) => {
    const aSh = a.service.transitShift;
    const bSh = b.service.transitShift;
    return aSh - bSh || a.total - b.total;
  })[0];

  return (
    <div className="stack">
      <div className="calc-grid">
        {/* ── Inputs ─────────────────────────────────────────────────── */}
        <section className="card calc-form-card portal-glass-card">
          <header className="calc-form-head">
            <span className="eyebrow">📐 Paquete</span>
            <h3 className="section-title section-title-small">Dime cómo es tu envío</h3>
            <p className="subtitle">Calculamos el precio estimado comparando carriers y servicios.</p>
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
          {cheapest ? (
            <article className="card calc-highlight calc-highlight-cheap">
              <span className="eyebrow">💶 Opción más barata</span>
              <h3 className="calc-highlight-price">{cheapest.total.toFixed(2)} €</h3>
              <p className="calc-highlight-line">
                <strong>{cheapest.carrier.label}</strong> · {cheapest.service.badge} {cheapest.service.label}
              </p>
              <p className="calc-highlight-sub">{cheapest.eta}</p>
            </article>
          ) : null}
          {fastest && fastest !== cheapest ? (
            <article className="card calc-highlight calc-highlight-fast">
              <span className="eyebrow">⚡ Entrega más rápida</span>
              <h3 className="calc-highlight-price">{fastest.total.toFixed(2)} €</h3>
              <p className="calc-highlight-line">
                <strong>{fastest.carrier.label}</strong> · {fastest.service.badge} {fastest.service.label}
              </p>
              <p className="calc-highlight-sub">{fastest.eta}</p>
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
              Precios orientativos sin IVA. El coste definitivo depende de tu contrato y del origen del envío.
            </p>
          </article>
        </section>
      </div>

      {/* ── Quote table ───────────────────────────────────────────────── */}
      <section className="card portal-glass-card stack">
        <header className="calc-form-head">
          <span className="eyebrow">📋 Comparativa</span>
          <h3 className="section-title section-title-small">Tarifas estimadas ({quotes.length} opciones)</h3>
          <p className="subtitle">Ordenado de más barato a más caro. Haz clic para seleccionar.</p>
        </header>
        <div className="calc-quote-table">
          <div className="calc-quote-head">
            <span>Carrier</span>
            <span>Servicio</span>
            <span>Tránsito</span>
            <span>Base</span>
            <span>Seguro</span>
            <span>Total</span>
          </div>
          {quotes.map((q) => (
            <div key={`${q.carrier.id}-${q.service.id}`} className="calc-quote-row">
              <span>
                <strong>{q.carrier.label}</strong>
                <small>{q.carrier.note}</small>
              </span>
              <span>
                <strong>{q.service.badge} {q.service.label}</strong>
              </span>
              <span>{q.eta}</span>
              <span>{q.price.toFixed(2)} €</span>
              <span>{q.insurance.toFixed(2)} €</span>
              <span className="calc-quote-total">{q.total.toFixed(2)} €</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
