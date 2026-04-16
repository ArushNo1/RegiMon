import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import './App.css';

import Header from './components/Header';
import NavTabs from './components/NavTabs';
import AdminBanner from './components/AdminBanner';
import ErrorBanner from './components/ErrorBanner';
import KeysPanel from './components/KeysPanel';
import ChangesPanel from './components/ChangesPanel';
import SettingsPanel from './components/SettingsPanel';

function App() {
  const [monitoring, setMonitoring] = useState(false);
  const [changes, setChanges] = useState([]);
  const [undoneChanges, setUndoneChanges] = useState(new Set());
  const undoneChangesRef = useRef(undoneChanges);
  const [isElevated, setIsElevated] = useState(false);
  const [hasAdminPaths, setHasAdminPaths] = useState(false);
  const [registryPaths, setRegistryPaths] = useState(() => {
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
    return [];
  });
  const [currentScreen, setCurrentScreen] = useState('keys');
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

  // Load registry paths from file on first mount (only if not in localStorage)
  useEffect(() => {
    let cancelled = false;
    const hasStoredPaths = localStorage.getItem('registryPaths');

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
    const unlisten = listen('registry-change', (event) => {
      const change = { ...event.payload, id: crypto.randomUUID() };
      setChanges((prev) => {
        const reverses = findReversed(prev, change);
        if (reverses) {
          setUndoneChanges(u => new Set(u).add(reverses));
          return prev;
        }
        const newChanges = [change, ...prev];
        const pruned = newChanges.slice(100).map(c => c.id);
        if (pruned.length > 0) {
          const next = new Set(undoneChangesRef.current);
          pruned.forEach(id => next.delete(id));
          setUndoneChanges(next);
        }
        return newChanges.slice(0, 100);
      });
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  function findReversed(changes, incoming) {
    if (incoming.change_type === 'modified') {
      return changes.find(c => !undoneChangesRef.current.has(c.id) &&
        c.change_type === 'modified' &&
        c.key_path === incoming.key_path &&
        c.value_name === incoming.value_name &&
        incoming.new_value === c.old_value)?.id ?? null;
    }

    const opposites = { deleted: 'added', added: 'deleted' };
    const targetType = opposites[incoming.change_type];
    if (targetType) {
      return changes.find(c => !undoneChangesRef.current.has(c.id) &&
        c.change_type === targetType &&
        c.key_path === incoming.key_path &&
        c.value_name === incoming.value_name
      )?.id ?? null;
    }

    return null;
  }

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

  async function handleUndo(change) {
    try {
      const result = await invoke('undo_change', { change });
      console.log('Undo successful:', result);
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
    } catch (error) {
      console.error('Failed to request elevation:', error);
      alert(`Failed to request elevation: ${error}`);
    }
  }

  function getChangesCount() {
    let count = 0;
    for (const change of changes) {
      if (!undoneChanges.has(change.id)) {
        count += 1;
      }
    }
    return count;
  }

  const changesCount = getChangesCount();

  return (
    <div className="min-h-screen bg-bg-primary font-sans">
      <Header
        monitoring={monitoring}
        onStart={handleStartMonitoring}
        onStop={handleStopMonitoring}
      />
      <NavTabs
        currentScreen={currentScreen}
        onChangeScreen={setCurrentScreen}
        pathCount={registryPaths.length}
        changesCount={changesCount}
        onClearChanges={clearChanges}
      />

      <div className="max-w-7xl mx-auto px-6 py-5">
        {!isElevated && hasAdminPaths && (
          <AdminBanner onRequestElevation={handleRequestElevation} />
        )}

        {error && (
          <ErrorBanner error={error} onDismiss={() => setError(null)} />
        )}

        {currentScreen === 'keys' ? (
          <KeysPanel
            registryPaths={registryPaths}
            newPath={newPath}
            onNewPathChange={setNewPath}
            onAddPath={addPath}
            onRemovePath={removePath}
            onReloadFromFile={reloadFromFile}
          />
        ) : currentScreen === 'changes' ? (
          <ChangesPanel
            changes={changes}
            undoneChanges={undoneChanges}
            monitoring={monitoring}
            onUndo={handleUndo}
          />
        ) : (
          <SettingsPanel />
        )}
      </div>
    </div>
  );
}

export default App;
