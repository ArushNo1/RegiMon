export default function Header({ monitoring, onStart, onStop }) {
  return (
    <div className="bg-bg-surface border-b border-border">
      <div className="max-w-7xl mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="/app-icon.png"
              alt="RegiMon"
              className="w-9 h-9"
            />
            <div>
              <h1 className="text-xl font-mono font-bold text-text-primary tracking-tight">
                RegiMon
              </h1>
              <p className="text-text-muted text-xs">
                Windows Registry Monitor
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                {monitoring && (
                  <span className="absolute inset-0 rounded-full bg-accent-live animate-pulse-ring" />
                )}
                <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${monitoring ? 'bg-accent-live' : 'bg-accent-danger'}`} />
              </span>
              <span className="text-text-muted text-xs font-semibold uppercase tracking-wider">
                {monitoring ? 'Live' : 'Idle'}
              </span>
            </div>
            <button
              onClick={monitoring ? onStop : onStart}
              className={`flex items-center gap-2 px-5 py-2 rounded-full font-medium text-sm cursor-pointer transition-all duration-150 ${monitoring
                ? 'bg-accent-danger/15 text-accent-danger hover:bg-accent-danger/25'
                : 'bg-accent-live/15 text-accent-live hover:bg-accent-live/25'
              }`}
            >
              {monitoring ? (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="1" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
              {monitoring ? 'Stop' : 'Start'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
