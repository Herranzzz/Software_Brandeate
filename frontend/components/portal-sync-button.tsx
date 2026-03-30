"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type PortalSyncButtonProps = {
  shopId: number;
};

export function PortalSyncButton({ shopId }: PortalSyncButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  async function handleSync() {
    setMessage(null);
    const response = await fetch(`/api/integrations/shopify/${shopId}/sync-orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
      setMessage(payload?.detail ?? "No se pudo sincronizar Shopify.");
      return;
    }

    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className="portal-sync-cta">
      <button className="button button-secondary" disabled={isPending} onClick={() => void handleSync()} type="button">
        {isPending ? "Sincronizando..." : "Sincronizar ahora"}
      </button>
      {message ? <span className="portal-sync-error">{message}</span> : null}
    </div>
  );
}
