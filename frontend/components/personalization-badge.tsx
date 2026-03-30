type PersonalizationBadgeProps = {
  isPersonalized: boolean;
};


export function PersonalizationBadge({ isPersonalized }: PersonalizationBadgeProps) {
  return (
    <span
      className={`badge ${isPersonalized ? "badge-personalized" : "badge-standard"}`}
    >
      {isPersonalized ? "Personalizado" : "Estandar"}
    </span>
  );
}
