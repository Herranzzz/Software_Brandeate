"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import type { Shop } from "@/lib/types";


type TenantProfileFormProps = {
  shop: Shop;
};


function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}


export function TenantProfileForm({ shop }: TenantProfileFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(shop.name);
  const [slug, setSlug] = useState(shop.slug);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const suggestedSlug = useMemo(() => slugify(name), [name]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    const response = await fetch(`/api/shops/${shop.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        slug,
      }),
    });

    const payload = (await response.json().catch(() => null)) as { detail?: string } | Shop | null;

    if (!response.ok) {
      setMessage({
        kind: "error",
        text:
          payload && "detail" in payload && payload.detail
            ? payload.detail
            : "No se pudo actualizar el perfil de la tienda.",
      });
      return;
    }

    setMessage({ kind: "success", text: "Perfil de tienda actualizado." });
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <form className="stack" onSubmit={handleSubmit}>
      <div className="portal-settings-grid">
        <div className="field">
          <label htmlFor="tenant-shop-name">Nombre visible</label>
          <input
            id="tenant-shop-name"
            onChange={(event) => setName(event.target.value)}
            placeholder="Nombre de tu tienda"
            value={name}
          />
        </div>

        <div className="field">
          <label htmlFor="tenant-shop-slug">Slug</label>
          <input
            id="tenant-shop-slug"
            onChange={(event) => setSlug(event.target.value)}
            placeholder={suggestedSlug || "mi-tienda"}
            value={slug}
          />
        </div>
      </div>

      <div className="table-secondary">
        Este perfil alimenta el nombre base del portal y la identidad de la tienda dentro de la plataforma.
      </div>

      <div className="actions-row">
        <button className="button" disabled={isPending || !name.trim() || !slug.trim()} type="submit">
          {isPending ? "Guardando..." : "Guardar perfil"}
        </button>
        <button
          className="button button-secondary"
          disabled={isPending}
          onClick={() => setSlug(suggestedSlug)}
          type="button"
        >
          Usar slug sugerido
        </button>
      </div>

      {message ? <div className={`feedback feedback-${message.kind}`}>{message.text}</div> : null}
    </form>
  );
}
