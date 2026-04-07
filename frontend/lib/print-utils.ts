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

export type LabelPrintFormat = "PDF" | "ZPL" | "EPL";

export interface PrintLabelOptions {
  format?: LabelPrintFormat;
  /** If true, opens the label in a new tab when the iframe strategy fails */
  fallbackToNewTab?: boolean;
}

/**
 * Print a CTT label by tracking code.
 * Returns a promise that resolves when the print dialog has been triggered
 * (or the fallback has been executed). It does NOT wait for the user to
 * confirm printing.
 */
export async function printLabel(
  trackingCode: string,
  options: PrintLabelOptions = {},
): Promise<void> {
  const format = options.format ?? "PDF";
  const fallback = options.fallbackToNewTab ?? true;
  const url = `/api/ctt/shippings/${trackingCode}/label?label_type=${format}&model_type=SINGLE`;

  if (format !== "PDF") {
    // ZPL/EPL cannot be printed by the browser — trigger a download instead.
    const anchor = document.createElement("a");
    anchor.href = `${url}&download=1`;
    anchor.download = `label-${trackingCode}.${format.toLowerCase()}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return;
  }

  return new Promise<void>((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText =
      "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;border:none;";

    let settled = false;

    function cleanup() {
      if (settled) return;
      settled = true;
      setTimeout(() => {
        if (document.body.contains(iframe)) {
          document.body.removeChild(iframe);
        }
        resolve();
      }, IFRAME_CLEANUP_DELAY_MS);
    }

    iframe.onload = () => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch {
        if (fallback) {
          window.open(url, "_blank", "noopener");
        }
      }
      cleanup();
    };

    iframe.onerror = () => {
      if (fallback) {
        window.open(url, "_blank", "noopener");
      }
      cleanup();
    };

    document.body.appendChild(iframe);
    iframe.src = url;
  });
}

/**
 * Print multiple labels sequentially, with a short gap between each to
 * avoid overwhelming the browser's print queue.
 */
export async function printLabelsSequential(
  trackingCodes: string[],
  options: PrintLabelOptions = {},
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  for (let i = 0; i < trackingCodes.length; i++) {
    await printLabel(trackingCodes[i], options);
    onProgress?.(i + 1, trackingCodes.length);
    // Small gap between prints so the browser print queue stays manageable.
    if (i < trackingCodes.length - 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 800));
    }
  }
}
