/**
 * SLA badge — shows delivery window status based on expected_delivery_date.
 * Only renders when a shipment is in-transit (not delivered/exception/label_created).
 */

type SlaBadgeProps = {
  expectedDeliveryDate: string | null | undefined;
  shippingStatus: string | null | undefined;
};

function getDaysDiff(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

const RESOLVED_STATUSES = new Set(["delivered", "exception", "stalled"]);
const PRE_PICKUP_STATUSES = new Set(["label_created", "pickup_available"]);

export function SlaBadge({ expectedDeliveryDate, shippingStatus }: SlaBadgeProps) {
  if (!expectedDeliveryDate) return null;

  const status = (shippingStatus || "").toLowerCase();
  // Don't show for already-resolved or pre-pickup shipments
  if (RESOLVED_STATUSES.has(status) || PRE_PICKUP_STATUSES.has(status)) return null;

  const days = getDaysDiff(expectedDeliveryDate);

  let label: string;
  let className: string;

  if (days < 0) {
    label = `Vencido (${Math.abs(days)}d)`;
    className = "sla-badge sla-overdue";
  } else if (days === 0) {
    label = "Entrega hoy";
    className = "sla-badge sla-today";
  } else if (days === 1) {
    label = "Entrega mañana";
    className = "sla-badge sla-tomorrow";
  } else {
    label = `Entrega en ${days}d`;
    className = "sla-badge sla-ok";
  }

  return <span className={className}>{label}</span>;
}
