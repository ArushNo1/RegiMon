# RegiMon — Windows Registry Monitor

A real-time Windows registry monitoring desktop app built with Tauri, React, and Rust. Watch critical registry keys for changes, get notified instantly, and undo modifications with one click.

## Features

- **Real-time monitoring** — uses Windows `RegNotifyChangeKeyValue` API to detect changes the moment they happen
- **Change detection** — tracks value modifications, additions, and deletions across monitored keys and their subkeys (recursive)
- **Undo changes** — revert any detected registry change directly from the UI
- **Admin elevation** — detects whether the app is running as administrator; prompts for elevation when HKLM/HKCR keys are in scope
- **System tray** — minimizes to tray on close; left-click to show/hide, right-click for menu
- **Customizable key list** — add/remove registry paths at runtime; persisted in `localStorage`; reset to defaults from `registry-paths.json`

## Default Monitored Keys

The app ships with a curated list of security-relevant keys including:

- Autorun/startup keys (`Run`, `RunOnce`, `RunOnceEx`, `RunServices`)
- Browser hijack targets (search providers, start page, protocol handlers)
- Shell extension and file association keys
- Services and driver configuration
- UAC, firewall, and security policy settings
- Credential store and certificate roots
- LoveBug/malware persistence locations

See [public/registry-paths.json](public/registry-paths.json) for the full list with descriptions.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| UI | React 19 + Tailwind CSS v4 |
| Desktop shell | Tauri v2 |
| Backend | Rust (Windows API via `windows-sys`, `winreg`) |
| Build | Vite 7 |

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://rustup.rs/) (stable toolchain)
- Windows 10/11

## Development

```bash
npm install
npm run tauri dev
```

## Building

```bash
npm run tauri build
```

Produces an MSI installer and NSIS `.exe` in `src-tauri/target/release/bundle/`.

CI builds are triggered automatically on pushes to branches matching `v*` via [.github/workflows/build-windows.yml](.github/workflows/build-windows.yml).

## Project Structure

```
src/
  App.jsx                  # Main UI — monitoring controls, changes feed
src-tauri/src/
  main.rs                  # Tauri commands, tray setup
  registry_monitor.rs      # Rust backend — WinAPI polling, undo logic
public/
  registry-paths.json      # Default set of monitored registry keys
```

## Notes

- HKCU keys can be monitored without elevation. HKLM and HKCR keys require administrator privileges.
- The app keeps the last 100 detected changes in memory.
- Closing the window minimizes to the system tray rather than exiting.
