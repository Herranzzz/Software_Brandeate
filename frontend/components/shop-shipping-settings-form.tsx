"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import type { Shop, ShopShippingSettings } from "@/lib/types";


type ShopShippingSettingsFormProps = {
  shop: Shop;
  submitLabel?: string;
};

type ShippingFormState = {
  sender_name: string;
  sender_email: string;
  sender_phone: string;
  sender_country_code: string;
  sender_postal_code: string;
  sender_address_line1: string;
  sender_address_line2: string;
  sender_town: string;
  sender_province: string;
  default_shipping_type_code: string;
  default_weight_tier_code: string;
  label_reference_mode: string;
  recipient_email_notifications: boolean;
  default_package_strategy: string;
  default_package_count: string;
};

const SHIPPING_SERVICE_OPTIONS = [
  { value: "C24", label: "CTT 24h" },
  { value: "C48", label: "CTT 48h" },
  { value: "C10", label: "CTT 10h" },
  { value: "C14", label: "CTT 14h" },
  { value: "C14E", label: "CTT 14h eCommerce" },
];

const WEIGHT_OPTIONS = [
  { value: "band_1000", label: "1 kg" },
  { value: "band_2000", label: "2 kg" },
  { value: "band_3000", label: "3 kg" },
  { value: "band_4000", label: "4 kg" },
  { value: "band_5000", label: "5 kg" },
  { value: "band_10000", label: "10 kg" },
  { value: "band_15000", label: "15 kg" },
];

function buildInitialState(settings: ShopShippingSettings | null | undefined): ShippingFormState {
  return {
    sender_name: settings?.sender_name ?? "",
    sender_email: settings?.sender_email ?? "",
    sender_phone: settings?.sender_phone ?? "",
    sender_country_code: settings?.sender_country_code ?? "ES",
    sender_postal_code: settings?.sender_postal_code ?? "",
    sender_address_line1: settings?.sender_address_line1 ?? "",
    sender_address_line2: settings?.sender_address_line2 ?? "",
    sender_town: settings?.sender_town ?? "",
    sender_province: settings?.sender_province ?? "",
    default_shipping_type_code: settings?.default_shipping_type_code ?? "C24",
    default_weight_tier_code: settings?.default_weight_tier_code ?? "band_2000",
    label_reference_mode: settings?.label_reference_mode ?? "reference",
    recipient_email_notifications: settings?.recipient_email_notifications ?? true,
    default_package_strategy: settings?.default_package_strategy ?? "per_order",
    default_package_count: String(settings?.default_package_count ?? 1),
  };
}

function normalizeNullable(value: string) {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function buildPayload(state: ShippingFormState) {
  return {
    shipping_settings: {
      sender_name: normalizeNullable(state.sender_name),
      sender_email: normalizeNullable(state.sender_email),
      sender_phone: normalizeNullable(state.sender_phone),
      sender_country_code: normalizeNullable(state.sender_country_code)?.toUpperCase() ?? null,
      sender_postal_code: normalizeNullable(state.sender_postal_code),
      sender_address_line1: normalizeNullable(state.sender_address_line1),
      sender_address_line2: normalizeNullable(state.sender_address_line2),
      sender_town: normalizeNullable(state.sender_town),
      sender_province: normalizeNullable(state.sender_province),
      default_shipping_type_code: normalizeNullable(state.default_shipping_type_code),
      default_weight_tier_code: normalizeNullable(state.default_weight_tier_code),
      label_reference_mode: normalizeNullable(state.label_reference_mode),
      recipient_email_notifications: state.recipient_email_notifications,
      default_package_strategy: normalizeNullable(state.default_package_strategy),
      default_package_count: Math.max(Number.parseInt(state.default_package_count || "1", 10) || 1, 1),
    },
  };
}

export function ShopShippingSettingsForm({
  shop,
  submitLabel = "Guardar ajustes de expedición",
}: ShopShippingSettingsFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [form, setForm] = useState<ShippingFormState>(() => buildInitialState(shop.shipping_settings));

  const previewAddress = useMemo(() => {
    return [
      form.sender_name.trim(),
      [form.sender_address_line1.trim(), form.sender_address_line2.trim()].filter(Boolean).join(", "),
      [form.sender_postal_code.trim(), form.sender_town.trim()].filter(Boolean).join(" · "),
      [form.sender_province.trim(), form.sender_country_code.trim().toUpperCase()].filter(Boolean).join(" · "),
    ].filter(Boolean);
  }, [form]);

  function updateField<Key extends keyof ShippingFormState>(key: Key, value: ShippingFormState[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    const response = await fetch(`/api/shops/${shop.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildPayload(form)),
    });

    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    if (!response.ok) {
      setMessage({
        kind: "error",
        text:
          payload?.detail && typeof payload.detail === "string"
            ? payload.detail
            : "No se pudieron guardar los ajustes de expedición.",
      });
      return;
    }

    setMessage({ kind: "success", text: "Ajustes de expedición guardados." });
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <form className="stack" onSubmit={handleSubmit}>
      <div className="shipping-settings-layout">
        <section className="shipping-settings-panel">
          <div className="shipping-settings-panel-head">
            <div>
              <span className="eyebrow">Dirección de expedición</span>
              <h4 className="section-title section-title-small">Origen y remitente</h4>
              <p className="subtitle">
                Esta dirección se usa por defecto al crear etiquetas CTT para la tienda.
              </p>
            </div>
          </div>

          <div className="portal-settings-grid">
            <div className="field">
              <label htmlFor={`shipping-sender-name-${shop.id}`}>Nombre remitente</label>
              <input
                id={`shipping-sender-name-${shop.id}`}
                onChange={(event) => updateField("sender_name", event.target.value)}
                placeholder="Brandeate Ops"
                value={form.sender_name}
              />
            </div>

            <div className="field">
              <label htmlFor={`shipping-sender-phone-${shop.id}`}>Teléfono</label>
              <input
                id={`shipping-sender-phone-${shop.id}`}
                onChange={(event) => updateField("sender_phone", event.target.value)}
                placeholder="+34 600 000 000"
                value={form.sender_phone}
              />
            </div>

            <div className="field">
              <label htmlFor={`shipping-sender-email-${shop.id}`}>Email</label>
              <input
                id={`shipping-sender-email-${shop.id}`}
                onChange={(event) => updateField("sender_email", event.target.value)}
                placeholder="operaciones@mitienda.com"
                value={form.sender_email}
              />
            </div>

            <div className="field">
              <label htmlFor={`shipping-sender-country-${shop.id}`}>País</label>
              <input
                id={`shipping-sender-country-${shop.id}`}
                maxLength={8}
                onChange={(event) => updateField("sender_country_code", event.target.value.toUpperCase())}
                placeholder="ES"
                value={form.sender_country_code}
              />
            </div>

            <div className="field field-span-2">
              <label htmlFor={`shipping-address-1-${shop.id}`}>Dirección</label>
              <input
                id={`shipping-address-1-${shop.id}`}
                onChange={(event) => updateField("sender_address_line1", event.target.value)}
                placeholder="Calle, número, nave o almacén"
                value={form.sender_address_line1}
              />
            </div>

            <div className="field field-span-2">
              <label htmlFor={`shipping-address-2-${shop.id}`}>Complemento</label>
              <input
                id={`shipping-address-2-${shop.id}`}
                onChange={(event) => updateField("sender_address_line2", event.target.value)}
                placeholder="Planta, puerta, polígono o instrucciones internas"
                value={form.sender_address_line2}
              />
            </div>

            <div className="field">
              <label htmlFor={`shipping-postal-${shop.id}`}>Código postal</label>
              <input
                id={`shipping-postal-${shop.id}`}
                onChange={(event) => updateField("sender_postal_code", event.target.value)}
                placeholder="28001"
                value={form.sender_postal_code}
              />
            </div>

            <div className="field">
              <label htmlFor={`shipping-town-${shop.id}`}>Ciudad</label>
              <input
                id={`shipping-town-${shop.id}`}
                onChange={(event) => updateField("sender_town", event.target.value)}
                placeholder="Madrid"
                value={form.sender_town}
              />
            </div>

            <div className="field field-span-2">
              <label htmlFor={`shipping-province-${shop.id}`}>Provincia / región</label>
              <input
                id={`shipping-province-${shop.id}`}
                onChange={(event) => updateField("sender_province", event.target.value)}
                placeholder="Madrid"
                value={form.sender_province}
              />
            </div>
          </div>
        </section>

        <section className="shipping-settings-panel shipping-settings-panel-secondary">
          <div className="shipping-settings-panel-head">
            <div>
              <span className="eyebrow">Operativa por defecto</span>
              <h4 className="section-title section-title-small">Servicio y preparación</h4>
              <p className="subtitle">
                Estos defaults se aplican al crear una expedición si el equipo no cambia el valor manualmente.
              </p>
            </div>
          </div>

          <div className="portal-settings-grid">
            <div className="field">
              <label htmlFor={`shipping-service-${shop.id}`}>Servicio CTT</label>
              <select
                id={`shipping-service-${shop.id}`}
                onChange={(event) => updateField("default_shipping_type_code", event.target.value)}
                value={form.default_shipping_type_code}
              >
                {SHIPPING_SERVICE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor={`shipping-weight-${shop.id}`}>Tramo de peso</label>
              <select
                id={`shipping-weight-${shop.id}`}
                onChange={(event) => updateField("default_weight_tier_code", event.target.value)}
                value={form.default_weight_tier_code}
              >
                {WEIGHT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor={`shipping-reference-${shop.id}`}>Identificador en etiqueta</label>
              <select
                id={`shipping-reference-${shop.id}`}
                onChange={(event) => updateField("label_reference_mode", event.target.value)}
                value={form.label_reference_mode}
              >
                <option value="reference">Referencia interna</option>
                <option value="shopify_name">Nombre del pedido Shopify</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor={`shipping-package-strategy-${shop.id}`}>Estrategia de bultos</label>
              <select
                id={`shipping-package-strategy-${shop.id}`}
                onChange={(event) => updateField("default_package_strategy", event.target.value)}
                value={form.default_package_strategy}
              >
                <option value="per_order">1 bulto por pedido</option>
                <option value="per_item">1 bulto por unidad</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor={`shipping-package-count-${shop.id}`}>Bultos por defecto</label>
              <input
                id={`shipping-package-count-${shop.id}`}
                min={1}
                onChange={(event) => updateField("default_package_count", event.target.value)}
                type="number"
                value={form.default_package_count}
              />
            </div>
          </div>

          <label className="shipping-settings-toggle">
            <input
              checked={form.recipient_email_notifications}
              onChange={(event) => updateField("recipient_email_notifications", event.target.checked)}
              type="checkbox"
            />
            <div>
              <div className="table-primary">Enviar email de seguimiento al destinatario</div>
              <div className="table-secondary">
                Si CTT lo permite para el servicio elegido, se enviará el email del cliente al crear la expedición.
              </div>
            </div>
          </label>

          <div className="shipping-settings-preview">
            <div className="shipping-settings-preview-label">Vista rápida del origen</div>
            <div className="shipping-settings-preview-body">
              {previewAddress.length > 0 ? (
                previewAddress.map((line) => <div key={line}>{line}</div>)
              ) : (
                <span className="table-secondary">Completa la dirección para usarla por defecto en las etiquetas.</span>
              )}
            </div>
          </div>
        </section>
      </div>

      <div className="actions-row">
        <button className="button" disabled={isPending} type="submit">
          {isPending ? "Guardando..." : submitLabel}
        </button>
      </div>

      {message ? <div className={`feedback feedback-${message.kind}`}>{message.text}</div> : null}
    </form>
  );
}
