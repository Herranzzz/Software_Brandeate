"use client";

import { useState } from "react";


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

      {isOpen ? (
        <div
          className="modal-backdrop shipment-lightbox-backdrop"
          onClick={() => setIsOpen(false)}
          role="presentation"
        >
          <div
            aria-modal="true"
            className="modal-sheet shipment-lightbox-sheet"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="modal-head">
              <div>
                <span className="eyebrow">Preview</span>
                <h3 className="section-title section-title-small">Render de personalización</h3>
              </div>
              <button className="button-secondary" onClick={() => setIsOpen(false)} type="button">
                Cerrar
              </button>
            </div>
            <div className="shipment-lightbox-body">
              <img alt={alt} className="shipment-lightbox-image" src={src} />
            </div>
            <div className="modal-footer">
              <a className="button button-secondary" href={src} rel="noreferrer" target="_blank">
                Abrir en pestaña nueva
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
