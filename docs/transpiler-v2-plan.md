# Plan: Transpiler V2 in Rust (eigenes Crate, Deploy aus dem Speicher)

Stand: 2026-11-16. Status: Plan, nichts umgesetzt. Entscheidungen A bis G und die offenen Fragen (Abschnitt 11) sind noch nicht vom User bestätigt.
**[Fakt]** = in einer Datei gesehen. **[Vermutung]** = Einschätzung, muss geprüft werden.

## 0. Funde, die den Plan ändern

1. **V2 hat selbst Index und Cache in Containern.** [Fakt] `C:\Adito\Projects\dist_TranspilerV2\.index\` enthält `memoryfs.dat` (Quellinhalte), `adito-model-index.json` (je Modell `name`, `lastModified`, `kind` = KIND-Nummer von ASYS_SYSTEM), `data-model-references*.json`, `filemeta.mapdb`. [Vermutung] `.mapdb` = Java-Bibliothek MapDB, V2 also evtl. Java (GraalVM Native Image) und damit evtl. dekompilierbar.
2. **Im dekompilierten Code steht nichts zu V2.** [Fakt] `adito_core_architecture/.transpiler-reference/2026.1.1` ist das Docker-Image `adito/aditotranspile:2026.1.1` = V1 (NetBeans headless, `ProjectCompiler` → `CompilationExecutor`). Suche nach `transpile.version`, `transpileToolChecksum`, `Standalone` ohne Treffer. Designer-Referenz ist 2025.1.6 (älter als V2).
3. **Die Hermes-Quelle steht jetzt auf V1.** [Fakt] `hermesarzneitmittel-dev/.aditoprj/transpile.version`: `version=V1`, `transpileToolChecksum=02a16eaa…`, 16.11.2026 18:57. Das V2-Orakel wurde vorher erzeugt. Zum Orakel gehören Prüfsumme und Plugin-Version, sonst ist es nicht reproduzierbar.
4. **V2 laut Doku: 35–40 s Vollbau.** Auch "Partial transpile" läuft intern als Vollbau. V2 hat kein echtes Delta: hier können wir gewinnen. Tool-Updates ändern die Ausgabe (Plugin 1.2.0 ändert Overrides).
5. **V2 schreibt auch Nicht-Modell-Dateien und manche Skripte als Datei.** [Fakt] V2-`dist` 5314 Dateien (V1 ca. 17955): `.liquibase/**`, `doc/*.png`, `cypress/**`, `tools/**`, einzelne `.js` (z. B. `entity/VisitPlanEmployeeWeek_entity/.../valueProcess.js`, `modification/7581d7d2-…/externalInitFilterProcess.js`).
6. **V2-`dist` ist fast die Deploy-Form.** [Fakt] In V2 steht in der `.aod` schon `function` statt `export function`. [Vermutung] V2-`.aod` ist byte-gleich mit `XMLDATA`, dann ist Deploy nur noch Hochladen. Messen auf einem System, das mit V2 deployt wurde.
7. **Der Deploy-Encoder ist auf V1 gebaut.** [Fakt] `crates/deploy/src/deploy_encode.rs` macht Skripte CRLF (`as_deployed_script`). V2 hat überall LF.
8. **`MODEL_KINDS` ist unvollständig.** [Fakt] V2-Index nennt `entityWebservice` = 10250 und `rendererDefinition` = 10267. Beide fehlen in `deploy_encode.rs` (Zeilen 15–30).
9. **Deploy geht heute nur mit MySQL.** [Fakt] `system_deploy.rs`: Backticks, `ON DUPLICATE KEY UPDATE`, `MD5(CONVERT(... USING utf8mb4))`. Das `database`-Plugin kann auch MSSQL/Postgres.
10. **Rust und C# ordnen Modifikationen verschieden.** [Fakt] Rust: `(is_project_root && change_type != Insert, position, Dateiname)` (`modification_engine_stage.rs:1175`). C#: `(Position, GUID)`, bei MODIFY auf denselben Pfad gewinnt die höchste `ModuleOrder` (`ModificationEngine.cs:179–197`). Modul-Reihenfolge: Rust `BTreeMap` nach Namen, Projekt zuletzt, "documented assumption, not empirically verified" (`copy_phase_stage.rs:333–341`); C# topologisch, bei Gleichstand alphabetisch. Für V2 beides neu messen.
11. **Kopplung der alten Engine stört Parallelität.** [Fakt] Globaler Fortschritts-Reporter, thread-lokale `ORDER_CACHE`/`OUTPUT_DIR`, `std::env::set_var` für den Cache-Ordner (`transpile_action.rs:197`), kein `cancel()` in `NativeTranspiler`, `try_snapshot_project` kopiert das Projekt vor jedem Lauf (viele Schreibvorgänge, vom Virenscanner gebremst).
12. **Doku-Widerspruch:** Root-`CLAUDE.md` nennt MSVC und weiter unten "rust-toolchain.toml steht auf GNU".

## 1. Zielbild und Nicht-Ziele

Ziel:
- Ein Crate ohne Tauri und ohne Datenbank. Baut aus dem Projekt die V2-Ausgabe, 100 % byte-gleich mit `dist_TranspilerV2`.
- Alles im Speicher. Ein Lauf liefert **Artefakte**: Typ, Name, KIND, Titel, Bytes, MD5.
- Artefakte gehen direkt in den Deploy. Ein `dist`-Ordner ist optional.
- Auf die Platte nur: der Cache als **eine** Datei, und `dist` nur auf Wunsch und nur geänderte Dateien.
- Lauf ohne Änderung unter 1 s. Eine geänderte Datei ca. 1 s.

Nicht-Ziele (nur vorbereiten): V1-Ausgabe (kommt später als zweites Format), Hot-Reload (nur Haken, Abschnitt 10), V2-Nichtdeterminismus nachbauen (erkennen und melden), altes `native-transpiler` umbauen (bleibt, bis das neue Crate es ersetzt).

## 2. Architektur

### Entscheidung A: Schnitt und Name
| Option | Vorteil | Nachteil |
|---|---|---|
| A1 ein Crate `transpiler-v2` | einfach | Name passt nicht mehr, wenn V1 dazukommt |
| **A2 ein Crate, neutraler Name (z. B. `dito-transpiler`), Module `core/` (Logik) und `format/v2.rs`; V1 später als `format/v1.rs` hinter Cargo-Feature** | eine Assembly, geteilte Logik, austauschbarer Writer | Disziplin: `core` kennt `format` nicht |
| A3 drei Crates (`core`, `v2`, `v1`) | harte Grenzen | mehr Cargo-Aufwand, schwerer zu überblicken |

Empfehlung A2 (C#-Vergleich: eine Assembly mit Namespaces `Core` und `Formats.V2`).

### Abhängigkeiten
Wiederverwenden: `npm-modules` (Module finden), `aod::document::parse` (Events, quick-xml; getestet), `plugin-api` (`Transpiler`, `ProgressSink`; wird erweitert), `compare_trees` (Harness, später in ein gemeinsames Modul).
Neu: virtuelles Dateisystem (Overlay), Baummodell, V2-Writer, Skript-Pipeline (Inline, Services, Imports, Leerzeilen), Abhängigkeitsgraph, Cache-Container, Artefakt-Typ.
Nicht abhängig von: `database`, `deploy`, `tauri`; `platform` nur für echte OS-Aufrufe (Hardlinks).

### Entscheidung B: Wie kommen Artefakte zum Deploy?
| Option | Bewertung |
|---|---|
| B1 `deploy` hängt vom Transpiler-Crate ab | koppelt Plugin an Kern, falsche Richtung |
| **B2 neutraler Typ `BuildArtifact { folder, name, kind, title, bytes, md5 }` in `plugin-api`; Transpiler liefert, `deploy` nimmt; `project` hält das letzte Ergebnis als `Arc<…>` im Speicher** | sauber, passt zu "Kern → plugin-api → Plugins" |
| B3 Deploy liest den Cache-Container von der Platte | geht ohne laufende App, mehr Formatpflege |

Empfehlung B2, B3 später für die CLI.

### API (Skizze)
- `Builder::new(project_root, BuildConfig)`; Config: Format (V2/V1), Cache-Ort, `materialize_dist: Option<Pfad>`, Threads.
- `build(&self, progress, cancel) -> Result<BuildResult>`; Result: Artefakte, Pass-through-Dateien, Diagnosen (fehlgeschlagene Modifikationen, Konflikte), Statistik (gelesene/geschriebene Dateien, Zeit je Phase).
- `build_one(artifact_id)` schon jetzt vorsehen (Hot-Reload). `CancelToken` = `Arc<AtomicBool>`, geprüft zwischen Artefakten.
- Cache: `cache::load`, `cache::store_in_background`.

### Entscheidung C: Anbindung an `plugin-api::Transpiler`
C1 Trait unverändert, Engine legt Ergebnis in versteckten Speicher (versteckter Zustand). **C2 `TranspileOutcome` um `artifacts: Option<Arc<BuildArtifacts>>` erweitern, `output_dir` wird `Option`** (Fremd-Transpiler `adito` setzt `None`). Empfehlung C2.

## 3. Datenmodell und Pipeline

### Entscheidung D: Darstellung im Speicher
| Option | Vorteil | Nachteil |
|---|---|---|
| D1 Event-Liste + Byte-Patches (wie `aod::document`) | treu zur Quelle | neuer Index nach jeder Änderung; Sortieren/Verschieben mühsam; V2 normalisiert ohnehin |
| **D2 eigener Baum als Arena (`Vec<Node>`, Kinder als Index-Listen; wie `List<Node>` mit `int ParentId`). Texte/Attribute bleiben rohe Bytes; ein Writer je Format schreibt die Bytes** | einfach für Modifikationen, Sortierung, Extension Points; Bytes nur aus dem Writer; parallel gut | Writer muss alle Regeln kennen |
| D3 typisiertes Modell je Objekttyp aus XSDs | Schema-Reihenfolge automatisch | sehr groß, lohnt nicht |

Empfehlung D2. Schema-Reihenfolge als Datentabelle (es gibt `child_order.json` und `crates/project/assets/property-catalog.json`). Bedingung: Messung M1 zeigt, dass V2 jedes Modell neu schreibt [Vermutung: `autoend.aod` hat andere Leerzeilen als Quelle und V1]. Wenn nein: je Teilbaum Original-Bytes merken und im Writer verwenden, solange unverändert.

### V2-Writer: belegte Regeln
Erste Zeile `<?xml version="1.0" encoding="UTF-8"?>`; LF; 2 Leerzeichen je Ebene; `<x />` mit Leerzeichen; LF am Dateiende; `<majorModelMode>COMPACT`; Text maskiert `& < >`, `"` bleibt.
Noch zu messen (Klassifikator): Escaping in Attributen, Attribut-Reihenfolge (Annahme: wie Quelle), leere verknüpfte Felder entfernen oder leer lassen (C# `LinkedFieldTagIndex` vs. Rust `LINKED_PROPERTIES`), Kodierung (V1 liest 1-Byte, schreibt UTF-8, `service_inline_stage.rs:18–19`).
Regel: Texte bleiben bis zum Writer `Vec<u8>`, nicht `String`.

Skript-Pipeline (ohne JS-Parser): `export` entfernen → Services einsetzen → Imports zusammenführen/doppelte entfernen → Leerzeilen/Whitespace nach V2-Regeln → XML-maskieren.

### Reihenfolge-Regeln (offen, zentral)
| Punkt | Rust heute | C# heute | V2 |
|---|---|---|---|
| Modul-Reihenfolge | alphabetisch, Projekt zuletzt | topologisch, Gleichstand alphabetisch | messen |
| Modifikationen | Stufe Projekt/Nicht-INSERT, dann `position`, dann Datei | `position`, dann GUID; höchstes Modul gewinnt bei gleichem MODIFY-Pfad | messen + Konflikt-Erkennung |
| Service-Implementierungen | Services nach Namen, Impl nach kleingeschriebenem Namen | treuer Port Java `ServiceSupport` | V2 weicht ab (`attributeUsageContexts_service`) |
| Kind-Elemente bei INSERT | `child_order.json`, sonst gelernt | XElement + Resolver | V2 weicht ab (`Activity_entity`) |

### Alias und Modifikationen: Reihenfolge ist Pflicht (Lion, 2026-11-16)
Aus der Praxis: Aliase mit **gleicher Tabelle**, die doppelt vorkommen, überschreiben sich still. Dann greift eine Einstellung nicht und niemand sieht warum. Das darf im neuen Crate nicht passieren.
- **Feste, dokumentierte Phasen-Reihenfolge** (eine Stelle im Code, ein Test pro Übergang): Module auflösen, Kopieren, Modifikationen, Extension Points, Service-Inlining, Alias-Merge, Preferences, Sprache. Alias-Merge läuft **nach** den Modifikationen (Modifikationen können Alias-Ziele und Entities ändern).
- **Gewinner-Regel pro Schlüssel**: Schlüssel eines Entity = (Ziel-Alias, Entity-Name). Gleicher Schlüssel aus mehreren Quellen: höchstes Modul in der Modul-Reihenfolge gewinnt, Projekt zuletzt. Nie "wer zuletzt geschrieben hat".
- **Konflikt-Erkennung statt Stille**: Zwei Aliase auf **dieselbe Tabelle** (gleiches `tableName`/Schema) im selben Ziel, oder derselbe Entity-Name doppelt, oder zwei MODIFY auf denselben Pfad: Warnung mit beiden Quellen (Modul, Datei), dem Gewinner und den verlorenen Werten. Die Warnung steht im Build-Log und im `TranspileOutcome`.
- **Einstellungen nicht verlieren**: Beim Zusammenführen verlorene Attribute (z. B. die Einstellung, die "nicht gegriffen hat") werden aufgelistet. Optionaler Modus "strikt": Konflikt = Fehler.
- **Erklär-Modus** (`--explain` / Trace): Für ein Artefakt zeigen, welche Quellen in welcher Reihenfolge beteiligt waren und welche gewonnen hat. Dient der Fehlersuche und dem Orakel-Vergleich.
- **Keine Probeprojekte** (Lion, 2026-11-16). Die ADITO-Reihenfolge ist unbekannt. Wir leiten sie nur aus dem echten Orakel (Hermes `dist_TranspilerV2`, z. B. 49 Aliase zu `Data_alias`) ab. Wo das Orakel nichts belegt, gilt die deterministische Vorgabe mit Warnung. Regeln stehen in einer Datei (`merge/order.rs`) mit Verweis auf den belegenden Orakel-Fall.
- **Tests**: Eigene Fixtures (klein, von uns geschrieben, ohne V2-Lauf) für (a) zwei Aliase, gleiche Tabelle, (b) Alias mit gleichem Entity-Namen in zwei Modulen, (c) Modifikation auf Alias vor/nach Merge, (d) Reihenfolge-Umkehr der Module. Erwartung aus dem V2-Orakel, nicht aus Rust/C#. P0 misst am V2-Orakel, was V2 bei diesen Fällen wirklich tut.

### Ablauf als Graph
```
P0 Entdecken: Module, .transpilerignore, Dateiliste mit Stat (parallel je Modul)
P1 Overlay: Pfad -> gewinnende Quelle (keine Kopie). Dubletten nach <name> (C# ArtifactNameDeduplicator)
P2 Je Artefakt, parallel: parsen -> Modifikationen (nach Ziel gruppiert) -> Extension Points -> verknüpfte Dateien lesen
   ---- Barriere ----
P3 Global: Service-Index (nach den Modifikationen, weil diese Implementierungen einfügen);
   Satelliten-Merges (Alias, Sprache, Preferences)
   ---- Barriere ----
P4 Je Artefakt, parallel: Skript-Transformation -> V2-Writer -> MD5
P5 Ausgänge: BuildResult (Speicher) | Cache-Container (Hintergrund) | dist (optional, nur Geänderte) | Deploy
```
Jeder Schritt in P2 und P4 ist eine **reine Funktion** (kein globaler Zustand, keine Platte): nötig für Parallelität, Delta, Hot-Reload. Modifikationen an Satelliten werden wie in C# vor dem Satelliten-Merge angewandt (`DependencyMergeService.cs:110–126`), bis die Messung etwas anderes zeigt.

### Entscheidung F: Parallelität
F1 eigenes `std::thread::scope` + Schlange (`parallel_try_each`). **F2 `rayon`** (wie `Parallel.ForEach`). Empfehlung F2 (neue Bibliothek: Zustimmung nötig).

## 4. Das Beste aus beiden
| Baustein | Woher | Begründung |
|---|---|---|
| Modul-Auflösung | Rust `npm-modules` | da und getestet; Reihenfolge aus Messung (Kandidat C#-Topo) |
| `.transpilerignore` an jeder Tiefe, Sonderfälle `.liquibase/data`, `scripts` | Rust `copy_phase_stage.rs` | am Korpus gefunden. **Bekannte Lücke** (README.md, CHANGELOG.md, eslint.config.mjs … nicht ignoriert) zuerst reparieren |
| Kein Kopieren, Overlay im Speicher | neu | weniger Schreibvorgänge für den Virenscanner |
| Dubletten nach `<name>` | C# `ArtifactNameDeduplicator` | fehlt in Rust; Ordnername = `<name>` gewinnt |
| Modifikationen: Pfade, Mixins, Kind-Reihenfolge | Rust `modification_engine_stage.rs` + C# `ModificationPathResolver` | beide in die Hypothesen-Tabelle |
| Leere Verweise bei berührten Artefakten | C# `LinkedFileNormalizer` (35/35) | für V2 evtl. nebensächlich, leere Elemente zählen |
| Extension Points | Rust-Regel, aber auf dem Baum statt auf Zeilen | Zeilenlogik bricht bei ungewöhnlicher Einrückung |
| Alias-/Sprach-/Preferences-Merge | C# (entityDb-Dedupe, Schema-Fix) + Rust | C# hat bekannten Fehler behoben |
| Service-Inlining | C# `ServiceCallResolver` (Port Java `ServiceSupport`, PreParser, ES6ImportParser; 11554/11556) | näher am Original; V2-Abweichungen als Regel-Schicht |
| Kein Inlining in `serviceDefinition` | C# `FinalBuildAssembler.cs:115–118` | durch Java belegt |
| `export` entfernen | Rust `drop_export` (breiter) vs. C# (nur `export function`) | am V2-Orakel messen |
| COMPACT, Base64 für Binärdateien | C# `FinalBuildAssembler` + Rust `deploy_encode` | gleiche Regel (Endung als Ersatz für Feldtyp) |
| 2024-Sonderfall | C# `TranspilerVersioning` | nur Haken |
| Merge-Fingerabdruck je Modul | C# `MergeCache` | billig |
| Delta je Artefakt | C# `ArtifactInputHasher`, aber mit echtem Abhängigkeitsgraph | C# hasht nur den eigenen Ordner (Services/Satelliten fehlen) |
| Abgleich mit Live-DB vor dem Überspringen | C# `fetchLiveHashes` | gute Gegenprobe |
| Löschen per umbenennen + Hintergrund | C# `WipeMergedRoot` | nur wenn `dist` neu geschrieben wird |
| Gebündelter Deploy, MD5, eine Transaktion | Rust `system_deploy.rs` | da; anpassen |
| Fortschritt gebündelt (ca. 150 ms) | C# `RunUiFlushLoopAsync` | Tausende Events bremsen die UI |
| Harness `compare_trees`, `compact_vs_dist` | Rust | Basis für Klassifikator |

## 5. Leistung und Virenscanner

### Messplan (erst messen, dann bauen)
| Nr | Messung | Werkzeug | Warum |
|---|---|---|---|
| M0 | Ausgangslage: V2 offiziell, V1 offiziell, alte Rust-Engine (`own_engine_timing`, `FORGE_TRANSPILE_TRACE=1`), C#-Transpiler; je 3 Läufe kalt/warm | Stoppuhr, Trace | Bezugswerte |
| M1 | Schreibt V2 alles neu? Unberührte Modelle: Quelle DISTRIBUTED→COMPACT gegen V2 | Beispielprogramm | entscheidet D2 |
| M2 | Kosten des Virenscanners: 5k/20k kleine Dateien anlegen/lesen/löschen; 1 Datei 150 MB; 5k Hardlinks; je im normalen Ordner, ausgenommenen Ordner und Dev Drive | Mikro-Benchmark | echte Zahlen |
| M3 | Welche Prozesse/Dateien kosten Scan-Zeit | `New-MpPerformanceRecording` / `Get-MpPerformanceReport`, WPR/WPA | MsMpEng-Kosten |
| M4 | Threads 1/2/4/8/16 beim Lesen von 23k Dateien | Benchmark | mehr ist mit Scanner nicht immer besser |
| M5 | Zeit je Phase im neuen Crate + Zähler | Statistik im `BuildResult` | Regressionen sehen |
| M6 | Speicherbedarf: alle Modelle und Skripte im RAM | Peak Working Set | In-Memory machbar? |
| M7 | Deploy: Fingerabdruck-Abfrage (ca. 3000 Zeilen), Upsert 1/100/alle über den Tunnel | Stoppuhr im Plugin | Zielwerte |

### Ideen bewertet
| Idee | Nutzen | Aufwand | Einschätzung |
|---|---|---|---|
| Module nicht kopieren (Overlay) | sehr hoch (heute erst ca. 18k Dateien schreiben, dann bearbeiten) | gratis im neuen Design | **Ja, größter Gewinn** |
| Keine Projektkopie vor dem Lauf (`try_snapshot_project`) | hoch | gratis (einmal lesen = Snapshot) | **Ja** |
| `dist` nur auf Wunsch | hoch (5314 Dateien weniger) | klein | **Ja** (Entscheidung E) |
| Nur geänderte Dateien in `dist` | hoch bei kleinen Änderungen | klein | **Ja** |
| Cache als **eine** Datei (statt `snapshot/` mit Tausenden) | hoch | mittel | **Ja** (V2 tut es auch) |
| Hardlinks für Pass-through in `dist` | mittel | klein | Vorsicht: Änderung in `dist` ändert die Quelle; nicht über Laufwerke; nur Option, nur Nicht-Modelle |
| Reflink/Block-Clone (ReFS, Dev Drive) | mittel | klein | [Vermutung] nur mit Dev Drive messbar |
| Dev Drive (asynchroner Defender-Scan) | hoch laut Microsoft | IT/Admin | Anleitung, M2 entscheidet |
| Ordner-Ausnahme (Cache, `dist`) | hoch | IT-Entscheidung | Anleitung mit Risiken |
| Prozess-Ausnahme (`DitoDesigner.exe`) | sehr hoch | IT | größtes Sicherheitsrisiko; nur nach Absprache |
| Wenige große Schreibvorgänge | mittel | klein | Container erfüllt das |
| Thread-Zahl anpassen | klein–mittel | klein | Wert aus M4 |
| mmap statt read | klein | klein | **Nein** für Quellen; evtl. Container |
| Schneller Hash (xxh3/blake3) für Änderungen, MD5 nur für DB-Vergleich | mittel | neue Bibliothek | Ja; MD5 je Artefakt im Cache |
| Änderungsliste von `project-index`/`file-watcher` statt Stat-Scan | hoch bei Delta | mittel | Phase 6; Rückfall auf Scan bei Overflow |

### Deploy aus dem Speicher
1. SELECT `ID, KIND, MD5(XMLDATA)` (gibt es: `remote_fingerprints`).
2. Mit lokaler MD5 je Artefakt vergleichen → Plan I/U/D.
3. Gebündelte Upserts in **einer** Transaktion (gibt es: `batched_system_statements`, 150 Zeilen oder 4 MB je Statement).
4. Anpassen: Inhalt aus Artefakt-Bytes statt `dist`; `MODEL_KINDS` ergänzen (Tabelle gegen V2-Index prüfen); Benutzer in `USER_NEW`/`USER_EDIT`; Meta-Zeile wie V2 (messen).
5. DB-MD5 immer frisch holen (andere deployen zwischendurch).

### Zielwerte (Vorschlag, M0/M2 können sie ändern)
| Fall | Ziel |
|---|---|
| Vollbau kalt | ≤ 8 s (V2 offiziell 35–40 s) |
| Lauf ohne Änderung | ≤ 1 s |
| 1 Skript geändert | ≤ 1,5 s |
| Deploy 1 Artefakt über Tunnel | ≤ 2 s |
| Voll-Deploy | nicht langsamer als V2 offiziell |

## 6. Inkrementell
Zuerst korrekt, dann schnell. Drei Stufen:
1. **Fingerabdruck je Modul** (C# `MergeCache`). Unverändert: Artefakte aus dem Container. Sonst Vollbau im Speicher, geschrieben wird nur, was sich ändert. Reicht vielleicht schon (Vollbau ≤ 8 s).
2. **Eingabe-Hash je Artefakt**: Bytes der gewinnenden Quelle, alle Modifikationen auf das Ziel + Sidecars, verknüpfte Dateien, Impl der Extension Points, Hash jedes genutzten Service (Name → Impl → Skripte), bei Satelliten-Zielen alle Satelliten, `ENGINE_REVISION` und Format-Id.
3. **Rückwärts-Index** "Datei → betroffene Artefakte". Basis für Hot-Reload.

Cache: eine Datei je Projekt unter `%LOCALAPPDATA%\DitoDesigner\transpile-cache\<hash-des-projektpfads>.bin`, nie im Projekt. Inhalt: Kopf (Version, Revision, Format), Datei-Tabelle (Pfad, Größe, mtime, Hash), Artefakt-Tabelle (Eingabe-Hash, Ausgabe-Bytes optional komprimiert, MD5). Schreiben atomar (temp + umbenennen) im Hintergrund.
**Entscheidung G:** eigenes einfaches Binärformat (keine neue Bibliothek, immer ganz neu schreiben; 100–200 MB unter 1 s im Hintergrund) oder `redb`/SQLite (Update am Ort, neue Bibliothek). Empfehlung: zuerst eigenes Format.
Invalidierung: `ENGINE_REVISION` (Konstante, jede Logikänderung erhöht sie); im Debug-Build werden zufällig 1 % der Artefakte voll neu gebaut und verglichen; Racy-mtime wie bei Git (gleiche Sekunde wie Cache-Speichern → per Inhalt hashen).

## 7. Teststrategie
**Harness:** `compare_trees` + Klassifikator mit "Leiter von Normalisierern"; erste passende Stufe = Klasse:
F1 Zeilenende · F2 Leerzeilen in Skripten · F3 sonstiger Whitespace · F4 `<x/>` vs. `<x></x>` · F5 Kodierung · F6 Imports (Reihenfolge/doppelt) · F7 Reihenfolge der Kinder · F8 Reihenfolge der Service-Implementierungen · L echter Inhalt anders · X Datei fehlt/zu viel.
Ausgabe: Histogramm je Klasse und Ordner, 3 Beispiele je Klasse mit Ausschnitt.

**V1↔V2-Unterschiede aufklären:**
1. Dreier-Vergleich Quelle/V1/V2 je Datei; Abweichungen (XPath, Klasse) in Tabelle.
2. Hypothesen-Tabelle je Reihenfolge-Frage (Modul-Reihenfolge, alphabetisch, `position`, Entdeckungs-Reihenfolge, Schema-Reihenfolge); 100 %-Regel gewinnt, sonst Nichtdeterminismus.
3. V2-Trace-Log (`-vv`) mitschneiden.
4. Kleine Test-Projekte mit dem echten V2-Tool (z. B. 2 Module mit gleicher Service-Impl); dazu muss das Tool ohne Designer laufen (Frage 1).
5. Dekompilieren, falls V2 Java-Bytecode enthält (Abschnitt 0, Punkt 1).
6. Java `ServiceSupport`/`ModificationHandler` (V1) lesen; V2 ist vermutlich ein Umbau davon.

Weiteres:
- **Regressions-Sperre:** `baseline.json` (Treffer je Ordner + Liste passender Dateien); Fehler, wenn eine Zahl sinkt oder eine passende Datei kippt (Ratsche).
- **V2-Nichtdeterminismus:** MODIFY-Konflikte im selben Modul selbst erkennen; V2 zweimal laufen lassen; wechselnde Dateien auf Liste "nicht bewertbar"; Warnung bei Konflikten.
- **Fixtures:** kleine anonyme Projekte unter `crates/<crate>/tests/fixtures/`; keine Kundendaten ohne Freigabe.
- **Orakel pinnen:** `transpileToolChecksum` + Plugin-Version; bei Tool-Update neues Orakel, alt gegen neu vergleichen.
- Laut Projektregel laufen Tests nur an Messpunkten (Ende jeder Phase, vor dem Umschalten), nicht täglich.

## 8. Phasen
| Phase | Inhalt | Größe | Hängt ab von | Definition of Done |
|---|---|---|---|---|
| **P0 Klären und messen** | V2-Tool finden, Start ohne Designer, `-vv`-Log; M0–M4, M6, M1; Klassifikator v1 auf "alte Engine + `deploy_encode`" gegen V2 | M | – | Bericht mit Zahlen, Klassen-Histogramm, Entscheidungen A–G |
| **P1 Gerüst** | Crate, API, Entdecken, `.transpilerignore` (inkl. bekannter Lücke), Overlay, Baum, V2-Writer, Pass-through, Harness | M | P0 | 100 % Nicht-Modell-Dateien und 100 % Modelle ohne Skripte/Modifikationen byte-gleich |
| **P2 Skripte** | Verknüpfte Dateien einbetten, `export`, Leerzeilen/Whitespace, Kodierung, leere Felder | M–L | P1 | ≥ 90 % aller V2-Dateien byte-gleich |
| **P3 Merge** | Modifikationen, Dubletten, Extension Points, Alias-/Sprach-/Preferences-Merge | L | P1 (parallel zu P2) | ≥ 98 % |
| **P4 Services und Reihenfolgen** | Service-Index, Inlining, Import-Dedupe, V2-Reihenfolge-Regeln | L | P2, P3 | ≥ 99,5 %, Rest klassifiziert/erklärt oder "nicht bewertbar" |
| **P5 Deploy aus Speicher** | `BuildArtifact` in `plugin-api`; Deploy nimmt Artefakte; `MODEL_KINDS`; Benutzer, Meta-Zeile | M | P1 (Typ); echte Tests nach P4 | Auf Dev-System MD5 aller Zeilen = nach V2-Deploy; 1 Artefakt ≤ 2 s |
| **P6 Inkrementell** | Container, Stufe 1, dann 2 und 3 | M–L | P4 | Lauf ohne Änderung ≤ 1 s; 50 Zufallsänderungen: Delta == Vollbau |
| **P7 App** | Registry, `transpile.version`, Fortschritt, Abbruch, Einstellungen, Umschalten | M | P4, P5 | Lauf aus der UI; Abbruch ≤ 0,5 s; Log in Output > Build |
| **P8 Hot-Reload-Haken** | `build_one`, Rückwärts-Index, Deploy einer Zeile | S | P6 | Ein Artefakt allein bauen und deployen |

Parallel möglich: P0-Messungen Virenscanner neben Klassifikator; P2 neben P3; P5 (Plugin-Seite) ab P1; Design von P6 neben P3/P4.

### Risiken
| Risiko | Gegenmaßnahme |
|---|---|
| V2-Regeln bleiben unklar | Test-Projekte mit echtem Tool, Dekompilieren, Hypothesen-Tabelle |
| Tool-Update ändert Ausgabe | Orakel pinnen, Diff-Bericht statt stiller Annahme |
| Falsche Daten auf ein System | Plan, Bestätigung, eine Transaktion; zuerst nur Dev-Systeme; Vergleich mit V2-Deploy-Zeile |
| Speicher zu groß | M6 früh; notfalls Ausgabe komprimiert halten |
| Lion kennt kein Rust | Arena statt Lebensdauer-Tricks, eigene Typen statt Generics, Karte mit C#-Vergleichen |
| Delta ≠ Vollbau | Zufallsprüfung im Debug-Build, `ENGINE_REVISION`, Property-Test in P6 |
| Deploy nur MySQL | Frage 3, sonst dokumentieren |

Leicht schiefgehende Stellen: `String::from_utf8_lossy` zerstört Latin-1 (darum `Vec<u8>`); CRLF aus Modifikationsdateien gelangt in die Ausgabe; Barriere: Modifikationen fügen Service-Implementierungen hinzu; globaler Zustand (statics, `set_var`) verhindert Parallelität und Hot-Reload; Logik ändern ohne `ENGINE_REVISION` zu erhöhen.

## 9. Anbindung an die App
- Registry-Id z. B. `dito-v2`, Name "Dito Transpiler V2", in `build_transpiler_registry` (`app/src-tauri/src/lib.rs`).
- Auswahl: `.aditoprj/transpile.version` lesen. V2: neues Crate. V1: wie heute (`native` oder `adito`). Datei fehlt: Einstellung in `designer.conf` (`[options]` oder neu `[transpile]`). Die Datei gehört dem ADITO-Plugin; wir schreiben sie nur auf Wunsch.
- Fortschritt über `ProgressSink` des Traits, gebündelt alle ca. 150 ms. Vorhandener Weg (`PROGRESS_REPORTER`, Build-Log) bleibt.
- Abbruch: `cancel()` setzt den Token; läuft nichts, `false`.
- Deploy: neue Befehle im `deploy`-Plugin über `plugin_call` (z. B. `planFromBuild`, `executeFromBuild`), kein neuer Tauri-Befehl; UI über das Register.
- Alte Engine `native` bleibt für V1, bis das neue Crate `format/v1` hat und 99,87 % erreicht; dann abschalten, später löschen. Bis dahin Regeln gezielt portieren, nichts teilen.

## 10. Hot-Reload (später): was jetzt stimmen muss
1. Reine Funktionen je Artefakt (P2, P4).
2. Expliziter Abhängigkeitsgraph mit Rückwärts-Index (Datei → Artefakte, Service → Aufrufer, Satellit → Ziel).
3. Stabile Artefakt-Id (Typ, Name, KIND) überall.
4. Deploy einer einzelnen Zeile als eigener Pfad.
5. Eingang von Änderungen über `project-index`/`file-watcher`, Rückfall Stat-Scan.
6. Offen: Lädt der ADITO-Server eine geänderte ASYS_SYSTEM-Zeile ohne Neustart nach? Davon hängt ab, ob Hot-Reload Sinn hat.

## 11. Offene Fragen (nach Wichtigkeit)
1. **Wo liegt das V2-Tool ("Native Tools", wird beim Designer-Start aktualisiert) und läuft es ohne Designer mit einem Projektpfad?** Entscheidet Testmethode und evtl. Dekompilieren. Empfehlung: im Designer-Userdir suchen oder einen V2-Lauf mit Process Monitor mitschneiden.
2. Crate-Schnitt und Name (A). Empfehlung: ein Crate, neutraler Name, Formate als Module.
3. Welche Datenbanken für den Deploy? Empfehlung: zuerst MySQL, dann erweitern.
4. Soll `dist` standardmäßig geschrieben werden? Liest jemand anderes `dist` (Designer, CI, Git)? Empfehlung: Vorgabe aus, Schalter "dist schreiben".
5. Wer steht in `USER_NEW`/`USER_EDIT`: Windows-Benutzer wie bei V2 oder `_____DESIGNERANONYM` wie heute? Empfehlung: wie V2, nach Messung.
6. Neue Bibliotheken: `rayon`, schneller Hash (xxh3/blake3), evtl. `zstd`. Empfehlung: `rayon` ja, Hash ja, `zstd` erst nach M6.
7. Gibt es ein Dev-System, das mit V2 deployt wurde? Dort prüfen wir "V2-`dist` == XMLDATA" (MD5 je Zeile).
8. IT: Dev Drive oder Virenscanner-Ausnahmen möglich? Empfehlung: erst M2/M3 messen, dann mit Zahlen fragen.
9. Speicher-Budget der App während eines Builds (z. B. ≤ 1 GB)?
10. V2-Konflikte bei Modifikationen: wie V2 still eine Variante nehmen oder abbrechen wie von ADITO geplant? Empfehlung: deterministisch nach Modul-Reihenfolge plus deutliche Warnung.
11. Orakel: Tool-Version 1.1.4 festhalten oder jedem Update folgen? Empfehlung: festhalten, je Update Diff-Bericht.
12. `TranspileOutcome` erweitern (C2): ok?

### P0-Funde (2026-11-16, gemessen)
- **Frage 1 gelöst:** Das V2-Tool liegt im Designer-Userdir: `%APPDATA%\.aditodesigner\<Designer-Version>\libraries\nativeTools\{transpile.exe, deploy.exe, schemas\}`. Version 2026.1.3 = Tool **1.2.2**, 2026.0.0 = Tool **1.1.6**. Beide laufen ohne Designer: `transpile.exe -f -vv --npm="C:\Program Files\nodejs\npm.cmd" -s <nativeTools>\schemas\schemas.json -t <Ausgabe> <Projekt>`. Ohne `--npm` scheitert es (`npm-prefix.js` wird im Projektordner gesucht). Lange Pfade mit Sonderzeichen meiden (1.1.6 scheiterte; kurzer Pfad `C:\Temp\...` ging).
- `transpileToolChecksum` in `.aditoprj/transpile.version` = SHA-256 von `transpile.exe` (Hash von 1.2.2 beginnt `02a16eaa`).
- V2 = **GraalVM Native Image**, Java 25, Quarkus/picocli. Klassennamen stehen im Stacktrace (`de.adito.designer.services.transpile...`). Es gibt `--daemon` (Dauerprozess), `--threads`, `--c11y` (Kompatibilitätsmodi) und `-t`.
- Phasen laut Log: Validate, Prepare In-Memory Filesystem (Jimfs), Read Project Metadata via NPM, Read referenced files, Analyze Modified Files, Packaging, File Integrity Verification (AOD), Inline Linked Files, Resolve and Apply Modifications (u. a. "Applying multiple modifications on same node", "Failed to apply", "points to a non existing target model"), danach Integritätsprüfung.
- **Integritätsprüfung nach Modifikationen:** Doppelte `<name>`-Kinder im selben Elternknoten sind ein **Fehler** (`DuplicateChildrenWithSameNameException`) und listen die beteiligten Modifikationen. Das ist genau das Alias-Problem von Lion. Das Orakel (Tool 1.1.4) lief durch, die heutigen Tools 1.1.6 und 1.2.2 brechen bei Hermes wegen `ResourceOperation_Data_alias` (`TITLE`) bzw. `VendiraOrder_webservice` ab. Unser Crate muss dieselbe Prüfung melden (mindestens als Warnung mit den Quellen).
- Das V2-Log mit `-vv` nennt je Phase und Konflikt die beteiligten Dateien. Das ist die Quelle für die Reihenfolge-Regeln.
- Kopierzeit M0-Messwert: 38.419 Dateien (144 MB) mit `robocopy /MT:16` in ca. 17 s, auch mehrfach.
- **Neues Orakel steht** (2026-11-16): Tool 1.2.2 auf `C:\Temp\v2probe\hermes` (Kopie ohne `.git`/`dist*`), Ausgabe `C:\Temp\v2probe\out`, **32,5 s** Vollbau, 5314 Dateien. Reparatur der Kopie (Skript `C:\Temp\v2probe\repair.ps1`, Bericht `repair-report.txt`): 2 redundante Modifikationen entfernt (`modification/ResourceOpe-entityField-4dafb591-8a` und `@3hills-it/vendira-pos-order/.../VendiraOrde-webserviceF-70501031-b6`). Ursache beim zweiten: das Basismodell in `vendira` hat das Feld schon, das Modul `vendira-pos-order` fügt es nochmal ein.
- **Vergleich mit dem alten Orakel (1.1.4):** 5307 von 5314 Dateien byte-gleich, 0 fehlende, 0 zusätzliche. Abweichend nur: `.index\*` (4 Dateien), `publish-10741.ps1`, `Data_alias.aod`, `VendiraOrder_webservice.aod` (letzte zwei durch die Reparatur). Folge: V2 1.1.4 und 1.2.2 erzeugen für Hermes praktisch dieselbe Ausgabe. Das Orakel ist stabil.
- **Gerüst steht** (`crates/dito-transpiler`, Name entschieden): `Builder`/`BuildConfig`/`BuildResult`, `discover` (über `npm-modules`), `overlay` (virtuelle Dateiliste statt Kopie), `rules` (`.transpilerignore` auch im Projekt-Wurzelordner), `merge/order.rs` (Vorgabe, noch ohne Beleg), `format/v2.rs` (Konstanten). Neue Bibliotheken: `rayon`, `ignore`, `indexmap`, `xxhash-rust` (noch nicht alle benutzt). 4 Tests grün.
- **Messwert Overlay (Hermes-Kopie, 1 Thread, ohne Inhalte lesen):** 160 Module, 21.091 Dateien (1.209 ignoriert), Entdecken ca. 70 ms, Overlay ca. 0,9 s. V2 nennt im Log "21126 changed files". Das heißt: ohne Kopieren (heute ca. 17 s beim `robocopy`, die alte Engine schreibt zusätzlich 18k Dateien) bleibt unter 1 s. Parallel und mit Cache wird es weniger.
- **P1 Stand** (2026-11-16, Hermes-Kopie gegen das neue Orakel, `examples/compare_out`): **3968 von 5314 Dateien (74,7 %) byte-gleich**. Alle Nicht-Modell-Dateien sind gleich (`.liquibase` 2278, `doc`, `tools`, `cypress`, Wurzeldateien). Modelle: 1660 Modelle werden mit LF+COMPACT allein gleich, der Rest (1337) braucht P2 (verknüpfte Skripte) oder P3 (Modifikationen). Nur im Orakel fehlt: `.index/*` (5 Dateien, V2 erzeugt es selbst). Zu viel bei uns: 383 Dateien (`aliasDefinition` 109, `language` 271, `preferences` 3), die V2 zusammenführt (P3).
- **Belegte Regeln aus P1:** (1) V2 normalisiert Modelle nicht neu: unveränderte Modelle sind Quelle mit LF und `COMPACT`. Damit gilt Entscheidung D: Original-Bytes behalten, kein Neuschreiben nötig, solange nichts verändert wird. (2) `.transpilerignore`: Datei hat CRLF; Muster ohne Platzhalter und `/` gelten **nur ab Modulwurzel** (`data` ignoriert nicht `.liquibase/*/data/`). (3) Eingebaute Vorgabe-Liste für jedes Modul (README, CHANGELOG, `.aditoprj`, `.idea`, `package.json`, `jsconfig.json` ...), sonst kämen Wurzeldateien aus Modulen ohne eigene Liste in die Ausgabe. (4) Aus Modulen kommen auch `doc/`, `tools/`, `cypress/`, `.liquibase/`. (5) **Offen:** V2 ersetzt absolute Pfade in `system`-Modellen (`serverConfigPath`: `D:\AditoProjects\Hermes\others\...` wird `$PROJECTHOME/others/...`). Regel noch nicht geklärt. (6) `publish-10741.ps1` (1 Datei) weicht ab, Ursache offen.
- **Zeiten P1 (Hermes, 1 Lauf, Virenscanner aktiv):** entdecken 73 ms, Overlay 0,86 s, planen 0,18 s, **dist schreiben 2,8 s** (5688 Dateien, parallel), gesamt 3,9 s. Zweiter Lauf, nichts geändert: schreiben 0,46 s (nur Vergleichen), gesamt 1,6 s. Zum Vergleich V2 offiziell 32,5 s. Ohne `dist` (Vorgabe) entfällt der Schreibanteil.
- **P2 Stand** (2026-11-16, Hermes): **4832 von 5314 Dateien (90,9 %) byte-gleich** (DoD P2 war ≥ 90 %). Neu belegte Regeln: (1) Verweis `%aditoprj%/<pfad>` im Element wird durch den Dateiinhalt ersetzt (Pfad ab Modulwurzel des Modells). (2) Inhalt mit LF, XML-maskiert (`&`, `<`, `>`), `export ` am Zeilenanfang entfernt. Das allein brachte +326 Dateien (`process`: 159 auf 485 gleich). (3) Für `icon`, `iconInactive`, `imageData`, `reportData` wird die Datei als Base64 eingesetzt (alle 11 `report`-Modelle gleich). (4) UTF-8-BOM wird entfernt (12 Modelle). (5) `<x></x>` wird `<x />`, auch in unveränderten Modellen. (6) **V2 formatiert ein Modell neu, wenn es nicht schön formatiert ist** (Beispiel `VendiraSalesFolderAreaArticles_entity`: eine Zeile `<entityProvider><name>..</name></entityProvider>` wird eingerückt). Für den Rest braucht es einen Baum und Writer (P3, gemeinsam mit den Modifikationen). 6 Modelle betroffen.
- **Rest nach P2 (473 Dateien anders):** Services/`modules.loadService` und Imports (P4), Erweiterungspunkte und Modifikationen (`neonViewExtensionPoint` gegen `neonViewReference`, `entityConsumerExtensionPoint`, P3), Alias-Zusammenführung (`<alias>Currency_Data_alias</alias>` gegen `Data_alias`, P3), Sprachdateien (P3).
- **P3 Stand** (2026-11-16, Hermes): **5106 von 5314 Dateien (96,1 %) byte-gleich**, nichts zu viel (nur `.index`, 5 Dateien, fehlt). Entscheidung D2 (eigener Baum) umgesetzt: `model/` (Arena, Parser, V2-Writer). **Der Writer schreibt alle 2996 Modelle des V2-Orakels byte-gleich zurück** (Selbsttest `roundtrip_oracle`): damit sind die V2-Schreibregeln belegt. Belegte Regeln aus P3: (1) Neue Listeneinträge einer Modifikation kommen ans Ende, in Modifikations-Reihenfolge (`neonContext/references` mischt `neonViewReference` und `webserviceReference`). Die Schema-Reihenfolge gilt nur für neue Eigenschaften und fehlende Behälter. (2) Erweiterungspunkte werden durch ihre `<implementations>` ersetzt, ohne Implementierungen entfallen sie (+83 Dateien). (3) Alias-Zusammenführung wie V1 (Ziel zuerst, Beitragende nach Name sortiert, Verweise umbenannt) passt: `aliasDefinition` 19 von 21 gleich. (4) Sprachen und Preferences je ein Objekt (V1-Regel passt, `language` 4 von 6, `preferences` 1 von 1). (5) Modifikations-Reihenfolge der alten Engine (Projekt zuletzt außer INSERT, dann `position`, dann Dateiname) liefert am V2-Orakel dieselben Ergebnisse für alle `modification`-Fälle ohne Konflikt-Abweichung (noch nicht gegen Konflikte geprüft).
- **Rest nach P3 (208 Dateien anders):** Services und Imports (`modules.loadService`, zusammengeführte `import {…}`, Reihenfolge der `*_impl`) rund 160 Dateien (P4). `userhelp` 14 Dateien: V2 wandelt AsciiDoc in HTML um (`&lt;div class="sect1"&gt;`); dafür bräuchte es einen AsciiDoc-Renderer, ungeklärt. `neonView` 2 Dateien (`autoNewRow` gegen `entityField`: Reihenfolge neuer Eigenschaften), `language` 2, `aliasDefinition` 2, `entityWebservice` 1, `publish-10741.ps1` 1.
- **Zeiten P3 (Hermes, ohne dist):** entdecken 80 ms, Overlay 1,1 s, planen 0,56 s (alle Modelle parallel: lesen, Baum, Modifikationen, Merge), mit `dist` schreiben (nichts geändert) 0,8 s. V2 offiziell 32,5 s.
- **P4 Stand** (2026-11-16, Hermes): **5203 von 5314 Dateien (97,9 %) byte-gleich** (DoD P4 war 99,5 %: **nicht erreicht**). Belegte Regeln aus P4: (1) Service-Aufrufe `modules.loadService("x")` werden zu `[_____GENERATED_x_<impl>, ...]`, die Implementierungen hängen als Funktionen hinten am Skript (Rümpfe um 2 Leerzeichen eingerückt), Imports der Implementierungen werden eingemischt, hinten angehängte Importe nach Modul sortiert. Port der V1-Regeln mit V2-Änderungen: nach den Importen bleibt **eine** Leerzeile (V1 fügte eine zweite ein); ein Service ohne Implementierung hängt `

` an, einer mit Funktionen die Funktionen plus `
`; schon importierte JDito-Namen werden nicht noch einmal importiert; Namen in einem Import werden ohne Groß/Klein sortiert (`newSelect, SqlBuilder`); `{ a, b }` mit je einem Leerzeichen. (2) **Modifikations-Reihenfolge belegt:** aufsteigend nach `position`, bei gleicher `position` nach Modul-Reihenfolge (nicht nach Dateiname). Das brachte +25 Dateien. Die Reihenfolge der `*_impl` ergibt sich daraus (nicht alphabetisch sortiert). (3) Eine MODIFY auf eine Eigenschaft, die das Modell noch nicht hat, hängt sie **ans Ende** des Elternknotens (nicht an ihre Schema-Stelle). (4) `export ` fällt auch hinter `//` weg. (5) Dateien, die kein UTF-8 sind, werden als Latin-1 gelesen und als UTF-8 geschrieben. (6) Alle Tabellen eines zusammengeführten Alias werden zusammen nach Name sortiert (`_` vor Buchstaben, ohne Groß/Klein). Verworfen: leere Datei-Eigenschaften nach Modifikationen entfernen (V1-Regel, verschlechterte V2 um 4 Dateien).
- **Rest nach P4 (102 anders, 9 fehlen):** `userhelp` 14 (AsciiDoc zu HTML), `entity` 46, `process` 30, `neonView` 6, `language` 2, `aliasDefinition` 2, `serviceDefinition` 2, `publish-10741.ps1` 1. Dazu fehlen 4 Skriptdateien, die V2 als eigene Datei lässt (`entity/…/valueProcess.js` 2, `modification/…/externalInitFilterProcess.js`, ein `process.js`), und `.index/*` (5, V2-eigen). Die `entity`- und `process`-Reste sind lange Schwänze mit je 1–3 gleichartigen Fällen (Reihenfolge neuer Eigenschaften, Importe in Sonderfällen, Felder in zusammengeführten Alias-Tabellen).
- **Zeiten P4 (Hermes, ohne dist):** entdecken 80 ms, Overlay 1,0 s, planen 0,59 s (inklusive Services), mit dist schreiben (nichts geändert) 0,8 s, gesamt 2,6 s. V2 offiziell 32,5 s.
- **P5 Stand** (2026-11-16, Deploy aus dem Speicher; nur offline geprüft): (1) `plugin-api::BuildArtifact` (Ordner, Name, Bytes) und `ArtifactStore` (letzter Satz im Speicher) als neutrale Brücke. (2) `crates/deploy/src/artifact_deploy.rs`: `local_models` (Artefakte zu Deploy-Modellen, mit `KIND` und `TITLE`), `plan_artifacts` (nur Lesen), `execute_artifacts` (Schreiben, nur mit `confirmed`, eine Transaktion, gebündelte Upserts), `compare_with_remote` (nur Lesen: MD5 je Zeile gegen die Artefakte). (3) Plugin-Befehle `deploy_plan_build`, `deploy_execute_build`, `deploy_check_format`, `deploy_build_info` (kein neuer Tauri-Befehl). (4) `USER_NEW`/`USER_EDIT` und Deploy-Zeile tragen den **Windows-Benutzer** (`execute_models`, `batched_system_statements_as`); der alte Weg über `dist` bleibt unverändert. (5) `MODEL_KINDS` ergänzt um `entityWebservice` 10250 und `rendererDefinition` 10267. `userhelp` (10217) bleibt draußen, bis AsciiDoc zu HTML geht (14 Dateien), sonst würde ein Deploy die HTML-Seiten des Systems durch AsciiDoc ersetzen. (6) **Komprimierung:** `sqlx` kann beim MySQL-Protokoll nicht komprimieren, deshalb komprimiert jetzt der **SSH-Tunnel** (`zlib@openssh.com`, dann `zlib`, sonst `none`; `ssh_session.rs`). Alle Datenbank-Daten laufen dort durch, auch das Deploy. Ob der Server es wirklich aushandelt, ist noch ungemessen. (7) Nur geänderte Zeilen gehen hoch (MD5-Abgleich der Datenbank), gebündelt je 150 Zeilen oder 4 MB.
- **P5 ungeprüft (wichtig):** Die Annahme "XMLDATA = Artefakt-Bytes unverändert" (V2-Format) ist **nicht am System belegt**. Das MariaDB-Werkzeug zu Hermes dev1 meldete `Connection closed` (Tunnel/Anmeldung), darum gibt es keinen Vergleich. Der alte Encoder (`deploy_encode`) bildet V1 nach (CRLF in Skripten) und ist für V2 vermutlich falsch. Vor dem ersten Schreiben auf einem System: `deploy_check_format` laufen lassen, das muss `different = []` zeigen. Messungen M7 (Deploy-Zeiten über den Tunnel, Ziel 1 Artefakt ≤ 2 s) fehlen deshalb ebenfalls.
- **P6 Stand** (2026-11-16, Hermes-Kopie, Stufe 1 des Cache): Das Overlay läuft jetzt parallel je Modul (1,0 s auf 0,45 s). Der Cache (`cache.rs`) ist **eine Datei** (5 MB statt 163 MB, lz4) und hängt am Fingerabdruck aus Modulliste, Dateiliste mit Größe und Änderungszeit, Engine-Stand und Format. Messung (`examples/cache_check`): Vollbau ohne Cache **1,0 s** (V2 offiziell 32,5 s), Lauf mit Cache und ohne Änderung **0,40 s** (Laden 18 ms, der Rest ist das Lesen der Dateiliste), Cache-Datei nach Änderung neu gebaut. **50 geänderte Skripte:** Ergebnis gleich einem frischen Bau ohne Cache (Prüfsumme über alle 5305 Dateien), Treffer danach wieder. Zurückgesetzte Dateien: Fehlschlag wegen neuer Änderungszeit, Ergebnis gleich der Referenz. Racy-Schutz: Wurde eine Eingabe in den letzten 3 s geändert, wird nicht gespeichert. Ziel "ohne Änderung ≤ 1 s" erreicht. **Offen aus P6:** Stufe 2 (Eingabe-Hash je Artefakt, dann nur geänderte Modelle neu bauen) und Stufe 3 (Rückwärts-Index Datei zu Artefakt). Sie lohnen sich erst, wenn der Vollbau mit 1 s zu langsam ist; er ist schon unter dem Ziel von "1 Skript geändert ≤ 1,5 s".
- **P7 Stand** (2026-11-16, an die App angeschlossen, nur in Tests geprüft, nicht in der laufenden App): (1) `plugin-api::TranspileOutcome` trägt jetzt `artifacts: Option<Arc<Vec<BuildArtifact>>>` (Entscheidung C2); `TranspileOutcome::new(dir)` für Engines ohne Artefakte. `output_dir` blieb ein `PathBuf` (bei der neuen Engine der Ort, an den `dist` ginge). (2) `project::transpile_action::DitoTranspiler` (Id `dito-v2`, Name "Dito Transpiler V2") in der Registry der App; Optionen: `write_dist=true` schreibt `dist`, sonst bleibt alles im Speicher. (3) Fortschritt: `Builder::build_with_progress` meldet 2/10/30/40/85/100 % mit Stufe an `Progress::Stage`; das Build-Log zeigt eine Zusammenfassung (Zahl, Zeit, Cache oder gebaut) und bis zu 200 Warnungen (Konflikte, nicht angewendete Modifikationen), Hinweise vom Typ Info nicht. (4) Abbruch: `cancel()` setzt das `CancelToken`; geprüft wird zwischen den Schritten, nicht mitten im Planen (ein Lauf dauert ca. 1 s). (5) Deploy: `set_artifact_sink` legt die Modelle des letzten Laufs in den `ArtifactStore` des Deploy-Plugins (`set_shared`, ohne Kopie). (6) Auswahl: Engine-Param `dito-v2`; UI: dritte Wahl "Dito Transpiler V2" im Auswahlfeld und in den Optionen, dazu der Schalter "dist schreiben" (gemerkt in `designer.conf`, `[transpile] writeDist`, Vorgabe aus). **Bewusst nicht automatisch:** Die Auswahl folgt nicht `.aditoprj/transpile.version`, die Datei wird nur gelesen (`project_transpile_version`). Die offizielle Engine bleibt die Vorgabe, bis das Crate die 99,5 % erreicht und das Deploy-Format am System belegt ist. Tests: `project` 204, `plugin-api` 29, `deploy` 27, `dito-transpiler` 26, UI-Einstellungen 6, Workspace baut.
- Offen (alt): Orakel-Lauf mit 1.1.4 ist nicht reproduzierbar (nur 1.1.6/1.2.2 installiert). Neuen Orakel-Stand erzeugen, sobald Hermes (oder ein anderes Projekt) wieder durchläuft.

### Entschieden (Lion, 2026-11-16)
1. Transpiler **built-in** im Designer. Zusätzlich ein eigenständiges Programm (Bin im Crate, Ablage im Designer-Installationsordner), falls leicht machbar. Kein Muss.
2. Schnitt und Name: wie empfohlen (ein Crate, neutraler Name, Formate als Module).
3. Datenbank: **nur MariaDB** (ADITO läuft nur darauf). Upload **komprimiert** (Protokoll-Kompression der Verbindung, und/oder komprimierte Nutzdaten, wo die Spalte es zulässt; in P0 messen).
4. `dist` schreiben: Schalter, **Vorgabe aus**, Zustand wird in `designer.conf` gemerkt.
5. `USER_NEW`/`USER_EDIT`: **Windows-Benutzer** wie V2.
6. Neue Bibliotheken: alle erlaubt (`rayon`, Hash, `zstd`/`lz4`, `ignore`, `indexmap` ...).
7. Hermes **dev1** hat einen V2-Stand: dort prüfen wir "V2-`.aod` == XMLDATA".
8. IT: Dev Drive/Ausnahmen gibt es bei Lion, bei vielen Kollegen **nicht** und sie können es nicht einrichten. Folge: Standard muss ohne Systemänderung schnell sein (wenig Dateien, ein Container, nur Änderungen schreiben).
9. Speicher-Budget: Ziel **≤ 2 GB** pro Build (Laptops 16–64 GB), je weniger desto besser.
10. Konflikte: **deterministisch nach Modul-Reihenfolge plus deutliche Warnung**.
11. Orakel: offen. Vorgabe: Tool-Version 1.1.4 festhalten, bei Updates Diff-Bericht.
12. `TranspileOutcome` (C2): offen. Vorgabe: erweitern wie in Entscheidung C beschrieben.

Nächster Schritt: P0 (Messungen, Crate-Gerüst, Orakel-Aufbau mit dev1).

## Betroffene Dateien
Neu: `crates/<name>/` mit `Cargo.toml`, `CLAUDE.md`, `src/{lib,api,discover,ignore,overlay,graph,progress,cancel}.rs`, `model/{tree,parse}.rs`, `merge/{modifications,extension_points,dedupe,alias,language,preferences}.rs`, `scripts/{linked,services,imports,normalize}.rs`, `format/{mod,v2}.rs`, `cache/{container,fingerprint}.rs`, `sink/dist.rs`, `examples/{v2_vs_oracle,classify,timing,av_bench}.rs`.
Ändern: `crates/plugin-api/src/transpiler.rs`, `crates/project/src/transpile_action.rs`, `app/src-tauri/src/lib.rs`, `app/src-tauri/Cargo.toml`, `crates/deploy/src/{deploy_encode,system_deploy,plugin}.rs`, `crates/native-transpiler/src/compare.rs`, Karten (`crates/CLAUDE.md`, Root-`CLAUDE.md`), Deploy-UI über `core/plugins/registry.ts`.
Nur lesen/portieren: `crates/native-transpiler/src/own_engine/*`, `AditoTunnelManager/HillsIT.Transpiler/{Merge/*, Pipeline/{ServiceCallResolver,FinalBuildAssembler,LinkedFieldTagIndex}.cs, Delta/*}`.
Orakel/Messdaten: `C:\Adito\Projects\{dist_TranspilerV2 (inkl. .index), dist_TranspilerV1, dist_DitoDesigner, hermesarzneitmittel-dev}`.
