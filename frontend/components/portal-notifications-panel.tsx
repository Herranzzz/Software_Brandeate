"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "brandeate.portal.notifications.v1";

type Channel = "email" | "sms" | "slack" | "inapp";

type EventKey =
  | "order_created"
  | "shipment_created"
  | "shipment_picked_up"
  | "shipment_in_transit"
  | "shipment_delivered"
  | "shipment_exception"
  | "incident_opened"
  | "incident_resolved"
  | "return_requested"
  | "invoice_ready";

type EventSpec = {
  key: EventKey;
  label: string;
  description: string;
  icon: string;
};

const EVENTS: EventSpec[] = [
  { key: "order_created",       label: "Nuevo pedido",           description: "Cada vez que entra un pedido en Brandeate.",           icon: "🆕" },
  { key: "shipment_created",    label: "Etiqueta creada",        description: "Cuando se genera la etiqueta de envío.",               icon: "🏷️" },
  { key: "shipment_picked_up",  label: "Recogido por el carrier", description: "El carrier ha recogido el paquete.",                   icon: "🚚" },
  { key: "shipment_in_transit", label: "En tránsito",            description: "El envío está en ruta hacia el destinatario.",         icon: "📦" },
  { key: "shipment_delivered",  label: "Entregado",              description: "El paquete ha llegado al cliente final.",              icon: "✅" },
  { key: "shipment_exception",  label: "Incidencia de envío",    description: "Retrasos, rechazos o direcciones incorrectas.",        icon: "🚨" },
  { key: "incident_opened",     label: "Nueva incidencia",       description: "Se abre una incidencia en un pedido.",                 icon: "⚠️" },
  { key: "incident_resolved",   label: "Incidencia resuelta",    description: "Cuando cerramos una incidencia como resuelta.",        icon: "🎉" },
  { key: "return_requested",    label: "Devolución solicitada",  description: "Un cliente solicita devolver un pedido.",              icon: "↩️" },
  { key: "invoice_ready",       label: "Factura disponible",     description: "Tu factura mensual está lista para descargar.",        icon: "💳" },
];

const CHANNELS: { key: Channel; label: string; icon: string }[] = [
  { key: "inapp", label: "En la app",  icon: "🔔" },
  { key: "email", label: "Email",      icon: "✉️" },
  { key: "sms",   label: "SMS",        icon: "📱" },
  { key: "slack", label: "Slack",      icon: "💬" },
];

type Preferences = Record<EventKey, Record<Channel, boolean>>;

function defaultPrefs(): Preferences {
  const base: Preferences = {} as Preferences;
  for (const e of EVENTS) {
    base[e.key] = {
      inapp: true,
      email: e.key === "shipment_exception" || e.key === "incident_opened" || e.key === "invoice_ready",
      sms: false,
      slack: false,
    };
  }
  return base;
}

function loadPrefs(): Preferences {
  if (typeof window === "undefined") return defaultPrefs();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultPrefs();
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    const defaults = defaultPrefs();
    for (const e of EVENTS) {
      defaults[e.key] = { ...defaults[e.key], ...(parsed[e.key] ?? {}) };
    }
    return defaults;
  } catch {
    return defaultPrefs();
  }
}

function persist(prefs: Preferences) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

export function PortalNotificationsPanel() {
  const [prefs, setPrefs] = useState<Preferences>(() => defaultPrefs());
  const [hydrated, setHydrated] = useState(false);
  const [digest, setDigest] = useState<"realtime" | "hourly" | "daily">("realtime");
  const [quietStart, setQuietStart] = useState("22:00");
  const [quietEnd, setQuietEnd] = useState("08:00");

  useEffect(() => {
    setPrefs(loadPrefs());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) persist(prefs);
  }, [prefs, hydrated]);

  function toggle(eventKey: EventKey, channel: Channel) {
    setPrefs((p) => ({
      ...p,
      [eventKey]: { ...p[eventKey], [channel]: !p[eventKey][channel] },
    }));
  }

  const activeCount = Object.values(prefs).reduce((s, row) => s + Object.values(row).filter(Boolean).length, 0);

  return (
    <div className="stack">
      <section className="card portal-glass-card stack">
        <div className="settings-section-head">
          <div>
            <span className="eyebrow">🔔 Preferencias</span>
            <h3 className="section-title section-title-small">Cómo quieres que te avisemos</h3>
            <p className="subtitle">
              Elige para cada evento los canales donde quieres recibir la notificación. {activeCount} canales activos.
            </p>
          </div>
        </div>

        <div className="notifs-table">
          <div className="notifs-head">
            <span>Evento</span>
            {CHANNELS.map((c) => (
              <span key={c.key} className="notifs-head-channel">{c.icon} {c.label}</span>
            ))}
          </div>
          {EVENTS.map((e) => (
            <div key={e.key} className="notifs-row">
              <div className="notifs-event">
                <span aria-hidden>{e.icon}</span>
                <div>
                  <strong>{e.label}</strong>
                  <small>{e.description}</small>
                </div>
              </div>
              {CHANNELS.map((c) => (
                <label key={c.key} className="notifs-cell">
                  <input
                    type="checkbox"
                    checked={prefs[e.key][c.key]}
                    onChange={() => toggle(e.key, c.key)}
                  />
                  <span className="notifs-cell-dot" />
                </label>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section className="card portal-glass-card stack">
        <div className="settings-section-head">
          <div>
            <span className="eyebrow">⏰ Frecuencia y silencio</span>
            <h3 className="section-title section-title-small">Agrupa avisos y protege tu descanso</h3>
            <p className="subtitle">
              Agrupa notificaciones no urgentes en un resumen, y define tu franja de silencio para no recibir emails de madrugada.
            </p>
          </div>
        </div>
        <div className="calc-row">
          <div className="calc-field">
            <label>Frecuencia por email</label>
            <select value={digest} onChange={(e) => setDigest(e.target.value as typeof digest)}>
              <option value="realtime">En tiempo real</option>
              <option value="hourly">Cada hora</option>
              <option value="daily">Resumen diario (09:00)</option>
            </select>
          </div>
          <div className="calc-field">
            <label>Silencio desde</label>
            <input type="time" value={quietStart} onChange={(e) => setQuietStart(e.target.value)} />
          </div>
          <div className="calc-field">
            <label>Silencio hasta</label>
            <input type="time" value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} />
          </div>
        </div>
        <p className="calc-hint">
          Los eventos críticos (incidencias urgentes, envíos exception) siempre se envían aunque estés en franja de silencio.
        </p>
      </section>
    </div>
  );
}
