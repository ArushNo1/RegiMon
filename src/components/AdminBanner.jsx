export default function AdminBanner({ onRequestElevation }) {
  return (
    <div className="bg-accent-warn/10 border border-accent-warn/30 rounded-lg px-4 py-3 mb-4 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <svg className="w-4 h-4 text-accent-warn flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
        <p className="text-accent-warn text-sm">
          Admin required for <span className="font-mono font-semibold">HKLM</span> / <span className="font-mono font-semibold">HKCR</span> keys
        </p>
      </div>
      <button
        onClick={onRequestElevation}
        className="px-3 py-1.5 bg-accent-warn/15 hover:bg-accent-warn/25 text-accent-warn rounded-md font-medium text-xs cursor-pointer transition-colors whitespace-nowrap"
      >
        Elevate
      </button>
    </div>
  );
}
