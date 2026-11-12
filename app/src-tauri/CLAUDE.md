# src-tauri – Karte
<!-- AUTO:START -->
## Dateien
| Datei | Wofür |
|---|---|
| `Cargo.toml` | Paket `designer-app` (lib `designer_app_lib`). Cargo-Features = Plugins (siehe unten). |
| `build.rs` | Ruft `tauri_build::build()`. |
| `tauri.conf.json` | Tauri-Einstellungen: Name, Id `de.threehillsit.dito-designer`, Fenster, NSIS-Installer (`windows/installer.nsi`), Update-Adresse. |
| `tauri.macos.conf.json` | Zusätze für macOS (Ziele `dmg`, `app`). |
| `Info.plist` | macOS: Texte für Ordner-Zugriff. |
| `capabilities/` | Rechte der Fenster (`default.json`: `main`, `float-*`, `dialog-*`, `editor-*`). |
| `gen/` | Von Tauri erzeugte Schemas. Nicht von Hand ändern. |
| `icons/` | App-Icons. |
| `windows/` | `installer.nsi`, Vorlage für den Windows-Installer. |
| `src/` | Rust-Quellcode, siehe Tabellen unten. |
<!-- AUTO:END -->

## Zweck
Die dünne Tauri-Hülle. Sie nimmt `invoke(...)` aus der UI an und ruft `crates/project` und die Plugins auf. Keine Fachlogik hier. Die Crate ist auch Teil des Workspace (`app/src-tauri`).

## Dateien in `src/`
| Datei | Wofür |
|---|---|
| `main.rs` | Startet `designer_app_lib::run()`. |
| `lib.rs` | `run()`: Tauri-Builder, State (`.manage`), `generate_handler!` (Handler-Liste), `build_feature_registry`, `build_transpiler_registry`, `TauriEvents` (`EventSink`), macOS-Menü, Panic-/Backup-Hooks. |
| `os_windows.rs` | Eigene Fenster (`float-*`, `dialog-*`, `editor-*`): öffnen, Payload, Ergebnis, Schließ-Sperre, `app_exit`. |
| `lsp_bridge.rs` | Sprachserver-Prozess für das Code-Feld (`start_lsp`, `send_lsp_message`). |
| `commands/mod.rs` | Modulliste und `blocking(...)`. |

## Befehl -> Datei (`src/commands/`)
| Datei | Befehle |
|---|---|
| `plugins.rs` | `plugin_call`, `plugin_list` |
| `project.rs` | `open_project`, `list_tree_children`, `restore_open_projects`, `list_icons`, `add_open_project`, `remove_open_project`, `find_usages`, `scan_problems`, `project_changed`, `list_project_files`, `resolve_import`, `get_recent_project`, `set_recent_project`, `list_project_models`, `export_project_zip`, `inspect_project_zip`, `import_project_zip`, `project_create_empty` |
| `editor.rs` | `get_property_tree`, `set_property`, `get_property_sheet`, `get_navigator`, `set_sheet_property`, `remove_sheet_property`, `reset_sheet_property`, `reset_sheet_element`, `activate_mapping`, `enable_modification`, `set_modification_property`, `set_modification_script`, `discard_modification`, `list_diagnostics`, `undo`, `redo`, `save`, `save_overwrite`, `reload_object`, `external_changes`, `get_object_source`, `set_object_source`, `read_jdito_types` |
| `files.rs` | `read_linked_file`, `write_linked_file`, `read_theme_file`, `read_theme_pack`, `copy_object`, `delete_object`, `file_info`, `file_paste`, `file_rename`, `file_delete`, `open_in_system`, `new_object_kinds`, `validate_new_name`, `create_object`, `rename_plan`, `rename_object` |
| `rest.rs` | `rest_list_webservices`, `rest_send` (HTTP über `reqwest`, Basic mit Passwort aus dem System-Schlüsselbund), `rest_has_password`, `rest_save_password`, `rest_forget_password` |
| `transpile.rs` | `execute_action`, `npm_run`, `cancel_build`, `transpile_compare` |
| `settings.rs` | `get_settings`, `set_settings`, `detect_designer_install` (und Hilfen `settings_file`, `write_settings`) |
| `dialogs.rs` | `pick_project_folder`, `pick_file`, `pick_save_file` (über `platform::FileDialog`) |
| `misc.rs` | `check_for_update`, `install_update`, `local_data_info`, `open_local_url`, `open_log_folder`, `open_backup_folder`, `log_client_error` |
| `os_windows.rs` (in `src/`) | `window_open`, `window_payload`, `window_result`, `window_close`, `window_close_guard`, `app_exit`, `main_window_contains` |
| `lsp_bridge.rs` (in `src/`) | `start_lsp`, `send_lsp_message` |

## Einstiegspunkte
- `lib.rs` `run()`. Dort: `.manage(...)` (State), `.invoke_handler(tauri::generate_handler![...])` (Handler-Liste).
- `build_feature_registry(app)`: meldet Plugins an. Mit `#[cfg(feature = ...)]` je Plugin.
- `build_transpiler_registry()`: `native` immer, `adito` nur mit Feature `adito-transpiler`. Vorgabe ist `native`.
- `plugin_call(plugin, command, args)`: der eine Befehl für alle Plugin-Aufrufe. `plugin_list` sagt der UI, welche Plugins es gibt und ob `available`.

## Abhängigkeiten
- Rein: `project`, `designer-core`, `app-base`, `platform`, `plugin-api`; optional `git`, `ssh-tunnel`, `database`, `deploy`, `liquibase`, `adito-transpiler`.
- Raus: nichts. Die UI (`app/ui`) ruft die Befehle auf (`app/ui/src/api/tauriApi.ts`).

## Regeln und Fallen
- **Jeder Tauri-Befehl packt seinen Rumpf in `crate::commands::guard("name", || { ... })` (sync) oder `guard_async("name", async { ... }).await` (async).** Ein Panic wird so zum Fehlertext (bei `Result`) oder zum leeren Wert (`Option`, `Vec`, `bool`, `()`) und kommt ins Protokoll, statt die App zu beenden oder das Versprechen im Frontend offen zu lassen. Neue Rückgabetypen: `PanicFallback` in `commands/mod.rs` ergänzen.
- Cargo-Features: `git`, `ssh-tunnel`, `database` (zieht `ssh-tunnel`), `deploy` und `liquibase` (ziehen `database`), `adito-transpiler`. Alle in `default`. Prüfung mit weniger: `cargo check -p designer-app --no-default-features --features git`.
- Neuer Befehl: Funktion mit `#[tauri::command]` in `commands/<datei>.rs` UND Eintrag in `generate_handler!` in `lib.rs`. Ohne Eintrag meldet die UI "command not found" erst zur Laufzeit.
- `blocking(|| ...)` (`commands/mod.rs`) führt langsame Arbeit außerhalb des UI-Threads aus (`spawn_blocking`) und macht aus einem abgestürzten Task einen Fehlertext. Langsame Befehle: `async fn` + `blocking`. Ohne das friert das Fenster ein. `plugin_call` nutzt es auch.
- Plugin-Zustand gehört den Plugins (z. B. `TunnelManager`, `DbManager`), nicht Tauri. Sie werden in `build_feature_registry` gebaut und als `Arc` weitergereicht.
- Events an die UI: `app.emit("forge://...")`. Aus Plugins heraus über `EventSink` (`TauriEvents`).
- Fenster: neue Fenstertypen brauchen das Label-Muster auch in `capabilities/default.json`, sonst fehlen die Rechte.
- Kommentare in `lib.rs` und `Cargo.toml` sprechen noch von einer GNU-Toolchain ("webview2-com", "R13"). Heute gilt MSVC (Root-`CLAUDE.md`).
- `commands/project.rs` hat Hilfsfunktionen ohne Befehl (`update_open_projects`, `recent_project_file`); `commands/editor.rs` hat `current_catalog`.
- Offener Fehler laut Root-`CLAUDE.md`: Nach der Projektauswahl (`dialogs.rs`, `rfd`) stoppt die App unter dem Debugger.

## Wenn du X ändern willst
| Aufgabe | Datei |
|---|---|
| Neuer Befehl für die UI | `src/commands/<passende Datei>.rs` und `generate_handler!` in `src/lib.rs`, Logik in `crates/project` |
| Neues Plugin anmelden | `Cargo.toml` (optional + Feature), `build_feature_registry` in `src/lib.rs` |
| Neue Transpiler-Engine anmelden | `build_transpiler_registry` in `src/lib.rs` |
| Neuer State | `.manage(...)` in `run()` in `src/lib.rs` |
| Fenster-Rechte | `capabilities/default.json` |
| Installer / Updater / Fenster-Optionen | `tauri.conf.json`, `windows/installer.nsi` |
| Datei-Dialog | `src/commands/dialogs.rs` |

## Tests
- Keine eigenen Tests (Logik liegt in `crates/project`). Prüfen: `cargo check -p designer-app`.
- Starten: `cd app && npx --prefix ui tauri dev`.
