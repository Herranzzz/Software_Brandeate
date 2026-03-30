import { getDesignStatusLabel, getDesignStatusStyles, getOrderDesignStatus } from "@/lib/format";
import type { Order } from "@/lib/types";


type DesignAvailabilityBadgeProps = {
  order: Order;
};


export function DesignAvailabilityBadge({ order }: DesignAvailabilityBadgeProps) {
  const status = getOrderDesignStatus(order);
  if (!status) {
    return <span className="badge badge-design badge-design-default">Sin diseño</span>;
  }

  const meta = getDesignStatusStyles(status);
  return <span className={meta.className}>{getDesignStatusLabel(status)}</span>;
}
