"use client";

import { useState } from "react";

import { AppModal } from "@/components/app-modal";
import { getItemPrimaryAsset } from "@/lib/personalization";
import type { Order } from "@/lib/types";


type Phase = "confirm" | "loading" | "done" | "error";

type BulkDesignDownloadModalProps = {
  orders: Order[];
  onClose: () => void;
};

export function BulkDesignDownloadModal({ orders, onClose }: BulkDesignDownloadModalProps) {
  const [phase, setPhase] = useState<Phase>("confirm");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [downloadedCount, setDownloadedCount] = useState(0);
  const [totalWithDesign, setTotalWithDesign] = useState(0);
  const [failedCount, setFailedCount] = useState(0);

  // Quick client-side pre-check: how many orders have a detectable design
  const ordersWithDesign = orders.filter((o) =>
    o.items.some((item) => getItemPrimaryAsset(item) !== null || item.design_link),
  );
  const ordersWithoutDesign = orders.length - ordersWithDesign.length;

  async function handleDownload() {
    setPhase("loading");
    setErrorMsg(null);

    try {
      const response = await fetch("/api/orders/bulk/download-designs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_ids: orders.map((o) => o.id) }),
      });

      if (!response.ok) {
        const text = await response.text();
        let detail = "Error al generar la descarga de diseños.";
        try {
          const json = JSON.parse(text) as { detail?: string };
          if (json.detail) detail = json.detail;
        } catch {
          // non-JSON error body
        }
        throw new Error(detail);
      }

      const okCount = Number(response.headers.get("X-Design-Results") ?? "0");
      const failures = Number(response.headers.get("X-Design-Failures") ?? "0");
      setDownloadedCount(okCount);
      setTotalWithDesign(ordersWithDesign.length);
      setFailedCount(failures);

      // Trigger browser download
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = "diseños-bulk.zip";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);

      setPhase("done");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Error desconocido");
      setPhase("error");
    }
  }

  const isLoading = phase === "loading";

  return (
    <AppModal
      eyebrow="Producción"
      onClose={isLoading ? () => {} : onClose}
      open
      title="Descargar diseños en bulk"
      subtitle={`${orders.length} pedido${orders.length !== 1 ? "s" : ""} seleccionado${orders.length !== 1 ? "s" : ""}`}
      width="default"
      actions={
        phase === "done" || phase === "error" ? (
          <button className="button" onClick={onClose} type="button">
            Cerrar
          </button>
        ) : (
          <>
            <button
              className="button-secondary"
              disabled={isLoading}
              onClick={onClose}
              type="button"
            >
              Cancelar
            </button>
            {phase === "confirm" ? (
              <button
                className="button"
                disabled={ordersWithDesign.length === 0}
                onClick={() => void handleDownload()}
                type="button"
              >
                Descargar diseños
              </button>
            ) : null}
          </>
        )
      }
    >
      <div className="stack">
        {phase === "confirm" ? (
          <>
            <div className="bulk-design-info">
              <div className="bulk-design-info-row">
                <span className="bulk-design-info-icon">🎨</span>
                <div>
                  <div className="table-primary">
                    {ordersWithDesign.length} pedido{ordersWithDesign.length !== 1 ? "s" : ""} con diseño detectable
                  </div>
                  <div className="table-secondary">
                    Los diseños se empaquetarán en un ZIP nombrado como:<br />
                    <code className="bulk-design-name-example">NUMERO_PEDIDO - Nombre del producto.png</code>
                  </div>
                </div>
              </div>
              {ordersWithoutDesign > 0 ? (
                <div className="bulk-design-info-row">
                  <span className="bulk-design-info-icon">⚠️</span>
                  <div>
                    <div className="table-primary">{ordersWithoutDesign} pedido{ordersWithoutDesign !== 1 ? "s" : ""} sin diseño visible</div>
                    <div className="table-secondary">Se omitirán automáticamente del ZIP.</div>
                  </div>
                </div>
              ) : null}
              {ordersWithDesign.length === 0 ? (
                <div className="feedback feedback-error">
                  Ninguno de los pedidos seleccionados tiene un diseño asociado visible. Selecciona pedidos personalizados con diseño disponible.
                </div>
              ) : null}
            </div>
            <div className="table-secondary">
              El servidor descargará cada diseño y generará el ZIP. Puede tardar unos segundos dependiendo del número de archivos.
            </div>
          </>
        ) : null}

        {phase === "loading" ? (
          <div className="bulk-label-loading">
            <div className="bulk-label-spinner" aria-hidden="true" />
            <div>
              <div className="table-primary">Generando ZIP de diseños...</div>
              <div className="table-secondary">
                Descargando y empaquetando {ordersWithDesign.length} diseño{ordersWithDesign.length !== 1 ? "s" : ""}. No cierres esta ventana.
              </div>
            </div>
          </div>
        ) : null}

        {phase === "done" ? (
          <div className="stack">
            <div className="feedback feedback-success">
              ✅ ZIP descargado con <strong>{downloadedCount}</strong> diseño{downloadedCount !== 1 ? "s" : ""}.
              {failedCount > 0 ? (
                <> {failedCount} no pudieron descargarse (URL inaccesible, timeout o archivo remoto caído).</>
              ) : totalWithDesign > downloadedCount ? (
                <> {totalWithDesign - downloadedCount} no pudieron descargarse.</>
              ) : null}
            </div>
            <div className="table-secondary">
              Revisa la carpeta de descargas de tu navegador para encontrar el archivo <code>diseños-bulk.zip</code>.
            </div>
          </div>
        ) : null}

        {phase === "error" ? (
          <div className="feedback feedback-error">
            {errorMsg ?? "Error al generar la descarga."}
          </div>
        ) : null}
      </div>
    </AppModal>
  );
}
