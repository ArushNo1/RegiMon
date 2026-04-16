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

- [ ] `handleUndo` has a stale debug `console.log('Undo successful:', result)` — should be removed (`App.jsx:232`)
- [ ] `findReversed` ignores `subkey_added`/`subkey_deleted` — subkey reversal is never detected, so undoing a subkey addition leaves the original change un-marked
- [ ] `findReversed` subkey-undone check only matches on key name, not on which subkey — two different subkeys under the same path can falsely cancel each other
- [ ] Adding a subkey → adding a value under it → deleting the subkey causes an OS error because the value change entry still references the now-deleted key
- [ ] `removePath` during active monitoring: if `stop_monitoring` succeeds but the subsequent `start_monitoring` throws, `monitoring` state stays `true` while nothing is actually being watched (`App.jsx:198-210`)

### Backend (Rust — requires human dev)

- [ ] `undo_registry_change` has no handler for `subkey_added`/`subkey_deleted` — undo on subkey events silently fails
- [ ] `value_name` for subkey events is a debug dump of the values `HashMap` instead of the subkey name

### Code quality

- [ ] `getChangesCount` recalculates on every render — should be `useMemo(() => ..., [changes, undoneChanges])` (`App.jsx:254`)
- [ ] `reloadFromFile` and the first-run mount `useEffect` contain identical fetch-and-parse logic — extract to a shared `loadPathsFromFile()` helper (`App.jsx:73` and `213`)
- [ ] localStorage entries are only validated at the array level — an entry with a missing `key` field passes `undefined` to Rust and renders a broken card

### UX polish

- [ ] Settings panel is a stub — needs: absolute vs. relative timestamp toggle, per-key depth control, keyset import/export
- [ ] "Reset to Default Paths" has no confirmation dialog — a misclick wipes custom configuration with no undo
- [ ] No loading state while `registry-paths.json` is fetched on first run — key list flashes empty until the fetch resolves
- [ ] Admin elevation banner should also offer to disable the specific keys that require admin rather than only prompting to re-launch elevated
- [ ] Keys should be individually togglable (enabled/disabled) without removing them from the list
- [ ] Filter/search the changes feed by key path or change type
- [ ] Windows toast notification when a change is detected while the window is minimised to tray
- [ ] Persist the changes log across sessions (currently clears on restart)
- [ ] Export changes to CSV/JSON
- [ ] `findReversed` logs two separate entries for subkey add/delete pairs — decide on and implement the correct behaviour (mark as undone + new entry, or collapse)

### Monitoring configuration

- [ ] **Per-key scan depth** — recursive depth is a global constant (`10`); each entry in `registry-paths.json` should carry its own `max_depth`
- [ ] **Import/export watch lists** — save/load `.json` monitoring profiles; support multiple named configs
- [ ] **Curated key profiles** — named presets ("Malware Persistence", "Browser Hijack Detection", etc.) loadable in one click
- [ ] **In-app registry browser** — tree view to navigate the live registry and add keys without knowing paths upfront

### Killer features

- [ ] **Process attribution** — identify *which process* caused a change via ETW or a kernel callback; the main differentiator vs. free tools
- [ ] **Severity scoring** — threat level per key (e.g. writes to `Run` = high) surfaced as colour coding for fast triage
- [ ] **Snapshot / diff mode** — capture full key state before/after an action (installing software, running a binary) and diff; classic malware sandbox use case
- [ ] **Threat intelligence matching** — flag changes matching a known-bad pattern library (bundled JSON ruleset)
- [ ] **Alert rules engine** — user-defined conditions with process allowlists so the tool actively defends rather than just observing
