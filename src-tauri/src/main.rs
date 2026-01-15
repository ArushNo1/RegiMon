#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod registry_monitor;

use registry_monitor::{RegistryMonitor, RegistryChange};
use std::sync::Mutex;
use tauri::{State, Manager, menu::{MenuBuilder, MenuItem}, tray::{TrayIconBuilder, TrayIconEvent}};

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

#[tauri::command]
fn undo_change(change: RegistryChange) -> Result<String, String> {
    registry_monitor::undo_registry_change(change)
}

fn main() {
    tauri::Builder::default()
        .manage(AppState {
            monitor: Mutex::new(RegistryMonitor::new()),
        })
        .invoke_handler(tauri::generate_handler![
            start_monitoring,
            stop_monitoring,
            read_registry_value,
            undo_change
        ])
        .setup(|app| {
            // Build the tray menu
            let show_item = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
            let hide_item = MenuItem::with_id(app, "hide", "Hide Window", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            
            let menu = MenuBuilder::new(app)
                .item(&show_item)
                .item(&hide_item)
                .separator()
                .item(&quit_item)
                .build()?;

            // Build the tray icon
            let _tray = TrayIconBuilder::with_id("main-tray")
                .tooltip("Registry Monitor")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "hide" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.hide();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button, .. } = event {
                        if button == tauri::tray::MouseButton::Left {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                if window.is_visible().unwrap_or(false) {
                                    let _ = window.hide();
                                } else {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                            }
                        }
                    }
                })
                .build(app)?;

            // Show the window initially
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                
                // Minimize to tray on close instead of exiting
                let window_clone = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        window_clone.hide().unwrap();
                        api.prevent_close();
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}