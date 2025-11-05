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
        paths = paths.filter(path => path && !path.startsWith("//"));

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
    <div className="container">
      <h1>Windows Registry Monitor</h1>

      <div className="controls">
        <button
          onClick={monitoring ? handleStopMonitoring : handleStartMonitoring}
          className={monitoring ? 'btn-danger' : 'btn-success'}
        >
          {monitoring ? 'Stop Monitoring' : 'Start Monitoring'}
        </button>
        <span className="status">
          Status: {monitoring ? '🟢 Monitoring' : '🔴 Stopped'}
        </span>
      </div>

      <div className="path-manager">
        <h2>Monitored Registry Paths</h2>
        <div className="add-path">
          <input
            type="text"
            placeholder="HKEY_CURRENT_USER\Software\..."
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
          />
          <button onClick={addPath}>Add Path</button>
        </div>
        <ul className="path-list">
          {registryPaths.map((path) => (
            <li key={path}>
              <span>{path}</span>
              <button onClick={() => removePath(path)}>Remove</button>
            </li>
          ))}
        </ul>
      </div>

      <div className="changes">
        <h2>Recent Changes ({changes.length})</h2>
        <div className="changes-list">
          {changes.map((change, index) => (
            <div key={index} className={`change-item ${change.change_type}`}>
              <div className="change-header">
                <span className="change-type">{change.change_type.toUpperCase()}</span>
                <span className="timestamp">{new Date(change.timestamp).toLocaleString()}</span>
              </div>
              <div className="change-details">
                <strong>Path:</strong> {change.key_path}
              </div>
              <div className="change-details">
                <strong>Value:</strong> {change.value_name}
              </div>
              {change.old_value && (
                <div className="change-details old">
                  <strong>Old:</strong> {change.old_value}
                </div>
              )}
              {change.new_value && (
                <div className="change-details new">
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