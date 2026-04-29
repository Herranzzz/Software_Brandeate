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
const PRINT_RENDER_DELAY_MS = 350;
// High DPI so thermal labels stay crisp. 300 DPI / 72 = ~4.17.
const PDF_RENDER_SCALE = 3;

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

function resolveMode(options: PrintLabelOptions): "silent" | "download" {
  if (options.forceDownload) return "download";
  // Both silent mode (kiosk) and normal mode use the same PDF.js → iframe path.
  // With --kiosk-printing Chrome skips the dialog entirely.
  // Without it the browser shows its standard print dialog.
  // Either way is better than a silent file download — the user wants to print,
  // not hunt for a file in their Downloads folder.
  return "silent";
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

// ─── Silent-print path ────────────────────────────────────────────────────

/**
 * Render a PDF blob to <img> pages inside a hidden iframe and print.
 *
 * Why this way: Chrome's built-in PDF viewer (what you get from <embed> or
 * iframe.src=pdfUrl) intercepts window.print() and bypasses --kiosk-printing,
 * so the dialog or the in-viewer "click to print" step shows up anyway.
 *
 * We rasterise every page to a canvas with pdf.js, inline the result as <img>
 * tags in a plain HTML document, and print THAT. Since the iframe is plain
 * HTML, --kiosk-printing applies and the job goes straight to the default
 * printer with zero UI.
 */
type RenderedPagePayload = {
  blob: Blob;
  widthPt: number;
  heightPt: number;
};

async function rasterisePdfInWorker(buffer: ArrayBuffer): Promise<RenderedPagePayload[]> {
  // OffscreenCanvas lets us rasterise pages off the main thread so the UI
  // stays responsive while a 20-page bulk renders. Older Safari lacks it —
  // the caller falls back to the synchronous main-thread path.
  const worker = new Worker(new URL("./pdf-render-worker.ts", import.meta.url), {
    type: "module",
  });
  try {
    return await new Promise<RenderedPagePayload[]>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent) => {
        const data = event.data as
          | { type: "result"; pages: RenderedPagePayload[] }
          | { type: "error"; message: string };
        if (data.type === "result") resolve(data.pages);
        else reject(new Error(data.message));
      };
      worker.onerror = (event) => reject(new Error(event.message || "Worker error"));
      worker.postMessage(
        { type: "render", buffer, scale: PDF_RENDER_SCALE },
        [buffer],
      );
    });
  } finally {
    worker.terminate();
  }
}

async function rasterisePdfOnMainThread(buffer: ArrayBuffer): Promise<RenderedPagePayload[]> {
  const pdfjs = await import("pdfjs-dist");
  try {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
  } catch {
    pdfjs.GlobalWorkerOptions.workerSrc = "";
  }
  const pdf = await pdfjs.getDocument({ data: buffer }).promise;
  const pages: RenderedPagePayload[] = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewportAt1 = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
        "image/png",
      ),
    );
    pages.push({
      blob,
      widthPt: viewportAt1.width,
      heightPt: viewportAt1.height,
    });
    page.cleanup();
  }
  pdf.destroy();
  return pages;
}

async function printBlobOnce(blob: Blob): Promise<void> {
  const buffer = await blob.arrayBuffer();
  const supportsOffscreen =
    typeof OffscreenCanvas !== "undefined" && typeof Worker !== "undefined";

  let renderedPages: RenderedPagePayload[];
  if (supportsOffscreen) {
    try {
      renderedPages = await rasterisePdfInWorker(buffer);
    } catch {
      // Worker init/render failed (CSP, SharedArrayBuffer headers, etc.) —
      // fall back to main-thread rendering so prints still go through.
      renderedPages = await rasterisePdfOnMainThread(buffer.slice(0));
    }
  } else {
    renderedPages = await rasterisePdfOnMainThread(buffer);
  }

  // Convert blobs to object URLs and remember them for cleanup after print.
  const pageUrls: string[] = renderedPages.map((p) => URL.createObjectURL(p.blob));
  const pageSizes = renderedPages.map((p) => ({ widthPt: p.widthPt, heightPt: p.heightPt }));

  const first = pageSizes[0] ?? { widthPt: 595, heightPt: 842 };
  // mm conversion for @page size (1pt = 0.3528mm).
  const widthMm = (first.widthPt * 0.3528).toFixed(2);
  const heightMm = (first.heightPt * 0.3528).toFixed(2);

  const imgsHtml = pageUrls
    .map(
      (src, idx) =>
        `<img src="${src}" alt="page-${idx + 1}" class="page" />`,
    )
    .join("\n");

  const html = [
    "<!DOCTYPE html>",
    "<html>",
    "<head>",
    '<meta charset="utf-8" />',
    "<style>",
    `  @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }`,
    "  * { margin:0; padding:0; box-sizing:border-box; }",
    "  html, body { width:100%; }",
    "  body { background:#fff; }",
    "  .page { display:block; width:100%; height:auto; page-break-after:always; }",
    "  .page:last-child { page-break-after:auto; }",
    "  @media print {",
    "    html, body { width: auto; }",
    "    .page { width: 100%; height: 100vh; object-fit: contain; }",
    "  }",
    "</style>",
    "</head>",
    "<body>",
    imgsHtml,
    "</body>",
    "</html>",
  ].join("\n");

  const htmlBlob = new Blob([html], { type: "text/html" });
  const htmlUrl = URL.createObjectURL(htmlBlob);

  return new Promise<void>((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText =
      "position:fixed;top:-9999px;left:-9999px;width:595px;height:842px;opacity:0;border:none;pointer-events:none;";

    let settled = false;
    let printDelayId = 0;

    function cleanup() {
      if (settled) return;
      settled = true;
      if (printDelayId) window.clearTimeout(printDelayId);
      setTimeout(() => {
        if (document.body.contains(iframe)) document.body.removeChild(iframe);
        URL.revokeObjectURL(htmlUrl);
        for (const url of pageUrls) URL.revokeObjectURL(url);
        resolve();
      }, IFRAME_CLEANUP_DELAY_MS);
    }

    iframe.onload = () => {
      if (settled || printDelayId) return;
      printDelayId = window.setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch {
          // swallow — cleanup resolves so the flow advances
        }
        cleanup();
      }, PRINT_RENDER_DELAY_MS);
    };

    iframe.onerror = () => cleanup();
    iframe.src = htmlUrl;
    document.body.appendChild(iframe);
  });
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

  if (mode === "download" || format !== "PDF") {
    // ZPL/EPL cannot go through the HTML print path.
    downloadByAnchor(trackingCode, format);
    return;
  }

  const blob = await fetchLabelBlob(trackingCode, format, options.signal);
  if (options.signal?.aborted) return;
  await printBlobOnce(blob);
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
      await printBlobOnce(merged);
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
