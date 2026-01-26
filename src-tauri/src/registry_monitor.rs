use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{Emitter, Window};
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0, WAIT_TIMEOUT, GetLastError};
use windows_sys::Win32::System::Registry::{
    RegNotifyChangeKeyValue, REG_NOTIFY_CHANGE_LAST_SET, REG_NOTIFY_THREAD_AGNOSTIC,
};
use windows_sys::Win32::System::Threading::{CreateEventW, WaitForMultipleObjects, OpenProcessToken, GetCurrentProcess};
use windows_sys::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_QUERY, TOKEN_ELEVATION};
use windows_sys::Win32::UI::Shell::ShellExecuteW;
use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOW;
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
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
    ignored_changes: Arc<Mutex<HashSet<String>>>,
}

impl RegistryMonitor {
    pub fn new() -> Self {
        Self {
            monitoring: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            ignored_changes: Arc::new(Mutex::new(HashSet::new())),
        }
    }

    pub fn start_monitoring(&self, window: Window, registry_paths: Vec<String>) {
        self.monitoring
            .store(true, std::sync::atomic::Ordering::SeqCst);
        let monitoring = self.monitoring.clone();
        let ignored_changes = self.ignored_changes.clone();

        thread::spawn(move || {
            let mut previous_state: HashMap<String, HashMap<String, String>> = HashMap::new();
            let mut key_handles: Vec<(String, RegKey, HANDLE)> = Vec::new();

            // Initial scan and setup event notifications
            for path in &registry_paths {
                if let Ok(values) = read_registry_key(path) {
                    previous_state.insert(path.clone(), values);
                }

                // Open registry key and create event for notification
                match setup_registry_notification(path) {
                    Ok((reg_key, event)) => key_handles.push((path.clone(), reg_key, event)),
                    Err(e) => eprintln!("Failed to monitor {}: {}", path, e),
                }
            }

            if key_handles.is_empty() {
                eprintln!("Failed to setup any registry notifications");
                return;
            }

            let events: Vec<HANDLE> = key_handles.iter().map(|(_, _, event)| *event).collect();

            while monitoring.load(std::sync::atomic::Ordering::SeqCst) {
                // Wait for any registry change event (with 1 second timeout)
                let wait_result = unsafe {
                    WaitForMultipleObjects(
                        events.len() as u32,
                        events.as_ptr(),
                        0,    // FALSE - wait for any event
                        1000, // 1 second timeout
                    )
                };

                if wait_result == WAIT_TIMEOUT {
                    continue;
                }

                // Check which key changed
                let changed_index = wait_result.wrapping_sub(WAIT_OBJECT_0) as usize;
                if changed_index < key_handles.len() {
                    let (path, reg_key, event) = match key_handles.get_mut(changed_index) {
                        Some(tuple) => tuple,
                        None => continue,
                    };

                    match read_registry_key(path) {
                        Ok(current_values) => {
                            let previous = previous_state.get(path);

                            // Detect changes
                            let changes = detect_changes(path, previous, &current_values);

                            // Filter out ignored changes
                            let ignored = ignored_changes.lock().unwrap();
                            let filtered_changes: Vec<_> = changes
                                .into_iter()
                                .filter(|change| {
                                    let key = format!("{}::{}", change.key_path, change.value_name);
                                    !ignored.contains(&key)
                                })
                                .collect();
                            drop(ignored);

                            // Send changes to frontend
                            for change in &filtered_changes {
                                let _ = window.emit("registry-change", &change);
                            }

                            // Update previous state
                            previous_state.insert(path.clone(), current_values);
                        }
                        Err(e) => {
                            if !e.to_string().contains("The system") {
                                eprintln!("Error reading registry key {}: {:?}", path, e);
                            }
                        }
                    }

                    // Re-register for next notification
                    unsafe {
                        RegNotifyChangeKeyValue(
                            reg_key.raw_handle() as *mut std::ffi::c_void,
                            1, // TRUE - watch subtree so nested changes trigger
                            REG_NOTIFY_CHANGE_LAST_SET | REG_NOTIFY_THREAD_AGNOSTIC,
                            *event,
                            1, // TRUE - asynchronous
                        );
                    }
                }
            }

            // Cleanup
            for (_, _, event) in key_handles {
                unsafe {
                    CloseHandle(event);
                }
            }
        });
    }

    pub fn stop_monitoring(&self) {
        self.monitoring
            .store(false, std::sync::atomic::Ordering::SeqCst);
    }

    pub fn get_ignored_changes(&self) -> Arc<Mutex<HashSet<String>>> {
        self.ignored_changes.clone()
    }
}

fn setup_registry_notification(path: &str) -> Result<(RegKey, HANDLE), Box<dyn std::error::Error>> {
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
    let key = hive.open_subkey_with_flags(&subkey_path, KEY_NOTIFY | KEY_READ)?;

    // Create event for notification
    let event = unsafe { CreateEventW(std::ptr::null(), 1, 0, std::ptr::null()) };
    if event.is_null() {
        return Err("Failed to create event".into());
    }

    // Register for notifications
    let result = unsafe {
        RegNotifyChangeKeyValue(
            key.raw_handle() as *mut std::ffi::c_void,
            1, // TRUE - watch subtree so nested changes trigger
            REG_NOTIFY_CHANGE_LAST_SET | REG_NOTIFY_THREAD_AGNOSTIC,
            event,
            1, // TRUE - asynchronous
        )
    };

    if result != 0 {
        unsafe {
            CloseHandle(event);
        }
        return Err(format!("RegNotifyChangeKeyValue failed with code {}", result).into());
    }

    Ok((key, event))
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

    // Track immediate subkeys so subtree changes are detected
    for subkey in key.enum_keys().filter_map(|k| k.ok()) {
        values.insert(format!("__subkey__{}", subkey), "SUBKEY".to_string());
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
pub fn undo_registry_change(
    change: RegistryChange,
    ignored_changes: Arc<Mutex<HashSet<String>>>,
) -> Result<String, String> {
    // Mark this change as ignored to prevent detection loop
    let change_key = format!("{}::{}", change.key_path, change.value_name);
    {
        let mut ignored = ignored_changes.lock().unwrap();
        ignored.insert(change_key.clone());
    }

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

                // Wait briefly, then clear ignored status
                let ignored = ignored_changes.clone();
                thread::spawn(move || {
                    thread::sleep(Duration::from_millis(500));
                    let mut ignored = ignored.lock().unwrap();
                    ignored.remove(&change_key);
                });

                Ok(format!(
                    "Restored '{}' to previous value",
                    change.value_name
                ))
            } else {
                Err("No old value to restore".to_string())
            }
        }
        "deleted" => {
            // Recreate the deleted value
            if let Some(old_value) = change.old_value {
                set_registry_value(&key, &change.value_name, &old_value)?;

                // Wait briefly, then clear ignored status
                let ignored = ignored_changes.clone();
                thread::spawn(move || {
                    thread::sleep(Duration::from_millis(500));
                    let mut ignored = ignored.lock().unwrap();
                    ignored.remove(&change_key);
                });

                Ok(format!("Restored deleted value '{}'", change.value_name))
            } else {
                Err("No old value to restore".to_string())
            }
        }
        "added" => {
            // Delete the newly added value
            key.delete_value(&change.value_name)
                .map_err(|e| format!("Failed to delete value: {}", e))?;

            // Wait briefly, then clear ignored status
            let ignored = ignored_changes.clone();
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(500));
                let mut ignored = ignored.lock().unwrap();
                ignored.remove(&change_key);
            });

            Ok(format!("Removed added value '{}'", change.value_name))
        }
        _ => Err("Unknown change type".to_string()),
    }
}

fn set_registry_value(key: &RegKey, value_name: &str, value_str: &str) -> Result<(), String> {
    if !value_str.starts_with("RegValue") {
        return Err("Unsupported value format".to_string());
    }

    let value_str = value_str
        .trim_start_matches("RegValue(")
        .trim_end_matches(")");

    if value_str.contains("REG_SZ") || value_str.contains("REG_EXPAND_SZ") {
        let cleaned = value_str.trim_start_matches("REG_SZ: ");
        let cleaned = cleaned.trim_start_matches("REG_EXPAND_SZ: ");
        key.set_value(value_name, &cleaned)
            .map_err(|e| format!("Failed to set string value: {}", e))?;
    } else if value_str.contains("REG_DWORD") {
        let cleaned = value_str.trim_start_matches("REG_DWORD: ");
        let dword_val: u32 = cleaned
            .parse()
            .map_err(|e| format!("Failed to parse DWORD value: {}", e))?;
        key.set_value(value_name, &dword_val)
            .map_err(|e| format!("Failed to set DWORD value: {}", e))?;
    } else if value_str.contains("REG_QWORD") {
        let cleaned = value_str.trim_start_matches("REG_QWORD: ");
        let qword_val: u64 = cleaned
            .parse()
            .map_err(|e| format!("Failed to parse QWORD value: {}", e))?;
        key.set_value(value_name, &qword_val)
            .map_err(|e| format!("Failed to set QWORD value: {}", e))?;
    } else if value_str.contains("REG_BINARY") {
        let cleaned = value_str.trim_start_matches("REG_BINARY: ");
        let bytes_str = cleaned.trim_start_matches('[').trim_end_matches(']');
        let bytes: Result<Vec<u8>, _> = bytes_str
            .split(',')
            .map(|s| s.trim().parse::<u8>())
            .collect();
        match bytes {
            Ok(byte_vec) => {key.set_raw_value(
                value_name,
                &winreg::RegValue {
                    vtype: winreg::enums::RegType::REG_BINARY,
                    bytes: byte_vec,
                }).map_err(|e| format!("Failed to set binary value: {}", e))?;
        }
            Err(e) => {
                return Err(format!("Failed to parse binary value: {}", e));
            }
        }
    } else {
        return Err("Unsupported registry value type".to_string());
    }

    Ok(())
}

// Check if the current process is running with administrator privileges
#[tauri::command]
pub fn is_elevated() -> bool {
    unsafe {
        let mut token_handle: HANDLE = std::ptr::null_mut();
        
        // Open the process token
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token_handle) == 0 {
            return false;
        }
        
        let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
        let mut return_length: u32 = 0;
        
        // Get the elevation information
        let result = GetTokenInformation(
            token_handle,
            TokenElevation,
            &mut elevation as *mut _ as *mut _,
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut return_length,
        );
        
        CloseHandle(token_handle);
        
        if result == 0 {
            return false;
        }
        
        elevation.TokenIsElevated != 0
    }
}

// Check if a registry path requires admin privileges
#[tauri::command]
pub fn requires_admin(path: String) -> bool {
    let parts: Vec<&str> = path.split('\\').collect();
    if parts.is_empty() {
        return false;
    }
    
    // HKCU doesn't require admin, but HKLM and HKCR typically do
    match parts[0] {
        "HKEY_LOCAL_MACHINE" | "HKLM" => true,
        "HKEY_CLASSES_ROOT" | "HKCR" => true,
        "HKEY_CURRENT_USER" | "HKCU" => false,
        _ => false,
    }
}

// Request elevation by restarting the application with administrator privileges
#[tauri::command]
pub fn request_elevation() -> Result<String, String> {
    unsafe {
        // Get the current executable path
        let exe_path = std::env::current_exe()
            .map_err(|e| format!("Failed to get executable path: {}", e))?;
        
        // Convert path to wide string for Windows API
        let exe_path_wide: Vec<u16> = OsStr::new(exe_path.to_str().unwrap())
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        
        let operation: Vec<u16> = OsStr::new("runas")
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        
        // Use ShellExecuteW with "runas" verb to trigger UAC elevation prompt
        let result = ShellExecuteW(
            std::ptr::null_mut(),
            operation.as_ptr(),
            exe_path_wide.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOW,
        );
        
        // ShellExecuteW returns a value > 32 on success
        if result as isize > 32 {
            // Exit the current non-elevated process
            std::process::exit(0);
        } else {
            let error = GetLastError();
            Err(format!("Failed to request elevation. Error code: {}", error))
        }
    }
}
