import { getDesignStatusLabel, getDesignStatusStyles } from "@/lib/format";
import type { DesignStatus } from "@/lib/types";


type DesignStatusBadgeProps = {
  status: DesignStatus;
};


export function DesignStatusBadge({ status }: DesignStatusBadgeProps) {
  const meta = getDesignStatusStyles(status);
  return <span className={meta.className}>{getDesignStatusLabel(status)}</span>;
}
