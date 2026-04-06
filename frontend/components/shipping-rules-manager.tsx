"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { ShippingRule, Shop } from "@/lib/types";


type ShippingRulesManagerProps = {
  shop: Shop;
};

type RuleDraft = {
  zone_name: string;
  shipping_rate_name: string;
  shipping_rate_amount: string;
  rule_type: string;
  min_value: string;
  max_value: string;
  carrier_service_code: string;
  carrier_service_label: string;
  country_codes: string;
  province_codes: string;
  postal_code_patterns: string;
  is_active: boolean;
  priority: string;
  notes: string;
};

const EMPTY_DRAFT: RuleDraft = {
  zone_name: "Península",
  shipping_rate_name: "",
  shipping_rate_amount: "",
  rule_type: "price",
  min_value: "0",
  max_value: "",
  carrier_service_code: "C24",
  carrier_service_label: "CTT 24h",
  country_codes: "ES",
  province_codes: "",
  postal_code_patterns: "",
  is_active: true,
  priority: "100",
  notes: "",
};

function mapRuleToDraft(rule: ShippingRule): RuleDraft {
  return {
    zone_name: rule.zone_name,
    shipping_rate_name: rule.shipping_rate_name ?? "",
    shipping_rate_amount: rule.shipping_rate_amount?.toString() ?? "",
    rule_type: rule.rule_type,
    min_value: rule.min_value?.toString() ?? "",
    max_value: rule.max_value?.toString() ?? "",
    carrier_service_code: rule.carrier_service_code,
    carrier_service_label: rule.carrier_service_label ?? "",
    country_codes: (rule.country_codes ?? []).join(", "),
    province_codes: (rule.province_codes ?? []).join(", "),
    postal_code_patterns: (rule.postal_code_patterns ?? []).join(", "),
    is_active: rule.is_active,
    priority: String(rule.priority),
    notes: rule.notes ?? "",
  };
}

function normalizeList(value: string) {
  const parts = value.split(",").map((item) => item.trim()).filter(Boolean);
  return parts.length > 0 ? parts : null;
}

function buildPayload(shopId: number, draft: RuleDraft) {
  return {
    shop_id: shopId,
    zone_name: draft.zone_name.trim(),
    shipping_rate_name: draft.shipping_rate_name.trim() || null,
    shipping_rate_amount: draft.shipping_rate_amount.trim() ? Number(draft.shipping_rate_amount) : null,
    rule_type: draft.rule_type,
    min_value: draft.min_value.trim() ? Number(draft.min_value) : null,
    max_value: draft.max_value.trim() ? Number(draft.max_value) : null,
    carrier_service_code: draft.carrier_service_code.trim(),
    carrier_service_label: draft.carrier_service_label.trim() || null,
    country_codes: normalizeList(draft.country_codes),
    province_codes: normalizeList(draft.province_codes),
    postal_code_patterns: normalizeList(draft.postal_code_patterns),
    is_active: draft.is_active,
    priority: Number(draft.priority || "100"),
    notes: draft.notes.trim() || null,
  };
}

export function ShippingRulesManager({ shop }: ShippingRulesManagerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rules, setRules] = useState<ShippingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<RuleDraft>(EMPTY_DRAFT);

  const sortedRules = useMemo(
    () => [...rules].sort((left, right) => left.priority - right.priority || left.id - right.id),
    [rules],
  );

  async function loadRules() {
    setLoading(true);
    try {
      const response = await fetch(`/api/shipping-rules?shop_id=${shop.id}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => [])) as ShippingRule[];
      if (response.ok) {
        setRules(payload);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRules();
  }, [shop.id]);

  function openNewRule() {
    setEditingId("new");
    setDraft(EMPTY_DRAFT);
    setMessage(null);
  }

  function openEditRule(rule: ShippingRule) {
    setEditingId(rule.id);
    setDraft(mapRuleToDraft(rule));
    setMessage(null);
  }

  function closeEditor() {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
  }

  async function saveRule() {
    setMessage(null);
    const isNew = editingId === "new";
    const url = isNew ? "/api/shipping-rules" : `/api/shipping-rules/${editingId}`;
    const method = isNew ? "POST" : "PATCH";
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload(shop.id, draft)),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setMessage({ kind: "error", text: payload?.detail ?? "No se pudo guardar la regla." });
      return;
    }
    setMessage({ kind: "success", text: isNew ? "Regla creada." : "Regla actualizada." });
    closeEditor();
    await loadRules();
    startTransition(() => router.refresh());
  }

  async function deleteRule(ruleId: number) {
    setMessage(null);
    const response = await fetch(`/api/shipping-rules/${ruleId}`, { method: "DELETE" });
    if (!response.ok) {
      setMessage({ kind: "error", text: "No se pudo eliminar la regla." });
      return;
    }
    setMessage({ kind: "success", text: "Regla eliminada." });
    await loadRules();
    startTransition(() => router.refresh());
  }

  return (
    <div className="stack">
      <div className="shipping-rules-head">
        <div>
          <span className="eyebrow">Reglas de envío</span>
          <h4 className="section-title section-title-small">Detección automática de servicio CTT</h4>
          <p className="subtitle">
            Usa zona, tarifa Shopify, peso o precio para sugerir automáticamente el servicio correcto, manteniendo override manual en operaciones.
          </p>
        </div>
        <button className="button-secondary" onClick={openNewRule} type="button">
          Nueva regla
        </button>
      </div>

      {message ? (
        <div className={`feedback ${message.kind === "success" ? "feedback-success" : "feedback-error"}`}>
          {message.text}
        </div>
      ) : null}

      <div className="table-wrap shipping-rules-table-wrap">
        <table className="table shipping-rules-table">
          <thead>
            <tr>
              <th>Zona</th>
              <th>Nombre tarifa</th>
              <th>Tarifa</th>
              <th>Rango</th>
              <th>Tipo</th>
              <th>Servicio CTT</th>
              <th>Prioridad</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="table-secondary" colSpan={9}>Cargando reglas...</td>
              </tr>
            ) : sortedRules.length === 0 ? (
              <tr>
                <td className="table-secondary" colSpan={9}>Todavía no hay reglas configuradas para esta tienda.</td>
              </tr>
            ) : (
              sortedRules.map((rule) => (
                <tr className="table-row" key={rule.id}>
                  <td className="table-primary">{rule.zone_name}</td>
                  <td>{rule.shipping_rate_name ?? "Cualquier tarifa"}</td>
                  <td>{rule.shipping_rate_amount != null ? `${rule.shipping_rate_amount.toFixed(2)}€` : "Cualquiera"}</td>
                  <td>
                    {(rule.min_value ?? 0).toFixed(2)} {rule.rule_type === "price" ? "€" : "kg"} -{" "}
                    {rule.max_value != null ? `${rule.max_value.toFixed(2)} ${rule.rule_type === "price" ? "€" : "kg"}` : "∞"}
                  </td>
                  <td>{rule.rule_type === "weight" ? "Por peso" : "Por precio"}</td>
                  <td>{rule.carrier_service_label ?? rule.carrier_service_code}</td>
                  <td>{rule.priority}</td>
                  <td><span className="badge">{rule.is_active ? "Activa" : "Pausada"}</span></td>
                  <td>
                    <div className="table-actions-row">
                      <button className="button-ghost" onClick={() => openEditRule(rule)} type="button">Editar</button>
                      <button className="button-ghost danger" onClick={() => void deleteRule(rule.id)} type="button">Eliminar</button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editingId !== null ? (
        <div className="shipping-rule-editor">
          <div className="portal-settings-grid">
            <div className="field">
              <label>Zona</label>
              <input value={draft.zone_name} onChange={(event) => setDraft((current) => ({ ...current, zone_name: event.target.value }))} />
            </div>
            <div className="field">
              <label>Nombre de tarifa Shopify</label>
              <input value={draft.shipping_rate_name} onChange={(event) => setDraft((current) => ({ ...current, shipping_rate_name: event.target.value }))} placeholder="Envío estándar 24h" />
            </div>
            <div className="field">
              <label>Tarifa de envío</label>
              <input value={draft.shipping_rate_amount} onChange={(event) => setDraft((current) => ({ ...current, shipping_rate_amount: event.target.value }))} placeholder="4.99" />
            </div>
            <div className="field">
              <label>Tipo de regla</label>
              <select value={draft.rule_type} onChange={(event) => setDraft((current) => ({ ...current, rule_type: event.target.value }))}>
                <option value="price">Por precio</option>
                <option value="weight">Por peso</option>
              </select>
            </div>
            <div className="field">
              <label>Mínimo</label>
              <input value={draft.min_value} onChange={(event) => setDraft((current) => ({ ...current, min_value: event.target.value }))} placeholder="0" />
            </div>
            <div className="field">
              <label>Máximo</label>
              <input value={draft.max_value} onChange={(event) => setDraft((current) => ({ ...current, max_value: event.target.value }))} placeholder="∞" />
            </div>
            <div className="field">
              <label>Servicio CTT</label>
              <input value={draft.carrier_service_code} onChange={(event) => setDraft((current) => ({ ...current, carrier_service_code: event.target.value }))} placeholder="C24" />
            </div>
            <div className="field">
              <label>Label servicio</label>
              <input value={draft.carrier_service_label} onChange={(event) => setDraft((current) => ({ ...current, carrier_service_label: event.target.value }))} placeholder="CTT 24h" />
            </div>
            <div className="field">
              <label>Países</label>
              <input value={draft.country_codes} onChange={(event) => setDraft((current) => ({ ...current, country_codes: event.target.value }))} placeholder="ES, PT" />
            </div>
            <div className="field">
              <label>Provincias</label>
              <input value={draft.province_codes} onChange={(event) => setDraft((current) => ({ ...current, province_codes: event.target.value }))} placeholder="PM, GC, TF" />
            </div>
            <div className="field field-span-2">
              <label>Patrones CP</label>
              <input value={draft.postal_code_patterns} onChange={(event) => setDraft((current) => ({ ...current, postal_code_patterns: event.target.value }))} placeholder="07*, 35*, 38*" />
            </div>
            <div className="field">
              <label>Prioridad</label>
              <input value={draft.priority} onChange={(event) => setDraft((current) => ({ ...current, priority: event.target.value }))} placeholder="100" />
            </div>
            <label className="shipping-settings-toggle field-span-2">
              <input checked={draft.is_active} onChange={(event) => setDraft((current) => ({ ...current, is_active: event.target.checked }))} type="checkbox" />
              <div>
                <strong>Regla activa</strong>
                <p className="subtitle">Si la desactivas deja de participar en la detección automática.</p>
              </div>
            </label>
            <div className="field field-span-2">
              <label>Notas</label>
              <input value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Observaciones operativas o aclaraciones internas" />
            </div>
          </div>
          <div className="modal-footer">
            <button className="button-secondary" onClick={closeEditor} type="button">Cancelar</button>
            <button className="button" disabled={isPending} onClick={() => void saveRule()} type="button">Guardar regla</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
