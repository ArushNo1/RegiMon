use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::ffi::OsStr;
use std::io;
use std::os::windows::ffi::OsStrExt;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{Emitter, Window};
use windows_sys::Win32::Foundation::{
    CloseHandle, GetLastError, HANDLE, WAIT_FAILED, WAIT_OBJECT_0, WAIT_TIMEOUT,
};
use windows_sys::Win32::Security::{
    GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
};
use windows_sys::Win32::System::Registry::{
    RegNotifyChangeKeyValue, REG_NOTIFY_CHANGE_LAST_SET, REG_NOTIFY_CHANGE_NAME,
    REG_NOTIFY_THREAD_AGNOSTIC,
};
use windows_sys::Win32::System::Threading::{
    CreateEventW, GetCurrentProcess, OpenProcessToken, WaitForMultipleObjects,
};
use windows_sys::Win32::UI::Shell::ShellExecuteW;
use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOW;
use winreg::enums::*;
use winreg::RegKey;

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ChangeType {
    Modified,
    Added,
    Deleted,
    SubkeyAdded,
    SubkeyDeleted,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct RegistryChange {
    pub key_path: String,
    pub value_name: String,
    pub old_value: Option<String>,
    pub new_value: Option<String>,
    pub change_type: ChangeType,
    pub timestamp: String,
}

pub struct RegistryMonitor {
    monitoring: Arc<std::sync::atomic::AtomicBool>,
    ignored_changes: Arc<Mutex<HashSet<String>>>,
}

const REGNOTIFYFLAGS: u32 =
    REG_NOTIFY_CHANGE_LAST_SET | REG_NOTIFY_THREAD_AGNOSTIC | REG_NOTIFY_CHANGE_NAME;

type ScanState = HashMap<String, HashMap<String, String>>;
type KeyHandle = (String, RegKey, HANDLE);

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
            let (mut previous_state, key_handles) = initial_scan(&registry_paths);
            if key_handles.is_empty() {
                eprintln!("Failed to setup any registry notifications");
                return;
            }

            let events: Vec<HANDLE> = key_handles.iter().map(|(_, _, e)| *e).collect();

            while monitoring.load(std::sync::atomic::Ordering::SeqCst) {
                let wait_result = unsafe {
                    WaitForMultipleObjects(events.len() as u32, events.as_ptr(), 0, 1000)
                };

                if wait_result == WAIT_TIMEOUT {
                    continue;
                }
                if wait_result == WAIT_FAILED {
                    eprintln!(
                        "WaitForMultipleObjects failed: error {}",
                        unsafe { GetLastError() }
                    );
                    thread::sleep(Duration::from_millis(500));
                    continue;
                }

                let changed_index = wait_result.wrapping_sub(WAIT_OBJECT_0) as usize;
                let Some((path, reg_key, event)) = key_handles.get(changed_index) else {
                    continue;
                };

                process_change_batch(path, &mut previous_state, &ignored_changes, &window);

                unsafe {
                    RegNotifyChangeKeyValue(
                        reg_key.raw_handle() as *mut std::ffi::c_void,
                        1,
                        REGNOTIFYFLAGS,
                        *event,
                        1,
                    );
                }
            }

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

fn initial_scan(paths: &[String]) -> (ScanState, Vec<KeyHandle>) {
    let mut state: ScanState = HashMap::new();
    let mut handles = Vec::new();
    for path in paths {
        for (subpath, values) in read_registry_key_recursive(path, 10) {
            state.insert(subpath, values);
        }
        match setup_registry_notification(path) {
            Ok((reg_key, event)) => handles.push((path.clone(), reg_key, event)),
            Err(e) => eprintln!("Failed to monitor {}: {}", path, e),
        }
    }
    (state, handles)
}

fn process_change_batch(
    path: &str,
    previous_state: &mut ScanState,
    ignored_changes: &Mutex<HashSet<String>>,
    window: &Window,
) {
    let new_state = read_registry_key_recursive(path, 10);
    let now = chrono::Local::now().to_rfc3339();
    let mut all_changes = Vec::<RegistryChange>::new();

    let path_prefix = format!("{}\\", path);
    let old_subpaths: Vec<String> = previous_state
        .keys()
        .filter(|k| *k == path || k.starts_with(&path_prefix))
        .cloned()
        .collect();

    for old_subpath in &old_subpaths {
        let old_values = &previous_state[old_subpath];
        match new_state.get(old_subpath) {
            Some(new_values) => {
                all_changes.extend(detect_changes(old_subpath, old_values, new_values, &now));
            }
            None => {
                all_changes.push(RegistryChange {
                    key_path: old_subpath.clone(),
                    value_name: String::new(),
                    old_value: None,
                    new_value: None,
                    change_type: ChangeType::SubkeyDeleted,
                    timestamp: now.clone(),
                });
            }
        }
    }

    for new_subpath in new_state.keys() {
        if !previous_state.contains_key(new_subpath) {
            all_changes.push(RegistryChange {
                key_path: new_subpath.clone(),
                value_name: String::new(),
                old_value: None,
                new_value: None,
                change_type: ChangeType::SubkeyAdded,
                timestamp: now.clone(),
            });
        }
    }

    {
        let ignored = ignored_changes.lock().unwrap();
        for change in &all_changes {
            let key = format!("{}::{}", change.key_path, change.value_name);
            if ignored.contains(&key) {
                continue;
            }
            if let Err(e) = window.emit("registry-change", change) {
                eprintln!("Failed to emit registry-change: {}", e);
            }
        }
    }

    for old_subpath in &old_subpaths {
        previous_state.remove(old_subpath);
    }
    for (subpath, values) in new_state {
        previous_state.insert(subpath, values);
    }
}

fn setup_registry_notification(path: &str) -> Result<(RegKey, HANDLE), Box<dyn std::error::Error>> {
    let (hive, subkey_path) = get_hive_and_keypath(path)?;
    let key = hive.open_subkey_with_flags(&subkey_path, KEY_NOTIFY | KEY_READ)?;

    let event = unsafe { CreateEventW(std::ptr::null(), 1, 0, std::ptr::null()) };
    if event.is_null() {
        return Err("Failed to create event".into());
    }

    let result = unsafe {
        RegNotifyChangeKeyValue(
            key.raw_handle() as *mut std::ffi::c_void,
            1,
            REGNOTIFYFLAGS,
            event,
            1,
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

fn get_parent_and_child(path: &str) -> Result<(String, String), io::Error> {
    let parts: Vec<&str> = path.split('\\').collect();
    if parts[0].is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Invalid registry path: missing hive",
        ));
    }
    if parts.len() < 2 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Invalid registry path: missing subkey",
        ));
    }
    let parent = parts[..parts.len() - 1].join("\\");
    Ok((parent, parts[parts.len() - 1].to_string()))
}

fn parse_hive(prefix: &str) -> Option<(RegKey, bool)> {
    match prefix {
        "HKEY_LOCAL_MACHINE" | "HKLM" => Some((RegKey::predef(HKEY_LOCAL_MACHINE), true)),
        "HKEY_CLASSES_ROOT" | "HKCR" => Some((RegKey::predef(HKEY_CLASSES_ROOT), true)),
        "HKEY_CURRENT_USER" | "HKCU" => Some((RegKey::predef(HKEY_CURRENT_USER), false)),
        _ => None,
    }
}

fn get_hive_and_keypath(path: &str) -> Result<(RegKey, String), io::Error> {
    let parts: Vec<&str> = path.split('\\').collect();
    if parts[0].is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Invalid registry path: missing hive",
        ));
    }
    if parts.len() < 2 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Invalid registry path: missing subkey",
        ));
    }
    let (hive, _) = parse_hive(parts[0]).ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, "Unknown registry hive")
    })?;
    let subkey_path = parts[1..].join("\\");
    if subkey_path.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Invalid registry path: empty subkey",
        ));
    }
    Ok((hive, subkey_path))
}

fn read_registry_key_recursive(root_path: &str, max_depth: usize) -> ScanState {
    let mut result: ScanState = HashMap::new();
    let Ok((hive, key_path)) = get_hive_and_keypath(root_path) else {
        return result;
    };
    let hive_name = root_path
        .split_once('\\')
        .map(|(h, _)| h)
        .unwrap_or(root_path);
    let Ok(key) = hive.open_subkey_with_flags(&key_path, KEY_READ) else {
        return result;
    };

    let mut bfs: VecDeque<(String, RegKey, usize)> = VecDeque::new();
    bfs.push_back((key_path, key, 0));
    while let Some((path, key, depth)) = bfs.pop_front() {
        let mut values = HashMap::new();
        for (name, value) in key.enum_values().filter_map(|v| v.ok()) {
            values.insert(name, format!("{:?}", value));
        }
        if depth < max_depth {
            for subkey in key.enum_keys().filter_map(|k| k.ok()) {
                let new_path = format!("{}\\{}", path, subkey);
                let Ok(new_key) = hive.open_subkey_with_flags(&new_path, KEY_READ) else {
                    continue;
                };
                bfs.push_back((new_path, new_key, depth + 1));
            }
        }
        result.insert(format!("{}\\{}", hive_name, path), values);
    }
    result
}

fn detect_changes(
    path: &str,
    previous: &HashMap<String, String>,
    current: &HashMap<String, String>,
    now: &str,
) -> Vec<RegistryChange> {
    let mut changes = Vec::new();

    for (key, old_val) in previous {
        match current.get(key) {
            Some(new_val) if new_val != old_val => {
                changes.push(RegistryChange {
                    key_path: path.to_string(),
                    value_name: key.clone(),
                    old_value: Some(old_val.clone()),
                    new_value: Some(new_val.clone()),
                    change_type: ChangeType::Modified,
                    timestamp: now.to_string(),
                });
            }
            None => {
                changes.push(RegistryChange {
                    key_path: path.to_string(),
                    value_name: key.clone(),
                    old_value: Some(old_val.clone()),
                    new_value: None,
                    change_type: ChangeType::Deleted,
                    timestamp: now.to_string(),
                });
            }
            _ => {}
        }
    }

    for (key, new_val) in current {
        if !previous.contains_key(key) {
            changes.push(RegistryChange {
                key_path: path.to_string(),
                value_name: key.clone(),
                old_value: None,
                new_value: Some(new_val.clone()),
                change_type: ChangeType::Added,
                timestamp: now.to_string(),
            });
        }
    }

    changes
}

fn schedule_ignored_clear(ignored: Arc<Mutex<HashSet<String>>>, key: String) {
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(500));
        ignored.lock().unwrap().remove(&key);
    });
}

#[tauri::command]
pub fn undo_registry_change(
    change: RegistryChange,
    ignored_changes: Arc<Mutex<HashSet<String>>>,
) -> Result<String, String> {
    let change_key = format!("{}::{}", change.key_path, change.value_name);
    ignored_changes.lock().unwrap().insert(change_key.clone());

    let (hive, subkey_path) = get_hive_and_keypath(&change.key_path)
        .map_err(|e| format!("Invalid registry path: {}", e))?;

    let result = match change.change_type {
        ChangeType::Modified | ChangeType::Deleted => {
            let old = change.old_value.clone().ok_or("No old value to restore")?;
            let key = hive
                .open_subkey_with_flags(&subkey_path, KEY_WRITE | KEY_READ)
                .map_err(|e| format!("Failed to open registry key: {}", e))?;
            set_registry_value(&key, &change.value_name, &old)?;
            Ok(format!("Restored '{}'", change.value_name))
        }
        ChangeType::Added => {
            let key = hive
                .open_subkey_with_flags(&subkey_path, KEY_WRITE | KEY_READ)
                .map_err(|e| format!("Failed to open registry key: {}", e))?;
            key.delete_value(&change.value_name)
                .map_err(|e| format!("Failed to delete value: {}", e))?;
            Ok(format!("Removed added value '{}'", change.value_name))
        }
        ChangeType::SubkeyAdded | ChangeType::SubkeyDeleted => {
            let (parent_path, child) = get_parent_and_child(&subkey_path)
                .map_err(|e| format!("Invalid subkey path: {}", e))?;
            let parent = hive
                .open_subkey_with_flags(&parent_path, KEY_WRITE)
                .map_err(|e| format!("Failed to open parent key {}: {}", parent_path, e))?;
            if change.change_type == ChangeType::SubkeyAdded {
                parent
                    .delete_subkey_all(&child)
                    .map_err(|e| format!("Failed to delete subkey {}: {}", child, e))?;
                Ok(format!("Removed added subkey '{}'", child))
            } else {
                parent
                    .create_subkey(&child)
                    .map_err(|e| format!("Failed to create subkey {}: {}", child, e))?;
                Ok(format!("Restored deleted subkey '{}'", child))
            }
        }
    };

    if result.is_ok() {
        schedule_ignored_clear(ignored_changes, change_key);
    }
    result
}

fn set_registry_value(key: &RegKey, value_name: &str, value_str: &str) -> Result<(), String> {
    let inner = value_str
        .strip_prefix("RegValue(")
        .and_then(|s| s.strip_suffix(')'))
        .ok_or("Unsupported value format")?;

    let (type_tag, payload) = inner
        .split_once(": ")
        .ok_or("Malformed value: missing type tag")?;

    let set_str = |vtype: winreg::enums::RegType| {
        let mut wide: Vec<u16> = payload.encode_utf16().collect();
        wide.push(0);
        let bytes: Vec<u8> = wide.iter().flat_map(|u| u.to_le_bytes()).collect();
        key.set_raw_value(value_name, &winreg::RegValue { vtype, bytes })
    };

    match type_tag {
        "REG_SZ" => set_str(winreg::enums::RegType::REG_SZ)
            .map_err(|e| format!("Failed to set REG_SZ: {}", e)),
        "REG_EXPAND_SZ" => set_str(winreg::enums::RegType::REG_EXPAND_SZ)
            .map_err(|e| format!("Failed to set REG_EXPAND_SZ: {}", e)),
        "REG_DWORD" => {
            let n: u32 = payload
                .parse()
                .map_err(|e| format!("Failed to parse DWORD: {}", e))?;
            key.set_value(value_name, &n)
                .map_err(|e| format!("Failed to set REG_DWORD: {}", e))
        }
        "REG_QWORD" => {
            let n: u64 = payload
                .parse()
                .map_err(|e| format!("Failed to parse QWORD: {}", e))?;
            key.set_value(value_name, &n)
                .map_err(|e| format!("Failed to set REG_QWORD: {}", e))
        }
        "REG_BINARY" => {
            let bytes_str = payload.trim_start_matches('[').trim_end_matches(']');
            let bytes: Vec<u8> = bytes_str
                .split(',')
                .map(|s| s.trim().parse::<u8>())
                .collect::<Result<_, _>>()
                .map_err(|e| format!("Failed to parse binary value: {}", e))?;
            key.set_raw_value(
                value_name,
                &winreg::RegValue {
                    vtype: winreg::enums::RegType::REG_BINARY,
                    bytes,
                },
            )
            .map_err(|e| format!("Failed to set REG_BINARY: {}", e))
        }
        "REG_MULTI_SZ" => {
            let inner = payload.trim_start_matches('[').trim_end_matches(']');
            let mut wide: Vec<u16> = Vec::new();
            for s in inner.split('\n') {
                wide.extend(s.encode_utf16());
                wide.push(0);
            }
            wide.push(0);
            let bytes: Vec<u8> = wide.iter().flat_map(|u| u.to_le_bytes()).collect();
            key.set_raw_value(
                value_name,
                &winreg::RegValue {
                    vtype: winreg::enums::RegType::REG_MULTI_SZ,
                    bytes,
                },
            )
            .map_err(|e| format!("Failed to set REG_MULTI_SZ: {}", e))
        }
        other => Err(format!("Unsupported registry value type: {}", other)),
    }
}

fn to_wide_null(s: &OsStr) -> Vec<u16> {
    s.encode_wide().chain(std::iter::once(0)).collect()
}

#[tauri::command]
pub fn is_elevated() -> bool {
    unsafe {
        let mut token_handle: HANDLE = std::ptr::null_mut();

        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token_handle) == 0 {
            return false;
        }

        let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
        let mut return_length: u32 = 0;
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

#[tauri::command]
pub fn requires_admin(path: String) -> bool {
    path.split('\\')
        .next()
        .and_then(parse_hive)
        .map(|(_, admin)| admin)
        .unwrap_or(false)
}

#[tauri::command]
pub fn request_elevation() -> Result<String, String> {
    let exe_path =
        std::env::current_exe().map_err(|e| format!("Failed to get executable path: {}", e))?;
    let exe_path_wide = to_wide_null(exe_path.as_os_str());
    let operation = to_wide_null(OsStr::new("runas"));

    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            operation.as_ptr(),
            exe_path_wide.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOW,
        )
    };

    if result as isize > 32 {
        std::process::exit(0);
    } else {
        let error = unsafe { GetLastError() };
        Err(format!(
            "Failed to request elevation. Error code: {}",
            error
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_hive_resolves_known_aliases() {
        for prefix in [
            "HKLM",
            "HKEY_LOCAL_MACHINE",
            "HKCU",
            "HKEY_CURRENT_USER",
            "HKCR",
            "HKEY_CLASSES_ROOT",
        ] {
            assert!(parse_hive(prefix).is_some(), "expected {} to parse", prefix);
        }
    }

    #[test]
    fn parse_hive_admin_flag_matches_hive() {
        assert!(parse_hive("HKLM").unwrap().1);
        assert!(parse_hive("HKCR").unwrap().1);
        assert!(!parse_hive("HKCU").unwrap().1);
    }

    #[test]
    fn parse_hive_rejects_unknown() {
        assert!(parse_hive("HKZZ").is_none());
        assert!(parse_hive("").is_none());
    }

    #[test]
    fn get_parent_and_child_splits_last_segment() {
        let (parent, child) = get_parent_and_child("HKCU\\Software\\Foo").unwrap();
        assert_eq!(parent, "HKCU\\Software");
        assert_eq!(child, "Foo");
    }

    #[test]
    fn get_parent_and_child_rejects_single_segment() {
        assert!(get_parent_and_child("HKCU").is_err());
    }

    #[test]
    fn get_parent_and_child_rejects_leading_backslash() {
        assert!(get_parent_and_child("\\Foo").is_err());
    }

    #[test]
    fn get_hive_and_keypath_strips_hive() {
        let (_hive, sub) = get_hive_and_keypath("HKCU\\Software\\Foo").unwrap();
        assert_eq!(sub, "Software\\Foo");
    }

    #[test]
    fn get_hive_and_keypath_rejects_unknown_hive() {
        assert!(get_hive_and_keypath("HKZZ\\Foo").is_err());
    }

    #[test]
    fn get_hive_and_keypath_rejects_hive_only() {
        assert!(get_hive_and_keypath("HKCU").is_err());
    }

    #[test]
    fn requires_admin_for_each_hive() {
        assert!(requires_admin("HKLM\\Software".into()));
        assert!(requires_admin("HKCR\\foo".into()));
        assert!(!requires_admin("HKCU\\Software".into()));
        assert!(!requires_admin("HKZZ\\foo".into()));
    }
}
