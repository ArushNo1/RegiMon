const HIVE_COLORS = {
  HKCU: 'bg-accent-live/15 text-accent-live',
  HKLM: 'bg-accent-warn/15 text-accent-warn',
  HKCR: 'bg-accent-info/15 text-accent-info',
};

const HIVE_LABELS = {
  HKEY_CURRENT_USER: 'HKCU',
  HKEY_LOCAL_MACHINE: 'HKLM',
  HKEY_CLASSES_ROOT: 'HKCR',
};

function getHive(keyPath) {
  const upper = keyPath.toUpperCase();
  for (const [full, short] of Object.entries(HIVE_LABELS)) {
    if (upper.startsWith(full) || upper.startsWith(short)) {
      return short;
    }
  }
  return null;
}

export default function KeyCard({ path, onRemove }) {
  const hive = getHive(path.key);
  const hiveClass = hive ? HIVE_COLORS[hive] : 'bg-accent/15 text-accent';
  const needsAdmin = hive === 'HKLM' || hive === 'HKCR';

  return (
    <div className="bg-bg-surface border border-border rounded-lg p-4 hover:border-border-hover transition-colors group">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {hive && (
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold uppercase shrink-0 ${hiveClass}`}>
              {hive}
            </span>
          )}
          {needsAdmin && (
            <svg className="w-3.5 h-3.5 text-accent-warn shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" title="Requires admin">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          )}
          <h3 className="font-mono text-xs text-text-primary font-medium break-all min-w-0">
            {path.key}
          </h3>
        </div>
        <button
          onClick={() => onRemove(path.key)}
          className="text-text-muted/40 hover:text-accent-danger cursor-pointer transition-colors opacity-0 group-hover:opacity-100 shrink-0"
          title="Remove key"
          aria-label={`Remove ${path.key}`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
      <p className="text-text-muted text-xs leading-relaxed">
        {path.description}
      </p>
    </div>
  );
}
