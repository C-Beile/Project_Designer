# validators – Karte
<!-- AUTO:START -->
## Dateien
| Datei | Wofür |
|---|---|
| `Cargo.toml` | Abhängig von `aod`, `designer-core`, `plugin-api`. |
| `src/` | Quellcode. Einzeldateien folgen. |
| `src/lib.rs` | Modulliste. |
| `src/validator_table.rs` | `VALIDATORS_BY_OBJECT_TYPE` (object_type zu Prüfer-Funktion) und `root_tag`. Hier neue Prüfer eintragen. |
| `src/entity_validators.rs` | `entity`. Enthält auch `flatten_entity` und `flatten_into_with_type` (Baum zu flacher Knotenliste), die alle anderen Dateien nutzen. |
| `src/view_context_dashboard_validators.rs` | `neonView`, `neonContext`, `neonDashboard` (drei Funktionen `*_diagnostics_for`). |
| `src/alias_validators.rs` | `aliasDefinition`. |
| `src/language_validators.rs` | `language`. |
| `src/system_validators.rs` | `system`. |
| `src/preferences_validators.rs` | `preferences`. |
| `src/application_validators.rs` | `application`. |
| `src/webservice_validators.rs` | `entityWebservice`. |
| `src/report_validators.rs` | `report`. |
<!-- AUTO:END -->

## Zweck
Die Prüfer für geöffnete Objekte. Ihre Ergebnisse (`Diagnostic`) erscheinen im Problems-Tab und als Fehler im Editor.

## Einstiegspunkte
- `validator_table::VALIDATORS_BY_OBJECT_TYPE`: Liste `(object_type, fn(&PropertyValue) -> Vec<Diagnostic>)`.
- `validator_table::root_tag(bytes)`: Name des Wurzel-Elements einer `.aod` (ergibt den `object_type`).
- Benutzt in `crates/project/src/project_actor.rs` (`list_diagnostics`) und `crates/project/src/problems.rs` (`scan_project`).

## Abhängigkeiten
- Rein: `aod`, `designer-core` (`to_plugin_property_node`, `build_plugin_registry`), `plugin-api`.
- Raus: `project`.

## Regeln und Fallen
- Ablauf je Typ immer gleich: Baum flachklopfen (`flatten_*`), `PluginRegistry` mit den Prüfern bauen, `validate_project`. Die Registry wird bei jedem Aufruf neu gebaut.
- Ein Objekttyp ohne Eintrag in der Tabelle hat keine Prüfung (kein Fehler).
- Eine Prüf-Regel ist ein `struct` mit `impl Validator`. Sie liest Knoten über den Pfad-Text (z. B. `entityFields.entityField[<N>].name`). Ändert sich das Schema, ändern sich die Pfade.
- Kommentare in den Dateien nennen noch `project_actor.rs` als Ort der Tabelle. Sie steht in `validator_table.rs`.

## Wenn du X ändern willst
| Aufgabe | Datei |
|---|---|
| Neue Regel für einen bestehenden Typ | `struct` + `impl Validator` in der Datei des Typs, in dessen `diagnostics_for` mit `registry.register_validator` eintragen |
| Neuer Objekttyp | neue Datei `<typ>_validators.rs` mit `pub fn diagnostics_for(&CoreValue) -> Vec<Diagnostic>` (Vorbild: `alias_validators.rs`), `pub mod` in `lib.rs`, Zeile in `validator_table.rs` |
| Anderen `object_type`-Namen zuordnen | `VALIDATORS_BY_OBJECT_TYPE` in `src/validator_table.rs` |

## Tests
- `cargo test -p validators`. Die Tests stehen in den Dateien selbst.
