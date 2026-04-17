/**
 * Label handling utilities.
 *
 * Silent/kiosk printing via hidden iframes has been removed — it was not
 * reliable across browsers/OSes. All flows now simply download the label
 * PDF (or ZPL/EPL) and let the user print from their PDF viewer / OS.
 *
 * The API surface (`printLabel`, `printLabelsMerged`, `printLabelsSequential`,
 * `PrintLabelError`, `PrintLabelFailure`) is preserved so call sites don't
 * need to change — they still say "print" semantically but the effect is a
 * download.
 */

const FETCH_TIMEOUT_MS = 35000; // just above backend CTT label timeout (30s)

export type LabelPrintFormat = "PDF" | "ZPL" | "EPL";

export interface PrintLabelOptions {
  format?: LabelPrintFormat;
  /** Legacy option kept for API compatibility — no longer used. */
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

/**
 * Trigger a direct browser download of a label by tracking code.
 * No hidden iframe, no automatic print dialog — just a download.
 */
export function printLabel(
  trackingCode: string,
  options: PrintLabelOptions = {},
): Promise<void> {
  const format = options.format ?? "PDF";
  const anchor = document.createElement("a");
  anchor.href = buildLabelUrl(trackingCode, format, true);
  anchor.download = `etiqueta-${trackingCode}.${extensionFor(format)}`;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  return Promise.resolve();
}

async function fetchLabelBlob(
  trackingCode: string,
  format: LabelPrintFormat,
): Promise<Blob> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
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
    // Small delay so the browser can start the download before we revoke.
    setTimeout(() => URL.revokeObjectURL(url), 2000);
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

/**
 * Fetch all labels, merge them into a single PDF, and trigger a single
 * download with the whole batch. Failures per tracking code are returned
 * so the caller can surface them.
 */
export async function printLabelsMerged(
  trackingCodes: string[],
  options: PrintLabelOptions = {},
  onProgress?: (done: number, total: number) => void,
): Promise<PrintLabelFailure[]> {
  if (trackingCodes.length === 0) return [];

  const format = options.format ?? "PDF";

  if (format !== "PDF") {
    // Can't merge ZPL/EPL meaningfully — fall back to sequential downloads.
    return printLabelsSequential(trackingCodes, options, onProgress);
  }

  const failures: PrintLabelFailure[] = [];
  const blobs: Blob[] = [];
  let fetched = 0;

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

  if (blobs.length > 0) {
    const merged = blobs.length === 1 ? blobs[0] : await mergePdfBlobs(blobs);
    const filename = `etiquetas-${new Date().toISOString().slice(0, 10)}-${blobs.length}.pdf`;
    triggerBlobDownload(merged, filename);
  }

  return failures;
}

/**
 * Download multiple labels sequentially (one download per label).
 * Failures are collected so a single bad label doesn't block the rest.
 */
export async function printLabelsSequential(
  trackingCodes: string[],
  options: PrintLabelOptions = {},
  onProgress?: (done: number, total: number) => void,
): Promise<PrintLabelFailure[]> {
  const failures: PrintLabelFailure[] = [];
  const format = options.format ?? "PDF";

  for (let i = 0; i < trackingCodes.length; i++) {
    const code = trackingCodes[i];
    try {
      // Pre-fetch so we surface backend errors cleanly instead of letting
      // the anchor silently download an HTML error page.
      const blob = await fetchLabelBlob(code, format);
      triggerBlobDownload(blob, `etiqueta-${code}.${extensionFor(format)}`);
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
    }
    onProgress?.(i + 1, trackingCodes.length);
    if (i < trackingCodes.length - 1) {
      // Small gap so the browser doesn't collapse multiple downloads.
      await new Promise<void>((resolve) => setTimeout(resolve, 400));
    }
  }

  return failures;
}
