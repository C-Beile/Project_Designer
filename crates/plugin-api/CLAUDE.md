# plugin-api – Karte
<!-- AUTO:START -->
## Dateien
| Datei | Wofür |
|---|---|
| `Cargo.toml` | Nur `serde`, `serde_json`. Keine Workspace-Crate. |
| `src/` | Quellcode. Einzeldateien folgen. |
| `src/lib.rs` | Modulliste und Re-Exports. |
| `src/feature.rs` | `FeaturePlugin`, `FeatureRegistry`, `EventSink`, `Args`, `to_json`, `unknown_command`. Die abschaltbaren Plugins (git, database ...). |
| `src/transpiler.rs` | `Transpiler`, `TranspilerRegistry`, `TranspileOptions`, `Progress`, `ProgressSink`, `TranspileOutcome`. |
| `src/registry.rs` | `PluginRegistry`: Prüfer, Aktionen, Editor-Anbieter, Datei-Compiler (alte Erweiterungspunkte). |
| `src/validator.rs` | Trait `Validator` (prüft ein `ProjectModel`). |
| `src/action.rs` | Trait `Action` (gibt eine `Transaction` zurück), `ActionError`. |
| `src/editor_provider.rs` | Trait `EditorProvider`. |
| `src/linked_file_compiler.rs` | Trait `LinkedFileCompiler`, `JsInlineCompiler`, `UnverifiedTsCompiler`. |
| `src/builtin.rs` | `register_all`: meldet die eingebauten Teile an (nur der `.js`-Compiler). |
| `src/types.rs` | Kleine eigene Typen (`ProjectModel`, `PropertyNode`, `Diagnostic`, `Transaction` ...), absichtlich unabhängig von `aod`. |
<!-- AUTO:END -->

## Zweck
Die Schnittstellen zwischen Kern und Erweiterungen. Der Kern kennt nur diese Traits, nie ein konkretes Plugin. Zwei Arten von Erweiterungen:
- Feature-Plugins (`FeaturePlugin`): Befehle über JSON, abschaltbar per Cargo-Feature.
- Transpiler-Engines (`Transpiler`): austauschbar, Auswahl per Id.
Dazu die älteren Erweiterungspunkte in `PluginRegistry` (`Validator`, `Action`, `EditorProvider`, `LinkedFileCompiler`).

## Einstiegspunkte
- `FeatureRegistry::register`, `get`, `is_available`, `call(plugin, command, args)`.
- `TranspilerRegistry::register`, `set_default`, `select(id)`, `cancel_any`.
- `PluginRegistry` wird in `designer-core` gebaut (`build_plugin_registry`) und in `project/src/actions.rs` erweitert.

## Abhängigkeiten
- Rein: nichts aus dem Workspace.
- Raus: alle Plugin-Crates, `designer-core`, `validators`, `project`, `native-transpiler`-Nutzer, `app/src-tauri`.

## Regeln und Fallen
- Plugin-Befehle: Name + JSON-Objekt mit camelCase-Feldern. `Args` liest sie und gibt klare Fehlertexte. Unbekannter Befehl: `unknown_command(id, command)`.
- `FeaturePlugin::requires` nennt Ids anderer Plugins. Fehlt eines (oder gibt es einen Zyklus), meldet `call` einen Fehler und `is_available` ist false.
- Ein zweites `register` mit gleicher Id ersetzt das erste. Die Reihenfolge der Anmeldung bleibt.
- `FeaturePlugin` und `Transpiler` sind `Send + Sync`: sie laufen in `spawn_blocking` (`plugin_call`). Zustand gehört dem Plugin (z. B. `Arc<DbManager>`), nicht Tauri.
- Events an die UI nur über `EventSink::emit` (Name z. B. `forge://tunnel-progress`), nie direkt über Tauri.
- `types.rs` hat eigene Platzhalter-Typen. Die Umwandlung aus `aod` steht in `designer-core/src/plugin_bridge.rs`.
- Die Traits `Validator`, `Action`, `EditorProvider`, `LinkedFileCompiler` sind nicht `Send`/`Sync` und werden bei jedem Aufruf neu in eine `PluginRegistry` gelegt. Kein dauerhafter Zustand darin.

## Wenn du X ändern willst
Neues Feature-Plugin, Schritt für Schritt:

| Schritt | Datei |
|---|---|
| 1. Neue Crate `crates/<name>` anlegen (`crates/*` ist schon im Workspace). Abhängigkeit `plugin-api`. | `crates/<name>/Cargo.toml` |
| 2. Struct mit `impl FeaturePlugin`: `id`, `name`, `requires`, `call` mit `match command { ... }`. Vorbild: `crates/ssh-tunnel/src/plugin.rs`. | `crates/<name>/src/plugin.rs`, `src/lib.rs` (`pub use`) |
| 3. Als optionale Abhängigkeit und Feature eintragen, ins `default` setzen. `requires` auch als Feature-Kette (`database = ["ssh-tunnel", ...]`). | `app/src-tauri/Cargo.toml` |
| 4. Mit `#[cfg(feature = "<name>")]` in `build_feature_registry` anmelden (Zustand, `EventSink` hier übergeben). | `app/src-tauri/src/lib.rs` |
| 5. UI: `invoke('plugin_call', { plugin, command, args })`. Menü, Einstellungen usw. über die UI-Registry, nur zeigen wenn `plugin_list` das Plugin als `available` meldet. Vorbild: `app/ui/src/features/git/`, `App.tsx`. | `app/ui/src/features/<name>/`, `app/ui/src/api/tauriApi.ts` |
| 6. Karte in `crates/CLAUDE.md` und Root-`CLAUDE.md` ergänzen. | `crates/CLAUDE.md` |

| Andere Aufgabe | Datei |
|---|---|
| Neue Transpiler-Engine | `impl Transpiler` und in `build_transpiler_registry` (`app/src-tauri/src/lib.rs`) anmelden |
| Neuer Objekt-Prüfer | `crates/validators/src/validator_table.rs` |
| Neues Argument-Hilfsmittel für Befehle | `Args` in `src/feature.rs` |
| Neue Aktion für `execute_action` | `impl Action`, anmelden in `crates/project/src/actions.rs` |

## Tests
- `cargo test -p plugin-api`. Die Tests stehen in den Dateien (Fake-Plugin in `feature.rs`, Fake-Engine in `transpiler.rs`).
