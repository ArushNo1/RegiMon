import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import './App.css';

function App() {
  const [monitoring, setMonitoring] = useState(false);
  const [changes, setChanges] = useState([]);
  const [undoneChanges, setUndoneChanges] = useState(new Set()); // Stores unique change IDs
  const undoneChangesRef = useRef(undoneChanges);
  const [isElevated, setIsElevated] = useState(false); // Assume elevated by default
  const [hasAdminPaths, setHasAdminPaths] = useState(false); // Tracks if any paths require admin
  const [registryPaths, setRegistryPaths] = useState(() => {
    // Try to load from localStorage first, then fall back to empty array
    const saved = localStorage.getItem('registryPaths');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      } catch (e) {
        console.error('Failed to parse saved registry paths:', e);
      }
    }
    return []; // Will be loaded from file in useEffect
  });
  const [currentScreen, setCurrentScreen] = useState('monitor'); // 'monitor' or 'changes'
  const [newPath, setNewPath] = useState('');
  const [error, setError] = useState(null);

  // Check admin status on mount
  useEffect(() => {
    async function checkElevation() {
      try {
        const elevated = await invoke('is_elevated');
        setIsElevated(elevated);
      } catch (error) {
        console.error('Failed to check elevation:', error);
      }
    }
    checkElevation();
  }, []);

  // Check if any paths require admin whenever paths change
  useEffect(() => {
    async function checkAdminRequirement() {
      try {
        const checks = await Promise.all(
          registryPaths.map(async (p) => {
            const requiresAdmin = await invoke('requires_admin', { path: p.key });
            return requiresAdmin;
          })
        );
        setHasAdminPaths(checks.some(req => req));
      } catch (error) {
        console.error('Failed to check admin requirements:', error);
      }
    }
    if (registryPaths.length > 0) {
      checkAdminRequirement();
    }
  }, [registryPaths]);

  // Load registry paths from file on first mount (only once, only if not in localStorage)
  useEffect(() => {
    let cancelled = false;
    const hasStoredPaths = localStorage.getItem('registryPaths');

    // Only load from file if there are no stored paths
    if (!hasStoredPaths) {
      (async () => {
        try {
          const response = await fetch('registry-paths.json', { cache: 'no-cache' });
          if (!response.ok) throw new Error('Failed to fetch registry paths');

          const paths = await response.json();

          if (!cancelled && Array.isArray(paths) && paths.length > 0) {
            setRegistryPaths(paths);
            localStorage.setItem('registryPaths', JSON.stringify(paths));
          }
        } catch (e) {
          console.error('Failed to load registry paths from file:', e);
        }
      })();
    }
    return () => { cancelled = true; };
  }, []);

  // Persist registry paths to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('registryPaths', JSON.stringify(registryPaths));
  }, [registryPaths]);

  useEffect(() => {
    undoneChangesRef.current = undoneChanges;
  }, [undoneChanges]);

  useEffect(() => {
    // Listen for registry changes
    const unlisten = listen('registry-change', (event) => {
      const change = { ...event.payload, id: crypto.randomUUID() };
      setChanges((prev) => {
        const reverses = findReversed(prev, change);
        if (reverses) {
          setUndoneChanges(u => new Set(u).add(reverses));
          return prev;
        }
        return [change, ...prev].slice(0, 100);
      });
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  async function handleStartMonitoring() {
    try {
      const pathKeys = registryPaths.map(p => p.key);
      await invoke('start_monitoring', { paths: pathKeys });
      setMonitoring(true);
    } catch (err) {
      setError(`Failed to start monitoring: ${err}`);
    }
  }

  async function handleStopMonitoring() {
    try {
      await invoke('stop_monitoring');
      setMonitoring(false);
    } catch (err) {
      setError(`Failed to stop monitoring: ${err}`);
    }
  }

  async function addPath() {
    const trimmed = newPath.trim();
    if (!trimmed) {
      setError('Registry path cannot be empty.');
      return;
    }
    if (registryPaths.some(p => p.key.toLowerCase() === trimmed.toLowerCase())) {
      setError(`Already watching: ${trimmed}`);
      return;
    }
    const entry = { key: trimmed, description: 'Custom registry key added by user.' };
    setRegistryPaths(prev => [...prev, entry]);
    setNewPath('');
    setError(null);

    if (monitoring) {
      try {
        await invoke('stop_monitoring');
        const pathKeys = [...registryPaths, entry].map(p => p.key);
        await invoke('start_monitoring', { paths: pathKeys });
      } catch (err) {
        setError(`Key added but failed to restart monitoring: ${err}`);
      }
    }
  }

  async function removePath(pathKey) {
    const newPaths = registryPaths.filter((p) => p.key !== pathKey);
    setRegistryPaths(newPaths);

    if (monitoring) {
      try {
        await invoke('stop_monitoring');
        const pathKeys = newPaths.map(p => p.key);
        await invoke('start_monitoring', { paths: pathKeys });
      } catch (err) {
        setError(`Key removed but failed to restart monitoring: ${err}`);
      }
    }
  }

  async function reloadFromFile() {
    try {
      const response = await fetch('registry-paths.json', { cache: 'no-cache' });
      if (!response.ok) throw new Error('Failed to fetch registry paths');

      const paths = await response.json();

      if (Array.isArray(paths) && paths.length > 0) {
        setRegistryPaths(paths);
        localStorage.setItem('registryPaths', JSON.stringify(paths));
      }
    } catch (e) {
      console.error('Failed to load registry paths from file:', e);
    }
  }

  //find if the incoming change is a reversal of one of the previous changes in the list
  function findReversed(changes, incoming) {
    if (incoming.change_type === 'modified') {
      //in changes, find one that has the same key/value, and then the values are opposite
      return changes.find(c => !undoneChangesRef.current.has(c.id) &&
        c.change_type === 'modified' &&
        c.key_path === incoming.key_path &&
        c.value_name === incoming.value_name &&
        incoming.new_value === c.old_value)?.id ?? null;
    }

    let opposites = {
      deleted: 'added', added: 'deleted',
    };
    let targetType = opposites[incoming.change_type];
    if (targetType) {
      return changes.find(c => !undoneChangesRef.current.has(c.id) &&
        c.change_type === targetType &&
        c.key_path === incoming.key_path &&
        c.value_name === incoming.value_name
      )?.id ?? null;
    }
    // opposites = { subkey_deleted: 'subkey_added', subkey_added: 'subkey_deleted' };
    // targetType = opposites[incoming.change_type];
    // if (targetType) {
    //   return changes.find(c => !undoneChangesRef.current.has(c.id) &&
    //     c.change_type === targetType &&
    //     c.key_path === incoming.key_path)?.id ?? null;
    // }
    
    return null;
  }

  async function handleUndo(change) {
    try {
      const result = await invoke('undo_change', { change });
      console.log('Undo successful:', result);

      // Mark this change as undone using its unique ID
      setUndoneChanges(prev => new Set(prev).add(change.id));
    } catch (error) {
      console.error('Failed to undo change:', error);
      alert(`Failed to undo change: ${error}`);
    }
  }

  function clearChanges() {
    setChanges([]);
    setUndoneChanges(new Set());
  }

  async function handleRequestElevation() {
    try {
      await invoke('request_elevation');
      // If successful, the app will restart with elevated privileges
    } catch (error) {
      console.error('Failed to request elevation:', error);
      alert(`Failed to request elevation: ${error}`);
    }
  }

  function getChangesCount() {
    let x = 0;
    for (const change of changes) {
      if (!undoneChanges.has(change.id)) {
        x += 1;
      }
    }
    return x;
  }

  const changesCount = getChangesCount();

  return (
    <div className="min-h-screen bg-gray-900">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white">
                Windows Registry Monitor
              </h1>
              <p className="text-gray-400 text-sm mt-1">
                Real-time monitoring of critical Windows registry keys
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${monitoring ? 'bg-green-500' : 'bg-red-500'}`}></span>
                <span className="text-gray-300 font-medium text-sm">
                  {monitoring ? 'Active' : 'Stopped'}
                </span>
              </div>
              <button
                onClick={monitoring ? handleStopMonitoring : handleStartMonitoring}
                className={`px-5 py-2 rounded-md font-medium text-sm transition-colors ${monitoring
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'bg-green-600 hover:bg-green-700 text-white'
                  }`}
              >
                {monitoring ? 'Stop' : 'Start'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="bg-gray-800 border-b border-gray-700">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex gap-8">
            <button
              onClick={() => setCurrentScreen('monitor')}
              className={`px-1 py-4 font-medium text-sm transition-colors border-b-2 ${currentScreen === 'monitor'
                ? 'text-blue-400 border-blue-400'
                : 'text-gray-400 border-transparent hover:text-gray-300'
                }`}
            >
              Monitored Keys ({registryPaths.length})
            </button>
            <button
              onClick={() => setCurrentScreen('changes')}
              className={`px-1 py-4 font-medium text-sm transition-colors border-b-2 relative ${currentScreen === 'changes'
                ? 'text-blue-400 border-blue-400'
                : 'text-gray-400 border-transparent hover:text-gray-300'
                }`}
            >
              Recent Changes
              {changesCount > 0 && (
                <span className="ml-2 px-2 py-0.5 bg-red-600 text-white text-xs rounded-full font-medium">
                  {changesCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Admin Warning Banner */}
        {!isElevated && hasAdminPaths && (
          <div className="bg-yellow-900 border border-yellow-700 rounded-lg p-4 mb-4">
            <div className="flex items-start gap-3">
              <svg className="w-6 h-6 text-yellow-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div className="flex-1">
                <h3 className="text-yellow-200 font-semibold mb-1">Limited Privileges</h3>
                <p className="text-yellow-100 text-sm mb-3">
                  The application is currently running without administrator privileges.
                  Only registry keys in <span className="font-mono font-semibold">HKEY_CURRENT_USER (HKCU)</span> can be monitored and modified.
                  To monitor and modify <span className="font-mono font-semibold">HKEY_LOCAL_MACHINE (HKLM)</span> or <span className="font-mono font-semibold">HKEY_CLASSES_ROOT (HKCR)</span>,
                  administrator privileges are required.
                </p>
                <button
                  onClick={handleRequestElevation}
                  className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-md font-medium text-sm transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  Request Administrator Privileges
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Error Banner */}
        {error && (
          <div className="bg-red-950 border border-red-700 rounded-lg px-4 py-3 mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-red-200 text-sm truncate">{error}</p>
            </div>
            <button
              onClick={() => setError(null)}
              className="text-red-400 hover:text-red-200 flex-shrink-0 text-lg leading-none transition-colors"
              aria-label="Dismiss error"
            >
              &times;
            </button>
          </div>
        )}

        {currentScreen === 'monitor' ? (
          <div>
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-4">
              <div className="flex gap-2 mb-3">
                <input
                  type="text"
                  placeholder="HKEY_CURRENT_USER\Software\..."
                  value={newPath}
                  onChange={(e) => setNewPath(e.target.value)}
                  onKeyUp={(e) => e.key === 'Enter' && addPath()}
                  className="flex-1 px-3 py-2 bg-gray-900 border border-gray-700 rounded text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
                <button
                  onClick={addPath}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-medium text-sm transition-colors"
                >
                  Add Key
                </button>
              </div>
              <button
                onClick={reloadFromFile}
                className="w-full px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-md font-medium text-sm transition-colors"
              >
                Reset to Default Paths
              </button>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {registryPaths.map((path) => (
                <div
                  key={path.key}
                  className="bg-gray-800 border border-gray-700 rounded-lg p-4 hover:border-gray-600 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <h3 className="font-mono text-xs text-gray-100 font-semibold break-all flex-1">
                      {path.key}
                    </h3>
                    <button
                      onClick={() => removePath(path.key)}
                      className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-medium transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                  <p className="text-gray-400 text-sm leading-relaxed">
                    {path.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div>
            {changes.length === 0 ? (
              <div className="bg-gray-800 border border-gray-700 rounded-lg p-12 text-center">
                <h3 className="text-lg font-semibold text-gray-100 mb-2">No Changes Detected</h3>
                <p className="text-gray-400 text-sm">
                  {monitoring ? 'Monitoring is active. Changes will appear here.' : 'Start monitoring to detect registry changes.'}
                </p>
              </div>
            ) : (
              <div>
                <div className="flex justify-end mb-4">
                  <button
                    onClick={clearChanges}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md font-medium text-sm transition-colors"
                  >
                    Clear All Changes
                  </button>
                </div>
                <div className="space-y-3">
                  {changes.map((change, index) => (
                    <div
                      key={change.id || index}
                      className={`bg-gray-800 border-l-4 border border-gray-700 rounded-lg p-4 ${change.change_type === 'modified'
                        ? 'border-l-orange-500'
                        : (change.change_type === 'added' || change.change_type === 'subkey_added')
                          ? 'border-l-green-500'
                          : 'border-l-red-500'
                        } ${undoneChanges.has(change.id) ? 'opacity-60' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <div className="flex items-center gap-2">
                          <span className={`px-2.5 py-1 rounded text-xs font-semibold uppercase ${change.change_type === 'modified'
                            ? 'bg-orange-500/20 text-orange-400'
                            : (change.change_type === 'added' || change.change_type === 'subkey_added')
                              ? 'bg-green-500/20 text-green-400'
                              : 'bg-red-500/20 text-red-400'
                            }`}>
                            {change.change_type}
                          </span>
                          {undoneChanges.has(change.id) && (
                            <span className="px-2.5 py-1 rounded text-xs font-semibold uppercase bg-blue-500/20 text-blue-400">
                              UNDONE
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-gray-400 text-xs">
                            {new Date(change.timestamp).toLocaleString()}
                          </span>
                          {!undoneChanges.has(change.id) && !change.change_type.startsWith('subkey_') && (
                            <button
                              onClick={() => handleUndo(change)}
                              className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium transition-colors"
                              title="Undo this change"
                            >
                              Undo
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="space-y-2 text-sm">
                        <div className="font-mono">
                          <span className="text-gray-400 font-medium">Key:</span>
                          <span className="text-gray-100 ml-2 break-all">{change.key_path}</span>
                        </div>
                        <div className="font-mono">
                          <span className="text-gray-400 font-medium">Value:</span>
                          <span className="text-gray-100 ml-2">{change.value_name}</span>
                        </div>
                        {change.old_value && (
                          <div className="font-mono">
                            <span className="text-gray-400 font-medium">Old:</span>
                            <span className="text-gray-100 ml-2 break-all">{change.old_value}</span>
                          </div>
                        )}
                        {change.new_value && (
                          <div className="font-mono">
                            <span className="text-gray-400 font-medium">New:</span>
                            <span className="text-gray-100 ml-2 break-all">{change.new_value}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;