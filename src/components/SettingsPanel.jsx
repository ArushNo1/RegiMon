import ChangeCard from './ChangeCard';
import EmptyState from './EmptyState';

export default function SettingsPanel() {
  if (true) {
    return (
      <EmptyState
        icon={
          <svg className="w-10 h-10" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        }
        title="No Changes Detected"
        message={'hi'
        }
      />
    );
  }

  return (
    <div className="space-y-2">
      <p>hi</p>  
    </div>
  );
}
