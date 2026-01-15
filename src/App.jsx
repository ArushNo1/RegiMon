import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import './App.css';

function App() {
  const [monitoring, setMonitoring] = useState(false);
  const [changes, setChanges] = useState([]);
  const [undoneChanges, setUndoneChanges] = useState(new Set());
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

  // Load registry paths from file on first mount (only once, only if not in localStorage)
  useEffect(() => {
    let cancelled = false;
    const hasStoredPaths = localStorage.getItem('registryPaths');
    
    // Only load from file if there are no stored paths
    if (!hasStoredPaths) {
      (async () => {
        try {
          const response = await fetch('registry-paths.json', { cache: 'no-cache' });
          if(!response.ok) throw new Error('Failed to fetch registry paths');

          const paths = await response.json();

          if(!cancelled && Array.isArray(paths) && paths.length > 0){
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
    // Listen for registry changes
    const unlisten = listen('registry-change', (event) => {
      const change = event.payload;
      setChanges((prev) => [change, ...prev].slice(0, 100)); // Keep last 100 changes
      
      // Show browser notification
      if (Notification.permission === 'granted') {
        new Notification('Registry Change Detected', {
          body: `${change.change_type}: ${change.value_name} in ${change.key_path}`,
        });
      }
    });

    // Request notification permission
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  async function handleStartMonitoring() {
    try {
      // Extract just the keys for monitoring
      const pathKeys = registryPaths.map(p => p.key);
      await invoke('start_monitoring', { paths: pathKeys });
      setMonitoring(true);
    } catch (error) {
      console.error('Failed to start monitoring:', error);
    }
  }

  async function handleStopMonitoring() {
    try {
      await invoke('stop_monitoring');
      setMonitoring(false);
    } catch (error) {
      console.error('Failed to stop monitoring:', error);
    }
  }

  function addPath() {
    if (newPath && !registryPaths.some(p => p.key === newPath)) {
      setRegistryPaths([...registryPaths, { key: newPath, description: 'Custom registry key added by user.' }]);
      setNewPath('');
    }
  }

  function removePath(pathKey) {
    setRegistryPaths(registryPaths.filter((p) => p.key !== pathKey));
  }

  async function reloadFromFile() {
    try {
      const response = await fetch('registry-paths.json', { cache: 'no-cache' });
      if(!response.ok) throw new Error('Failed to fetch registry paths');

      const paths = await response.json();

      if(Array.isArray(paths) && paths.length > 0){
        setRegistryPaths(paths);
        localStorage.setItem('registryPaths', JSON.stringify(paths));
      }
    } catch (e) {
      console.error('Failed to load registry paths from file:', e);
    }
  }

  async function handleUndo(change, index) {
    try {
      const result = await invoke('undo_change', { change });
      console.log('Undo successful:', result);
      
      // Mark this change as undone
      setUndoneChanges(prev => new Set(prev).add(index));
      
      // Show notification
      if (Notification.permission === 'granted') {
        new Notification('Change Undone', {
          body: result,
        });
      }
    } catch (error) {
      console.error('Failed to undo change:', error);
      alert(`Failed to undo change: ${error}`);
    }
  }

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
                className={`px-5 py-2 rounded-md font-medium text-sm transition-colors ${
                  monitoring 
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
              className={`px-1 py-4 font-medium text-sm transition-colors border-b-2 ${
                currentScreen === 'monitor'
                  ? 'text-blue-400 border-blue-400'
                  : 'text-gray-400 border-transparent hover:text-gray-300'
              }`}
            >
              Monitored Keys ({registryPaths.length})
            </button>
            <button
              onClick={() => setCurrentScreen('changes')}
              className={`px-1 py-4 font-medium text-sm transition-colors border-b-2 relative ${
                currentScreen === 'changes'
                  ? 'text-blue-400 border-blue-400'
                  : 'text-gray-400 border-transparent hover:text-gray-300'
              }`}
            >
              Recent Changes
              {changes.length > 0 && (
                <span className="ml-2 px-2 py-0.5 bg-red-600 text-white text-xs rounded-full font-medium">
                  {changes.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        {currentScreen === 'monitor' ? (
          <div>
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-4">
              <div className="flex gap-2 mb-3">
                <input
                  type="text"
                  placeholder="HKEY_CURRENT_USER\Software\..."
                  value={newPath}
                  onChange={(e) => setNewPath(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && addPath()}
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
              <div className="space-y-3">
                {changes.map((change, index) => (
                  <div 
                    key={index} 
                    className={`bg-gray-800 border-l-4 border border-gray-700 rounded-lg p-4 ${
                      change.change_type === 'modified' 
                        ? 'border-l-orange-500' 
                        : change.change_type === 'added'
                        ? 'border-l-green-500'
                        : 'border-l-red-500'
                    } ${undoneChanges.has(index) ? 'opacity-60' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <div className="flex items-center gap-2">
                        <span className={`px-2.5 py-1 rounded text-xs font-semibold uppercase ${
                          change.change_type === 'modified' 
                            ? 'bg-orange-500/20 text-orange-400' 
                            : change.change_type === 'added'
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-red-500/20 text-red-400'
                        }`}>
                          {change.change_type}
                        </span>
                        {undoneChanges.has(index) && (
                          <span className="px-2.5 py-1 rounded text-xs font-semibold uppercase bg-blue-500/20 text-blue-400">
                            UNDONE
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400 text-xs">
                          {new Date(change.timestamp).toLocaleString()}
                        </span>
                        {!undoneChanges.has(index) && (
                          <button
                            onClick={() => handleUndo(change, index)}
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
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;