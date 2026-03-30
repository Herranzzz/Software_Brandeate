import { getOrderPriorityMeta } from "@/lib/format";
import type { OrderPriority } from "@/lib/types";


type PriorityBadgeProps = {
  priority: OrderPriority;
  neutral?: boolean;
};


export function PriorityBadge({ priority, neutral = false }: PriorityBadgeProps) {
  const meta = getOrderPriorityMeta(priority);
  return <span className={neutral ? "badge" : meta.className}>{meta.label}</span>;
}
