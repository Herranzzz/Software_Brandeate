import type { AutomationFlag } from "@/lib/types";


type AutomationFlagBadgeProps = {
  flag: AutomationFlag;
};

export function AutomationFlagBadge({ flag }: AutomationFlagBadgeProps) {
  return (
    <span className={`automation-flag-badge automation-flag-badge-${flag.tone}`} title={flag.description}>
      {flag.label}
    </span>
  );
}
