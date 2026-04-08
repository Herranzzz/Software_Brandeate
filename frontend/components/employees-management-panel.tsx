"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type Dispatch, type SetStateAction } from "react";

import { AppModal } from "@/components/app-modal";
import { Card } from "@/components/card";
import { KpiCard } from "@/components/kpi-card";
import { PageHeader } from "@/components/page-header";
import { formatDateTime } from "@/lib/format";
import type {
  EmployeeActivityResponse,
  EmployeeAnalyticsRow,
  EmployeeMetricsPeriod,
  Shop,
  UserRole,
} from "@/lib/types";


type EmployeesManagementPanelProps = {
  employees: EmployeeAnalyticsRow[];
  shops: Shop[];
  period: EmployeeMetricsPeriod;
  periodLinks: Array<{
    label: string;
    href: string;
    active: boolean;
  }>;
};

type EmployeeFormState = {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  is_active: boolean;
  shop_ids: number[];
};

const roleOptions: Array<{ value: UserRole; label: string; hint: string }> = [
  { value: "ops_admin", label: "Ops admin", hint: "Acceso global a operativa, etiquetas y paneles internos." },
  { value: "shop_admin", label: "Shop admin", hint: "Gestiona una o varias tiendas concretas con capacidad operativa." },
  { value: "shop_viewer", label: "Shop viewer", hint: "Solo consulta y seguimiento para cuentas con acceso más acotado." },
];

const roleLabels: Record<UserRole, string> = {
  super_admin: "Super admin",
  ops_admin: "Ops admin",
  shop_admin: "Shop admin",
  shop_viewer: "Shop viewer",
};

function getEmptyForm(): EmployeeFormState {
  return {
    name: "",
    email: "",
    password: "",
    role: "shop_admin",
    is_active: true,
    shop_ids: [],
  };
}

function getPeriodCount(employee: EmployeeAnalyticsRow, period: EmployeeMetricsPeriod) {
  return period === "day" ? employee.labels_today : employee.labels_this_week;
}

async function readErrorMessage(response: Response) {
  try {
    const payload = (await response.json()) as { detail?: string } | null;
    return payload?.detail ?? "No se pudo completar la operación.";
  } catch {
    return "No se pudo completar la operación.";
  }
}

export function EmployeesManagementPanel({
  employees,
  shops,
  period,
  periodLinks,
}: EmployeesManagementPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [createForm, setCreateForm] = useState<EmployeeFormState>(getEmptyForm);
  const [editForm, setEditForm] = useState<EmployeeFormState>(getEmptyForm);
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeAnalyticsRow | null>(null);
  const [activityData, setActivityData] = useState<EmployeeActivityResponse | null>(null);
  const [isActivityLoading, setIsActivityLoading] = useState(false);

  const totals = useMemo(() => {
    const labelsToday = employees.reduce((sum, employee) => sum + employee.labels_today, 0);
    const labelsThisWeek = employees.reduce((sum, employee) => sum + employee.labels_this_week, 0);
    const totalLabels = employees.reduce((sum, employee) => sum + employee.total_labels, 0);
    const activeEmployees = employees.filter((employee) => employee.is_active).length;
    const activeInPeriod = employees.filter((employee) => getPeriodCount(employee, period) > 0).length;
    return {
      count: employees.length,
      activeEmployees,
      labelsToday,
      labelsThisWeek,
      totalLabels,
      activeInPeriod,
    };
  }, [employees, period]);

  const ranking = useMemo(
    () => [...employees].sort((left, right) => getPeriodCount(right, period) - getPeriodCount(left, period) || right.total_labels - left.total_labels),
    [employees, period],
  );
  const topPeriodValue = Math.max(1, ...ranking.map((employee) => getPeriodCount(employee, period)));

  function updateForm(
    setter: Dispatch<SetStateAction<EmployeeFormState>>,
    update: Partial<EmployeeFormState>,
  ) {
    setter((current) => ({ ...current, ...update }));
  }

  function toggleShop(
    setter: Dispatch<SetStateAction<EmployeeFormState>>,
    shopId: number,
  ) {
    setter((current) => ({
      ...current,
      shop_ids: current.shop_ids.includes(shopId)
        ? current.shop_ids.filter((id) => id !== shopId)
        : [...current.shop_ids, shopId],
    }));
  }

  async function handleCreateEmployee(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const needsShops = createForm.role === "shop_admin" || createForm.role === "shop_viewer";
    const response = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...createForm,
        email: createForm.email.trim().toLowerCase(),
        shop_ids: needsShops ? createForm.shop_ids : [],
      }),
    });

    if (!response.ok) {
      setMessage({ kind: "error", text: await readErrorMessage(response) });
      return;
    }

    setCreateOpen(false);
    setCreateForm(getEmptyForm());
    setMessage({ kind: "success", text: "Empleado creado correctamente." });
    startTransition(() => {
      router.refresh();
    });
  }

  function openEditModal(employee: EmployeeAnalyticsRow) {
    setSelectedEmployee(employee);
    setEditForm({
      name: employee.name,
      email: employee.email,
      password: "",
      role: employee.role,
      is_active: employee.is_active,
      shop_ids: employee.shops.map((shop) => shop.id),
    });
    setEditOpen(true);
    setMessage(null);
  }

  async function handleEditEmployee(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedEmployee) {
      return;
    }

    const needsShops = editForm.role === "shop_admin" || editForm.role === "shop_viewer";
    const response = await fetch(`/api/users/${selectedEmployee.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editForm.name.trim(),
        email: editForm.email.trim().toLowerCase(),
        role: editForm.role,
        is_active: editForm.is_active,
        password: editForm.password.trim() ? editForm.password : undefined,
        shop_ids: needsShops ? editForm.shop_ids : [],
      }),
    });

    if (!response.ok) {
      setMessage({ kind: "error", text: await readErrorMessage(response) });
      return;
    }

    setEditOpen(false);
    setSelectedEmployee(null);
    setMessage({ kind: "success", text: "Empleado actualizado correctamente." });
    startTransition(() => {
      router.refresh();
    });
  }

  async function handleToggleActive(employee: EmployeeAnalyticsRow) {
    setMessage(null);
    const response = await fetch(`/api/users/${employee.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !employee.is_active }),
    });

    if (!response.ok) {
      setMessage({ kind: "error", text: await readErrorMessage(response) });
      return;
    }

    setMessage({
      kind: "success",
      text: employee.is_active ? "Empleado desactivado." : "Empleado reactivado.",
    });
    startTransition(() => {
      router.refresh();
    });
  }

  async function handleOpenActivity(employee: EmployeeAnalyticsRow) {
    setSelectedEmployee(employee);
    setActivityOpen(true);
    setActivityData(null);
    setIsActivityLoading(true);
    setMessage(null);

    const response = await fetch(`/api/users/${employee.id}/activity?limit=12`, {
      cache: "no-store",
    });

    if (!response.ok) {
      setIsActivityLoading(false);
      setMessage({ kind: "error", text: await readErrorMessage(response) });
      return;
    }

    const payload = (await response.json()) as EmployeeActivityResponse;
    setActivityData(payload);
    setIsActivityLoading(false);
  }

  function renderShops(employee: EmployeeAnalyticsRow) {
    if (employee.role === "ops_admin" || employee.role === "super_admin") {
      return "Todas";
    }
    if (employee.shops.length === 0) {
      return "Sin tiendas";
    }
    return employee.shops.map((shop) => shop.name).join(", ");
  }

  function renderEmployeeForm(
    mode: "create" | "edit",
    form: EmployeeFormState,
    setter: Dispatch<SetStateAction<EmployeeFormState>>,
  ) {
    const needsShops = form.role === "shop_admin" || form.role === "shop_viewer";
    const selectedRole = roleOptions.find((option) => option.value === form.role);

    return (
      <form className="stack" onSubmit={mode === "create" ? handleCreateEmployee : handleEditEmployee}>
        <div className="portal-settings-grid">
          <div className="field">
            <label htmlFor={`${mode}-employee-name`}>Nombre</label>
            <input
              id={`${mode}-employee-name`}
              onChange={(event) => updateForm(setter, { name: event.target.value })}
              placeholder="Nombre del empleado"
              value={form.name}
            />
          </div>

          <div className="field">
            <label htmlFor={`${mode}-employee-email`}>Email</label>
            <input
              id={`${mode}-employee-email`}
              onChange={(event) => updateForm(setter, { email: event.target.value })}
              placeholder="equipo@brandeate.com"
              type="email"
              value={form.email}
            />
          </div>

          <div className="field">
            <label htmlFor={`${mode}-employee-password`}>
              {mode === "create" ? "Contraseña temporal" : "Nueva contraseña"}
            </label>
            <input
              id={`${mode}-employee-password`}
              minLength={mode === "create" ? 6 : undefined}
              onChange={(event) => updateForm(setter, { password: event.target.value })}
              placeholder={mode === "create" ? "Mínimo 6 caracteres" : "Déjalo vacío si no cambia"}
              type="password"
              value={form.password}
            />
          </div>

          <div className="field">
            <label htmlFor={`${mode}-employee-role`}>Rol</label>
            <select
              id={`${mode}-employee-role`}
              onChange={(event) =>
                updateForm(setter, {
                  role: event.target.value as UserRole,
                  shop_ids:
                    event.target.value === "ops_admin" ? [] : form.shop_ids,
                })
              }
              value={form.role}
            >
              {roleOptions.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
            <div className="table-secondary">{selectedRole?.hint}</div>
          </div>
        </div>

        <div className="employees-form-switch">
          <span className="employees-form-switch-copy">
            Estado de la cuenta
            <small>{form.is_active ? "Acceso permitido al iniciar sesión." : "La cuenta quedará creada pero bloqueada."}</small>
          </span>
          <button
            className={`employees-toggle ${form.is_active ? "is-active" : ""}`}
            onClick={(event) => {
              event.preventDefault();
              updateForm(setter, { is_active: !form.is_active });
            }}
            type="button"
          >
            <span />
          </button>
        </div>

        <div className="team-shops-block">
          <div className="team-shops-head">
            <strong>Tiendas asignadas</strong>
            <span className="table-secondary">
              {needsShops
                ? "Selecciona las tiendas que este empleado podrá operar o consultar."
                : "Los ops admin tienen alcance global y no necesitan asignación."}
            </span>
          </div>

          <div className="team-shop-grid">
            {shops.map((shop) => {
              const isSelected = form.shop_ids.includes(shop.id);
              return (
                <button
                  className={`team-shop-pill ${isSelected ? "team-shop-pill-active" : ""}`}
                  disabled={!needsShops}
                  key={shop.id}
                  onClick={(event) => {
                    event.preventDefault();
                    if (needsShops) {
                      toggleShop(setter, shop.id);
                    }
                  }}
                  type="button"
                >
                  {shop.name}
                </button>
              );
            })}
          </div>
        </div>

        <div className="modal-footer">
          <button
            className="button"
            disabled={
              isPending ||
              !form.name.trim() ||
              !form.email.trim() ||
              (mode === "create" && form.password.length < 6) ||
              (mode === "edit" && form.password.length > 0 && form.password.length < 6) ||
              (needsShops && form.shop_ids.length === 0)
            }
            type="submit"
          >
            {mode === "create" ? "Crear empleado" : "Guardar cambios"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="stack employees-shell">
      <PageHeader
        eyebrow="Equipo"
        title="Empleados"
        description="Gestiona accesos internos, revisa actividad operativa y entiende quién está generando etiquetas dentro del sistema."
        actions={
          <button className="button" onClick={() => setCreateOpen(true)} type="button">
            Crear empleado
          </button>
        }
      />

      <section className="admin-dashboard-timebar employees-filter-row">
        <span className="admin-dashboard-timebar-label">Métricas</span>
        <div className="dashboard-donut-range-pills">
          {periodLinks.map((link) => (
            <Link className={`shipments-range-pill${link.active ? " is-active" : ""}`} href={link.href} key={link.href}>
              {link.label}
            </Link>
          ))}
        </div>
      </section>

      {message ? <div className={`feedback feedback-${message.kind}`}>{message.text}</div> : null}

      <section className="admin-dashboard-kpis">
        <KpiCard delta={`${totals.activeEmployees} activos`} index={0} label="Equipo" tone="default" value={String(totals.count)} />
        <KpiCard delta={`${totals.activeInPeriod} con actividad`} index={1} label="Etiquetas hoy" tone="accent" value={String(totals.labelsToday)} />
        <KpiCard delta="últimos 7 días" index={2} label="Etiquetas semana" tone="success" value={String(totals.labelsThisWeek)} />
        <KpiCard delta="histórico operativo" index={3} label="Etiquetas totales" tone="warning" value={String(totals.totalLabels)} />
      </section>

      <section className="employees-grid">
        <Card className="stack employees-ranking-card">
          <div className="admin-dashboard-panel-head">
            <div>
              <span className="eyebrow">Rendimiento</span>
              <h3 className="section-title section-title-small">
                Ranking por {period === "day" ? "día" : "semana"}
              </h3>
            </div>
            <div className="team-count-pill">{ranking.length} perfiles</div>
          </div>

          <div className="employees-ranking-list">
            {ranking.slice(0, 6).map((employee, index) => {
              const value = getPeriodCount(employee, period);
              return (
                <article className="employees-ranking-row" key={employee.id}>
                  <div className="employees-ranking-main">
                    <div className="employees-ranking-meta">
                      <span className="employees-ranking-index">{index + 1}</span>
                      <div>
                        <strong>{employee.name}</strong>
                        <div className="table-secondary">{roleLabels[employee.role]}</div>
                      </div>
                    </div>
                    <strong>{value}</strong>
                  </div>
                  <div className="employees-ranking-track">
                    <span style={{ width: `${Math.max(10, (value / topPeriodValue) * 100)}%` }} />
                  </div>
                </article>
              );
            })}
          </div>
        </Card>

        <Card className="stack employees-summary-card">
          <div className="admin-dashboard-panel-head">
            <div>
              <span className="eyebrow">Cobertura</span>
              <h3 className="section-title section-title-small">Vista operativa</h3>
            </div>
          </div>

          <div className="employees-summary-list">
            <article className="employees-summary-item">
              <span>Empleados activos</span>
              <strong>{totals.activeEmployees}</strong>
            </article>
            <article className="employees-summary-item">
              <span>Con etiquetas {period === "day" ? "hoy" : "esta semana"}</span>
              <strong>{totals.activeInPeriod}</strong>
            </article>
            <article className="employees-summary-item">
              <span>Ops admin</span>
              <strong>{employees.filter((employee) => employee.role === "ops_admin").length}</strong>
            </article>
            <article className="employees-summary-item">
              <span>Cuentas inactivas</span>
              <strong>{employees.filter((employee) => !employee.is_active).length}</strong>
            </article>
          </div>
        </Card>
      </section>

      <Card className="stack table-card employees-table-card">
        <div className="admin-dashboard-panel-head">
          <div>
            <span className="eyebrow">Gestión</span>
            <h3 className="section-title section-title-small">Equipo y analítica por empleado</h3>
            <p className="subtitle">
              Cada fila combina cuenta, permisos y rendimiento real en creación de etiquetas.
            </p>
          </div>
        </div>

        <div className="table-wrap employees-table-wrap">
          <table className="table employees-table">
            <thead>
              <tr>
                <th>Empleado</th>
                <th>Rol</th>
                <th>Estado</th>
                <th>Tiendas</th>
                <th>Hoy</th>
                <th>Semana</th>
                <th>Total</th>
                <th>Última actividad</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((employee) => (
                <tr className="table-row" key={employee.id}>
                  <td>
                    <div className="employees-user-cell">
                      <strong>{employee.name}</strong>
                      <span className="table-secondary">{employee.email}</span>
                    </div>
                  </td>
                  <td><span className="portal-soft-pill">{roleLabels[employee.role]}</span></td>
                  <td>
                    <span className={`employees-status-pill ${employee.is_active ? "is-active" : "is-inactive"}`}>
                      {employee.is_active ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td className="table-secondary employees-cell-wide">{renderShops(employee)}</td>
                  <td className="table-primary">{employee.labels_today}</td>
                  <td className="table-primary">{employee.labels_this_week}</td>
                  <td className="table-primary">{employee.total_labels}</td>
                  <td className="table-secondary">
                    {employee.last_activity_at ? formatDateTime(employee.last_activity_at) : "Sin actividad"}
                  </td>
                  <td>
                    <div className="employees-actions">
                      <button className="button button-secondary" onClick={() => openEditModal(employee)} type="button">
                        Editar
                      </button>
                      <button className="button button-secondary" onClick={() => handleOpenActivity(employee)} type="button">
                        Actividad
                      </button>
                      <button className="button button-secondary" onClick={() => handleToggleActive(employee)} type="button">
                        {employee.is_active ? "Desactivar" : "Activar"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <AppModal
        actions={
          <button className="button button-secondary" onClick={() => setCreateOpen(false)} type="button">
            Cerrar
          </button>
        }
        eyebrow="Nuevo acceso"
        onClose={() => setCreateOpen(false)}
        open={createOpen}
        subtitle="Alta de cuentas operativas o accesos acotados para el equipo."
        title="Crear empleado"
        width="wide"
      >
        {renderEmployeeForm("create", createForm, setCreateForm)}
      </AppModal>

      <AppModal
        actions={
          <button className="button button-secondary" onClick={() => setEditOpen(false)} type="button">
            Cerrar
          </button>
        }
        eyebrow="Gestión"
        onClose={() => setEditOpen(false)}
        open={editOpen}
        subtitle={selectedEmployee ? `Actualiza permisos y disponibilidad de ${selectedEmployee.name}.` : undefined}
        title="Editar empleado"
        width="wide"
      >
        {renderEmployeeForm("edit", editForm, setEditForm)}
      </AppModal>

      <AppModal
        actions={
          <button className="button button-secondary" onClick={() => setActivityOpen(false)} type="button">
            Cerrar
          </button>
        }
        eyebrow="Trazabilidad"
        onClose={() => setActivityOpen(false)}
        open={activityOpen}
        subtitle={selectedEmployee ? `Últimas etiquetas y expediciones creadas por ${selectedEmployee.name}.` : undefined}
        title="Detalle de actividad"
        width="wide"
      >
        <div className="stack">
          {isActivityLoading ? <div className="admin-dashboard-empty">Cargando actividad…</div> : null}

          {!isActivityLoading && activityData?.items.length === 0 ? (
            <div className="admin-dashboard-empty">Este empleado todavía no ha generado etiquetas.</div>
          ) : null}

          {!isActivityLoading && activityData?.items.length ? (
            <div className="employees-activity-list">
              {activityData.items.map((item) => (
                <article className="employees-activity-item" key={item.shipment_id}>
                  <div>
                    <strong>{item.order_external_id}</strong>
                    <div className="table-secondary">
                      {item.carrier} · {item.tracking_number}
                    </div>
                  </div>
                  <div className="employees-activity-meta">
                    <span>{item.label_created_at ? "Etiqueta creada" : "Shipment creado"}</span>
                    <strong>{formatDateTime(item.last_activity_at)}</strong>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </div>
      </AppModal>
    </div>
  );
}
