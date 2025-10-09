#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod registry_monitor;

use registry_monitor::{RegistryChange, RegistryMonitor};
use std::sync::Mutex;
use tauri::{Manager, State};

struct AppState {
    monitor: Mutex<RegistryMonitor>,
}

#[tauri::command]
fn start_monitoring(
    window: tauri::Window,
    state: State<AppState>,
    paths: Vec<String>,
) -> Result<String, String> {
    let monitor = state.monitor.lock().unwrap();
    monitor.start_monitoring(window, paths);
    Ok("Monitoring started".to_string())
}

#[tauri::command]
fn stop_monitoring(state: State<AppState>) -> Result<String, String> {
    let monitor = state.monitor.lock().unwrap();
    monitor.stop_monitoring();
    Ok("Monitoring stopped".to_string())
}

#[tauri::command]
fn read_registry_value(path: String, value_name: String) -> Result<String, String> {
    // Implementation for reading a specific registry value
    Ok(format!("Reading {} from {}", value_name, path))
}

fn main() {
    tauri::Builder::default()
        .manage(AppState {
            monitor: Mutex::new(RegistryMonitor::new()),
        })
        .invoke_handler(tauri::generate_handler![
            start_monitoring,
            stop_monitoring,
            read_registry_value
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}