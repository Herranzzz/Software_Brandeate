"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";


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


export default function SignupPage() {
  const router = useRouter();
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [password, setPassword] = useState("");
  const [shopName, setShopName] = useState("");
  const [shopSlug, setShopSlug] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const suggestedSlug = useMemo(() => slugify(shopName), [shopName]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsPending(true);
    setMessage(null);

    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        owner_name: ownerName,
        owner_email: ownerEmail,
        password,
        shop_name: shopName,
        shop_slug: shopSlug || suggestedSlug,
      }),
    });

    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;

    setIsPending(false);

    if (!response.ok) {
      setMessage({ kind: "error", text: payload?.detail ?? "No se pudo crear la cuenta de tienda." });
      return;
    }

    setMessage({ kind: "success", text: "Cuenta creada. Redirigiendo al portal..." });
    router.push("/portal/settings");
    router.refresh();
  }

  return (
    <div className="auth-shell">
      <div className="auth-card auth-card-wide">
        <div className="stack">
          <span className="eyebrow">Brandeate for merchants</span>
          <h1 className="title auth-title">Crea tu tienda</h1>
          <p className="subtitle">
            Configura tu acceso, crea el perfil base de tu tienda y conecta Shopify dentro del portal Brandeate.
          </p>
        </div>

        <form className="stack" onSubmit={handleSubmit}>
          <div className="portal-settings-grid">
            <div className="field">
              <label htmlFor="owner-name">Tu nombre</label>
              <input id="owner-name" onChange={(event) => setOwnerName(event.target.value)} value={ownerName} />
            </div>

            <div className="field">
              <label htmlFor="owner-email">Email</label>
              <input id="owner-email" onChange={(event) => setOwnerEmail(event.target.value)} type="email" value={ownerEmail} />
            </div>

            <div className="field">
              <label htmlFor="shop-name">Nombre de la tienda</label>
              <input id="shop-name" onChange={(event) => setShopName(event.target.value)} value={shopName} />
            </div>

            <div className="field">
              <label htmlFor="shop-slug">Slug público</label>
              <input
                id="shop-slug"
                onChange={(event) => setShopSlug(event.target.value)}
                placeholder={suggestedSlug || "mi-tienda"}
                value={shopSlug}
              />
            </div>

            <div className="field field-span-2">
              <label htmlFor="signup-password">Password</label>
              <input
                id="signup-password"
                minLength={6}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                value={password}
              />
            </div>
          </div>

          <div className="actions-row">
            <button
              className="button"
              disabled={isPending || !ownerName || !ownerEmail || !shopName || !(shopSlug || suggestedSlug) || !password}
              type="submit"
            >
              {isPending ? "Creando cuenta..." : "Crear cuenta y entrar"}
            </button>
            <button
              className="button button-secondary"
              disabled={isPending}
              onClick={() => setShopSlug(suggestedSlug)}
              type="button"
            >
              Usar slug sugerido
            </button>
          </div>
        </form>

        {message ? <div className={`feedback feedback-${message.kind}`}>{message.text}</div> : null}

        <div className="auth-meta-row">
          <span>¿Ya tienes acceso?</span>
          <Link className="table-link table-link-strong" href="/login">
            Inicia sesión
          </Link>
        </div>
      </div>
    </div>
  );
}
