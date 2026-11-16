# dito-transpiler – Karte
<!-- AUTO:START -->
## Dateien
| Datei | Wofür |
|---|---|
| `Cargo.toml` | Abhängigkeiten: `npm-modules`, `rayon`, `ignore`, `indexmap`, `xxhash-rust`, `base64`, `lz4_flex`. Kein Tauri, keine Datenbank. |
| `examples/` | `overlay_probe` (Entdecken und Overlay messen), `oracle_probe` (Quellen gegen V2-Orakel: gleich, nur LF/COMPACT, anders, weggelassen), `compare_out` (bauen, `dist` schreiben, gegen Orakel vergleichen, häufigste Abweichungen, Zeiten), `roundtrip_oracle` (Writer-Selbsttest), `cache_check` (Cache: Treffer, 50 Änderungen, Gleichheit mit frischem Bau). |
| `src/` | Quellcode. Einzeldateien folgen. |
| `src/lib.rs` | Modulliste und Re-Exports. |
| `src/cache.rs` | Cache in einer Datei je Projekt (`%LOCALAPPDATA%\DitoDesigner\transpile-cache\<Hash>.bin`, lz4): Fingerabdruck aller Eingaben, atomar schreiben, Racy-Schutz. `ENGINE_REVISION` bei jeder Logikänderung erhöhen. |
| `src/api.rs` | `Builder`, `BuildConfig`, `BuildResult`, `BuildStats`, `Diagnostic`, `CancelToken`. |
| `src/discover.rs` | Module finden (über `npm-modules`) und in Modul-Reihenfolge bringen. |
| `src/overlay.rs` | Virtuelle Dateiliste über alle Module (ersetzt das Kopieren). Gewinner je Pfad, `.transpilerignore`. |
| `src/rules.rs` | `IgnoreRules`: eingebaute Vorgabe plus `.transpilerignore` je Modul. Muster ohne Platzhalter und `/` gelten nur ab der Modulwurzel (nicht wie gitignore in jeder Tiefe). CRLF-Dateien werden gelesen. |
| `src/pipeline.rs` | Aus dem Overlay die Ausgabedateien planen (Stand P4: Modelle als Baum, Verweise, Modifikationen, Erweiterungspunkte, Alias/Sprache/Preferences, Services und Imports). `MODEL_FOLDERS`. |
| `src/sink.rs` | `write_dist`: Ordner einmal anlegen, parallel schreiben, unveränderte Dateien nicht anfassen, veraltete Dateien löschen (`.index` bleibt). |
| `src/merge/` | Zusammenführen der Module. |
| `src/merge/mod.rs` | Modulliste. |
| `src/merge/order.rs` | Alle Reihenfolge-Regeln an einer Stelle (Module, Modifikationen). Jede Regel nennt den Orakel-Fall, der sie belegt. |
| `src/merge/modifications.rs` | Modifikationen lesen (INSERT/MODIFY/DELETE, Pfad, Wert) und auf den Baum anwenden. Neue Listeneinträge kommen ans Ende. Fehler werden gemeldet, nicht still geschluckt. |
| `src/merge/child_order.json` | Reihenfolge der Kinder je Eltern-Tag (nur für neue Eigenschaften und Behälter). Kopie aus der alten Engine. |
| `src/merge/extension_points.rs` | Erweiterungspunkte durch ihre `<implementations>` ersetzen. |
| `src/merge/alias.rs` | Alias zusammenführen (Ziel zuerst, Beitragende nach Name), Alias-Verweise umbenennen, Dubletten melden. |
| `src/merge/language.rs` | Sprachobjekte je Sprache und Preferences zusammenführen. |
| `src/scripts/` | Regeln für Skripte in Modellen. |
| `src/scripts/mod.rs` | Modulliste. |
| `src/scripts/services.rs` | `modules.loadService("x")` durch Funktionslisten ersetzen, Implementierungen als `_____GENERATED_*`-Funktionen anhängen, Imports einmischen (Namen ohne Groß/Klein sortiert). Port aus der alten Engine, V2-Abweichungen markiert. |
| `src/scripts/apply.rs` | Service-Index aus allen Modellen bauen und in jedes Skript einsetzen (parallel). |
| `src/model/` | Der Baum im Speicher (Arena, rohe Bytes). |
| `src/model/mod.rs` | Modulliste und Re-Exports. |
| `src/model/tree.rs` | `Document`, `Node`, Einfügen, Lösen, Teilbaum kopieren. |
| `src/model/parse.rs` | Strenger kleiner XML-Leser (lehnt Kommentare und gemischten Inhalt ab). |
| `src/model/write.rs` | V2-Writer: schreibt jeden V2-Orakel-Modell byte-gleich zurück (Selbsttest `roundtrip_oracle`). |
| `src/format/` | Ausgabeformate. |
| `src/format/mod.rs` | `FormatId` (heute nur `V2`). |
| `src/format/v2.rs` | V2-Regeln: LF, COMPACT, BOM weg, verknüpfte Dateien einsetzen (maskiert, `export ` am Zeilenanfang weg, Base64 für `icon`, `iconInactive`, `imageData`, `reportData`), leere Elemente als `<x />`. Mit Tests. |
<!-- AUTO:END -->

## Zweck
Der neue Transpiler für ADITO-Projekte. Er soll die Ausgabe des offiziellen V2-Tools (COMPACT, LF) byte-genau nachbauen, im Speicher arbeiten und schnell sein. V1 kann später als zweites Format dazukommen. Plan, Entscheidungen und Messwerte: `docs/transpiler-v2-plan.md`. C#-Vergleich: eine Assembly mit Namespaces `Core` und `Formats.V2`.

## Einstiegspunkte
- `Builder::new(BuildConfig).build(&CancelToken)` liefert `BuildResult` (Statistik, Meldungen). Artefakte kommen mit den nächsten Phasen.
- Orakel zum Testen: `C:\Temp\v2probe\out` (V2-Tool 1.2.2 auf einer reparierten Hermes-Kopie). Start des Tools: siehe Plan, Abschnitt "P0-Funde".

## Regeln und Fallen
- Der Kern (`discover`, `overlay`, `merge`) kennt keine Formate. Nur `format/` schreibt Bytes.
- Reihenfolge-Regeln nur in `merge/order.rs`. Keine Regel ohne Beleg aus dem Orakel. Ohne Beleg: Vorgabe, im Kommentar als solche markiert.
- Konflikte (gleicher Pfad, gleiche Tabelle, doppelte Namen) werden nie still entschieden: immer eine `Diagnostic` mit allen beteiligten Dateien.
- Keine Inhalte lesen, wo ein Pfad reicht (Virenscanner). Kein globaler Zustand, kein `set_var`, damit Parallelität und Hot-Reload möglich bleiben.
- **Jede Änderung der Logik erhöht `ENGINE_REVISION` in `cache.rs`.** Sonst liefert der Cache das alte Ergebnis. Der Cache vergleicht nur Dateiliste, Größe und Änderungszeit, nie Inhalte.
- Texte bleiben `Vec<u8>`, nie `String::from_utf8_lossy` (zerstört Latin-1).

## Wenn du X ändern willst
| Aufgabe | Datei |
|---|---|
| Modul-Reihenfolge oder Gewinner-Regel | `src/merge/order.rs` |
| Welche Dateien ignoriert werden | `src/rules.rs`, `src/overlay.rs` (`SKIP_DIRS`) |
| V2-Schreibregeln | `src/format/v2.rs` |
| Neues Format (V1) | `src/format/` neue Datei, `FormatId` erweitern |

## Tests
- `cargo test -p dito-transpiler`.
- Messung: `cargo run --release --example overlay_probe -p dito-transpiler -- <projekt>`.
