"use client";

import { useState } from "react";

import { AppModal } from "@/components/app-modal";

type RenderPreviewLightboxProps = {
  alt: string;
  src: string;
  onLoadError?: () => void;
};

export function RenderPreviewLightbox({ alt, src, onLoadError }: RenderPreviewLightboxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isBroken, setIsBroken] = useState(false);

  function handleError() {
    setIsBroken(true);
    onLoadError?.();
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

  return (
    <>
      <button
        className="shipment-render-trigger"
        onClick={() => setIsOpen(true)}
        type="button"
      >
        <img alt={alt} className="shipment-render-image" onError={handleError} src={src} />
      </button>

      <div className="shipment-render-meta">
        <button className="button button-secondary" onClick={() => setIsOpen(true)} type="button">
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
