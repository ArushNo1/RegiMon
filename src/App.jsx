import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import './App.css';

const DEFAULT_REGISTRY_PATHS = [
  'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run',
  'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\TimeZoneInformation'
];

const REGISTRY_DESCRIPTIONS = {
  'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run': 
    'Programs that run automatically when the current user logs in. Commonly used by malware for persistence.',
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run': 
    'Programs that run automatically for all users at startup. A critical location for system-wide persistence.',
  'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\TimeZoneInformation': 
    'System timezone settings. Changes may indicate tampering or system configuration modifications.',
  'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce': 
    'Programs that run once at next user login, then the entry is deleted.',
  'HKEY_LOCAL_MACHINE\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce': 
    'Programs that run once at next system startup for all users, then the entry is deleted.',
  'HKEY_LOCAL_MACHINE\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnceEx': 
    'Extended RunOnce functionality. Not created by default but Windows reads from it if present.',
  'HKEY_LOCAL_MACHINE\\Software\\Microsoft\\Windows\\CurrentVersion\\RunServices': 
    'Legacy key for services to run at startup (Windows 9x/NT compatibility).',
  'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\RunServices': 
    'Legacy key for user-specific services at startup (Windows 9x/NT compatibility).',
  'HKEY_LOCAL_MACHINE\\Software\\Microsoft\\Windows\\CurrentVersion\\RunServicesOnce': 
    'Legacy key for one-time service execution at startup.',
  'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\RunServicesOnce': 
    'Legacy key for one-time user-specific service execution.',
  'HKEY_LOCAL_MACHINE\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer\\Run': 
    'Group Policy-enforced startup programs. Harder for users to disable.',
  'HKEY_LOCAL_MACHINE\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall': 
    'Registry of installed programs. Modifications may indicate software installation or removal.',
  'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Services': 
    'All Windows services configuration. Critical for system functionality and security.',
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Schedule\\TaskCache\\Tasks': 
    'Scheduled tasks cache. Used by Task Scheduler for automated program execution.',
  'HKEY_LOCAL_MACHINE\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon': 
    'Login process configuration. Often targeted by malware to control user sessions.',
  'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings': 
    'Internet Explorer settings for current user including proxy configuration.',
  'HKEY_LOCAL_MACHINE\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings': 
    'System-wide Internet Explorer settings and proxy configuration.',
  'HKEY_LOCAL_MACHINE\\Software\\Microsoft\\WBEM': 
    'Windows Management Instrumentation settings. Used for system management and monitoring.',
  'HKEY_CLASSES_ROOT\\CLSID': 
    'COM class registrations. Modifications can redirect application behavior or enable attacks.',
  'HKEY_LOCAL_MACHINE\\SECURITY\\Policy\\Secrets': 
    'Sensitive security data including cached credentials and service account passwords.',
  'HKEY_LOCAL_MACHINE\\System\\CurrentControlSet\\Control\\Lsa': 
    'Local Security Authority configuration. Controls authentication and security policies.',
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Windows\\AppInit_DLLs': 
    'DLLs loaded into every process. Heavily abused by malware for code injection.',
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options': 
    'Debugging settings and executable redirections. Can be used to hijack program execution.'
};

function App() {
  const [monitoring, setMonitoring] = useState(false);
  const [changes, setChanges] = useState([]);
  const [registryPaths, setRegistryPaths] = useState(DEFAULT_REGISTRY_PATHS);
  const [currentScreen, setCurrentScreen] = useState('monitor'); // 'monitor' or 'changes'

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
          <div className="grid gap-4 md:grid-cols-2">
            {registryPaths.map((path) => (
              <div 
                key={path} 
                className="bg-gray-800 border border-gray-700 rounded-lg p-4 hover:border-gray-600 transition-colors"
              >
                <h3 className="font-mono text-xs text-gray-100 font-semibold mb-2 break-all">
                  {path}
                </h3>
                <p className="text-gray-400 text-sm leading-relaxed">
                  {REGISTRY_DESCRIPTIONS[path] || 'Registry key monitored for changes.'}
                </p>
              </div>
            ))}
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
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <span className={`px-2.5 py-1 rounded text-xs font-semibold uppercase ${
                        change.change_type === 'modified' 
                          ? 'bg-orange-500/20 text-orange-400' 
                          : change.change_type === 'added'
                          ? 'bg-green-500/20 text-green-400'
                          : 'bg-red-500/20 text-red-400'
                      }`}>
                        {change.change_type}
                      </span>
                      <span className="text-gray-400 text-xs">
                        {new Date(change.timestamp).toLocaleString()}
                      </span>
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