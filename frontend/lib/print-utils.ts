/**
 * Auto-print utilities for shipping labels.
 *
 * Strategy: load the label PDF in a hidden iframe on the same origin and
 * call contentWindow.print(). The browser's print dialog opens pre-loaded
 * with the label — the operator just confirms or has their OS set to
 * auto-accept for the configured thermal printer.
 *
 * For ZPL format (Zebra printers), printing via browser is not possible,
 * so we open a download/new-tab fallback instead.
 */

const IFRAME_CLEANUP_DELAY_MS = 3000;
const FETCH_TIMEOUT_MS = 35000; // just above backend CTT label timeout (30s)
const PDF_RENDER_DELAY_MS = 450;

export type LabelPrintFormat = "PDF" | "ZPL" | "EPL";

export interface PrintLabelOptions {
  format?: LabelPrintFormat;
  /** If true, opens the label in a new tab when the iframe strategy fails */
  fallbackToNewTab?: boolean;
}

export class PrintLabelError extends Error {
  constructor(
    public readonly trackingCode: string,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "PrintLabelError";
  }
}

function buildLabelUrl(trackingCode: string, format: LabelPrintFormat): string {
  return `/api/ctt/shippings/${trackingCode}/label?label_type=${format}&model_type=SINGLE`;
}

async function fetchLabelBlob(trackingCode: string, format: LabelPrintFormat): Promise<Blob> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(buildLabelUrl(trackingCode, format), {
      signal: controller.signal,
      credentials: "include",
    });
    if (!res.ok) {
      let detail = `${res.status} ${res.statusText}`;
      try {
        const body = (await res.json()) as { detail?: string };
        if (body?.detail) detail = body.detail;
      } catch {
        // ignore – non-JSON error body
      }
      throw new PrintLabelError(trackingCode, `No se pudo descargar la etiqueta: ${detail}`);
    }
    return await res.blob();
  } catch (err) {
    if (err instanceof PrintLabelError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new PrintLabelError(
        trackingCode,
        `Tiempo de espera agotado al descargar la etiqueta (${FETCH_TIMEOUT_MS / 1000}s).`,
        err,
      );
    }
    throw new PrintLabelError(
      trackingCode,
      err instanceof Error ? err.message : "Error de red al descargar la etiqueta",
      err,
    );
  } finally {
    window.clearTimeout(timeoutId);
  }
}

/**
 * Print a CTT label by tracking code.
 *
 * Strategy: fetch the label as a blob first (so backend errors are surfaced
 * cleanly instead of letting an iframe render an HTML error page and then
 * print it). Once we have the blob, create an object URL and drive an
 * invisible iframe to trigger the browser's print dialog.
 *
 * Returns a promise that resolves when the print dialog has been triggered
 * (or the fallback has been executed). It does NOT wait for the user to
 * confirm printing. Rejects with PrintLabelError when the backend fails.
 */
export async function printLabel(
  trackingCode: string,
  options: PrintLabelOptions = {},
): Promise<void> {
  const format = options.format ?? "PDF";
  const fallback = options.fallbackToNewTab ?? true;

  if (format !== "PDF") {
    // ZPL/EPL cannot be printed by the browser — trigger a download instead.
    // For these, we can't pre-validate via fetch() without consuming the body,
    // so we still rely on a plain anchor download and surface errors at the
    // server's content-disposition level.
    const anchor = document.createElement("a");
    anchor.href = `${buildLabelUrl(trackingCode, format)}&download=1`;
    anchor.download = `label-${trackingCode}.${format.toLowerCase()}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return;
  }

  let blob: Blob;
  try {
    blob = await fetchLabelBlob(trackingCode, format);
  } catch (err) {
    if (fallback) {
      // Single-label flow: pop a tab so the user can at least see the backend
      // error or retry manually.
      window.open(buildLabelUrl(trackingCode, format), "_blank", "noopener");
    }
    throw err;
  }

  const blobUrl = URL.createObjectURL(blob);

  return new Promise<void>((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText =
      "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;border:none;";

    let settled = false;
    let printDelayId = 0;

    function cleanup() {
      if (settled) return;
      settled = true;
      if (printDelayId) {
        window.clearTimeout(printDelayId);
      }
      setTimeout(() => {
        if (document.body.contains(iframe)) {
          document.body.removeChild(iframe);
        }
        URL.revokeObjectURL(blobUrl);
        resolve();
      }, IFRAME_CLEANUP_DELAY_MS);
    }

    iframe.onload = () => {
      if (settled || printDelayId) {
        return;
      }
      // Delay slightly so the browser PDF viewer is fully ready before print.
      printDelayId = window.setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch {
          // swallow — cleanup will still resolve so sequential flow advances
        }
        cleanup();
      }, PDF_RENDER_DELAY_MS);
    };

    iframe.onerror = () => {
      cleanup();
    };

    iframe.src = blobUrl;
    document.body.appendChild(iframe);
  });
}

export type PrintLabelFailure = {
  trackingCode: string;
  error: PrintLabelError;
};

/**
 * Print multiple labels sequentially, with a short gap between each to
 * avoid overwhelming the browser's print queue.
 *
 * Failures are collected and returned instead of aborting the whole batch
 * on the first backend error — otherwise a single flaky label would block
 * printing the rest of the selection. The caller decides how to surface
 * failures to the user.
 */
export async function printLabelsSequential(
  trackingCodes: string[],
  options: PrintLabelOptions = {},
  onProgress?: (done: number, total: number) => void,
): Promise<PrintLabelFailure[]> {
  const failures: PrintLabelFailure[] = [];
  // In bulk mode we never want the per-label fallback to pop zombie tabs —
  // we collect failures and let the modal display them at the end.
  const perLabelOptions: PrintLabelOptions = { ...options, fallbackToNewTab: false };

  for (let i = 0; i < trackingCodes.length; i++) {
    try {
      await printLabel(trackingCodes[i], perLabelOptions);
    } catch (err) {
      if (err instanceof PrintLabelError) {
        failures.push({ trackingCode: trackingCodes[i], error: err });
      } else {
        failures.push({
          trackingCode: trackingCodes[i],
          error: new PrintLabelError(
            trackingCodes[i],
            err instanceof Error ? err.message : "Error desconocido al imprimir",
            err,
          ),
        });
      }
    }
    onProgress?.(i + 1, trackingCodes.length);
    // Small gap between prints so the browser print queue stays manageable.
    if (i < trackingCodes.length - 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 800));
    }
  }

  return failures;
}
