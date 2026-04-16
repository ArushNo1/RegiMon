export default function NavTabs({ currentScreen, onChangeScreen, pathCount, changesCount, onClearChanges }) {
  return (
    <div className="bg-bg-surface border-b border-border">
      <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
        <div className="flex gap-6">
          <button
            onClick={() => onChangeScreen('keys')}
            className={`flex items-center gap-2 px-1 py-3.5 font-medium text-sm cursor-pointer transition-colors border-b-2 ${currentScreen === 'keys'
              ? 'text-accent-highlight border-accent-highlight'
              : 'text-text-muted border-transparent hover:text-text-primary'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
            Keys
            <span className="text-xs text-text-muted">({pathCount})</span>
          </button>
          <button
            onClick={() => onChangeScreen('changes')}
            className={`flex items-center gap-2 px-1 py-3.5 font-medium text-sm cursor-pointer transition-colors border-b-2 ${currentScreen === 'changes'
              ? 'text-accent-highlight border-accent-highlight'
              : 'text-text-muted border-transparent hover:text-text-primary'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Changes
            {changesCount > 0 && (
              <span className="px-1.5 py-0.5 bg-accent-danger text-white text-xs rounded-full font-semibold leading-none">
                {changesCount}
              </span>
            )}
          </button>
          <button
            onClick={() => onChangeScreen('settings')}
            className={`flex items-center gap-2 px-1 py-3.5 font-medium text-sm cursor-pointer transition-colors border-b-2 ${currentScreen === 'settings'
              ? 'text-accent-highlight border-accent-highlight'
              : 'text-text-muted border-transparent hover:text-text-primary'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Settings
          </button>
        </div>
        {currentScreen === 'changes' && changesCount > 0 && (
          <button
            onClick={onClearChanges}
            className="flex items-center gap-1.5 text-text-muted hover:text-accent-danger text-xs cursor-pointer transition-colors"
            title="Clear all changes"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
