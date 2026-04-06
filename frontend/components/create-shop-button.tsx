"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

import { AppModal } from "@/components/app-modal";
import type { Shop } from "@/lib/types";


type CreateShopButtonProps = {
  buttonLabel?: string;
  buttonClassName?: string;
  title?: string;
  description?: string;
  successRedirectPath?: string;
};

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

export function CreateShopButton({
  buttonLabel = "Nueva tienda",
  buttonClassName = "button",
  title = "Crear tienda",
  description = "Da de alta una nueva tienda para empezar a conectar pedidos, expediciones e integraciones desde el admin.",
  successRedirectPath,
}: CreateShopButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const suggestedSlug = useMemo(() => slugify(name), [name]);

  useEffect(() => {
    if (!slugTouched) {
      setSlug(suggestedSlug);
    }
  }, [slugTouched, suggestedSlug]);

  function resetState() {
    setName("");
    setSlug("");
    setSlugTouched(false);
    setMessage(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    const payload = {
      name: name.trim(),
      slug: slugify(slug),
    };

    const response = await fetch("/api/shops", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const result = (await response.json().catch(() => null)) as
      | (Shop & { detail?: string })
      | { detail?: string }
      | null;

    if (!response.ok) {
      setMessage({
        kind: "error",
        text: result?.detail ?? "No se pudo crear la tienda.",
      });
      return;
    }

    const createdShop = result as Shop;
    setMessage({
      kind: "success",
      text: `Tienda ${createdShop.name} creada correctamente.`,
    });

    startTransition(() => {
      if (successRedirectPath) {
        const separator = successRedirectPath.includes("?") ? "&" : "?";
        router.push(`${successRedirectPath}${separator}selected=${createdShop.id}`);
      } else {
        router.refresh();
      }
    });

    window.setTimeout(() => {
      setOpen(false);
      resetState();
      router.refresh();
    }, 700);
  }

  return (
    <>
      <button
        className={buttonClassName}
        onClick={() => {
          resetState();
          setOpen(true);
        }}
        type="button"
      >
        {buttonLabel}
      </button>

      <AppModal
        actions={
          <button className="button button-secondary" onClick={() => setOpen(false)} type="button">
            Cerrar
          </button>
        }
        eyebrow="Nueva tienda"
        onClose={() => setOpen(false)}
        open={open}
        subtitle={description}
        title={title}
      >
        <form className="stack create-shop-form" onSubmit={handleSubmit}>
          <div className="portal-settings-grid">
            <div className="field">
              <label htmlFor="create-shop-name">Nombre de la tienda</label>
              <input
                autoFocus
                id="create-shop-name"
                onChange={(event) => setName(event.target.value)}
                placeholder="Donde Fue"
                value={name}
              />
            </div>

            <div className="field">
              <label htmlFor="create-shop-slug">Slug</label>
              <input
                id="create-shop-slug"
                onChange={(event) => {
                  setSlugTouched(true);
                  setSlug(event.target.value);
                }}
                placeholder="donde-fue"
                value={slug}
              />
              <div className="table-secondary">Solo minúsculas, números y guiones.</div>
            </div>
          </div>

          <div className="create-shop-summary">
            <div className="create-shop-summary-row">
              <span>URL interna</span>
              <strong>/{slugify(slug || suggestedSlug || "nueva-tienda")}</strong>
            </div>
            <div className="create-shop-summary-row">
              <span>Siguiente paso</span>
              <strong>Conectar Shopify y defaults de expedición</strong>
            </div>
          </div>

          {message ? <div className={`feedback feedback-${message.kind}`}>{message.text}</div> : null}

          <div className="create-shop-actions">
            <button
              className="button"
              disabled={isPending || name.trim().length === 0 || slugify(slug).length < 3}
              type="submit"
            >
              {isPending ? "Creando..." : "Crear tienda"}
            </button>
          </div>
        </form>
      </AppModal>
    </>
  );
}
