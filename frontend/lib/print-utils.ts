/**
 * Label handling utilities.
 *
 * Two paths depending on the per-device preference stored in localStorage
 * under the key read by `isSilentPrintEnabled()`:
 *
 *   1. Silent print (kiosk mode) — wraps the PDF in a minimal HTML page with
 *      <embed> and drives a hidden iframe to call contentWindow.print(). With
 *      Chrome launched via `--kiosk-printing` this skips the dialog and
 *      prints directly to the default printer. WITHOUT that flag the browser
 *      still shows its normal print dialog — it doesn't break, it just isn't
 *      silent.
 *
 *   2. Download — plain <a download> (or blob URL for merged bulk PDFs). The
 *      user prints from their PDF viewer / OS. Reliable everywhere.
 *
 * The toggle lives in /settings → tab "Impresión". It's stored per-device
 * (localStorage) so each operator station can opt-in independently.
 */

// Backend CTT label timeout is 20s with 1 retry (~42s worst case). Frontend
// timeout sits comfortably above so we never fail while the backend would still
// have succeeded on retry.
const FETCH_TIMEOUT_MS = 60000;
const IFRAME_CLEANUP_DELAY_MS = 2500;

/** localStorage key controlling silent-print mode on this device. */
export const SILENT_PRINT_STORAGE_KEY = "brandeate_silent_print_enabled";

/** Optional printer name hint (informational — browsers can't pick printers). */
export const PRINTER_NAME_STORAGE_KEY = "brandeate_printer_name";

export function getPrinterNameHint(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(PRINTER_NAME_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setPrinterNameHint(name: string): void {
  if (typeof window === "undefined") return;
  try {
    const trimmed = name.trim();
    if (trimmed) window.localStorage.setItem(PRINTER_NAME_STORAGE_KEY, trimmed);
    else window.localStorage.removeItem(PRINTER_NAME_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function isSilentPrintEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SILENT_PRINT_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSilentPrintEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (enabled) window.localStorage.setItem(SILENT_PRINT_STORAGE_KEY, "1");
    else window.localStorage.removeItem(SILENT_PRINT_STORAGE_KEY);
  } catch {
    // ignore — private mode, storage quota, etc.
  }
}

export type LabelPrintFormat = "PDF" | "ZPL" | "EPL";

export interface PrintLabelOptions {
  format?: LabelPrintFormat;
  /** Force silent print regardless of the stored preference. */
  forceSilent?: boolean;
  /** Force download regardless of the stored preference. */
  forceDownload?: boolean;
  /** Legacy option kept for API compatibility — no longer used. */
  fallbackToNewTab?: boolean;
  /** Allows the caller to cancel in-flight label fetches (e.g. modal closed). */
  signal?: AbortSignal;
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

export type PrintLabelFailure = {
  trackingCode: string;
  error: PrintLabelError;
};

function buildLabelUrl(
  trackingCode: string,
  format: LabelPrintFormat,
  download: boolean,
): string {
  const base = `/api/ctt/shippings/${trackingCode}/label?label_type=${format}&model_type=SINGLE`;
  return download ? `${base}&download=1` : base;
}

function extensionFor(format: LabelPrintFormat): string {
  return format.toLowerCase();
}

function resolveMode(options: PrintLabelOptions): "silent" | "newtab" | "download" {
  if (options.forceDownload) return "download";
  if (options.forceSilent || isSilentPrintEnabled()) return "silent";
  // Default: open in new tab — native PDF viewer, zero dependencies.
  return "newtab";
}

// ─── Download path ────────────────────────────────────────────────────────

function downloadByAnchor(trackingCode: string, format: LabelPrintFormat): void {
  const anchor = document.createElement("a");
  anchor.href = buildLabelUrl(trackingCode, format, true);
  anchor.download = `etiqueta-${trackingCode}.${extensionFor(format)}`;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}

// ─── Print-via-embed path ─────────────────────────────────────────────────

/**
 * Build an HTML document that embeds a PDF blob and auto-calls window.print().
 *
 * Why <embed> instead of <img> rasterisation via PDF.js:
 *  • No worker / OffscreenCanvas required — zero CSP issues on Vercel.
 *  • Chrome's built-in PDF renderer (which handles the <embed>) IS included
 *    in the print output when the enclosing HTML document is printed.
 *  • With --kiosk-printing the dialog is bypassed, giving fully silent print.
 *  • Without --kiosk-printing the native print dialog appears automatically,
 *    so the operator never has to click "Imprimir" a second time.
 *
 * The caller chooses between two delivery modes:
 *  • newTab=false (default / kiosk): inject into a hidden 595×842 iframe in
 *    the current page; call iframe.contentWindow.print() after the PDF loads.
 *  • newTab=true: open the HTML blob in a new tab; the tab's <script> calls
 *    window.print() and then window.close() after print completes.
 */
function buildPrintHtml(pdfBlobUrl: string, opts: { newTab?: boolean } = {}): string {
  const closeAfterPrint = opts.newTab ? "window.addEventListener('afterprint',function(){setTimeout(window.close,400)});" : "";
  return [
    "<!DOCTYPE html><html><head><meta charset='utf-8'>",
    "<style>",
    "* { margin:0; padding:0; box-sizing:border-box }",
    "html, body { width:100%; height:100%; overflow:hidden; background:#fff }",
    "@page { margin:0; size:auto }",
    "embed { display:block; width:100%; height:100vh }",
    "</style></head><body>",
    `<embed src="${pdfBlobUrl}" type="application/pdf">`,
    "<script>",
    // Give the PDF embed ~1.5 s to render before calling print.
    // There is no reliable 'load' event on <embed> for PDFs in all browsers.
    `(function(){var d=false;function p(){if(d)return;d=true;window.print();${closeAfterPrint}}setTimeout(p,1500);})();`,
    "</script></body></html>",
  ].join("");
}

/**
 * Print a PDF blob by injecting it into a hidden iframe in the current page.
 * Resolves once the print call has been dispatched (the dialog may still be
 * open; that's fine — the operator interacts with it independently).
 */
async function printBlobInIframe(blob: Blob): Promise<void> {
  const pdfUrl = URL.createObjectURL(blob);
  const html = buildPrintHtml(pdfUrl);
  const htmlBlob = new Blob([html], { type: "text/html" });
  const htmlUrl = URL.createObjectURL(htmlBlob);

  return new Promise<void>((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    // Off-screen but still rendered at a realistic size so the PDF plugin
    // initialises correctly (display:none prevents plugin loading).
    iframe.style.cssText =
      "position:fixed;top:-9999px;left:-9999px;width:595px;height:842px;opacity:0;border:none;pointer-events:none;";

    let settled = false;
    let timerId = 0;

    function cleanup() {
      if (settled) return;
      settled = true;
      clearTimeout(timerId);
      setTimeout(() => {
        if (document.body.contains(iframe)) document.body.removeChild(iframe);
        URL.revokeObjectURL(htmlUrl);
        URL.revokeObjectURL(pdfUrl);
        resolve();
      }, IFRAME_CLEANUP_DELAY_MS);
    }

    iframe.onload = () => {
      if (settled) return;
      // The HTML document has loaded; the <embed> is still fetching the PDF.
      // Wait an extra 1.5 s on top of what the HTML script already waits so
      // we don't clean up the iframe before the print job is dispatched.
      timerId = window.setTimeout(cleanup, 1500 + IFRAME_CLEANUP_DELAY_MS);
    };

    iframe.onerror = cleanup;
    document.body.appendChild(iframe);
    iframe.src = htmlUrl;
  });
}

/**
 * Print a PDF blob by opening the HTML wrapper in a new browser tab.
 * The tab auto-calls window.print() and closes itself after printing.
 * Useful when the caller cannot inject iframes (e.g. strict sandbox) or when
 * the operator prefers to see the label before confirming the print.
 */
function printBlobInNewTab(blob: Blob): void {
  const pdfUrl = URL.createObjectURL(blob);
  const html = buildPrintHtml(pdfUrl, { newTab: true });
  const htmlBlob = new Blob([html], { type: "text/html" });
  const htmlUrl = URL.createObjectURL(htmlBlob);
  window.open(htmlUrl, "_blank", "noopener");
  // Revoke blob URLs after the new tab has had time to load.
  setTimeout(() => {
    URL.revokeObjectURL(htmlUrl);
    URL.revokeObjectURL(pdfUrl);
  }, 30_000);
}

async function fetchLabelBlob(
  trackingCode: string,
  format: LabelPrintFormat,
  externalSignal?: AbortSignal,
): Promise<Blob> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  // Propagate caller cancellation (e.g. user closes the bulk modal mid-fetch).
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }
  try {
    const res = await fetch(buildLabelUrl(trackingCode, format, false), {
      signal: controller.signal,
      credentials: "include",
    });
    if (!res.ok) {
      let detail = `${res.status} ${res.statusText}`;
      try {
        const body = (await res.json()) as { detail?: string };
        if (body?.detail) detail = body.detail;
      } catch {
        // ignore non-JSON error body
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
    if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);
  }
}

async function mergePdfBlobs(blobs: Blob[]): Promise<Blob> {
  const { PDFDocument } = await import("pdf-lib");
  const merged = await PDFDocument.create();
  for (const blob of blobs) {
    const arrayBuffer = await blob.arrayBuffer();
    const src = await PDFDocument.load(arrayBuffer);
    const pages = await merged.copyPages(src, src.getPageIndices());
    for (const page of pages) {
      merged.addPage(page);
    }
  }
  const bytes = await merged.save();
  return new Blob([bytes], { type: "application/pdf" });
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Print (or download) a single label by tracking code.
 *
 * Mode is decided by `isSilentPrintEnabled()` unless overridden via
 * `forceSilent` / `forceDownload` in the options.
 */
export async function printLabel(
  trackingCode: string,
  options: PrintLabelOptions = {},
): Promise<void> {
  const format = options.format ?? "PDF";
  const mode = resolveMode(options);

  // Non-PDF formats or explicit download → save file.
  if (mode === "download" || format !== "PDF") {
    downloadByAnchor(trackingCode, format);
    return;
  }

  // Fetch the blob once; both silent and newtab paths need it.
  let blob: Blob;
  try {
    blob = await fetchLabelBlob(trackingCode, format, options.signal);
    if (options.signal?.aborted) return;
  } catch {
    // Network / timeout — fall back to opening the raw URL so the operator
    // can still print manually from the PDF viewer.
    window.open(buildLabelUrl(trackingCode, format, false), "_blank", "noopener");
    return;
  }

  if (mode === "silent") {
    // Silent/kiosk: inject into a hidden iframe and call contentWindow.print().
    // With --kiosk-printing Chrome skips the dialog; without it the native
    // print dialog still appears, but the operator only has to confirm once.
    try {
      await printBlobInIframe(blob);
      return;
    } catch {
      // Iframe approach failed — fall through to new-tab.
    }
  }

  // Default (and silent-mode fallback): open an HTML wrapper in a new tab.
  // The wrapper embeds the PDF and auto-calls window.print(), so the print
  // dialog opens immediately without the operator having to click anything.
  printBlobInNewTab(blob);
}

/**
 * Fetch + merge all labels into a single PDF, then either silently print it
 * or trigger a single download of the merged file.
 */
export async function printLabelsMerged(
  trackingCodes: string[],
  options: PrintLabelOptions = {},
  onProgress?: (done: number, total: number) => void,
): Promise<PrintLabelFailure[]> {
  if (trackingCodes.length === 0) return [];

  const format = options.format ?? "PDF";

  if (format !== "PDF") {
    return printLabelsSequential(trackingCodes, options, onProgress);
  }

  const mode = resolveMode(options);
  const failures: PrintLabelFailure[] = [];
  // Index-aligned with trackingCodes so the merged PDF preserves UI order
  // regardless of which download finishes first. A null slot means that
  // tracking code failed and is excluded from the merge.
  const blobsByIndex: Array<Blob | null> = new Array(trackingCodes.length).fill(null);
  let fetched = 0;

  const CONCURRENCY = 6;
  let nextIndex = 0;

  async function fetchOne(index: number) {
    const code = trackingCodes[index];
    try {
      const blob = await fetchLabelBlob(code, "PDF", options.signal);
      blobsByIndex[index] = blob;
    } catch (err) {
      if (err instanceof PrintLabelError) {
        failures.push({ trackingCode: code, error: err });
      } else {
        failures.push({
          trackingCode: code,
          error: new PrintLabelError(
            code,
            err instanceof Error ? err.message : "Error desconocido al descargar",
            err,
          ),
        });
      }
    } finally {
      fetched++;
      onProgress?.(fetched, trackingCodes.length);
    }
  }

  const workers: Promise<void>[] = [];
  async function worker() {
    while (nextIndex < trackingCodes.length) {
      if (options.signal?.aborted) return;
      const i = nextIndex++;
      await fetchOne(i);
    }
  }
  for (let i = 0; i < Math.min(CONCURRENCY, trackingCodes.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  if (options.signal?.aborted) return failures;

  const blobs = blobsByIndex.filter((b): b is Blob => b !== null);

  if (blobs.length > 0) {
    const merged = blobs.length === 1 ? blobs[0] : await mergePdfBlobs(blobs);
    if (mode === "silent") {
      try {
        await printBlobInIframe(merged);
      } catch {
        // Iframe failed — open HTML wrapper in a new tab as fallback.
        printBlobInNewTab(merged);
      }
    } else if (mode === "newtab") {
      // HTML wrapper opens in a new tab and auto-calls window.print() so the
      // operator never has to click the print button in the PDF viewer.
      printBlobInNewTab(merged);
    } else {
      const filename = `etiquetas-${new Date().toISOString().slice(0, 10)}-${blobs.length}.pdf`;
      triggerBlobDownload(merged, filename);
    }
  }

  return failures;
}

/**
 * Sequential per-label flow. Honours the silent/download preference for each
 * label individually.
 */
export async function printLabelsSequential(
  trackingCodes: string[],
  options: PrintLabelOptions = {},
  onProgress?: (done: number, total: number) => void,
): Promise<PrintLabelFailure[]> {
  const failures: PrintLabelFailure[] = [];

  for (let i = 0; i < trackingCodes.length; i++) {
    if (options.signal?.aborted) break;
    const code = trackingCodes[i];
    try {
      await printLabel(code, options);
    } catch (err) {
      if (err instanceof PrintLabelError) {
        failures.push({ trackingCode: code, error: err });
      } else {
        failures.push({
          trackingCode: code,
          error: new PrintLabelError(
            code,
            err instanceof Error ? err.message : "Error desconocido al imprimir",
            err,
          ),
        });
      }
    }
    onProgress?.(i + 1, trackingCodes.length);
    if (i < trackingCodes.length - 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
    }
  }

  return failures;
}
