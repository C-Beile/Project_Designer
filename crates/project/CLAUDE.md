# project – Karte
<!-- AUTO:START -->
## Dateien
| Datei | Wofür |
|---|---|
| `Cargo.toml` | Abhängigkeiten. Plugin-Crates (git, database, deploy, adito-transpiler) nur als `dev-dependencies`. |
| `assets/` | Eingebaute `icons.json` und `property-catalog.json` (per `include_str!`). |
| `examples/` | Kleine Programme zum Probieren (`dump_tree`, `db_live`, `deploy_*`, ...). |
| `tests/` | Integrationstests und `fixtures/DemoProject`. |
| `src/` | Quellcode. Einzeldateien folgen. |
| `src/lib.rs` | Modulliste. Kein Tauri im Crate. |
| `src/project_actor.rs` | `ProjectActorHandle` und Actor-Thread: alle offenen Objekte, Undo/Redo, Speichern. |
| `src/tree.rs` | Projektbaum (`TreeNode`, `scan_project_tree`, `list_tree_children`). |
| `src/tree_ops.rs` | Objekt kopieren und löschen (Kontextmenü). |
| `src/file_ops.rs` | Datei kopieren, verschieben, umbenennen, löschen, Eigenschaften. |
| `src/new_object.rs` | "Neu": Vorlagen und `create_object`. |
| `src/object_names.rs` | Namensprüfung für neue Objekte. |
| `src/rename.rs` | Umbenennen mit Verweisen: `plan` und `apply`. |
| `src/problems.rs` | Problem-Scan und Fundstellen (`scan_project`, `find_usages`). |
| `src/catalog/` | Eigenschafts-Katalog (`mod.rs`), Sheet je Objekt (`sheet.rs`), XSD und Klassendateien lesen. |
| `src/wire.rs` | Wire-Format zur UI (`WireValue`, Pfad-Text). |
| `src/history.rs` | Undo/Redo-Verlauf je Objekt. |
| `src/linked_file.rs` | Lesen/Schreiben verknüpfter Dateien (`%aditoprj%`). |
| `src/modification_write.rs` | Modifikationen für Modul-Objekte (`modification/<id>`). |
| `src/transpile_action.rs` | Transpile-Aktion, Engine-Wahl, `set_transpilers`. |
| `src/transpile_compare.rs` | Vergleich eigener `dist` mit der Referenz. |
| `src/actions.rs` | `dispatch_action` (Action-Id zu `Action`). |
| `src/project_zip.rs` | Export/Import ausgewählter Modelle als Zip. |
| `src/project_create.rs` | Leeres Projekt anlegen. |
| `src/watch.rs` | Änderungen von außen erkennen (Fingerabdruck, Datei-Stempel). |
| `src/settings.rs` | Eigene Einstellungen und Liste offener Projekte. |
| `src/file_list.rs` | Dateinamen für die Schnellsuche, Theme-Dateien lesen. |
| `src/import_resolve.rs` | Ziel eines `import ... from` finden. |
| `src/jdito_types.rs` | JDito-Typdefinitionen fürs Code-Feld. |
| `src/icons.rs` | Eingebaute Icons (`bundled_icons`). |
| `src/local_data.rs` | Lokale Daten des Designers (Ordnergrößen, Versionsordner). |
| `src/sheet_actor_tests.rs` | Tests Actor und Sheet (nur `cfg(test)`). |
| `src/tree_tests.rs` | Tests des Baums. |
| `src/modification_write_tests.rs` | Tests der Modifikationen. |
<!-- AUTO:END -->

## Zweck
Die Logik hinter den Tauri-Befehlen, ohne `tauri`. Die Hülle `app/src-tauri/src/commands/*` ruft nur diese Crate.

## Einstiegspunkte
- `project_actor::ProjectActorHandle::spawn()` (Tauri-State, `.manage` in `app/src-tauri/src/lib.rs`).
- `transpile_action::set_transpilers(registry)`: die App ruft es beim Start. `transpilers()` liefert die Registry.
- `actions::dispatch_action("transpile", ...)`, `transpile_action::run_transpile`.

## Abhängigkeiten
- Rein: `designer-core`, `app-base`, `aod`, `validators`, `plugin-api`, `native-transpiler`, `npm-modules`, `platform`.
- Raus: `app/src-tauri` (Befehle in `commands/project.rs`, `files.rs`, `editor.rs`, `transpile.rs`).

## Regeln und Fallen
- Actor-Modell: `ProjectHandle` hält ein `Rc` und ist nicht `Send`. Darum läuft alles auf einem Thread (`forge-project-actor`). Aufrufe gehen über `call(...)` und `Request`. Neuer Aufruf = neue `Request`-Variante + Zweig in `run`.
- Ein Panic in einer Anfrage wird abgefangen (`catch_unwind`), der Actor lebt weiter.
- Die Crate kennt nur `TranspilerRegistry`, nie den offiziellen Transpiler. Ohne `set_transpilers` gibt es nur die eigene Engine (`NATIVE_ID`, `OFFICIAL_ID` = `adito`). `set_transpilers` gilt nur beim ersten Aufruf (`OnceLock`).
- Die Kommentare an `TranspilerEngine` sagen "Standard Official". Im Code ist `Default` und `from_param` aber `ExperimentalForge` (nur `"official"` wählt `Official`).
- `object_names.rs` ist getrennt, damit `new_object` und `tree_ops` sich nicht im Kreis aufrufen.

## Wenn du X ändern willst
| Aufgabe | Datei |
|---|---|
| Neue Operation auf offenem Objekt | `src/project_actor.rs` (`Request`, `run`, Methode am Handle) |
| Neuer Knoten oder Ordner im Baum | `src/tree.rs` |
| Neuer Objekttyp bei "Neu" | `src/new_object.rs` |
| Eigenschaftsliste im Properties-Panel | `src/catalog/sheet.rs`, `src/catalog/mod.rs` |
| Umbenennen: welche Verweise | `src/rename.rs` |
| Neue Prüfung im Problems-Tab | `src/problems.rs` (Prüfer selbst: `crates/validators`) |
| Transpile-Ablauf oder Engine-Wahl | `src/transpile_action.rs` |
| Neuer Tauri-Befehl dazu | `app/src-tauri/src/commands/*.rs` und `generate_handler!` in `app/src-tauri/src/lib.rs` |

## Tests
- `cargo test -p project`. Unit-Tests stehen in `src/*_tests.rs` und `src/catalog/tests.rs`.
- `tests/robustness.rs`, `tests/modification_real.rs`: nutzen ein Korpus, wenn vorhanden (sonst übersprungen).
- `tests/transpile_action_real.rs`: braucht eine ADITO-Installation für den offiziellen Lauf.
