export type DashboardKpi = {
  label: string;
  value: string;
  delta: string;
  tone?: "default" | "accent" | "success" | "warning" | "danger";
};

export type DashboardActivity = {
  id: number;
  title: string;
  detail: string;
  time: string;
};

export type DashboardIncident = {
  id: number;
  type: string;
  priority: "low" | "medium" | "high" | "critical";
  order: string;
  customer: string;
  state: "open" | "investigating" | "blocked" | "resolved";
  owner: string;
  updated_at: string;
};

export type DashboardChartPoint = {
  day: string;
  value: number;
};

export const dashboardKpis: DashboardKpi[] = [
  { label: "Pedidos nuevos", value: "42", delta: "+12% hoy", tone: "default" },
  { label: "En produccion", value: "18", delta: "6 urgentes", tone: "accent" },
  { label: "Enviados", value: "27", delta: "4 carriers activos", tone: "warning" },
  { label: "Entregados", value: "96%", delta: "SLA semanal", tone: "success" },
  { label: "Incidencias", value: "5", delta: "2 criticas", tone: "danger" },
];

export const dashboardChart: DashboardChartPoint[] = [
  { day: "Lun", value: 18 },
  { day: "Mar", value: 26 },
  { day: "Mie", value: 21 },
  { day: "Jue", value: 30 },
  { day: "Vie", value: 34 },
  { day: "Sab", value: 20 },
  { day: "Dom", value: 14 },
];

export const dashboardStatusSummary = [
  { label: "Pending", value: 14 },
  { label: "In progress", value: 18 },
  { label: "Ready to ship", value: 9 },
  { label: "Shipped", value: 27 },
  { label: "Delivered", value: 41 },
  { label: "Exception", value: 5 },
];

export const recentActivity: DashboardActivity[] = [
  {
    id: 1,
    title: "Shipment creado para ORD-1042",
    detail: "DHL · tracking 003404341122",
    time: "Hace 12 min",
  },
  {
    id: 2,
    title: "Incidencia abierta por direccion incompleta",
    detail: "Pedido ORD-1031 · cliente Marta Perez",
    time: "Hace 27 min",
  },
  {
    id: 3,
    title: "Tracking actualizado a out_for_delivery",
    detail: "Pedido ORD-1018 · UPS",
    time: "Hace 41 min",
  },
  {
    id: 4,
    title: "Pedido marcado como ready_to_ship",
    detail: "Lote de produccion morning-batch-7",
    time: "Hace 58 min",
  },
];

export const mockIncidencias: DashboardIncident[] = [
  {
    id: 9001,
    type: "Direccion incompleta",
    priority: "high",
    order: "ORD-1031",
    customer: "Marta Perez",
    state: "open",
    owner: "Lucia",
    updated_at: "2026-03-28T17:40:00Z",
  },
  {
    id: 9002,
    type: "Carrier con retraso",
    priority: "medium",
    order: "ORD-1027",
    customer: "Daniel Vega",
    state: "investigating",
    owner: "Marco",
    updated_at: "2026-03-28T16:15:00Z",
  },
  {
    id: 9003,
    type: "Producto dañado",
    priority: "critical",
    order: "ORD-1011",
    customer: "Paula Neri",
    state: "blocked",
    owner: "Lucia",
    updated_at: "2026-03-28T15:05:00Z",
  },
  {
    id: 9004,
    type: "Reintento de entrega",
    priority: "low",
    order: "ORD-1005",
    customer: "Ruben Soler",
    state: "resolved",
    owner: "Mario",
    updated_at: "2026-03-28T12:45:00Z",
  },
];
