# file-watcher – Karte
<!-- AUTO:START -->
## Dateien
| Datei | Wofür |
|---|---|
| `Cargo.toml` | Abhängigkeiten: `platform`, `app-base`. |
| `src/` | Quellcode. Einzeldateien folgen. |
| `src/lib.rs` | Modulliste und Re-Exports. |
| `src/batcher.rs` | `Batcher`: bündelt rohe Events zu `Batch` (Ruhezeit, Max-Wartezeit, Flut, Git-HEAD, npm, Verdacht auf Überlauf). Reine Logik, Uhrzeit von außen. |
| `src/ignore.rs` | `IgnoreRules`: die eine Ignore-Liste (`node_modules`, `.git` außer `HEAD`, `target`, `.claude`, Build-Ordner, Temp-Dateien von `atomic_write`). |
| `src/watch_set.rs` | Welche Ordner beobachtet werden: Wurzel flach, jeder Ordner der obersten Ebene rekursiv, `.git` und `node_modules` flach. |
| `src/session.rs` | `WatchSession`: ein Thread, der OS-Events mit dem Batcher verbindet und fertige Batches an einen Callback gibt. `Drop` beendet ihn. |
<!-- AUTO:END -->

## Zweck
Beobachtet einen Projektordner und liefert gebündelte Pakete (`Batch`). Kein Tauri, keine Events: der Besitzer (`project-index`) bekommt die Pakete über einen Callback und sendet selbst die Events.

## Einstiegspunkte
- `WatchSession::start(root, watcher, WatchConfig, on_batch)`; `start_with` für Tests (eigene "war das mein Schreiben?"-Prüfung).
- `Batcher::{push, poll, deadline}`.

## Regeln und Fallen
- Ein `Batch` sagt nur, WELCHE Pfade berührt wurden (`TouchedPath { path, own }`). Was passiert ist (neu, geändert, gelöscht), prüft der Empfänger per `stat`. Windows meldet Umbenennungen als `From`/`To`, Ordner oft nur als Ordner.
- `BatchKind::Flood` (mehr als 200 Events oder `.git/HEAD`) und `Rescan` haben keine Pfade: der Empfänger gleicht das ganze Projekt ab.
- `verify_after` (ab 64 Events): der OS-Puffer könnte übergelaufen sein, der Empfänger soll zur Sicherheit abgleichen.
- npm-Änderungen (`package-lock.json`, `node_modules/.package-lock.json`, `node_modules`) kommen erst nach 3 s Ruhe und ohne Max-Wartezeit als `modules_changed`.
- Die Ignore-Liste steht NUR in `ignore.rs`. Eigene Filter (Schnellsuche, Rename) bleiben bei der Abfrage.
- Neue Ordner der obersten Ebene werden dynamisch dazugenommen (`watch_set::target_for_created`).

## Wenn du X ändern willst
| Aufgabe | Datei |
|---|---|
| Zeiten, Schwellen | `WatchConfig` in `src/batcher.rs` |
| Was ignoriert wird | `src/ignore.rs` |
| Welche Ordner beobachtet werden | `src/watch_set.rs` |

## Tests
- `cargo test -p file-watcher`. Der Batcher wird mit künstlichen `Instant`s getestet, die Session mit einem falschen `FileWatcher` (Kanal) und einmal mit dem echten.
