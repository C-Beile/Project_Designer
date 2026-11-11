# aod – Karte
<!-- AUTO:START -->
## Dateien
| Datei | Wofür |
|---|---|
| `Cargo.toml` | Abhängigkeiten: nur `quick-xml`, `thiserror`. Dev: `walkdir`. |
| `examples/` | `canon_check` (reguläre Form gegen fertigen Build prüfen), `qa_corpus_roundtrip` (Round-Trip über ein ganzes Korpus). |
| `tests/` | Integrationstests (`corpus_round_trip`, `patch_ops`, `rename_cascade`, `undo_redo`) und `fixtures/`. |
| `src/` | Quellcode. Einzeldateien folgen. |
| `src/lib.rs` | Modulliste und Kurz-Re-Exports (`aod::AodDocument`, `aod::PropertyTree` ...). |
| `src/document/` | Schicht 1: `.aod` als Event-Liste. `document.rs` (`parse`, `serialize`, `round_trip_check`), `index.rs` (Pfad zu Event-Bereich), `patch.rs` (`replace_text_at`, `insert_at`, `delete_range`), `canonical.rs` (reguläre Form), `error.rs`. |
| `src/tree/` | Schicht 2: `PropertyTree` (`tree.rs`), Werte (`value.rs`), Pfade (`path.rs`), Bytes erzeugen (`codec.rs`), Undo (`command.rs`, `transaction.rs`), Beobachter (`observer.rs`), Brücke zu `document` (`aod_io_adapter.rs`, Trait in `event_source.rs`), Test-Double (`testing.rs`). |
| `src/refs/` | Verweise zwischen Objekten: `RefGraph` (`graph.rs`), Kanten lesen (`extract.rs`), Typen (`edge.rs`, `object_id.rs`). |
<!-- AUTO:END -->

## Zweck
Liest und schreibt `.aod`-Dateien byte-genau. Ungeänderte Teile werden nie neu erzeugt, nur wiederholt. Darauf sitzen der Eigenschaftsbaum mit Undo (`tree`) und der Verweis-Graph mit Umbenennen (`refs`). Kein Dateizugriff hier: `serialize` gibt `Vec<u8>` zurück, geschrieben wird in `platform`/`designer-core`.

## Einstiegspunkte
- `document::parse(bytes)` / `document::serialize(&doc)`: Bytes zu `AodDocument` und zurück.
- `document::round_trip_check(bytes)`: Beweis, dass parse + serialize die Datei nicht ändert.
- `tree::AodDocumentSource::new(...)` + `tree::PropertyTree`: Werte lesen und ändern. Jede Änderung gibt ein `FileCommand` zurück (Byte-Bereich, alt, neu).
- `tree::Transaction` / `tree::UndoStack`: mehrere `FileCommand`s als ein Undo-Schritt.
- `refs::RefGraph`: Kanten aufbauen, `rename_cascade` (liefert eine `Transaction`), Löschen prüfen (`Diagnostic`).
- `document::canonicalize(bytes)`: reguläre Form (2 Leerzeichen, ein Element je Zeile, CRLF). Nur der Transpiler nutzt es (`native-transpiler/.../copy_phase_stage.rs`).

## Abhängigkeiten
- Rein: nichts aus dem Workspace.
- Raus: `designer-core`, `project`, `validators`, `native-transpiler`, `cli/forge` (benutzen `document` und `tree`; `refs` niemand).

## Regeln und Fallen
- Byte-Treue ist Pflicht: Datei laden und ohne Änderung speichern muss denselben Inhalt ergeben. Darum gibt es kein DOM, das Format wird nie aus der Tiefe neu berechnet.
- Neue Elemente: 2 Leerzeichen je Ebene, CRLF, kein BOM. Ausnahme `customProperties` in `entityFieldDb` (steht flacher). Die Ausnahme steht in `KNOWN_INDENT_QUIRKS` in `document/patch.rs`. Einen neuen Fall dort eintragen, nicht im Code verteilen.
- `tree::testing` ist absichtlich nicht `cfg(test)`. Andere Crates nutzen `InMemoryEventSource` in ihren Tests. Nicht für Produktivcode.
- Pfade: `tree::NodePath` (Feldnamen plus Index) und `document::EventPath` (Tag plus Vorkommen) beschreiben dieselbe Stelle. Die Übersetzung steht nur in `tree/aod_io_adapter.rs`.
- Verweise zeigen auf Objekte (Typ + Name) oder auf verknüpfte Dateien (`%aditoprj%/...`). `rename_cascade` überspringt Kanten zu verknüpften Dateien. Löschen meldet nur hängende Verweise, es löscht nichts mit.
- `refs` wird heute von keiner anderen Crate benutzt (nur von den eigenen Tests). Das Umbenennen der App läuft über `crates/project/src/rename.rs`.
- Die Modul-Kommentare nennen noch Namen aus der Bauzeit (`aod-io`, `core-model`). Heute sind das `aod::document` und `aod::tree`.

## Wenn du X ändern willst
| Aufgabe | Datei |
|---|---|
| Neue Bearbeitungsart auf Event-Ebene | `src/document/patch.rs` |
| Neue Einrückungs-Ausnahme | `KNOWN_INDENT_QUIRKS` in `src/document/patch.rs` und `src/tree/codec.rs` |
| Wie ein Wert als Bytes aussieht | `src/tree/codec.rs` |
| Neue Art von Verweis | `src/refs/edge.rs` (`RefKind`), `src/refs/extract.rs` |
| Umbenennen: wie die Änderung berechnet wird | `src/refs/graph.rs` (`rename_cascade`) |
| Reguläre Form des Transpilers | `src/document/canonical.rs` |

## Tests
- `cargo test -p aod`.
- `tests/corpus_round_trip.rs` prüft jede Datei unter `tests/fixtures/` (Projekte: Hermes, Pichler, SVB, FFG) auf identische Bytes. Neue Fixture: einfach die `.aod` unter `tests/fixtures/<Projekt>/...` ablegen. Keine Kundendaten ohne Freigabe.
- `examples/qa_corpus_roundtrip.rs` und `examples/canon_check.rs` laufen gegen ein großes Korpus auf der Platte (nicht im `cargo test`).
