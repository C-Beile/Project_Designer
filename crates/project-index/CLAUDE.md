# project-index – Karte
<!-- AUTO:START -->
## Dateien
| Datei | Wofür |
|---|---|
| `Cargo.toml` | Abhängigkeiten: `aod`, `designer-core`, `validators`, `platform`, `app-base`, `plugin-api`, `file-watcher`. Nicht `project`. |
| `src/` | Quellcode. Einzeldateien folgen. |
| `src/lib.rs` | Modulliste und Re-Exports. |
| `src/layout.rs` | `OBJECT_FOLDERS`, `SCANNED_FOLDERS`, `object_of(rel)` (Pfad zu Typ + Name). |
| `src/model.rs` | `ProjectIndex`, `FileEntry`, `ObjectEntry`, `RefEntry`, `Target`, `ModuleState`, `ProblemDto`, `UsageDto`. |
| `src/text_pos.rs` | `line_col`, `span_line_col`, `parse_node_path`. |
| `src/analyze.rs` | `analyze_file`: eine `.aod` EINMAL lesen (Parse-Fehler, Prüfer, Verweise mit Zeile/Spalte). `validate_aod_bytes`. |
| `src/references.rs` | `ReferenceIndex`: Verweise je DATEI, vorwärts und rückwärts. |
| `src/modules.rs` | Stand der npm-Module: Namen je Ordner, Alias-Ziele, Stempel von `package.json`/Lock-Dateien. |
| `src/build.rs` | `build_index`: voller Aufbau in Phasen (listing, reading, linking), parallel, abbrechbar. |
| `src/update.rs` | `compute_delta` (liest ohne Sperre) und `apply_delta`: Änderungen per `stat`-Abgleich einspielen, `affected` berechnen. |
| `src/query.rs` | Lese-API: `problems`, `usages`, `object_exists`, `referenced_by`, `files`. |
| `src/dump.rs` | `ProjectIndex::dump_json`: alles im Index als lesbares JSON (Debug-Menü, Befehl `index_dump`). |
| `src/progress.rs` | `ProgressSink`, `Throttle` (100 ms), `percent_of`. |
| `src/events.rs` | Event-Namen und Payloads (camelCase): `IndexProgress`, `ProjectChanged`, `IndexStatus`, `VerifyOutcome`. |
| `src/log.rs` | `IndexLog` (echt: `CrashlogIndexLog`), `WarnBudget` (höchstens 20 WARN je Aufbau). |
| `src/service.rs` | `IndexRegistry`, `ProjectIndexHandle`, Worker-Thread, Nachrichten-Schleife, Aufbau-Slot (einer zur Zeit). |
<!-- AUTO:END -->

## Zweck
Hält für jedes offene Projekt Dateien, Objekte, Verweise und Probleme im Speicher und bleibt über den File-Watcher aktuell. Sendet `forge://index-progress` und `forge://project-changed`. Die Tauri-Hülle (`app/src-tauri/src/commands/index.rs`) legt eine `IndexRegistry` als State an.

## Einstiegspunkte
- `IndexRegistry::ensure_started(root)`, `stop`, `rebuild`, `get(root)`.
- `ProjectIndexHandle::{status, verify, read, wait_ready}`. `read` gibt `None`, solange der Index nicht fertig ist.
- `build_index(...)` ist rein und ohne Thread testbar.

## Thread-Modell (in C# gedacht)
- `IndexRegistry` = Singleton mit `ConcurrentDictionary<Pfad, Handle>`. Handle hält `Arc<RwLock<ProjectIndex>>` (`ReaderWriterLockSlim`).
- Pro Projekt ein Worker-Thread (`forge-index-<name>`) mit Nachrichten-Schleife (`BlockingCollection`). **Der Worker ist der einzige Schreiber.**
- Der volle Aufbau läuft ohne Sperre auf einem neuen Index, am Ende ein kurzer Tausch. Änderungen: erst `compute_delta` (Lesesperre), dann `apply_delta` (Schreibsperre, Mikrosekunden).
- Der Watcher startet VOR dem Auflisten. Batches während des Aufbaus warten in der Schleife und werden danach eingespielt. Doppeltes Einspielen schadet nicht, weil per Stempel verglichen wird.
- Nie Events senden, während eine Sperre gehalten wird. Nie den Actor aufrufen.
- Höchstens ein Aufbau gleichzeitig (`BuildSlot`), ein zweites Projekt zeigt `queued`.
- Panic in einer Nachricht: abgefangen, ERROR im Log, der alte Index bleibt.

## Regeln und Fallen
- Verweis-Probleme ("Ziel fehlt") sind NICHT pro Datei gespeichert. Sie ändern sich, wenn ein Ziel auftaucht oder verschwindet. `problems()` rechnet sie bei jeder Abfrage. `affected` im Event nennt die Verweiser eines neuen oder gelöschten Ziels.
- Alias-Verweise stehen als Kurzname (`Target::AliasShort`) und werden erst bei der Abfrage aufgelöst (Projekt-Aliase plus Alias-Ziele der Module). Ohne installierte Module wird nichts über Aliase gesagt.
- Der Index hält nie XML-Inhalte im Log. Nur Pfade und Parser-Meldungen.
- Jede Änderung der Struktur der Events: `app/ui/src/wire/types.ts` mitziehen.
- Der Index ist nach dem Speichern bis zu etwa 0,5 s alt (Ruhezeit des Watchers). Rename ruft darum vorher `verify()` und parst die Kandidaten-Dateien frisch.

## Wenn du X ändern willst
| Aufgabe | Datei |
|---|---|
| Neue Art von Verweis | `crates/aod/src/references/read.rs` (`ReferenceKind`), dann ggf. `query.rs` |
| Neue Abfrage | `src/query.rs` |
| Neues Event oder Feld | `src/events.rs`, Ausgabe in `src/service.rs`, UI-Typ in `wire/types.ts` |
| Neuer Objektordner | `src/layout.rs` |
| Zeiten des Watchers | `crates/file-watcher/src/batcher.rs` |

## Tests
- `cargo test -p project-index`. Vergleich mit dem alten Voll-Scan: `cargo test -p project --test index_parity` (Fixtures aus `aod/tests/fixtures` und `project/tests/fixtures`).
