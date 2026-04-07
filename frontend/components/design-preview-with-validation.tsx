"use client";

import { useCallback } from "react";

import { RenderPreviewLightbox } from "@/components/render-preview-lightbox";

type DesignPreviewWithValidationProps = {
  alt: string;
  src: string;
  orderId: number;
  itemId: number;
};

export function DesignPreviewWithValidation({ alt, src, orderId, itemId }: DesignPreviewWithValidationProps) {
  const handleLoadError = useCallback(() => {
    fetch(`/api/orders/${orderId}/items/${itemId}/report-broken-asset`, {
      method: "POST",
    }).catch(() => {
      // Best-effort — don't block UI if reporting fails
    });
  }, [orderId, itemId]);

  return (
    <RenderPreviewLightbox
      alt={alt}
      onLoadError={handleLoadError}
      src={src}
    />
  );
}
