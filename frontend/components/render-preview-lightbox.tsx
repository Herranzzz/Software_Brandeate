"use client";

import { useState } from "react";

import { AppModal } from "@/components/app-modal";

type RenderPreviewLightboxProps = {
  alt: string;
  src: string;
};

export function RenderPreviewLightbox({ alt, src }: RenderPreviewLightboxProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        className="shipment-render-trigger"
        onClick={() => setIsOpen(true)}
        type="button"
      >
        <img alt={alt} className="shipment-render-image" src={src} />
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
              <img alt={alt} className="shipment-lightbox-image" src={src} />
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
