/**
 * Label fetching, merging and printing.
 *
 * One primitive (`printPdfBlob`) drives every print path:
 *   1. Create a blob URL from the PDF.
 *   2. Append a hidden iframe whose `src` is that blob URL.
 *      The browser's built-in PDF viewer renders the PDF inside the iframe.
 *   3. Wait for the iframe's `load` event — this fires AFTER the PDF viewer
 *      has parsed the document, so we don't need any magic-number timeouts.
 *   4. Focus the iframe's contentWindow (some browsers require this) and call
 *      `contentWindow.print()`. With Chrome's `--kiosk-printing` flag the
 *      dialog is bypassed; otherwise the native dialog opens automatically
 *      with the PDF already selected.
 *   5. Listen for `afterprint` on the contentWindow to clean up reliably.
 *      A fallback timer guarantees cleanup even if `afterprint` never fires
 *      (kiosk mode, some PDF viewers, browser quirks).
 *
 * For batch printing we fetch labels in parallel (concurrency 6), merge them
 * into a single PDF with pdf-lib, and print as ONE job. The operator only
 * sees one print dialog regardless of how many labels are in the batch.
 *
 * Modes:
 *   - "print"    (default): hidden iframe + print(). Silent in kiosk mode.
 *   - "newtab"   : open PDF in a new tab; operator prints manually.
 *   - "download" : save the file (also forced for ZPL/EPL formats).
 *
 * Callers select the mode either explicitly via options or implicitly via
 * `isSilentPrintEnabled()` (the per-device toggle in /settings → Impresión).
 */

// ─── Constants ────────────────────────────────────────────────────────────

/** Backend label timeout is ~42 s worst case; client sits comfortably above. */
const FETCH_TIMEOUT_MS = 60_000;

/** Max time we wait for the iframe to fire `load` before we give up. */
const PRINT_READY_TIMEOUT_MS = 30_000;

/** Cleanup fallback if `afterprint` never fires (kiosk mode, quirks, etc.). */
const CLEANUP_FALLBACK_MS = 90_000;

/** Concurrent label fetches in batch mode. */
const BATCH_FETCH_CONCURRENCY = 6;

// ─── Per-device preferences ──────────────────────────────────────────────

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
    // ignore — private mode, storage quota, etc.
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
    // ignore
  }
}

// ─── Public types ────────────────────────────────────────────────────────

export type LabelPrintFormat = "PDF" | "ZPL" | "EPL";

export interface PrintLabelOptions {
  format?: LabelPrintFormat;
  /** Force silent print regardless of the stored preference. */
  forceSilent?: boolean;
  /** Force download regardless of the stored preference. */
  forceDownload?: boolean;
  /** Force opening the label in a new tab. */
  forceNewTab?: boolean;
  /** Legacy option kept for API compatibility — no longer needed. */
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

// ─── URL helpers ─────────────────────────────────────────────────────────

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

// ─── Mode resolution ─────────────────────────────────────────────────────

type ResolvedMode = "print" | "newtab" | "download";

function resolveMode(options: PrintLabelOptions, format: LabelPrintFormat): ResolvedMode {
  // Non-PDF formats can't be embedded in the print iframe — always download.
  if (format !== "PDF") return "download";
  if (options.forceDownload) return "download";
  if (options.forceNewTab) return "newtab";
  if (options.forceSilent || isSilentPrintEnabled()) return "print";
  // Default: silent print via hidden iframe. Without --kiosk-printing the
  // browser still shows its native print dialog (with the PDF preselected),
  // so the operator only confirms once. This is more reliable than opening
  // a new tab because popup blockers don't apply.
  return "print";
}

// ─── Network ─────────────────────────────────────────────────────────────

async function fetchLabelBlob(
  trackingCode: string,
  format: LabelPrintFormat,
  externalSignal?: AbortSignal,
): Promise<Blob> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }
  try {
    const res = await fetch(buildLabelUrl(trackingCode, format, false), {
      signal: controller.signal,
      credentials: "include",
      cache: "no-store",
    });
    if (!res.ok) {
      let detail = `${res.status} ${res.statusText}`;
      try {
        const body = (await res.json()) as { detail?: string };
        if (body?.detail) detail = body.detail;
      } catch {
        // non-JSON error body, fall back to status text
      }
      throw new PrintLabelError(
        trackingCode,
        `No se pudo descargar la etiqueta: ${detail}`,
      );
    }
    const blob = await res.blob();
    if (blob.size === 0) {
      throw new PrintLabelError(
        trackingCode,
        "El servidor devolvió una etiqueta vacía.",
      );
    }
    return blob;
  } catch (err) {
    if (err instanceof PrintLabelError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") {
      // Caller cancelled; surface as PrintLabelError but with explicit message.
      throw new PrintLabelError(
        trackingCode,
        externalSignal?.aborted
          ? "Operación cancelada."
          : `Tiempo de espera agotado al descargar la etiqueta (${FETCH_TIMEOUT_MS / 1000}s).`,
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

// ─── PDF merge ───────────────────────────────────────────────────────────

async function mergePdfBlobs(blobs: Blob[]): Promise<Blob> {
  if (blobs.length === 0) {
    throw new Error("Cannot merge zero PDFs");
  }
  if (blobs.length === 1) return blobs[0];

  const { PDFDocument } = await import("pdf-lib");
  const merged = await PDFDocument.create();
  for (const blob of blobs) {
    const buffer = await blob.arrayBuffer();
    const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const pages = await merged.copyPages(src, src.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }
  const bytes = await merged.save();
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}

// ─── Print primitive ─────────────────────────────────────────────────────

/**
 * Print a PDF blob via a hidden iframe. Resolves once the print dialog has
 * been triggered (the dialog itself is the user's responsibility).
 *
 * The PDF is wrapped in a same-origin HTML document containing an <embed>.
 * Loading the PDF blob URL directly makes Chrome hand the iframe off to its
 * PDF-viewer extension, which runs cross-origin — calling contentWindow.print()
 * on it throws a SecurityError. The HTML wrapper keeps the iframe same-origin
 * so print() always works without opening a new tab.
 *
 * A 1-second delay after the HTML loads gives the <embed> time to render the
 * PDF before the dialog opens; without it the dialog may show a blank page.
 */
function printPdfBlob(blob: Blob): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const pdfUrl = URL.createObjectURL(blob);

    const htmlContent =
      "<!DOCTYPE html><html><head><style>" +
      "*{margin:0;padding:0}html,body{width:100%;height:100%;overflow:hidden}" +
      "embed{display:block;width:100%;height:100%;border:0}" +
      "</style></head><body>" +
      `<embed src="${pdfUrl}" type="application/pdf">` +
      "</body></html>";
    const htmlBlob = new Blob([htmlContent], { type: "text/html" });
    const htmlUrl = URL.createObjectURL(htmlBlob);

    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.setAttribute("title", "print");
    // Off-screen but rendered at a real size — display:none prevents some
    // browsers' PDF plugins from initialising.
    iframe.style.cssText =
      "position:fixed;right:-99999px;bottom:-99999px;width:595px;height:842px;border:0;visibility:hidden;pointer-events:none;";

    let printTriggered = false;
    let cleaned = false;
    let readyTimerId = 0;
    let embedDelayTimerId = 0;
    let fallbackTimerId = 0;

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      window.clearTimeout(readyTimerId);
      window.clearTimeout(embedDelayTimerId);
      window.clearTimeout(fallbackTimerId);
      try {
        iframe.contentWindow?.removeEventListener("afterprint", onAfterPrint);
      } catch {
        // cross-origin or disposed window — ignore
      }
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      URL.revokeObjectURL(pdfUrl);
      URL.revokeObjectURL(htmlUrl);
    };

    const onAfterPrint = () => {
      // Small delay so the browser actually dispatches the job before we
      // tear down the iframe (some print drivers read the document late).
      window.setTimeout(cleanup, 500);
    };

    const onLoad = () => {
      if (printTriggered) return;
      printTriggered = true;
      window.clearTimeout(readyTimerId);

      const win = iframe.contentWindow;
      if (!win) {
        cleanup();
        reject(new Error("Iframe contentWindow not available"));
        return;
      }

      // Give the <embed> time to render the PDF before opening the dialog.
      embedDelayTimerId = window.setTimeout(() => {
        try {
          win.addEventListener("afterprint", onAfterPrint, { once: true });
        } catch {
          // afterprint listener may fail in some sandboxed contexts; the
          // fallback timer below will still clean up.
        }
        try {
          win.focus();
        } catch {
          // ignore — focus is best-effort
        }
        try {
          win.print();
        } catch (err) {
          cleanup();
          reject(err);
          return;
        }
        // The dialog (if any) is now the operator's responsibility.
        resolve();
        // Guarantee cleanup even if afterprint never fires.
        fallbackTimerId = window.setTimeout(cleanup, CLEANUP_FALLBACK_MS);
      }, 1000);
    };

    iframe.addEventListener("load", onLoad, { once: true });
    iframe.addEventListener("error", () => {
      cleanup();
      reject(new Error("Failed to load PDF in iframe"));
    });

    // Hard cap: if the HTML wrapper never loads, give up.
    readyTimerId = window.setTimeout(() => {
      if (!printTriggered) {
        cleanup();
        reject(new Error("PDF preview did not load in time"));
      }
    }, PRINT_READY_TIMEOUT_MS);

    document.body.appendChild(iframe);
    iframe.src = htmlUrl;
  });
}

// ─── New-tab fallback ────────────────────────────────────────────────────

/**
 * Open the PDF blob directly in a new tab. The browser's built-in PDF viewer
 * shows it; the operator prints manually. Returns false if the popup was
 * blocked by the browser.
 */
function openPdfInNewTab(blob: Blob): boolean {
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank", "noopener");
  // Revoke after the tab has had time to load. Too short and Safari/Firefox
  // can race the navigation; 60s is generous.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return win !== null;
}

// ─── Download ────────────────────────────────────────────────────────────

function downloadBlob(blob: Blob, filename: string): void {
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
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

function downloadByAnchor(trackingCode: string, format: LabelPrintFormat): void {
  // Stream directly from the backend with Content-Disposition: attachment.
  const anchor = document.createElement("a");
  anchor.href = buildLabelUrl(trackingCode, format, true);
  anchor.download = `etiqueta-${trackingCode}.${extensionFor(format)}`;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

// ─── Public API: single label ────────────────────────────────────────────

/**
 * Print (or download) a single label by tracking code.
 *
 * Mode is decided automatically based on the per-device preference and the
 * label format, but callers can override via the options.
 */
export async function printLabel(
  trackingCode: string,
  options: PrintLabelOptions = {},
): Promise<void> {
  const format = options.format ?? "PDF";
  const mode = resolveMode(options, format);

  // Non-PDF: stream-download from the backend; no need to fetch as a blob.
  if (mode === "download" && format !== "PDF") {
    downloadByAnchor(trackingCode, format);
    return;
  }

  // PDF path — always fetch the blob so we can retry / fall back.
  let blob: Blob;
  try {
    blob = await fetchLabelBlob(trackingCode, format, options.signal);
  } catch (err) {
    // Hard failure on fetch — let the caller decide what to show. Re-throw
    // so toasts/UI feedback can pick it up.
    throw err;
  }
  if (options.signal?.aborted) return;

  if (mode === "download") {
    downloadBlob(blob, `etiqueta-${trackingCode}.${extensionFor(format)}`);
    return;
  }

  if (mode === "newtab") {
    if (!openPdfInNewTab(blob)) {
      // Popup blocked — fall back to download.
      downloadBlob(blob, `etiqueta-${trackingCode}.pdf`);
    }
    return;
  }

  // mode === "print": hidden iframe + window.print().
  try {
    await printPdfBlob(blob);
  } catch {
    // Iframe path failed (sandbox, disabled PDF viewer, plugin missing).
    // Fall through to opening the PDF in a new tab.
    if (!openPdfInNewTab(blob)) {
      downloadBlob(blob, `etiqueta-${trackingCode}.pdf`);
    }
  }
}

/**
 * Pre-fetch a label PDF blob without printing it.
 * Call right after shipment creation so the blob is ready in memory when the
 * operator clicks "Imprimir etiqueta" — the print dialog opens without any
 * additional network round-trip.
 */
export async function prefetchLabelBlob(
  trackingCode: string,
  signal?: AbortSignal,
): Promise<Blob> {
  return fetchLabelBlob(trackingCode, "PDF", signal);
}

/**
 * Print a pre-fetched PDF blob directly, using the same iframe + dialog path
 * as `printLabel`. Falls back to new-tab → download on failure.
 */
export async function printFromBlob(blob: Blob): Promise<void> {
  try {
    await printPdfBlob(blob);
  } catch {
    if (!openPdfInNewTab(blob)) {
      downloadBlob(blob, "etiqueta.pdf");
    }
  }
}

// ─── Public API: batch ───────────────────────────────────────────────────

/**
 * Fetch all labels in parallel (concurrency 6), merge them into a single PDF,
 * and dispatch ONE print job (or one download / new-tab depending on mode).
 *
 * Returns the list of fetch failures. The successful labels are still printed.
 */
export async function printLabelsMerged(
  trackingCodes: string[],
  options: PrintLabelOptions = {},
  onProgress?: (done: number, total: number) => void,
): Promise<PrintLabelFailure[]> {
  if (trackingCodes.length === 0) return [];

  const format = options.format ?? "PDF";

  // ZPL/EPL aren't mergeable — fall back to per-label flow.
  if (format !== "PDF") {
    return printLabelsSequential(trackingCodes, options, onProgress);
  }

  const failures: PrintLabelFailure[] = [];
  // Index-aligned with trackingCodes so the merged PDF preserves UI order
  // regardless of which fetch finishes first.
  const blobsByIndex: Array<Blob | null> = new Array(trackingCodes.length).fill(null);
  let fetchedCount = 0;

  let nextIndex = 0;
  const total = trackingCodes.length;

  async function fetchOne(index: number) {
    const code = trackingCodes[index];
    try {
      blobsByIndex[index] = await fetchLabelBlob(code, "PDF", options.signal);
    } catch (err) {
      failures.push({
        trackingCode: code,
        error:
          err instanceof PrintLabelError
            ? err
            : new PrintLabelError(
                code,
                err instanceof Error ? err.message : "Error desconocido al descargar",
                err,
              ),
      });
    } finally {
      fetchedCount++;
      onProgress?.(fetchedCount, total);
    }
  }

  async function worker() {
    while (nextIndex < total) {
      if (options.signal?.aborted) return;
      const i = nextIndex++;
      await fetchOne(i);
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(BATCH_FETCH_CONCURRENCY, total); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  if (options.signal?.aborted) return failures;

  const blobs = blobsByIndex.filter((b): b is Blob => b !== null);
  if (blobs.length === 0) return failures;

  let merged: Blob;
  try {
    merged = await mergePdfBlobs(blobs);
  } catch (err) {
    // Merge failed — fall back to printing the first blob so at least the
    // operator gets something. Surface the merge error via failures list.
    failures.push({
      trackingCode: "(merge)",
      error: new PrintLabelError(
        "(merge)",
        err instanceof Error ? err.message : "No se pudo combinar las etiquetas",
        err,
      ),
    });
    merged = blobs[0];
  }

  const mode = resolveMode(options, "PDF");
  const date = new Date().toISOString().slice(0, 10);
  const filename = `etiquetas-${date}-${blobs.length}.pdf`;

  if (mode === "download") {
    downloadBlob(merged, filename);
    return failures;
  }

  if (mode === "newtab") {
    if (!openPdfInNewTab(merged)) downloadBlob(merged, filename);
    return failures;
  }

  // mode === "print"
  try {
    await printPdfBlob(merged);
  } catch {
    if (!openPdfInNewTab(merged)) downloadBlob(merged, filename);
  }

  return failures;
}

/**
 * Sequential per-label flow. Use only for non-PDF formats (each label is its
 * own print/download). For PDF, prefer `printLabelsMerged` — it's faster and
 * shows a single dialog.
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
      failures.push({
        trackingCode: code,
        error:
          err instanceof PrintLabelError
            ? err
            : new PrintLabelError(
                code,
                err instanceof Error ? err.message : "Error desconocido al imprimir",
                err,
              ),
      });
    }
    onProgress?.(i + 1, trackingCodes.length);
    // Short pause between dialogs so the browser doesn't drop the next one.
    if (i < trackingCodes.length - 1) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 500));
    }
  }

  return failures;
}
