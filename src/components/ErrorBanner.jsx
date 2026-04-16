export default function ErrorBanner({ error, onDismiss }) {
  return (
    <div className="bg-accent-danger/10 border border-accent-danger/30 rounded-lg px-4 py-3 mb-4 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
        <svg className="w-4 h-4 text-accent-danger flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-accent-danger text-sm truncate">{error}</p>
      </div>
      <button
        onClick={onDismiss}
        className="text-accent-danger/60 hover:text-accent-danger flex-shrink-0 text-lg leading-none cursor-pointer transition-colors"
        aria-label="Dismiss error"
      >
        &times;
      </button>
    </div>
  );
}
