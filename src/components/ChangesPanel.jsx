import ChangeCard from './ChangeCard';
import EmptyState from './EmptyState';

export default function ChangesPanel({ changes, undoneChanges, monitoring, onUndo }) {
  if (changes.length === 0) {
    return (
      <EmptyState
        icon={
          <svg className="w-10 h-10" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        }
        title="No Changes Detected"
        message={monitoring
          ? 'Monitoring is active. Changes will appear here.'
          : 'Start monitoring to detect registry changes.'
        }
      />
    );
  }

  return (
    <div className="space-y-2">
      {changes.map((change) => (
        <ChangeCard
          key={change.id}
          change={change}
          isUndone={undoneChanges.has(change.id)}
          onUndo={onUndo}
        />
      ))}
    </div>
  );
}
