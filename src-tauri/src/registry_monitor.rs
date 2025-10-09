use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::{Manager, Window, Emitter};
use winreg::enums::*;
use winreg::RegKey;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct RegistryChange {
    pub key_path: String,
    pub value_name: String,
    pub old_value: Option<String>,
    pub new_value: Option<String>,
    pub change_type: String, // "modified", "added", "deleted"
    pub timestamp: String,
}

pub struct RegistryMonitor {
    monitoring: Arc<std::sync::atomic::AtomicBool>,
}

impl RegistryMonitor {
    pub fn new() -> Self {
        Self {
            monitoring: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }
    }

    pub fn start_monitoring(&self, window: Window, registry_paths: Vec<String>) {
        self.monitoring.store(true, std::sync::atomic::Ordering::SeqCst);
        let monitoring = self.monitoring.clone();

        thread::spawn(move || {
            let mut previous_state: HashMap<String, HashMap<String, String>> = HashMap::new();
            
            // Initial scan
            for path in &registry_paths {
                if let Ok(values) = read_registry_key(path) {
                    previous_state.insert(path.clone(), values);
                }
            }

            while monitoring.load(std::sync::atomic::Ordering::SeqCst) {
                thread::sleep(Duration::from_millis(200)); // Check every 0.2 seconds

                for path in &registry_paths {
                    if let Ok(current_values) = read_registry_key(path) {
                        let previous = previous_state.get(path);

                        // Detect changes
                        let changes = detect_changes(
                            path,
                            previous,
                            &current_values,
                        );

                        // Send changes to frontend
                        for change in changes {
                            let _ = window.emit("registry-change", &change);
                            println!("Registry change detected: {:?}", change);
                        }

                        previous_state.insert(path.clone(), current_values);
                    }
                }
            }
        });
    }

    pub fn stop_monitoring(&self) {
        self.monitoring.store(false, std::sync::atomic::Ordering::SeqCst);
    }
}

fn read_registry_key(path: &str) -> Result<HashMap<String, String>, Box<dyn std::error::Error>> {
    let parts: Vec<&str> = path.split('\\').collect();
    if parts.is_empty() {
        return Err("Invalid registry path".into());
    }

    let hive = match parts[0] {
        "HKEY_LOCAL_MACHINE" | "HKLM" => RegKey::predef(HKEY_LOCAL_MACHINE),
        "HKEY_CURRENT_USER" | "HKCU" => RegKey::predef(HKEY_CURRENT_USER),
        "HKEY_CLASSES_ROOT" | "HKCR" => RegKey::predef(HKEY_CLASSES_ROOT),
        _ => return Err("Unknown registry hive".into()),
    };

    let subkey_path = parts[1..].join("\\");
    let key = hive.open_subkey_with_flags(&subkey_path, KEY_READ)?;

    let mut values = HashMap::new();
    for (name, value) in key.enum_values().filter_map(|v| v.ok()) {
        values.insert(name, format!("{:?}", value));
    }

    Ok(values)
}

fn detect_changes(
    path: &str,
    previous: Option<&HashMap<String, String>>,
    current: &HashMap<String, String>,
) -> Vec<RegistryChange> {
    let mut changes = Vec::new();
    let now = chrono::Local::now().to_rfc3339();

    if let Some(prev) = previous {
        // Check for modifications and deletions
        for (key, old_val) in prev {
            match current.get(key) {
                Some(new_val) if new_val != old_val => {
                    changes.push(RegistryChange {
                        key_path: path.to_string(),
                        value_name: key.clone(),
                        old_value: Some(old_val.clone()),
                        new_value: Some(new_val.clone()),
                        change_type: "modified".to_string(),
                        timestamp: now.clone(),
                    });
                }
                None => {
                    changes.push(RegistryChange {
                        key_path: path.to_string(),
                        value_name: key.clone(),
                        old_value: Some(old_val.clone()),
                        new_value: None,
                        change_type: "deleted".to_string(),
                        timestamp: now.clone(),
                    });
                }
                _ => {}
            }
        }

        // Check for additions
        for (key, new_val) in current {
            if !prev.contains_key(key) {
                changes.push(RegistryChange {
                    key_path: path.to_string(),
                    value_name: key.clone(),
                    old_value: None,
                    new_value: Some(new_val.clone()),
                    change_type: "added".to_string(),
                    timestamp: now.clone(),
                });
            }
        }
    }

    changes
}