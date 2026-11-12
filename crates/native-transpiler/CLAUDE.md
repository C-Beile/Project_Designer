# native-transpiler – Karte
<!-- AUTO:START -->
## Dateien
| Datei | Wofür |
|---|---|
| `Cargo.toml` | Feature `harness` (Standard, zieht `adito-transpiler`). Binary und Test `full_harness_run` brauchen es. |
| `examples/` | `own_vs_dist` (eigene Engine gegen vorhandenes `dist` prüfen), `own_engine_timing` (nur Zeit messen), `unshare_probe` (Hilfe für `linked_unshare_stage`). |
| `tests/` | `copy_phase_against_real_corpus.rs` (braucht Korpus, sonst übersprungen), `full_harness_run.rs` (braucht ADITO-Installation), `fixtures/minimal`. |
| `src/` | Quellcode. Einzeldateien folgen. |
| `src/lib.rs` | Modulliste. `error`, `harness` nur mit Feature `harness`. |
| `src/main.rs` | Kommandozeile `native-transpiler --project <Kopie>`: Harness laufen lassen. Nur mit Feature `harness`. |
| `src/harness.rs` | `DifferentialHarness`: offizieller Transpiler und `OwnEngine` auf derselben Projektkopie, danach Vergleich (nur `harness`). |
| `src/error.rs` | `HarnessError` (nur `harness`). |
| `src/compare.rs` | `compare_trees`: Byte-Vergleich zweier Ordnerbäume, ohne Toleranz. |
| `src/report.rs` | Markdown-Bericht eines Harness-Laufs. |
| `src/own_engine/` | Die eigene Engine. Die Stages stehen in der Tabelle "Stages" unten. |
| `src/own_engine/mod.rs` | Trait `OwnEngine`, `StubEngine`, Re-Exports aller Stages. |
| `src/own_engine/progress.rs` | Fortschritts-Meldung der Stages (`set_reporter`, `report`). |
| `src/own_engine/child_order.json` | Reihenfolge der Kind-Elemente je Elterntag, per `include_str!` in `modification_engine_stage.rs`. |
<!-- AUTO:END -->

## Zweck
Der eigene Rust-Transpiler. Er baut aus einem Projekt den `dist`-Ordner, ohne den offiziellen ADITO-Transpiler. Dazu ein Vergleichswerkzeug (Harness): offizieller Lauf gegen eigene Engine, Byte für Byte.

## Einstiegspunkte
- `own_engine::IncrementalEngine` (Trait `OwnEngine`): die Engine, die die App benutzt (`crates/project/src/transpile_action.rs`). Ruft `run_incremental(project_home, output_dir)`.
- `own_engine::progress::set_reporter(...)`: die App hängt die Fortschrittsleiste hier ein.
- `own_engine::merge_modifications_into_bytes`: von `project` für Modifikationen benutzt.
- `DifferentialHarness` und `compare_trees`: Vergleich (Feature `harness`).

## Stages
Reihenfolge in `run_incremental` (`own_engine/incremental_stage.rs`):

| Nr | Stage-Datei | Aufgabe |
|---|---|---|
| 1 | `resolver_stage.rs` | npm-Module des Projekts auflösen (Crate `npm-modules`). |
| 2 | `incremental_stage.rs` | Manifest der Eingaben prüfen. Unverändert: alten Stand aus dem Cache nehmen und fertig. |
| 3 | `copy_phase_stage.rs` | Jedes Modul nach `output_dir` kopieren (ohne `.transpilerignore`). Nicht reguläre `.aod` werden in die reguläre Form gebracht. |
| 4 | `modification_engine_stage.rs` | `modification/<id>`-Dateien (INSERT/MODIFY/DELETE) anwenden. |
| 5 | `extension_point_stage.rs` | Erweiterungspunkte durch ihre Implementierungen ersetzen. |
| 6 | `modification_relocate_stage.rs` | Skripte und Doku der Modifikationen unter ihr Objekt verschieben. |
| 7 | `service_inline_stage.rs` | `modules.loadService(...)` in Skripten durch die Implementierungen ersetzen. Danach wird `modification/` gelöscht. |
| 8 | `linked_unshare_stage.rs` | Datei in fremdem Ordner in den Ordner des eigenen Namens kopieren. |
| 9 | `alias_merge_stage.rs` | Alias-Definitionen je Ziel-Alias zu einer zusammenführen. |
| 10 | `preferences_merge_stage.rs` | Preferences der Module in die des Projekts falten. |
| 11 | `language_merge_stage.rs` | Eine Sprachdatei je Sprache. |
| 12 | `incremental_stage.rs` | Ergebnis als Snapshot und Manifest im Cache ablegen. |

`linked_files_stage.rs` (`run_linked_files_phase`) ist NICHT Teil des Ablaufs. Die offizielle Ausgabe lässt `%aditoprj%/...` stehen. Die Stage bleibt für das ältere Verhalten und für Tests.

## Abhängigkeiten
- Rein: `aod`, `npm-modules`, `platform`; `adito-transpiler` nur mit Feature `harness`.
- Raus: `project` (`transpile_action.rs`, Tests). `cli/forge` nicht.

## Regeln und Fallen
- Ziel ist ein Byte-genauer Nachbau des offiziellen `dist`. Keine "fast gleiche" Ausgabe: erst `own_vs_dist` oder Harness laufen lassen.
- Die Reihenfolge der Stages ist wichtig (z. B. Erweiterungspunkte erst nach den Modifikationen, Aliase erst nach den Modifikationen). Neue Stage: in `run_incremental` an die richtige Stelle setzen und in `own_engine/mod.rs` exportieren.
- Der Cache liegt im Projekt unter `.forge-incremental-cache/` (`manifest.txt`, `snapshot/`, `output-state`). Umgebungsvariable `FORGE_INCREMENTAL_CACHE_DIR` verlegt ihn (z. B. für schreibgeschützte Repositories). Eine geänderte Stage-Logik ändert das Manifest nicht: Cache-Ordner löschen, sonst kommt das alte Ergebnis.
- Der Snapshot wird nach dem Build in einem Hintergrund-Thread geschrieben (`write_snapshot_later`), damit der Build früher fertig meldet. Das Manifest wird zuletzt geschrieben. Der nächste Lauf wartet darauf (`wait_for_snapshot`).
- `FORGE_TRANSPILE_TRACE=1` gibt Zeiten und Modifikations-Fehler auf stderr aus.
- Das Feature `harness` ist Standard, die Engine braucht es nicht. Ohne: `cargo check -p native-transpiler --no-default-features`.
- Kommentare in `linked_files_stage.rs` ("fifth and final") und `incremental_stage.rs` ("sixth and final") stammen aus der Bauzeit und stimmen nicht mehr mit dem Ablauf überein.

## Wenn du X ändern willst
| Aufgabe | Datei |
|---|---|
| Neue Stage | neue `src/own_engine/<name>_stage.rs`, `pub mod` und `pub use` in `own_engine/mod.rs`, Aufruf in `run_incremental` |
| Modifikationen (INSERT/MODIFY/DELETE) | `src/own_engine/modification_engine_stage.rs` (Reihenfolge der Kinder: `child_order.json`) |
| Welche Dateien kopiert werden | `src/own_engine/copy_phase_stage.rs` |
| Wann der Cache gilt | `src/own_engine/incremental_stage.rs` (`compute_manifest`) |
| Unterschiede zum offiziellen Ergebnis suchen | `examples/own_vs_dist.rs` |

## Tests
- `cargo test -p native-transpiler`. `incremental_stage` ist manchmal flaky.
- Bekannt rot (brauchen echte ADITO-Installation oder Korpus): 2 Tests in der lib und `full_harness_run` (Root-`CLAUDE.md`, "Stand der Tests"). `full_harness_run` und `real_transpiler` (Crate `adito-transpiler`) nicht gleichzeitig laufen lassen: `nbexec64.exe` sperrt sein Userdir.
- `copy_phase_against_real_corpus` überspringt sich ohne Korpus.
