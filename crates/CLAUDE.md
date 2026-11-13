# crates – Karte
<!-- AUTO:START -->
## Dateien
| Datei | Wofür | Hängt ab von |
|---|---|---|
| `platform/` | Betriebssystem: Prozesse, Dateien, Dialoge, Anmeldedaten, Datei-Beobachtung (nur hier OS-Aufrufe). Siehe `platform/CLAUDE.md`. | nichts |
| `aod/` | `.aod` byte-genau lesen/schreiben (`document`), Baum + Undo (`tree`), Verweise lesen (`references`). | nichts |
| `npm-modules/` | npm-Module des Projekts, Zyklen, Versionskonflikte. | nichts |
| `plugin-api/` | Schnittstellen: `FeaturePlugin`, `FeatureRegistry`, `EventSink`, `Transpiler`, `TranspilerRegistry`, `Validator`, `Action`. | nichts |
| `app-base/` | Crashlog, Backup (`BUILD_FOLDERS`), Schreibschutz, Designer-Pfade, `scrub` (Geheimnisse maskieren), `parallel` (`parallel_map`), `config` (`designer.conf`: TOML lesen/schreiben), `window_state` (Fensterlage speichern und prüfen). | platform |
| `file-watcher/` | Beobachtet einen Projektordner und liefert gebündelte Pakete (`Batch`). Kein Tauri. Siehe `file-watcher/CLAUDE.md`. | platform, app-base |
| `designer-core/` | Fassade ohne UI (`ProjectHandle`, Plugin-Brücke). | aod, npm-modules, plugin-api, platform |
| `validators/` | Prüfer für Objekte, `validator_table` (object_type zu Prüfern). | aod, designer-core, plugin-api |
| `native-transpiler/` | Eigener Rust-Transpiler (`own_engine/`) und Vergleichswerkzeug (Feature `harness`). | aod, npm-modules, platform, adito-transpiler (nur Feature `harness`) |
| `project/` | Das offene Projekt: Actor, Baum, Katalog, Umbenennen, Zip, Transpile-Aktion. Siehe `project/CLAUDE.md`. | designer-core, app-base, aod, validators, plugin-api, native-transpiler, npm-modules, platform, project-index |
| `project-index/` | Index über das offene Projekt (Dateien, Verweise, Probleme), hält sich per File-Watcher aktuell, sendet `forge://index-progress` und `forge://project-changed`. Siehe `project-index/CLAUDE.md`. | aod, designer-core, validators, platform, app-base, plugin-api, file-watcher |
| `git/` | Plugin `git` (`GitPlugin`). Befehle in `src/plugin.rs`, Logik in `git_actions.rs`, `git_scm.rs`, `clone.rs`, `connect.rs` (Verknüpfung mit dem Remote). | platform, app-base, plugin-api |
| `ssh-tunnel/` | Plugin `ssh-tunnel` (`TunnelPlugin`, plink). | platform, app-base, plugin-api |
| `database/` | Plugin `database`: Treiber, Sitzungen, SQL, Users/Aliase. | ssh-tunnel, app-base, platform, plugin-api |
| `deploy/` | Plugin `deploy`: Deploy-Zeilen nach ASYS_SYSTEM. | database, plugin-api |
| `liquibase/` | Plugin `liquibase`: Update der Changelogs eines Alias. | database, ssh-tunnel, plugin-api, app-base, platform |
| `adito-transpiler/` | Plugin `adito` (Transpiler-Id `adito`): ruft den offiziellen ADITO-Transpiler. | platform, app-base, plugin-api |
<!-- AUTO:END -->

## Zweck
Alle Rust-Bibliotheken des Workspace (`Cargo.toml` im Root: `crates/*`, `cli/*`, `app/src-tauri`).
Gruppen laut Root-`CLAUDE.md`: Kern, Schnittstelle, Plugins.

## Einstiegspunkte
- `plugin-api/src/feature.rs`: `FeaturePlugin` (id, name, requires, `call(command, args)`), `FeatureRegistry`, `EventSink`, `Args`.
- `plugin-api/src/transpiler.rs`: `Transpiler`, `TranspilerRegistry`.
- `app/src-tauri/src/lib.rs`: `build_feature_registry` und `build_transpiler_registry` melden die Plugins an.
- Plugin-Befehle: je Plugin `src/plugin.rs`, `match command { ... }` in `call`.

## Abhängigkeiten
- Rein/Raus: Kern -> `plugin-api` -> Plugins. Der Kern kennt keine Plugins.
- Kette der neuen Crates: `platform` <- `app-base` <- `file-watcher` <- `project-index` <- `project` <- `app/src-tauri`. `project-index` darf NICHT von `project` abhängen (`project` re-exportiert, was es früher selbst hatte: `OBJECT_FOLDERS`, `ProblemDto`, `UsageDto`, `parse_node_path`).
- Plugins sind Cargo-Features in `app/src-tauri/Cargo.toml`: `git`, `ssh-tunnel`, `database`, `deploy`, `liquibase`, `adito-transpiler`.
- Feature-Ketten: `database` zieht `ssh-tunnel`; `deploy` und `liquibase` ziehen `database`.
- `cli/forge` (Paket `designer-cli`) nutzt `designer-core`, `adito-transpiler`, `aod`.

## Regeln und Fallen
- Neue Plugin-Crate: in `app/src-tauri/Cargo.toml` (optional + Feature) und in `lib.rs` anmelden.
- Ausnahmen von der Richtung: `native-transpiler` zieht `adito-transpiler` über das Standard-Feature `harness` (nur Vergleich, die Engine braucht es nicht). `project` nutzt `git`, `database`, `deploy`, `adito-transpiler` nur in `[dev-dependencies]` (Beispiele und Tests).
- OS-spezifische Aufrufe gehören nur nach `platform`.

## Wenn du X ändern willst
| Aufgabe | Datei |
|---|---|
| Befehl eines Plugins ergänzen | `<plugin>/src/plugin.rs` (`call`) |
| Neues Plugin | neue Crate, `plugin-api` nutzen, `app/src-tauri/Cargo.toml`, `app/src-tauri/src/lib.rs` |
| Neue Transpiler-Engine | `Transpiler` aus `plugin-api/src/transpiler.rs`, in `build_transpiler_registry` anmelden |
| Neuer Objekt-Prüfer | `validators/src/validator_table.rs` |
| Etwas, das das ganze Projekt im Speicher braucht (Verweise, Probleme, Dateiliste) | `project-index/src/query.rs` |

## Tests
- Eine Crate: `cargo test -p <crate>`. Alles: `cargo test --workspace --no-fail-fast`.
- Schnellprüfung: `cargo check --workspace --tests --examples`.
- Bekannt rot (10, brauchen echte ADITO-Installation oder Korpus): `native-transpiler` (lib 2, `full_harness_run`), `npm-modules` (resolve_real_corpus 3, resolve_synthetic 2), `adito-transpiler` (real_transpiler 2). `incremental_stage` ist manchmal flaky. Siehe Root-`CLAUDE.md`, "Stand der Tests".
