use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::{Emitter, Window};
use winreg::enums::*;
use winreg::RegKey;

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
        self.monitoring
            .store(true, std::sync::atomic::Ordering::SeqCst);
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
                    match read_registry_key(path) {
                        Ok(current_values) => {
                            let previous = previous_state.get(path);

                            // Detect changes
                            let changes = detect_changes(path, previous, &current_values);

                            // Send changes to frontend
                            for change in &changes {
                                let _ = window.emit("registry-change", &change);
                                println!("Registry change detected: {:?}", change);
                            }

                            // Only update previous_state after successfully detecting and emitting changes
                            // This ensures state consistency
                            previous_state.insert(path.clone(), current_values);
                        }
                        Err(e) => {
                            if !e.to_string().contains("The system") {
                                // Log error but don't update previous_state to maintain consistency
                                eprintln!("Error reading registry key {}: {:?}", path, e);
                            }
                        }
                    }
                }
            }
        });
    }

    pub fn stop_monitoring(&self) {
        self.monitoring
            .store(false, std::sync::atomic::Ordering::SeqCst);
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

#[tauri::command]
pub fn undo_registry_change(change: RegistryChange) -> Result<String, String> {
    // Parse the registry path
    let parts: Vec<&str> = change.key_path.split('\\').collect();
    if parts.is_empty() {
        return Err("Invalid registry path".to_string());
    }

    let hive = match parts[0] {
        "HKEY_LOCAL_MACHINE" | "HKLM" => RegKey::predef(HKEY_LOCAL_MACHINE),
        "HKEY_CURRENT_USER" | "HKCU" => RegKey::predef(HKEY_CURRENT_USER),
        "HKEY_CLASSES_ROOT" | "HKCR" => RegKey::predef(HKEY_CLASSES_ROOT),
        _ => return Err("Unknown registry hive".to_string()),
    };

    let subkey_path = parts[1..].join("\\");
    
    // Open the key with write permissions
    let key = hive
        .open_subkey_with_flags(&subkey_path, KEY_WRITE | KEY_READ)
        .map_err(|e| format!("Failed to open registry key: {}", e))?;

    match change.change_type.as_str() {
        "modified" => {
            // Restore the old value
            if let Some(old_value) = change.old_value {
                set_registry_value(&key, &change.value_name, &old_value)?;
                Ok(format!("Restored '{}' to previous value", change.value_name))
            } else {
                Err("No old value to restore".to_string())
            }
        }
        "deleted" => {
            // Recreate the deleted value
            if let Some(old_value) = change.old_value {
                set_registry_value(&key, &change.value_name, &old_value)?;
                Ok(format!("Restored deleted value '{}'", change.value_name))
            } else {
                Err("No old value to restore".to_string())
            }
        }
        "added" => {
            // Delete the newly added value
            key.delete_value(&change.value_name)
                .map_err(|e| format!("Failed to delete value: {}", e))?;
            Ok(format!("Removed added value '{}'", change.value_name))
        }
        _ => Err("Unknown change type".to_string()),
    }
}

fn set_registry_value(key: &RegKey, value_name: &str, value_str: &str) -> Result<(), String> {
    // Parse the value string format from winreg (e.g., "RegValue { bytes: [...], vtype: REG_SZ }")
    // This is a simplified implementation - you may need to handle more types
    
    // Try to detect the value type from the string representation
    if value_str.contains("REG_SZ") {
        // Extract string value from the debug format
        // For simplicity, we'll try to read the current value and write it back, or handle as string
        let cleaned = extract_string_value(value_str);
        key.set_value(value_name, &cleaned)
            .map_err(|e| format!("Failed to set string value: {}", e))?;
    } else if value_str.contains("REG_DWORD") {
        // Extract DWORD value
        let dword_val = extract_dword_value(value_str);
        key.set_value(value_name, &dword_val)
            .map_err(|e| format!("Failed to set DWORD value: {}", e))?;
    } else {
        // Try setting as string as fallback
        key.set_value(value_name, &value_str)
            .map_err(|e| format!("Failed to set value: {}", e))?;
    }
    
    Ok(())
}

fn extract_string_value(debug_str: &str) -> String {
    // This extracts string content from debug format like "RegValue { bytes: [72, 0, 101, ...], vtype: REG_SZ }"
    // For a more robust solution, we would parse the bytes and convert them
    
    // Try to find bytes array and convert
    if let Some(start) = debug_str.find("bytes: [") {
        if let Some(end) = debug_str[start..].find("]") {
            let bytes_str = &debug_str[start + 8..start + end];
            let bytes: Vec<u8> = bytes_str
                .split(',')
                .filter_map(|s| s.trim().parse().ok())
                .collect();
            
            // Try to convert bytes to UTF-16 string (common for REG_SZ)
            if bytes.len() % 2 == 0 {
                let u16_vec: Vec<u16> = bytes
                    .chunks_exact(2)
                    .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
                    .take_while(|&c| c != 0) // Stop at null terminator
                    .collect();
                
                return String::from_utf16_lossy(&u16_vec);
            }
        }
    }
    
    // Fallback to original string
    debug_str.to_string()
}

fn extract_dword_value(debug_str: &str) -> u32 {
    // Extract DWORD from debug format
    if let Some(start) = debug_str.find("bytes: [") {
        if let Some(end) = debug_str[start..].find("]") {
            let bytes_str = &debug_str[start + 8..start + end];
            let bytes: Vec<u8> = bytes_str
                .split(',')
                .filter_map(|s| s.trim().parse().ok())
                .collect();
            
            if bytes.len() == 4 {
                return u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
            }
        }
    }
    
    0 // Default fallback
}
