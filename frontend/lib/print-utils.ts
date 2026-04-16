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
 *
 * For bulk printing, all labels are merged into a single PDF using pdf-lib
 * so the print dialog opens only once (one job for the whole batch).
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

  // Reuse the same HTML-wrapper approach so kiosk-printing works here too.
  return printBlobOnce(blob);
}

export type PrintLabelFailure = {
  trackingCode: string;
  error: PrintLabelError;
};

/**
 * Merge an array of PDF Blobs into a single PDF Blob using pdf-lib.
 * Pages from each source PDF are appended in order.
 */
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

/**
 * Print a PDF blob directly via a hidden iframe (one print dialog).
 *
 * IMPORTANT — kiosk-printing compatibility:
 * Loading a PDF blob directly in an <iframe> makes Chrome hand it to the
 * built-in PDF viewer plugin, whose print path BYPASSES --kiosk-printing.
 * To ensure the flag works we wrap the PDF in an HTML page and embed it via
 * <embed>. The <iframe> then loads HTML (not PDF), so contentWindow.print()
 * goes through the browser's HTML print path, which DOES respect the flag.
 *
 * The PDF embed needs extra render time before print() is safe to call, so
 * we use PDF_EMBED_RENDER_DELAY_MS (larger than the plain PDF delay).
 */
const PDF_EMBED_RENDER_DELAY_MS = 1400;

function printBlobOnce(blob: Blob): Promise<void> {
  const pdfUrl = URL.createObjectURL(blob);

  // Build a minimal HTML wrapper that embeds the PDF.
  const html = [
    "<!DOCTYPE html>",
    "<html>",
    "<head>",
    "<style>",
    "  * { margin:0; padding:0; box-sizing:border-box; }",
    "  html, body { width:100%; height:100%; overflow:hidden; }",
    "  embed { display:block; width:100%; height:100%; }",
    "  @media print { html, body, embed { width:100%; height:100%; } }",
    "</style>",
    "</head>",
    "<body>",
    `  <embed src="${pdfUrl}" type="application/pdf">`,
    "</body>",
    "</html>",
  ].join("\n");

  const htmlBlob = new Blob([html], { type: "text/html" });
  const htmlUrl = URL.createObjectURL(htmlBlob);

  return new Promise<void>((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    // Give the iframe real dimensions so the PDF embed renders correctly.
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
        URL.revokeObjectURL(pdfUrl);
        resolve();
      }, IFRAME_CLEANUP_DELAY_MS);
    }

    iframe.onload = () => {
      if (settled || printDelayId) return;
      // Wait for the PDF embed inside the HTML to finish rendering.
      printDelayId = window.setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch {
          // swallow — cleanup will still resolve so the flow advances
        }
        cleanup();
      }, PDF_EMBED_RENDER_DELAY_MS);
    };

    iframe.onerror = () => cleanup();
    iframe.src = htmlUrl;
    document.body.appendChild(iframe);
  });
}

/**
 * Fetch all labels in parallel, merge them into a single PDF, then open
 * ONE print dialog for the whole batch. Failures for individual tracking
 * codes are collected and returned so the caller can surface them.
 *
 * `onProgress(fetched, total)` is called as each fetch completes so the
 * UI can show a live counter.
 */
export async function printLabelsMerged(
  trackingCodes: string[],
  options: PrintLabelOptions = {},
  onProgress?: (done: number, total: number) => void,
): Promise<PrintLabelFailure[]> {
  if (trackingCodes.length === 0) return [];

  const format = options.format ?? "PDF";

  // For ZPL/EPL there's nothing to merge — fall back to sequential.
  if (format !== "PDF") {
    return printLabelsSequential(trackingCodes, options, onProgress);
  }

  const failures: PrintLabelFailure[] = [];
  const blobs: Blob[] = [];
  let fetched = 0;

  // Fetch all PDFs in parallel (but cap at 6 concurrent to avoid overloading).
  const CONCURRENCY = 6;
  const queue = [...trackingCodes];

  async function fetchOne(code: string) {
    try {
      const blob = await fetchLabelBlob(code, "PDF");
      blobs.push(blob);
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

  // Run with limited concurrency
  const workers: Promise<void>[] = [];
  async function worker() {
    while (queue.length > 0) {
      const code = queue.shift();
      if (code !== undefined) await fetchOne(code);
    }
  }
  for (let i = 0; i < Math.min(CONCURRENCY, trackingCodes.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  if (blobs.length === 0) return failures;

  // Merge all successfully fetched PDFs and print once.
  const merged = blobs.length === 1 ? blobs[0] : await mergePdfBlobs(blobs);
  await printBlobOnce(merged);

  return failures;
}

/**
 * Print multiple labels sequentially, with a short gap between each to
 * avoid overwhelming the browser's print queue.
 *
 * Failures are collected and returned instead of aborting the whole batch
 * on the first backend error — otherwise a single flaky label would block
 * printing the rest of the selection. The caller decides how to surface
 * failures to the user.
 *
 * @deprecated Prefer printLabelsMerged for PDF labels — it opens a single
 * print dialog for the whole batch instead of one per label.
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
