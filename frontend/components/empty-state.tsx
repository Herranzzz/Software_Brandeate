type EmptyStateProps = {
  title: string;
  description: string;
};


export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-orb" aria-hidden="true" />
      <h3 className="empty-title">{title}</h3>
      <p className="empty-description">{description}</p>
    </div>
  );
}
