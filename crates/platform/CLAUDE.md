# platform – Karte
<!-- AUTO:START -->
## Dateien
| Datei | Wofür |
|---|---|
| `.gitignore` | Ignorierte Dateien. |
| `Cargo.toml` | Abhängigkeiten (`notify`, `rfd`, `ssh-key`, `windows-sys`). |
| `examples/` | `ppk_convert` (PuTTY-Schlüssel umwandeln). |
| `src/` | Quellcode. Einzeldateien folgen. |
| `src/lib.rs` | Modulliste und Re-Exports (`native` = die Umsetzung des laufenden Systems). |
| `src/fs.rs` | `atomic_write` (Temp-Datei + Umbenennen, Backup-Hook), `FileStamp`/`file_stamp`, `path_key`, Register eigener Schreibvorgänge (`note_own_change`, `take_own_write`). |
| `src/watcher.rs` | `FileWatcher`, `WatchEvent`, `WatchEventKind` (mit `Rescan`), `WatchTarget`, `WatchHandle` (`add`/`remove`). |
| `src/windows/watcher.rs` | `NotifyFileWatcher` (Bibliothek `notify`). Fehler werden zu `Rescan`. Gilt auch für macOS/Linux (`unix/mod.rs` bindet die Datei ein). |
| `src/windows/mod.rs` | Windows-Umsetzungen der Schnittstellen. |
| `src/windows/credentials.rs` | Anmeldedaten im Windows-Schlüsselbund (einziger Ort mit `unsafe`). |
| `src/windows/dialog.rs` | Datei-Dialoge (`rfd`). |
| `src/windows/node.rs` | Node.js finden. |
| `src/windows/process.rs` | Prozesse starten und beenden. |
| `src/windows/shell.rs` | Explorer, Standardprogramm. |
| `src/unix/mod.rs` | macOS/Linux-Umsetzungen. |
| `src/unix/credentials.rs` | Schlüsselbund (Keychain). |
| `src/unix/node.rs` | Node.js finden. |
| `src/unix/shell.rs` | `open`/`xdg-open`. |
| `src/macos.rs` | Gerüst für macOS (Platzhalter). |
| `src/console.rs` | Konsolenfenster-Optionen für Kindprozesse. |
| `src/credentials.rs` | Schnittstelle für Anmeldedaten. |
| `src/dialog.rs` | Schnittstelle für Datei-Dialoge. |
| `src/error.rs` | `PlatformError`. |
| `src/git.rs` | Git über das `git`-Programm (`CommandGitOperations`). |
| `src/node.rs` | Schnittstelle `NodeResolver`. |
| `src/ppk.rs` | `.ppk` zu OpenSSH-Schlüssel. |
| `src/process.rs` | Schnittstelle `ProcessSpawner`. |
| `src/shell.rs` | Schnittstelle `ShellIntegration`. |
<!-- AUTO:END -->

## Zweck
Die einzige Stelle mit Betriebssystem-Aufrufen: Prozesse, Dateien, Dialoge, Anmeldedaten, Datei-Beobachtung.

## Regeln und Fallen
- **Watcher-Lücke unter Windows.** `ReadDirectoryChangesW` hat pro Watch einen 16-KB-Puffer. Läuft er über (viele Dateien auf einmal), meldet Windows 0 Bytes. Die Bibliothek `notify` 6.1.1 wirft das still weg. Darum liegt eine Kopie mit einem Patch unter `vendor/notify` (`[patch.crates-io]` im Root-`Cargo.toml`): bei 0 Bytes sendet sie ein Event mit `Flag::Rescan`. Das wird hier zu `WatchEventKind::Rescan`. Ein Update auf notify 8 löst die Lücke nicht (geprüft).
- Fehler von `notify` werden nie verschluckt, sondern zu `Rescan`. Wer den Watcher nutzt, muss auf `Rescan` den ganzen Baum abgleichen.
- `atomic_write` trägt nach dem Umbenennen ein, dass die App selbst geschrieben hat (`take_own_write` verbraucht den Eintrag, 5 s gültig, nur mit gleichem Stempel). Wer mit `std::fs` direkt schreibt, ruft `note_own_change(pfad)` auf.
- Pfade als Schlüssel immer mit `path_key` bilden (Windows: Kleinschreibung, nur `/`).
- Nur `fs::atomic_write` hat einen einzigen Backup-Hook (`OnceLock`).

## Wenn du X ändern willst
| Aufgabe | Datei |
|---|---|
| Neue Art von Watch-Event | `src/watcher.rs`, Zuordnung in `src/windows/watcher.rs` (`to_watch_events`) |
| Eigene Schreibvorgänge erkennen | `src/fs.rs` |
| Neuer OS-Aufruf | Schnittstelle am Crate-Wurzel, Umsetzungen in `windows/` und `unix/` |

## Tests
- `cargo test -p platform`. Die Watcher-Tests nutzen das echte Dateisystem (Timeouts 10 s).
