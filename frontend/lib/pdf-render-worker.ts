/// <reference lib="webworker" />
/**
 * Off-main-thread PDF rasteriser.
 *
 * The bulk-label flow needs to rasterise 1..N labels at 300 DPI into PNG
 * frames before printing. Done on the main thread that's a 10–30s freeze
 * for a 20-label batch. This worker uses OffscreenCanvas so the UI stays
 * responsive (you can scroll, click, even cancel) while pages render.
 *
 * Protocol:
 *   in  → { type: "render", buffer: ArrayBuffer, scale: number }
 *   out ← { type: "result", pages: Array<{ blob: Blob; widthPt; heightPt }> }
 *   out ← { type: "error", message: string }
 *
 * The main thread is responsible for feature-detecting OffscreenCanvas before
 * spawning this worker — see `printBlobOnce` for the fallback path.
 */

type RenderRequest = {
  type: "render";
  buffer: ArrayBuffer;
  scale: number;
};

type RenderedPage = {
  blob: Blob;
  widthPt: number;
  heightPt: number;
};

type RenderResponse =
  | { type: "result"; pages: RenderedPage[] }
  | { type: "error"; message: string };

self.onmessage = async (event: MessageEvent<RenderRequest>) => {
  const { buffer, scale } = event.data;
  try {
    // Dynamic import keeps pdfjs out of the worker's static bundle until use.
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
    const pages: RenderedPage[] = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const viewportAt1 = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale });
      const canvas = new OffscreenCanvas(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height),
      );
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("OffscreenCanvas 2D context unavailable");
      // pdfjs types still require canvasContext typed as CanvasRenderingContext2D.
      await page.render({
        canvasContext: ctx as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;
      const blob = await canvas.convertToBlob({ type: "image/png" });
      pages.push({
        blob,
        widthPt: viewportAt1.width,
        heightPt: viewportAt1.height,
      });
      page.cleanup();
    }
    pdf.destroy();

    const response: RenderResponse = { type: "result", pages };
    self.postMessage(response);
  } catch (err) {
    const response: RenderResponse = {
      type: "error",
      message: err instanceof Error ? err.message : "PDF render failed",
    };
    self.postMessage(response);
  }
};

export {};
