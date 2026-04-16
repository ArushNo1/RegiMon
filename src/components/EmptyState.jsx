export default function EmptyState({ title, message, icon }) {
  return (
    <div className="bg-bg-surface border border-border rounded-lg p-12 text-center">
      {icon && (
        <div className="flex justify-center mb-4 text-text-muted/40">
          {icon}
        </div>
      )}
      <h3 className="text-base font-semibold text-text-primary mb-1.5">{title}</h3>
      <p className="text-text-muted text-sm">{message}</p>
    </div>
  );
}
