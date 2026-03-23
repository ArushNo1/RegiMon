use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{Emitter, Window};
use windows_sys::Win32::Foundation::{
    CloseHandle, GetLastError, HANDLE, WAIT_OBJECT_0, WAIT_TIMEOUT,
};
use windows_sys::Win32::Security::{
    GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
};
use windows_sys::Win32::System::Registry::{
    REG_NOTIFY_CHANGE_LAST_SET, REG_NOTIFY_CHANGE_NAME, REG_NOTIFY_THREAD_AGNOSTIC, RegNotifyChangeKeyValue
};
use windows_sys::Win32::System::Threading::{
    CreateEventW, GetCurrentProcess, OpenProcessToken, WaitForMultipleObjects,
};
use windows_sys::Win32::UI::Shell::ShellExecuteW;
use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOW;
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

const REGNOTIFYFLAGS: u32 = REG_NOTIFY_CHANGE_LAST_SET | REG_NOTIFY_THREAD_AGNOSTIC | REG_NOTIFY_CHANGE_NAME;


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
                let subtree = read_registry_key_recursive(path, 10);
                for (subpath, values) in subtree {
                    previous_state.insert(subpath, values);
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
                if changed_index >= key_handles.len() {
                    continue;
                }

                let Some((path, reg_key, event)) = key_handles.get_mut(changed_index) else {
                    continue;
                };

                let new_state = read_registry_key_recursive(path, 10);
                let mut all_changes = Vec::<RegistryChange>::new();
                let path_prefix = format!("{}\\", path);
                let old_subpaths: Vec<String> = previous_state
                    .keys()
                    .filter(|k| *k == path.as_str() || k.starts_with(&path_prefix))
                    .cloned()
                    .collect();

                for old_subpath in &old_subpaths {
                    let old_values = &previous_state[old_subpath];
                    if new_state.contains_key(old_subpath) {
                        let new_values = &new_state[old_subpath];
                        let changes = detect_changes(old_subpath, Some(old_values), new_values);
                        all_changes.extend(changes);
                    } else {
                        all_changes.push(RegistryChange {
                            key_path: old_subpath.clone(),
                            value_name: format!("{:?}", old_values).chars().take(50).collect(),
                            old_value: None,
                            new_value: None,
                            change_type: "subkey_deleted".to_string(),
                            timestamp: chrono::Local::now().to_rfc3339(),
                        });
                    }
                }

                for (new_subpath, new_values) in &new_state {
                    if !previous_state.contains_key(new_subpath) {
                        all_changes.push(RegistryChange {
                            key_path: new_subpath.clone(),
                            value_name: format!("{:?}", new_values).chars().take(50).collect(),
                            old_value: None,
                            new_value: None,
                            change_type: "subkey_added".to_string(),
                            timestamp: chrono::Local::now().to_rfc3339(),
                        });
                    }
                }

                let ignored = ignored_changes.lock().unwrap();
                let filtered_changes: Vec<_> = all_changes
                    .into_iter()
                    .filter(|change| {
                        let key = format!("{}::{}", change.key_path, change.value_name);
                        !ignored.contains(&key)
                    })
                    .collect();
                drop(ignored);
                for change in &filtered_changes {
                    let _ = window.emit("registry-change", &change);
                }

                for old_subpath in &old_subpaths {
                    if !new_state.contains_key(old_subpath) {
                        previous_state.remove(old_subpath);
                    }
                }

                for (subpath, values) in new_state {
                    previous_state.insert(subpath, values);
                }

                // Re-register for next notification
                unsafe {
                    RegNotifyChangeKeyValue(
                        reg_key.raw_handle() as *mut std::ffi::c_void,
                        1, // TRUE - watch subtree so nested changes trigger
                        REGNOTIFYFLAGS,
                        *event,
                        1, // TRUE - asynchronous
                    );
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
    let (hive, subkey_path) = get_hive_and_keypath(path)?;
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
            REGNOTIFYFLAGS,
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

fn get_hive_and_keypath(path: &str) -> Result<(RegKey, String), std::io::Error> {
    let parts: Vec<&str> = path.split('\\').collect();
    if parts.is_empty() || parts[0].is_empty() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Invalid registry path: missing hive",
        ));
    }

    if parts.len() < 2 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Invalid registry path: missing subkey",
        ));
    }

    let hive = match parts[0] {
        "HKEY_LOCAL_MACHINE" | "HKLM" => RegKey::predef(HKEY_LOCAL_MACHINE),
        "HKEY_CURRENT_USER" | "HKCU" => RegKey::predef(HKEY_CURRENT_USER),
        "HKEY_CLASSES_ROOT" | "HKCR" => RegKey::predef(HKEY_CLASSES_ROOT),
        _ => {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "Unknown registry hive",
            ))
        }
    };

    let subkey_path = parts[1..].join("\\");
    if subkey_path.is_empty() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Invalid registry path: empty subkey",
        ));
    }

    Ok((hive, subkey_path))
}

fn read_registry_key_recursive(
    root_path: &str,
    max_depth: usize,
) -> HashMap<String, HashMap<String, String>> {
    let mut result: HashMap<String, HashMap<String, String>> = HashMap::new();
    let hivestring = root_path.split('\\').next().unwrap();
    let mut bfs: VecDeque<(String, RegKey, usize)> = VecDeque::new();

    let Ok((hive, key_path)) = get_hive_and_keypath(root_path) else {
        return result;
    };
    let Ok(key) = hive.open_subkey_with_flags(&key_path, KEY_READ) else {
        return result;
    };
    bfs.push_back((key_path.to_string(), key, 0));
    while let Some((path, key, depth)) = bfs.pop_front() {
        let mut values = HashMap::new();
        for (name, value) in key.enum_values().filter_map(|v| v.ok()) {
            values.insert(name, format!("{:?}", value));
        }
        for subkey in key.enum_keys().filter_map(|k| k.ok()) {
            if depth < max_depth {
                let new_path = format!("{}\\{}", path, subkey);
                let Ok(new_key) = hive.open_subkey_with_flags(&new_path, KEY_READ) else {
                    continue;
                };
                bfs.push_back((new_path, new_key, depth + 1));
            }
        }
        result.insert(format!("{}\\{}", hivestring, path), values);
    }
    result
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

    let (hive, subkey_path) = get_hive_and_keypath(&change.key_path)
        .map_err(|e| format!("Invalid registry path: {}", e))?;
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
            Ok(byte_vec) => {
                key.set_raw_value(
                    value_name,
                    &winreg::RegValue {
                        vtype: winreg::enums::RegType::REG_BINARY,
                        bytes: byte_vec,
                    },
                )
                .map_err(|e| format!("Failed to set binary value: {}", e))?;
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
        let exe_path =
            std::env::current_exe().map_err(|e| format!("Failed to get executable path: {}", e))?;

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
            Err(format!(
                "Failed to request elevation. Error code: {}",
                error
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*; // imports everything from the parent module

    #[test]
    fn test_reads_2() {
        let result = read_registry_key_recursive("HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\RulesEngine\\Providers", 3);
        println!("Keys found: {:#?}", result.keys().collect::<Vec<_>>());
    }
    #[test]
    fn test_recursive_reads_root() {
        // Use HKCU\Software\Microsoft\Windows\CurrentVersion\Run
        // — always exists, no admin needed
        let result = read_registry_key_recursive(
            "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
            3,
        );
        // Should have at least the root path as a key
        assert!(result
            .contains_key("HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"));
        println!("Keys found: {:#?}", result.keys().collect::<Vec<_>>());
    }

    #[test]
    fn test_recursive_finds_subkeys() {
        // Uninstall has many subkeys (one per installed app)
        let result = read_registry_key_recursive(
            "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
            1,
        );
        // Should contain more than just the root
        assert!(
            result.len() > 1,
            "Expected subkeys, found: {:?}",
            result.keys().collect::<Vec<_>>()
        );
    }

    #[test]
    fn test_depth_zero_returns_only_root() {
        let result = read_registry_key_recursive(
            "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
            0,
        );
        assert_eq!(result.len(), 1); // only root, no children
    }
}
