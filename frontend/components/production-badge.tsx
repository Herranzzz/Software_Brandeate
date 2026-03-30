import { getProductionStatusMeta } from "@/lib/format";
import type { ProductionStatus } from "@/lib/types";


type ProductionBadgeProps = {
  status: ProductionStatus;
  neutral?: boolean;
};


export function ProductionBadge({ status, neutral = false }: ProductionBadgeProps) {
  const meta = getProductionStatusMeta(status);

  return <span className={neutral ? "badge" : meta.className}>{meta.label}</span>;
}
