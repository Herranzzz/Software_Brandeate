"use client";

import { useState } from "react";

import { AppModal } from "@/components/app-modal";
import { CTT_SERVICE_OPTIONS, CTT_WEIGHT_BANDS } from "@/lib/ctt";
import { printLabelsSequential, type PrintLabelFailure } from "@/lib/print-utils";
import type { Order, Shop } from "@/lib/types";


type BulkLabelResult = {
  order_id: number;
  external_id: string | null;
  status: "created" | "skipped" | "failed";
  reason: string | null;
  shipping_code: string | null;
  tracking_url: string | null;
};

type BulkLabelResponse = {
  results: BulkLabelResult[];
  created_count: number;
  skipped_count: number;
  failed_count: number;
};

type Phase = "config" | "loading" | "printing" | "done";

type BulkLabelModalProps = {
  orders: Order[];
  shop?: Shop | null;
  onClose: () => void;
  onComplete?: (updatedOrderIds: number[]) => void;
};


export function BulkLabelModal({ orders, shop, onClose, onComplete }: BulkLabelModalProps) {
  const settings = shop?.shipping_settings ?? null;

  const [weightTierCode, setWeightTierCode] = useState(
    settings?.default_weight_tier_code ?? "band_2000",
  );
  const [serviceCode, setServiceCode] = useState(
    settings?.default_shipping_type_code ?? "C24",
  );
  const [autoPrint, setAutoPrint] = useState(settings?.printer_auto_print ?? false);
  const [printFormat, setPrintFormat] = useState(
    settings?.printer_label_format ?? "PDF",
  );

  const [phase, setPhase] = useState<Phase>("config");
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<BulkLabelResponse | null>(null);
  const [printProgress, setPrintProgress] = useState<{ done: number; total: number } | null>(null);
  const [printFailures, setPrintFailures] = useState<PrintLabelFailure[]>([]);

  const eligibleOrders = orders.filter((o) => !o.shipment?.tracking_number);
  const alreadyShippedOrders = orders.filter((o) => Boolean(o.shipment?.tracking_number));

  async function handleCreate() {
    setPhase("loading");
    setError(null);

    try {
      const res = await fetch("/api/ctt/shippings/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_ids: orders.map((o) => o.id),
          weight_tier_code: weightTierCode,
          shipping_type_code: serviceCode,
          item_count: 1,
        }),
      });

      if (!res.ok) {
        const body = (await res.json()) as { detail?: string };
        throw new Error(body.detail ?? "Error al crear etiquetas en bulk");
      }

      const data = (await res.json()) as BulkLabelResponse;
      setResponse(data);

      const createdCodes = data.results
        .filter((r) => r.status === "created" && r.shipping_code)
        .map((r) => r.shipping_code as string);

      if (autoPrint && createdCodes.length > 0) {
        setPhase("printing");
        setPrintProgress({ done: 0, total: createdCodes.length });
        const failures = await printLabelsSequential(
          createdCodes,
          { format: printFormat === "ZPL" ? "ZPL" : "PDF" },
          (done, total) => setPrintProgress({ done, total }),
        );
        setPrintFailures(failures);
      }

      setPhase("done");
      const createdIds = data.results
        .filter((r) => r.status === "created")
        .map((r) => r.order_id);
      onComplete?.(createdIds);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
      setPhase("config");
    }
  }

  function handleClose() {
    if (phase === "loading" || phase === "printing") return;
    onClose();
  }

  const isProcessing = phase === "loading" || phase === "printing";

  return (
    <AppModal
      actions={
        phase === "done" ? (
          <button className="button" onClick={onClose} type="button">
            Cerrar
          </button>
        ) : (
          <>
            <button
              className="button-secondary"
              disabled={isProcessing}
              onClick={handleClose}
              type="button"
            >
              Cancelar
            </button>
            {phase === "config" ? (
              <button
                className="button"
                disabled={orders.length === 0}
                onClick={() => void handleCreate()}
                type="button"
              >
                Crear {orders.length} etiqueta{orders.length !== 1 ? "s" : ""}
              </button>
            ) : null}
          </>
        )
      }
      eyebrow="CTT Express"
      onClose={handleClose}
      open
      title="Crear etiquetas en bulk"
      subtitle={`${orders.length} pedidos seleccionados`}
      width="wide"
    >
      <div className="stack">

        {/* CONFIG PHASE */}
        {phase === "config" ? (
          <>
            {alreadyShippedOrders.length > 0 ? (
              <div className="feedback feedback-info">
                <strong>{alreadyShippedOrders.length} pedido{alreadyShippedOrders.length !== 1 ? "s" : ""} ya tienen etiqueta</strong> y serán omitidos automáticamente.
                Solo se procesarán los {eligibleOrders.length} sin etiqueta.
              </div>
            ) : null}

            <div className="bulk-label-config">
              <div className="bulk-label-config-section">
                <span className="eyebrow">Parámetros de envío</span>
                <p className="subtitle">Se aplicarán a todos los pedidos sin etiqueta previa.</p>

                <div className="portal-settings-grid">
                  <div className="field">
                    <label htmlFor="bulk-weight-tier">Tramo de peso</label>
                    <select
                      id="bulk-weight-tier"
                      value={weightTierCode}
                      onChange={(e) => setWeightTierCode(e.target.value)}
                    >
                      {CTT_WEIGHT_BANDS.map((band) => (
                        <option key={band.code} value={band.code}>
                          {band.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="field">
                    <label htmlFor="bulk-service-code">Servicio CTT</label>
                    <select
                      id="bulk-service-code"
                      value={serviceCode}
                      onChange={(e) => setServiceCode(e.target.value)}
                    >
                      {CTT_SERVICE_OPTIONS.map((opt) => (
                        <option key={opt.code} value={opt.code}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="bulk-label-config-section">
                <span className="eyebrow">Impresión</span>
                <p className="subtitle">Si activas la impresión automática, cada etiqueta creada se enviará al diálogo de impresión del navegador sin pasos adicionales.</p>

                <label className="shipping-settings-toggle">
                  <input
                    type="checkbox"
                    checked={autoPrint}
                    onChange={(e) => setAutoPrint(e.target.checked)}
                  />
                  <div>
                    <div className="table-primary">Imprimir automáticamente</div>
                    <div className="table-secondary">
                      Lanza el diálogo de impresión tras crear cada etiqueta. Usa la impresora configurada en el sistema.
                    </div>
                  </div>
                </label>

                {autoPrint ? (
                  <div className="field">
                    <label htmlFor="bulk-print-format">Formato de impresión</label>
                    <select
                      id="bulk-print-format"
                      value={printFormat}
                      onChange={(e) => setPrintFormat(e.target.value)}
                    >
                      <option value="PDF">PDF (impresora estándar o térmica)</option>
                      <option value="ZPL">ZPL (descarga para Zebra / impresora de red)</option>
                    </select>
                  </div>
                ) : null}
              </div>
            </div>

            {error ? <div className="feedback feedback-error">{error}</div> : null}
          </>
        ) : null}

        {/* LOADING PHASE */}
        {phase === "loading" ? (
          <div className="bulk-label-loading">
            <div className="bulk-label-spinner" aria-hidden="true" />
            <div>
              <div className="table-primary">Creando etiquetas...</div>
              <div className="table-secondary">
                Procesando {orders.length} pedido{orders.length !== 1 ? "s" : ""} con CTT Express.
              </div>
            </div>
          </div>
        ) : null}

        {/* PRINTING PHASE */}
        {phase === "printing" && printProgress ? (
          <div className="bulk-label-loading">
            <div className="bulk-label-spinner" aria-hidden="true" />
            <div>
              <div className="table-primary">
                Imprimiendo {printProgress.done} / {printProgress.total}...
              </div>
              <div className="table-secondary">
                Enviando etiquetas al diálogo de impresión del navegador.
              </div>
            </div>
          </div>
        ) : null}

        {/* DONE PHASE */}
        {phase === "done" && response ? (
          <div className="stack">
            <div className="bulk-label-summary">
              {response.created_count > 0 ? (
                <div className="bulk-label-stat bulk-label-stat-success">
                  <span className="bulk-label-stat-number">{response.created_count}</span>
                  <span className="bulk-label-stat-label">creadas</span>
                </div>
              ) : null}
              {response.skipped_count > 0 ? (
                <div className="bulk-label-stat bulk-label-stat-neutral">
                  <span className="bulk-label-stat-number">{response.skipped_count}</span>
                  <span className="bulk-label-stat-label">omitidas</span>
                </div>
              ) : null}
              {response.failed_count > 0 ? (
                <div className="bulk-label-stat bulk-label-stat-error">
                  <span className="bulk-label-stat-number">{response.failed_count}</span>
                  <span className="bulk-label-stat-label">fallidas</span>
                </div>
              ) : null}
            </div>

            {response.created_count > 0 ? (
              <div className="feedback feedback-success">
                {response.created_count} etiqueta{response.created_count !== 1 ? "s" : ""} creada{response.created_count !== 1 ? "s" : ""} correctamente en CTT Express.
                {autoPrint && printFailures.length === 0 ? " Impresas automáticamente." : ""}
                {autoPrint && printFailures.length > 0
                  ? ` ${response.created_count - printFailures.length} de ${response.created_count} enviadas a imprimir.`
                  : ""}
              </div>
            ) : null}

            {printFailures.length > 0 ? (
              <div className="stack">
                <div className="feedback feedback-error">
                  {printFailures.length} etiqueta{printFailures.length !== 1 ? "s" : ""} no se pudo imprimir automáticamente. Las etiquetas sí se crearon en CTT; puedes reimprimirlas manualmente desde el pedido.
                </div>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Tracking</th>
                        <th>Motivo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {printFailures.map((failure) => (
                        <tr className="table-row" key={failure.trackingCode}>
                          <td className="table-primary">{failure.trackingCode}</td>
                          <td className="table-secondary">{failure.error.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {response.failed_count > 0 ? (
              <div className="stack">
                <div className="feedback feedback-error">
                  {response.failed_count} pedido{response.failed_count !== 1 ? "s" : ""} no se pudieron procesar. Revisa los detalles:
                </div>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Pedido</th>
                        <th>Estado</th>
                        <th>Motivo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {response.results
                        .filter((r) => r.status === "failed")
                        .map((r) => (
                          <tr className="table-row" key={r.order_id}>
                            <td className="table-primary">{r.external_id ?? `#${r.order_id}`}</td>
                            <td>
                              <span className="badge badge-status badge-status-pending">Fallido</span>
                            </td>
                            <td className="table-secondary">{r.reason ?? "Error desconocido"}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {response.skipped_count > 0 ? (
              <details className="bulk-label-skipped">
                <summary className="table-secondary">
                  {response.skipped_count} pedido{response.skipped_count !== 1 ? "s" : ""} omitido{response.skipped_count !== 1 ? "s" : ""} (ya tenían etiqueta)
                </summary>
                <ul className="bulk-label-skipped-list">
                  {response.results
                    .filter((r) => r.status === "skipped")
                    .map((r) => (
                      <li key={r.order_id}>
                        <span className="table-primary">{r.external_id ?? `#${r.order_id}`}</span>
                        {r.shipping_code ? (
                          <span className="table-secondary"> · {r.shipping_code}</span>
                        ) : null}
                      </li>
                    ))}
                </ul>
              </details>
            ) : null}

            {response.created_count === 0 && response.failed_count === 0 ? (
              <div className="feedback feedback-info">
                Todos los pedidos seleccionados ya tenían etiqueta CTT. No se creó ninguna nueva.
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </AppModal>
  );
}
