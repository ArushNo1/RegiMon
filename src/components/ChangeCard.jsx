const TYPE_CONFIG = {
  modified:      { label: 'Modified',      badgeClass: 'bg-accent-change/15 text-accent-change', borderClass: 'border-l-accent-change' },
  added:         { label: 'Added',         badgeClass: 'bg-accent-live/15 text-accent-live',     borderClass: 'border-l-accent-live' },
  deleted:       { label: 'Deleted',       badgeClass: 'bg-accent-danger/15 text-accent-danger', borderClass: 'border-l-accent-danger' },
  subkey_added:  { label: 'Subkey Added',  badgeClass: 'bg-accent-live/15 text-accent-live',     borderClass: 'border-l-accent-live' },
  subkey_deleted:{ label: 'Subkey Deleted', badgeClass: 'bg-accent-danger/15 text-accent-danger', borderClass: 'border-l-accent-danger' },
};

function timeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

export default function ChangeCard({ change, isUndone, onUndo }) {
  const config = TYPE_CONFIG[change.change_type] || TYPE_CONFIG.modified;
  const canUndo = !isUndone && !change.change_type.startsWith('subkey_');

  return (
    <div
      className={`animate-slide-in bg-bg-surface border-l-[3px] border border-border rounded-lg p-4 ${config.borderClass} ${isUndone ? 'opacity-40' : ''}`}
    >
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded text-xs font-semibold ${config.badgeClass}`}>
            {config.label}
          </span>
          {isUndone && (
            <span className="px-2 py-0.5 rounded text-xs font-semibold bg-accent-info/15 text-accent-info">
              Undone
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span
            className="text-text-muted text-xs"
            title={new Date(change.timestamp).toLocaleString()}
          >
            {timeAgo(change.timestamp)}
          </span>
          {canUndo && (
            <button
              onClick={() => onUndo(change)}
              className="text-text-muted/50 hover:text-accent-info cursor-pointer transition-colors"
              title="Undo this change"
              aria-label="Undo this change"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a5 5 0 015 5v2M3 10l4-4M3 10l4 4" />
              </svg>
            </button>
          )}
        </div>
      </div>
      <div className="space-y-1.5 text-xs font-mono">
        <div>
          <span className="text-text-muted">Key </span>
          <span className="text-text-primary break-all">{change.key_path}</span>
        </div>
        {change.value_name && (
          <div>
            <span className="text-text-muted">Value </span>
            <span className="text-text-primary">{change.value_name}</span>
          </div>
        )}
        {change.old_value && (
          <div className="flex gap-1.5">
            <span className="text-accent-danger/70 shrink-0">-</span>
            <span className="text-accent-danger/70 break-all">{change.old_value}</span>
          </div>
        )}
        {change.new_value && (
          <div className="flex gap-1.5">
            <span className="text-accent-live/70 shrink-0">+</span>
            <span className="text-accent-live/70 break-all">{change.new_value}</span>
          </div>
        )}
      </div>
    </div>
  );
}
