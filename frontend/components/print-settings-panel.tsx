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
          <strong>Importante para que funcione realmente sin diálogo:</strong>
          <ol style={{ margin: "0.5rem 0 0 1.2rem", padding: 0 }}>
            <li>Descarga y usa el acceso directo de abajo para abrir Brandeate en Chrome con el flag <code>--kiosk-printing</code>.</li>
            <li>Configura la impresora de etiquetas como <strong>impresora predeterminada del sistema</strong>.</li>
            <li>Abre la web desde ese acceso directo (no desde Chrome normal).</li>
          </ol>
          <p style={{ marginTop: "0.5rem" }} className="muted">
            Si activas esta opción sin usar el acceso directo, el navegador seguirá mostrando el
            diálogo de impresión — es una limitación de Chrome, no del sistema.
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
            Ejecuta el script y usa el acceso directo creado para abrir Brandeate con
            impresión silenciosa habilitada a nivel navegador.
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
