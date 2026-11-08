# designer-core – Karte
<!-- AUTO:START -->
## Dateien
| Datei | Wofür |
|---|---|
| `Cargo.toml` | Abhängig von `aod`, `npm-modules`, `plugin-api`, `platform`. |
| `src/` | Quellcode. Einzeldateien folgen. |
| `src/lib.rs` | Modulliste und Re-Exports (`aod`, `npm_modules`, `plugin_api`, `platform`), damit Nutzer nur `designer-core` brauchen. |
| `src/project.rs` | `open_project`, `ProjectHandle`: eine offene `.aod` mit Baum, Ändern, Byte-Bereiche, Speichern, `ForgeError`. |
| `src/plugin_bridge.rs` | Umwandlung `aod`-Typen zu `plugin-api`-Typen (`to_plugin_property_node`, `to_plugin_transaction` ...). |
| `src/plugins.rs` | `build_plugin_registry()`: baut die `PluginRegistry` mit den eingebauten Teilen. |
| `tests/` | Nur `fixtures/PROJECT_Sales.aod`. Die Tests selbst stehen in `src/project.rs`. |
<!-- AUTO:END -->

## Zweck
Fassade ohne UI: ein offenes Objekt (`ProjectHandle`) und die Brücke zwischen `aod` und `plugin-api`. `cli/forge`, `validators` und `project` bauen darauf auf. Keine Tauri-Abhängigkeit.

## Einstiegspunkte
- `open_project(pfad)` liefert `ProjectHandle`. Dann `value_at`, `set_property`, `save`.
- `build_plugin_registry()`: wird bei jeder Prüfung und Aktion neu aufgerufen (`validators`, `project/src/actions.rs`).
- `to_plugin_property_node(pfad, object_type, wert)`: Baustein jedes Prüfers.

## Abhängigkeiten
- Rein: `aod`, `npm-modules`, `plugin-api`, `platform`.
- Raus: `validators`, `project`, `cli/forge`.

## Regeln und Fallen
- `ProjectHandle` hält ein `Rc`, ist also nicht `Send`. Darum läuft er im Actor-Thread von `project`.
- `save` schreibt über `platform::fs::atomic_write`, nie mit `std::fs::write`. Ein UTF-8-BOM der Datei wird gemerkt und beim Speichern wieder geschrieben (Byte-Treue).
- `plugin-api` und `aod` kennen sich nicht. Nur hier werden die Typen umgewandelt. `Object` und `Array` werden zu `Missing` (der Platzhalter kennt nur Skalare).
- Der Kopfkommentar in `lib.rs` nennt noch ein Modul `transpiler` (`PlatformTranspilerRunner`) und Pfade `crates/core-model`. Beides gibt es nicht mehr. Ebenso sagen Kommentare in `cli/forge`, `designer_core::transpiler` sei zuständig.
- `build_plugin_registry` meldet nur den `.js`-Datei-Compiler an. Aktionen und Prüfer kommen von den Aufrufern.

## Wenn du X ändern willst
| Aufgabe | Datei |
|---|---|
| Neue Operation auf einem offenen Objekt (Fassade) | `src/project.rs` |
| Neuer Typ muss zu `plugin-api` umgewandelt werden | `src/plugin_bridge.rs` |
| Eingebautes Plugin im Standard-Registry | `crates/plugin-api/src/builtin.rs` (`register_all`) |
| Die App-Logik darüber (Actor, Undo, Baum) | `crates/project` |

## Tests
- `cargo test -p designer-core`. Laden, Ändern, Speichern, Neu-laden und "ungeändert speichern = gleiche Bytes" (`src/project.rs`, Fixture `tests/fixtures/PROJECT_Sales.aod`).
