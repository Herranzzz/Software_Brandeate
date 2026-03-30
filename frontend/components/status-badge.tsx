import { getOrderStatusMeta } from "@/lib/format";
import type { OrderStatus } from "@/lib/types";


type StatusBadgeProps = {
  status: OrderStatus;
  neutral?: boolean;
};


export function StatusBadge({ status, neutral = false }: StatusBadgeProps) {
  const meta = getOrderStatusMeta(status);

  return <span className={neutral ? "badge" : meta.className}>{meta.label}</span>;
}
