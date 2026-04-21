"use client";

import { useEffect, useState } from "react";

import { Card } from "@/components/card";
import { useToast } from "@/components/toast";
import {
  isSilentPrintEnabled,
  printLabel,
  setSilentPrintEnabled,
} from "@/lib/print-utils";


function detectOS(): "windows" | "mac" | "other" {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("win")) return "windows";
  if (ua.includes("mac")) return "mac";
  return "other";
}

/**
 * Per-device settings panel for silent label printing.
 *
 * Silent printing requires Chrome launched with the `--kiosk-printing` flag.
 * Without that flag the browser's normal print dialog still appears, which
 * is why this is behind an opt-in toggle stored per device in localStorage.
 */
export function PrintSettingsPanel() {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [testTracking, setTestTracking] = useState("");
  const [isTesting, setIsTesting] = useState(false);
  const [os, setOs] = useState<"windows" | "mac" | "other">("other");

  useEffect(() => {
    setEnabled(isSilentPrintEnabled());
    setOs(detectOS());
    setHydrated(true);
  }, []);

  function onToggle(next: boolean) {
    setSilentPrintEnabled(next);
    setEnabled(next);
    toast(
      next
        ? "Impresión silenciosa activada en este dispositivo"
        : "Impresión silenciosa desactivada — las etiquetas se descargarán",
      "success",
    );
  }

  function downloadKioskScript() {
    const osParam = os === "mac" ? "mac" : "windows";
    window.location.href = `/api/kiosk-script?os=${osParam}`;
  }

  async function runTest() {
    const code = testTracking.trim();
    if (!code) {
      toast("Introduce un tracking code para la prueba", "warning");
      return;
    }
    setIsTesting(true);
    try {
      await printLabel(code, { format: "PDF", forceSilent: true });
      toast("Trabajo de impresión enviado. Revisa la impresora.", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Error en la prueba de impresión", "error");
    } finally {
      setIsTesting(false);
    }
  }

  if (!hydrated) {
    return (
      <Card className="stack settings-section-card">
        <div className="muted">Cargando preferencias de impresión...</div>
      </Card>
    );
  }

  return (
    <div className="stack">
      <Card className="stack settings-section-card">
        <div className="settings-section-head">
          <div>
            <span className="eyebrow">🖨️ Impresión de etiquetas</span>
            <h3 className="section-title section-title-small">Impresión silenciosa</h3>
            <p className="subtitle">
              Activa este modo para que al pulsar <strong>Imprimir</strong> la etiqueta vaya
              directamente a la impresora, sin diálogo y sin descarga, en este dispositivo.
            </p>
          </div>
        </div>

        <label className="toggle-row" style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onToggle(e.target.checked)}
          />
          <div>
            <strong>{enabled ? "Activada" : "Desactivada"}</strong>
            <div className="muted" style={{ fontSize: "0.875rem" }}>
              {enabled
                ? "Este dispositivo imprimirá las etiquetas directamente."
                : "Este dispositivo descargará el PDF para que lo imprimas manualmente."}
            </div>
          </div>
        </label>

        <div className="feedback feedback-info">
          <strong>Cómo instalarlo (5 minutos, una sola vez):</strong>
          <ol style={{ margin: "0.5rem 0 0 1.2rem", padding: 0, display: "grid", gap: "0.4rem" }}>
            <li>
              <strong>Configura la impresora de etiquetas como predeterminada del sistema.</strong>{" "}
              {os === "mac" ? (
                <>Ajustes del sistema → Impresoras y escáneres → clic derecho sobre tu impresora de etiquetas → <em>Establecer impresora predeterminada</em>.</>
              ) : os === "windows" ? (
                <>Configuración → Bluetooth y dispositivos → Impresoras y escáneres → selecciona tu impresora → <em>Establecer como predeterminada</em>. Desactiva también <em>«Permitir que Windows administre mi impresora predeterminada»</em>.</>
              ) : (
                <>En los ajustes del sistema, marca la impresora térmica como predeterminada.</>
              )}
            </li>
            <li>
              <strong>Descarga el acceso directo</strong> con el botón de abajo y guárdalo en el escritorio.
              {os === "mac" && (
                <> La primera vez tendrás que darle permiso: clic derecho sobre el archivo <code>.command</code> → <em>Abrir</em> → <em>Abrir</em> de nuevo en el aviso de seguridad.</>
              )}
            </li>
            <li>
              <strong>Activa el toggle</strong> de arriba en este dispositivo.
            </li>
            <li>
              <strong>Usa siempre ese acceso directo</strong> para abrir Brandeate cuando vayas a imprimir etiquetas. Al hacer doble clic, Chrome se cerrará y volverá a abrirse con tu perfil de siempre (tu sesión iniciada, tus bookmarks), pero con el modo de impresión silenciosa activo. No es una ventana de invitado.
            </li>
            <li>
              <strong>Prueba la impresión</strong> en la sección de abajo para confirmar que funciona antes de ponerlo en producción.
            </li>
          </ol>
          <p style={{ marginTop: "0.75rem" }} className="muted">
            ⚠️ Si abres Brandeate desde un Chrome que ya estaba abierto a mano (no desde el acceso directo), seguirá apareciendo el diálogo de impresión. Es una limitación de Chrome: la flag <code>--kiosk-printing</code> solo se aplica cuando el navegador arranca con ella. Por eso el acceso directo cierra Chrome antes de relanzarlo.
          </p>
        </div>

        <div className="stack-xs">
          <button className="button" onClick={downloadKioskScript} type="button">
            {os === "mac"
              ? "⬇ Descargar acceso directo (Mac)"
              : os === "windows"
                ? "⬇ Descargar acceso directo (Windows)"
                : "⬇ Descargar acceso directo"}
          </button>
          <p className="muted" style={{ fontSize: "0.875rem", marginTop: "0.4rem" }}>
            {os === "mac"
              ? "Archivo .command. Guárdalo en el escritorio y ábrelo con doble clic (la primera vez con clic derecho → Abrir)."
              : os === "windows"
                ? "Archivo .bat. Guárdalo en el escritorio y ábrelo con doble clic. Si Windows SmartScreen avisa: «Más información → Ejecutar de todas formas»."
                : "Guarda el archivo y ábrelo con doble clic para arrancar Chrome con impresión silenciosa."}
          </p>
        </div>
      </Card>

      <Card className="stack settings-section-card">
        <div className="settings-section-head">
          <div>
            <span className="eyebrow">🧪 Prueba rápida</span>
            <h3 className="section-title section-title-small">Probar impresión silenciosa</h3>
            <p className="subtitle">
              Introduce un código de seguimiento ya existente y pulsa <strong>Probar</strong>.
              La prueba fuerza el modo silencioso independientemente del toggle para que puedas
              validar la configuración antes de activarlo en toda la operativa.
            </p>
          </div>
        </div>

        <div className="grid grid-2">
          <div className="field">
            <label htmlFor="test-tracking">Tracking code</label>
            <input
              id="test-tracking"
              onChange={(e) => setTestTracking(e.target.value)}
              placeholder="Ej: 0000000000000000"
              value={testTracking}
            />
          </div>
          <div className="field" style={{ alignSelf: "end" }}>
            <button
              className="button"
              disabled={isTesting || !testTracking.trim()}
              onClick={runTest}
              type="button"
            >
              {isTesting ? "Enviando..." : "Probar impresión"}
            </button>
          </div>
        </div>

        <p className="muted" style={{ fontSize: "0.875rem" }}>
          ¿No imprime sin diálogo? Revisa que Chrome esté abierto desde el acceso directo y
          que la impresora térmica sea la predeterminada del sistema. Si aparece el diálogo,
          confírmalo una vez y Chrome memorizará la impresora.
        </p>
      </Card>
    </div>
  );
}
