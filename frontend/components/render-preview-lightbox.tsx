"use client";

import { useState } from "react";

import { AppModal } from "@/components/app-modal";
import {
  setLastOpenedPreview,
  useLastOpenedPreview,
} from "@/lib/last-opened-preview";

type RenderPreviewLightboxProps = {
  alt: string;
  src: string;
  onLoadError?: () => void;
  trackId?: string;
};

export function RenderPreviewLightbox({ alt, src, onLoadError, trackId }: RenderPreviewLightboxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isBroken, setIsBroken] = useState(false);
  const lastOpened = useLastOpenedPreview();
  const isLastOpened = Boolean(trackId) && lastOpened === trackId;

  function handleError() {
    setIsBroken(true);
    onLoadError?.();
  }

  function handleOpen() {
    if (trackId) {
      setLastOpenedPreview(trackId);
    }
    setIsOpen(true);
  }

  if (isBroken) {
    return (
      <div className="shipment-render-broken">
        <div className="shipment-render-broken-icon">⚠️</div>
        <span className="shipment-render-broken-label">Imagen no disponible</span>
        <span className="shipment-render-broken-hint">El asset de personalización no carga correctamente.</span>
        <a className="table-link table-link-strong" href={src} rel="noreferrer" target="_blank">
          Abrir enlace original
        </a>
      </div>
    );
  }

  const triggerClassName = [
    "shipment-render-trigger",
    isLastOpened ? "shipment-render-trigger--last-opened" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <button
        className={triggerClassName}
        onClick={handleOpen}
        type="button"
      >
        <img alt={alt} className="shipment-render-image" onError={handleError} src={src} />
        {isLastOpened ? (
          <span className="shipment-render-last-opened-badge" aria-hidden="true">
            Última vista
          </span>
        ) : null}
      </button>

      <div className="shipment-render-meta">
        <button className="button button-secondary" onClick={handleOpen} type="button">
          Ver más grande
        </button>
        <a className="table-link table-link-strong" href={src} rel="noreferrer" target="_blank">
          Abrir en pestaña nueva
        </a>
      </div>

      <AppModal
        actions={(
          <button className="button-secondary" onClick={() => setIsOpen(false)} type="button">
            Cerrar
          </button>
        )}
        bodyClassName="shipment-lightbox-modal-body"
        eyebrow="Preview"
        onClose={() => setIsOpen(false)}
        open={isOpen}
        title="Render de personalización"
        width="wide"
      >
            <div className="shipment-lightbox-body">
              <img alt={alt} className="shipment-lightbox-image" onError={handleError} src={src} />
            </div>
            <div className="modal-footer">
              <a className="button button-secondary" href={src} rel="noreferrer" target="_blank">
                Abrir en pestaña nueva
              </a>
            </div>
      </AppModal>
    </>
  );
}
