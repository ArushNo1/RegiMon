import KeyCard from './KeyCard';

export default function KeysPanel({ registryPaths, newPath, onNewPathChange, onAddPath, onRemovePath, onReloadFromFile }) {
  return (
    <div>
      <div className="mb-4">
        <label htmlFor="registry-path-input" className="block text-text-muted text-xs font-medium mb-1.5">
          Add Registry Key
        </label>
        <div className="flex gap-2">
          <input
            id="registry-path-input"
            type="text"
            placeholder="HKEY_CURRENT_USER\Software\..."
            value={newPath}
            onChange={(e) => onNewPathChange(e.target.value)}
            onKeyUp={(e) => e.key === 'Enter' && onAddPath()}
            className="flex-1 px-3 py-2 bg-bg-surface border border-border rounded-md text-text-primary text-sm font-mono placeholder-text-muted/40 focus:outline-none focus:border-accent-highlight transition-colors"
          />
          <button
            onClick={onAddPath}
            className="flex items-center gap-1.5 px-4 py-2 bg-accent/15 hover:bg-accent/25 text-accent rounded-md font-medium text-sm cursor-pointer transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add
          </button>
        </div>
        <button
          onClick={onReloadFromFile}
          className="text-text-muted/60 hover:text-text-primary text-xs cursor-pointer transition-colors mt-2 underline underline-offset-2"
        >
          Reset to default paths
        </button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {registryPaths.map((path) => (
          <KeyCard key={path.key} path={path} onRemove={onRemovePath} />
        ))}
      </div>
    </div>
  );
}
