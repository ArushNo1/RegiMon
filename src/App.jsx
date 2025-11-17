import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import './App.css';

function App() {
  const [monitoring, setMonitoring] = useState(false);
  const [changes, setChanges] = useState([]);
  const [registryPaths, setRegistryPaths] = useState([
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run',
    'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\TimeZoneInformation'
  ]);
  const [newPath, setNewPath] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const regpaths = await fetch('registry-paths.json', { cache: 'no-cache' });
        if(!regpaths.ok) throw new Error('Failed to fetch registry paths');

        const text = await regpaths.text();
        let paths;
        try {
          const json = JSON.parse(text);
          paths = Array.isArray(json) ? json : json.registryPaths;
        } catch {
          paths = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        }

        if(!cancelled){
          setRegistryPaths(Array.isArray(paths) && paths.length ? paths : DEFAULT_REGISTRY_PATHS);
        }
      } catch {
        if(!cancelled) setRegistryPaths(DEFAULT_REGISTRY_PATHS);
      }
    })();
    return () => { cancelled = true; };
  }, []);
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
      await invoke('start_monitoring', { paths: registryPaths });
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
    if (newPath && !registryPaths.includes(newPath)) {
      setRegistryPaths([...registryPaths, newPath]);
      setNewPath('');
    }
  }

  function removePath(path) {
    setRegistryPaths(registryPaths.filter((p) => p !== path));
  }

  return (
    <div className="max-w-6xl mx-auto p-5 font-sans">
      <h1 className="text-3xl font-bold text-gray-800 mb-5">Windows Registry Monitor</h1>

      <div className="flex gap-5 items-center mb-8 p-5 bg-gray-100 rounded-lg">
        <button
          onClick={monitoring ? handleStopMonitoring : handleStartMonitoring}
          className={`px-5 py-2.5 border-none rounded cursor-pointer text-base transition-opacity hover:opacity-80 ${
            monitoring ? 'bg-red-500 text-white' : 'bg-green-500 text-white'
          }`}
        >
          {monitoring ? 'Stop Monitoring' : 'Start Monitoring'}
        </button>
        <span className="font-bold">
          Status: {monitoring ? '🟢 Monitoring' : '🔴 Stopped'}
        </span>
      </div>

      <div className="mb-8 p-5 bg-white border border-gray-300 rounded-lg">
        <h2 className="text-xl font-bold mb-4">Monitored Registry Paths</h2>
        <div className="flex gap-2.5 mb-4">
          <input
            type="text"
            placeholder="HKEY_CURRENT_USER\Software\..."
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            className="flex-1 px-2 py-2 border border-gray-300 rounded"
          />
          <button 
            onClick={addPath}
            className="px-5 py-2 bg-blue-500 text-white border-none rounded cursor-pointer hover:bg-blue-600 transition-colors"
          >
            Add Path
          </button>
        </div>
        <ul className="list-none p-0">
          {registryPaths.map((path) => (
            <li key={path} className="flex justify-between items-center p-2.5 mb-1 bg-gray-50 rounded">
              <span className="flex-1 break-all">{path}</span>
              <button 
                onClick={() => removePath(path)}
                className="ml-2 px-3 py-1 bg-red-500 text-white border-none rounded cursor-pointer hover:bg-red-600 transition-colors text-sm"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="p-5 bg-white border border-gray-300 rounded-lg">
        <h2 className="text-xl font-bold mb-4">Recent Changes ({changes.length})</h2>
        <div className="max-h-[600px] overflow-y-auto">
          {changes.map((change, index) => (
            <div 
              key={index} 
              className={`p-4 mb-2.5 border-l-4 rounded ${
                change.change_type === 'modified' 
                  ? 'border-l-orange-500 bg-orange-50' 
                  : change.change_type === 'added'
                  ? 'border-l-green-500 bg-green-50'
                  : 'border-l-red-500 bg-red-50'
              }`}
            >
              <div className="flex justify-between mb-2.5">
                <span className="font-bold px-2 py-0.5 rounded text-xs uppercase bg-gray-200">
                  {change.change_type}
                </span>
                <span className="text-gray-600 text-xs">
                  {new Date(change.timestamp).toLocaleString()}
                </span>
              </div>
              <div className="my-1 text-sm">
                <strong>Path:</strong> {change.key_path}
              </div>
              <div className="my-1 text-sm">
                <strong>Value:</strong> {change.value_name}
              </div>
              {change.old_value && (
                <div className="my-1 text-sm text-red-700">
                  <strong>Old:</strong> {change.old_value}
                </div>
              )}
              {change.new_value && (
                <div className="my-1 text-sm text-green-700">
                  <strong>New:</strong> {change.new_value}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default App;