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

## TODO

### Bugs
- [ ] `findReversed` returns the whole change object for subkey reversals instead of `?.id ?? null` — auto-undo of subkey pairs silently breaks
- [ ] `findReversed` closes over stale `undoneChanges` state (the listener `useEffect` has `[]` deps, so the "already undone" guard always sees an empty Set and never skips re-undoing)
- [ ] Remove debug `console.log("THE CHANGE IS", change)` left in the event listener

### Backend (Rust)
- [ ] `read_registry_value` command is a stub — returns a format string instead of actually reading the registry
- [ ] `undo_registry_change` has no handler for `subkey_added` / `subkey_deleted` change types — undo on subkey events silently errors
- [ ] `set_registry_value` doesn't handle `REG_MULTI_SZ` or other uncommon value types — undo fails silently for those values
- [ ] `value_name` for subkey events is a truncated debug dump of the values `HashMap` — should be the subkey name or left empty

### Polish / UX
- [ ] Custom app icon — currently uses the stock regedit icon
- [ ] Filter / search the changes feed by key path or change type
- [ ] Notifications (Windows toast) when a change is detected while the window is hidden
- [ ] Persist changes log across sessions (currently clears on restart)
- [ ] Export changes to a file (CSV / JSON)

### Monitoring configuration
- [ ] **Per-key scan depth** — recursive depth is a global constant (`10`); each entry in `registry-paths.json` should carry its own `max_depth` so shallow keys (e.g. `Run`) don't waste cycles and deep trees (e.g. `Uninstall`) can go further
- [ ] **In-app registry browser** — a tree view to navigate the live registry and add keys to the watch list without knowing the path upfront; makes the tool usable without registry expertise
- [ ] **Curated key profiles** — ship multiple named presets (e.g. "Malware Persistence", "Software Installation Audit", "Browser Hijack Detection") that the user can load in one click; the current single flat list is the entire scope of the tool
- [ ] **Import/export watch lists** — save and share `.json` monitoring profiles so configurations can be versioned or distributed to a team

### Killer features (real differentiators)
- [ ] **Process attribution** — identify *which process* caused a registry change using ETW (Event Tracing for Windows) or a kernel callback; this is what separates a registry monitor from a registry *auditor* and is not available in most free tools
- [ ] **Severity scoring** — assign a threat level to each monitored key (e.g. writes to `Run` = high, timezone change = low) and surface that in the UI with colour coding; lets analysts triage at a glance instead of reading every entry
- [ ] **Snapshot / diff mode** — capture the full state of watched keys before an action (installing software, running a suspicious binary), then diff against the post-action state; the classic use case for malware sandbox analysis
- [ ] **Threat intelligence matching** — flag changes that match a known-bad pattern library (e.g. specific value names or data written by known malware families); could start as a bundled JSON ruleset
- [ ] **Alert rules engine** — let the user define conditions ("alert if any value is written under `HKLM\...\Run` by a process not in my allowlist") so the tool actively defends rather than just observing
