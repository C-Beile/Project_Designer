# Umsetzungsplan: Projekt-Index + File-Watcher, danach Umbau `aod::references`

Kennzeichnung: **[Belegt]** = im Code gesehen (Datei:Zeile). **[Einschätzung]** = meine Bewertung, noch nicht gemessen oder geprüft.

---

## A. Ist-Stand (kurz) und falsche Karten-Angaben

### A1. Ist-Stand mit Fundstellen

**Änderungen von außen erkennen (heute: Polling)**
- [Belegt] `app/ui/src/shell/hooks/useExternalChanges.ts:74` fragt alle 3 s ab. `:75` fragt zusätzlich beim Fokus-Gewinn. `:35` bricht ab, wenn das Fenster keinen Fokus hat. Heute gibt es also **kein Reload ohne Fokus**.
- [Belegt] `:40` ruft `api.projectChanged(p)`. Bei einer Änderung erhöht `:41-42` `reloadToken` (der Baum wird neu gelesen) und `scanTick` (der Problem-Scan läuft neu).
- [Belegt] `app/src-tauri/src/commands/project.rs:116-130`: `ProjectFingerprints` und `project_changed` gehen bei jedem Aufruf jede Datei mit `stat` durch (`crates/project/src/watch.rs:31-58`).
- [Belegt] Offene Tabs prüft der Actor über Stempel: `project_actor.rs:354-364` (`ExternalChanges`). Beim Speichern meldet er einen Konflikt (`:342`) und setzt danach den Stempel neu (`:349`). Ein eigenes Speichern löst darum heute schon keinen Tab-Reload aus.

**Watcher in `platform`**
- [Belegt] `crates/platform/src/watcher.rs`: `FileWatcher::watch(root)`. `WatchEventKind` kennt nur `Created`, `Modified`, `Removed`, `Other`. Es gibt keine Art `Rescan`.
- [Belegt] `platform/src/windows/watcher.rs:44-51` verwirft `Err`-Ergebnisse von notify ohne Meldung. Die Datei gilt auch für macOS/Linux (`unix/mod.rs:13-14`).
- [Belegt] Niemand nutzt den Watcher heute. Er erscheint nur in der eigenen Datei und in den `pub use`-Zeilen (`windows/mod.rs:18`, `unix/mod.rs:21`, `lib.rs:58`). Die Kommentare `watcher.rs:1-4` verweisen auf eine Crate `index`, die es nicht gibt.
- [Belegt] notify 6.1.1, `src/windows.rs:39`: Puffer 16 KB. `:313-317`: der Parameter `_bytes_written` wird nie gelesen. Läuft der Puffer über, liefert Windows 0 Bytes. notify liest dann einen frischen, leeren Puffer (`:261`). Dort ist `Action` = 0, und `:399 _ => ()` verwirft den Eintrag. **Ein Überlauf geht also völlig still verloren.**
- [Belegt, Web] notify 8.2.0 ist hier nicht besser. `_bytes_written` bleibt ungenutzt, und bei unbekannten Fehlern wird das Verzeichnis still abgemeldet. Ein Update löst die Lücke also nicht.

**Schreiben von Dateien**
- [Belegt] `platform/src/fs.rs:40-56` `atomic_write`: schreibt in eine Temp-Datei `.{name}.{pid}.{n}.tmp` (`:33`) und benennt sie dann um. Der Backup-Hook ist ein `OnceLock<fn>` (`:24-28`), es ist also nur **ein** Hook möglich.
- [Belegt] Diese Wege nutzen `atomic_write`: Objekt speichern (`designer-core/src/project.rs:210`), `linked_file.rs:34`, `modification_write.rs:468`, `content_search.rs:150`.
- [Belegt] Diese Wege schreiben direkt mit `std::fs`, **ohne** `atomic_write`: `rename.rs:184-201`, `new_object.rs:191-196`, `tree_ops.rs:72-95`, `file_ops.rs:83-129`, `project_zip.rs:232`.
- [Belegt] Transpile schreibt Build-Ordner **in den Projektordner**: `app-base/src/backup.rs:45` (`dist`, `_own_engine_dist`, `_forge_experimental_dist`, `transpile-cache`, `transpile-snapshot`, `.forge-incremental-cache`). Deine Ignore-Liste in Vorgabe 1 nennt nur `dist`.
- [Belegt] Es gibt drei verschiedene Ignore-Listen: `watch.rs:25`, `file_list.rs:5` (mit `.idea`, `.vscode`, `.aditoprj`) und `rename.rs:60` (mit `.aditoprj`, `.liquibase`, `modification`, `data`).

**Verweise und Probleme**
- [Belegt] `aod/src/refs`: `RefGraph` (`graph.rs:36-44`) hält `outgoing`/`incoming` als `HashMap<ObjectId, Vec<Edge>>` und eine Alias-Map.
  - `index()` klont die Alias-Map bei jedem Aufruf (`:78`).
  - `remove_outgoing` macht für jede Kante ein `retain` über die eingehende Liste (`:86-94`).
  - Der Kommentar `extract.rs:23-27` sagt, eine Alias-Kante "erscheint wieder, sobald der Alias indiziert ist". Dafür gibt es keinen Mechanismus: `index_alias` (`graph.rs:62-67`) indiziert die abhängigen Objekte nicht neu. **Der Kommentar ist falsch.**
- [Belegt] `ObjectKind` (`object_id.rs:13-21`) kennt nur Entity, View, Alias, Webservice, LinkedFile. Für Context, Dashboard, Process usw. gibt es keine Absender-Art.
- [Belegt] `project/src/problems.rs:199` und `:276`: Absender ist immer `ObjectKind::Entity`, auch bei Views und Contexts.
- [Belegt] `problems.rs:200` und `:277`: `&|_| None` löst Alias-Verweise nie auf. Dazu überspringt `:209` die Alias-Art. Fehlende Aliase meldet die App also nie.
- [Belegt] `scan_usages` (`problems.rs:256-308`) läuft der Reihe nach. Es liest jede Datei zweimal: `std::fs::read` (`:271`) und dann `designer_core::open_project` (`:272`), das die Datei erneut liest (`designer-core/src/project.rs:101`). `scan_project` liest ebenfalls doppelt (`:162` + `:170`), läuft aber parallel (`:158`).
- [Belegt] Der Zeilen/Spalten-Code steht dreimal fast gleich da: `problems.rs:186-191`, `:218-223`, `:294-299`.
- [Einschätzung, Verdacht] `open_project` schneidet das BOM ab (`designer-core/src/project.rs:102-104`). `problems.rs` rechnet `line_col` aber auf den Bytes **mit** BOM. Bei Dateien mit BOM könnten Spalten um bis zu 3 verschoben sein. In P6 mit einem Test prüfen.
- [Belegt] `rename.rs:95-133` `plan`: die Änderungen kommen aus `scan_usages` (strukturiert). Die Zusatz-Treffer kommen aus einer Textsuche über alle `.js`/`.aod` (`:107-131`). "Heute Textsuche" stimmt also nur für den Teil "hits".
- [Belegt] `problems.rs:141-155` nutzt `OBJECT_FOLDERS` (11 Ordner, `tree.rs:26-38`). Der Baum nutzt `SCANNED_FOLDERS` (16 Ordner, `tree.rs:65-82`).
- [Belegt] `problems.rs:89-125` prüft, ob ein Ziel existiert, über **alle** Ordner in `node_modules`. Der Baum nutzt dagegen `npm_modules::resolve_lenient` (`tree.rs:233`). Das sind zwei verschiedene Mengen von Modulen.

**Parallel, Log, Events, UI**
- [Belegt] `project/src/parallel.rs:14-38` `parallel_map`: keine Abbruch-Möglichkeit, Ergebnisse in der Reihenfolge der Eingabe. Genutzt in `tree.rs:380`, `:421`, `:595`, `problems.rs:158`, `content_search.rs:118`.
- [Belegt] Das "IDE-Log" ist `app_base::crashlog::write_entry(kind, msg)` (`crashlog.rs:92-107`). Es schreibt in `dito-designer-YYYY-MM-DD.log`, maskiert vorher mit `scrub` (`:98`) und ruft den Listener auf. Der Listener sendet `forge://log-entry` (`app/src-tauri/src/lib.rs:144-148`). Die UI zeigt das im Output-Reiter "IDE Log" (`useOutputLogs.ts:33-44`): `WARN` wird gelb, `ERROR`/`PANIC` rot, alles andere normal. `areaOf` (`:10-16`) bestimmt den Bereich.
- [Belegt] `write_entry` öffnet die Datei bei **jedem** Eintrag neu und schreibt jedes Mal eine Kopfzeile mit Version (`:97-99`). Darum keine Einträge pro Datei schreiben.
- [Belegt] `EventSink` (`plugin-api/src/feature.rs:26-28`). `TauriEvents` ist privat in `lib.rs:54-61`. `app.emit` sendet an alle Fenster.
- [Belegt] Statusleiste: `StatusBar.tsx:116-130` hat linke und rechte Register-Plätze (`useStatusBarItems`). `task` ist nur ein laufender Streifen ohne Prozent, nur für Transpile (`Shell.tsx:521`). `ProgressBar` mit `percent` gibt es schon (`core/ui/ProgressBar.tsx`).
- [Belegt] UI-Namenskonflikt: `app/ui/src/editors/projectIndex.ts` (`ProjectIndexContext`) gibt es schon und meint etwas anderes. Neue UI-Namen müssen sich davon klar abheben.
- [Belegt] `open_project` (`commands/project.rs:21-33`) läuft bei **jedem** `reloadToken` erneut (`useProjects.ts:61-79`). Auch das Git-Plugin löst Reloads aus (`ShellExtensionContext.setReloadToken`, `registry.ts:104`).
- [Belegt] Der Workspace nimmt `crates/*` per Platzhalter auf (`Cargo.toml:11`). Neue Crates brauchen **keinen** Eintrag in der Root-`Cargo.toml`.

### A2. Falsche oder veraltete Karten-Angaben
1. `crates/aod/CLAUDE.md:29` und `:37`: "refs niemand" / "`refs` wird heute von keiner anderen Crate benutzt". **Falsch.** `project/src/problems.rs:11-12` nutzt `extract_edges`, `ObjectId` und `ObjectKind`. Der Modul-Kommentar `aod/src/refs/mod.rs:13-14` sagt es selbst richtig.
2. `crates/project/CLAUDE.md`: `src/content_search.rs` fehlt in der Tabelle. Die Datei gibt es, und sie wird genutzt (`commands/project.rs:216-229`). Außerdem nennt `parallel.rs` nur "Baum- und Problem-Scan"; die Suche nutzt es auch.
3. `app/src-tauri/CLAUDE.md`, Befehlstabelle unvollständig:
   - `project.rs` ohne `get_recent_projects`, `search_in_projects`, `replace_in_projects`, `find_projects_in_folder`
   - `misc.rs` ohne `set_log_timezone`
   - `dialogs.rs` ohne `pick_project_folders`
   - `os_windows.rs` ohne `window_show`
   - Unter "Tests" steht "Keine eigenen Tests", aber `commands/mod.rs:112-140` hat `guard_tests`.
4. `app/ui/src/shell/hooks/CLAUDE.md`, Liste der `listenBackend`-Nutzer: `forge://log-entry` (`useOutputLogs.ts:35`) fehlt.
5. `aod/src/refs/extract.rs:23-27` (Code-Kommentar, keine Karte): Die Aussage "Kante erscheint wieder" ist falsch (siehe A1).
6. Root-`CLAUDE.md`, "Umbau ... nicht committet": Der Git-Status ist sauber, und es gibt neuere Commits (1.0.6 bis 1.0.8). [Einschätzung] Der Satz ist wahrscheinlich veraltet. Bitte prüfen.
7. [Einschätzung] Der Text von `crates/plugin-api/CLAUDE.md` zeigte keine `AUTO:START`-Marke. Mit `check-maps.ps1` prüfen.

---

## B. Zielarchitektur

### B1. Crates und Abhängigkeiten

```
platform  (+ Rescan, + Register eigener Schreibvorgänge, + FileStamp)
   ^
app-base  (+ parallel.rs hierher verschoben, BUILD_FOLDERS öffentlich)
   ^
file-watcher  (neu)  -> platform, app-base, serde
   ^
project-index (neu)  -> aod, designer-core, validators, platform, app-base, plugin-api, file-watcher, serde, serde_json, quick-xml
   ^
project              -> + project-index
   ^
designer-app (Tauri) -> + project-index
```

Es entsteht kein Kreis. Die Begründung:
- `validators` hängt an `designer-core`, `aod` und `plugin-api` (`crates/CLAUDE.md:12`). Keiner davon kennt `project`.
- `project-index` darf **nicht** von `project` abhängen. Darum ziehen diese Teile aus `project` nach `project-index`, und `project` re-exportiert sie (die Aufrufer bleiben unverändert):
  - `OBJECT_FOLDERS` und `SCANNED_FOLDERS` (aus `tree.rs`)
  - die Datei-Analyse (`xml_error`, `line_col`, Validator-Lauf, Verweise lesen)
  - `ProblemDto` und `UsageDto`

**Kritischer Punkt zu Vorgabe 1:** Der File-Watcher soll laut Vorgabe `plugin-api::EventSink` kennen. Ich empfehle das nicht. Der Watcher liefert seine Pakete (Batches) über einen Callback (in C#: ein `Action<Batch>`-Delegate). **Nur der Index sendet Events.** Gründe:
- `forge://project-changed` braucht `affected`, und das kennt nur der Index.
- So gibt es genau einen Absender.

Wenn du es doch willst, kostet das nur eine Zeile in `Cargo.toml`.

### B2. Module je Crate

**`crates/platform`** (geändert)

| Datei | Änderung |
|---|---|
| `src/fs.rs` | `FileStamp` und `file_stamp()` ziehen aus `project/src/watch.rs` hierher. Neu `path_key()`: Pfad als Schlüssel normalisieren (Windows: Kleinschreibung, `\` statt `/`). Neu: Register eigener Schreibvorgänge (`atomic_write` trägt nach dem Umbenennen ein). Dazu `note_own_change()` und `take_own_write()`. |
| `src/watcher.rs` | `WatchEventKind::Rescan`. `WatchTarget { path, recursive }`. `FileWatcher::watch_targets`. `WatchHandle::add/remove`. |
| `src/windows/watcher.rs` | `Err(_)` von notify wird zu `Rescan` (Pfad = Wurzel). Ebenso `event.need_rescan()` (macOS FSEvents setzt das wirklich). Mehrere Watch-Ziele auf einem notify-Watcher. Den Watcher in einen `Mutex` legen, damit `add` und `remove` gehen. |

**`crates/file-watcher`** (neu)

| Datei | Verantwortung |
|---|---|
| `Cargo.toml` | `platform`, `app-base`, `serde` |
| `src/lib.rs` | Re-Exports |
| `src/ignore.rs` | `IgnoreRules::standard()`. Ignoriert: `node_modules`, `.git` (außer `HEAD`/`ORIG_HEAD`), `target`, `.claude`, `app_base::backup::BUILD_FOLDERS` (enthält `dist`), `*.tmp` (Temp-Dateien von `atomic_write`). Eine Liste für alle. Eigene Filter für Schnellsuche und Rename (`.idea`, `.vscode`, `.aditoprj` ...) bleiben in der Abfrage, nicht hier. |
| `src/batcher.rs` | Reine Logik ohne Threads und ohne Dateisystem. Uhrzeit (`Instant`) und die Prüfung "eigener Schreibvorgang?" werden hineingegeben. Ruhezeit 400 ms, Max-Wartezeit 2 s, Flut-Schwelle >200, `.git/HEAD` ergibt Flut, Verdacht auf Überlauf (>=64 rohe Events, siehe H) ergibt `verify_after`, npm-Auslöser. |
| `src/watch_set.rs` | Welche Ordner beobachtet werden (siehe Entscheidung D1). Neuer Ordner in der obersten Ebene: Watch dazunehmen. |
| `src/session.rs` | `WatchSession`: ein Thread, der `recv_timeout(deadline)` mit dem Batcher verbindet und den Callback aufruft. `Drop` beendet alles (in C#: `IDisposable`). |

**`crates/project-index`** (neu)

| Datei | Verantwortung |
|---|---|
| `src/lib.rs` | Re-Exports |
| `src/layout.rs` | `OBJECT_FOLDERS`, `SCANNED_FOLDERS` (aus `tree.rs` verschoben). `object_of(rel_path) -> Option<(type, name)>`. |
| `src/model.rs` | `ProjectIndex`, `FileEntry`, `ObjectEntry`, `ModuleState`, `FileKey` |
| `src/text_pos.rs` | `line_col`, `span_line_col` (die drei Kopien werden eine) |
| `src/analyze.rs` | `analyze_file`: Datei **einmal** lesen, `xml_error`, parsen, Validatoren, Verweise mit Zeile/Spalte. `ProblemDto`/`UsageDto` ziehen hierher. |
| `src/references.rs` | `ReferenceIndex` (vorwärts/rückwärts, Alias erst bei der Abfrage auflösen) |
| `src/modules.rs` | Modul-Stand: Stempel von `package.json`, `package-lock.json`, `node_modules/.package-lock.json`; Namen der Modul-Objekte je Ordner; `targetAliasName` der Modul-Aliase |
| `src/build.rs` | Voller Aufbau in Phasen, `parallel_map`, Abbruch, Fortschritt |
| `src/update.rs` | `apply_paths` (Batch einspielen), `reconcile` (Stempel-Abgleich), `affected` berechnen |
| `src/query.rs` | Lese-API: Probleme, Usages, Dateien, Objekte |
| `src/progress.rs` | `ProgressSink`-Trait, Drosselung (Uhr wird hineingegeben) |
| `src/events.rs` | Event-Namen und Payloads (serde, camelCase) |
| `src/log.rs` | `IndexLog`-Trait. Die echte Umsetzung schreibt per `crashlog::write_entry`. Warnungen gedeckelt. |
| `src/service.rs` | `IndexRegistry`, `ProjectIndexHandle`, Worker-Thread, Nachrichten-Schleife, Generation, Begrenzung der Aufbauten |
| `tests/*.rs` | Integration (Temp-Ordner, Fake-EventSink, Fake-Watcher) |

**`crates/project`** (geändert)
- `tree.rs`: `pub use project_index::layout::{OBJECT_FOLDERS, ...}`
- `parallel.rs`: `pub use app_base::parallel::*`
- `problems.rs`: in P5 erst zweigleisig (Index oder alter Scan), dann schlanker.
- `watch.rs`: `project_fingerprint` fällt weg, `file_stamp` wird re-exportiert.

### B3. Öffentliche API (Signaturen als Text)

**platform**
```
pub struct FileStamp { pub len: u64, pub modified_ms: u128 }
pub fn file_stamp(path: &Path) -> Option<FileStamp>
pub fn path_key(path: &Path) -> String
pub fn note_own_change(path: &Path)                      // für std::fs-Schreiber, gilt ca. 5 s
pub fn take_own_write(path: &Path, now: Option<FileStamp>) -> bool   // verbraucht den Eintrag
pub enum WatchEventKind { Created, Modified, Removed, Other, Rescan }
pub struct WatchTarget { pub path: PathBuf, pub recursive: bool }
trait FileWatcher { fn watch(&self, root) -> ...;  fn watch_targets(&self, &[WatchTarget]) -> Result<WatchHandle, PlatformError> }
impl WatchHandle { pub fn add(&self, &WatchTarget) -> Result<(), PlatformError>; pub fn remove(&self, &Path) -> Result<(), PlatformError> }
```

**file-watcher**
```
pub struct WatchConfig { quiet: Duration(400ms), max_wait: Duration(2s), flood_threshold: usize(200),
                         suspect_overflow: usize(64), npm_quiet: Duration(3s), ignore: IgnoreRules }
pub struct Batch { pub root: PathBuf, pub paths: Vec<TouchedPath>, pub kind: BatchKind,
                   pub modules_changed: bool, pub raw_events: usize, pub verify_after: bool }
pub struct TouchedPath { pub path: PathBuf, pub own: bool }
pub enum BatchKind { Normal, Flood(FloodReason), Rescan(RescanReason) }
pub enum FloodReason { TooManyEvents(usize), GitHead }
pub enum RescanReason { OsReported, WatcherError, SuspectedOverflow, WatchRootGone }
impl Batcher { fn new(root, cfg, own: Box<dyn Fn(&Path)->bool + Send>); fn push(&mut self, WatchEvent, Instant);
               fn poll(&mut self, Instant) -> Option<Batch>; fn deadline(&self) -> Option<Instant> }
impl WatchSession { fn start(root: &Path, watcher: Arc<dyn FileWatcher>, cfg: WatchConfig,
                             on_batch: impl Fn(Batch) + Send + 'static) -> Result<Self, PlatformError> }
```

Wichtig: Ein Batch sagt nur, **welche Pfade berührt wurden**. Was wirklich passiert ist (neu, geändert, gelöscht), entscheidet der Index beim Einspielen per `stat`. Grund: Windows meldet Umbenennungen als `From`/`To`, und bei Ordnern kommt oft nur das Event des Ordners selbst. Ein Pfad, der jetzt ein Ordner ist oder unter dem der Index Einträge hat, wird als ganzer Teilbaum abgeglichen.

**project-index**
```
pub struct IndexRegistry
impl IndexRegistry {
  pub fn new(events: Arc<dyn EventSink>, log: Arc<dyn IndexLog>, watcher: Arc<dyn FileWatcher>) -> Self
  pub fn ensure_started(&self, root: &Path) -> StartOutcome     // Started | Running | Ready
  pub fn rebuild(&self, root: &Path)
  pub fn stop(&self, root: &Path)
  pub fn get(&self, root: &Path) -> Option<Arc<ProjectIndexHandle>>
}
impl ProjectIndexHandle {
  pub fn status(&self) -> IndexStatus
  pub fn verify(&self) -> Result<VerifyOutcome, String>           // Stempel-Abgleich über den Worker, wartet auf das Ergebnis
  pub fn read<R>(&self, f: impl FnOnce(&ProjectIndex) -> R) -> Option<R>   // None, solange nicht Ready
  pub fn wait_ready(&self, timeout: Duration) -> bool
}
impl ProjectIndex {
  pub fn problems(&self) -> Vec<ProblemDto>                      // statische + Verweis-Probleme
  pub fn usages(&self, object_type: &str, name: &str) -> Vec<UsageDto>
  pub fn referenced_by(&self, target: &ObjectId) -> Vec<(FileKey, &RefEntry)>
  pub fn references(&self, file: &Path) -> &[RefEntry]
  pub fn files(&self) -> impl Iterator<Item = &FileEntry>
  pub fn objects_of_type(&self, object_type: &str) -> Vec<&ObjectEntry>
  pub fn object_exists(&self, object_type: &str, name: &str) -> bool   // Projekt + Module
}
pub fn build_index(root: &Path, opts: &BuildOptions, progress: &dyn ProgressSink, cancel: &AtomicBool)
    -> Result<ProjectIndex, Cancelled>                             // rein, ohne Thread testbar
pub fn analyze_file(path: &Path, bytes: &[u8], object_type: &'static str, name: &str) -> FileAnalysis
```

### B4. Datenstrukturen

```
ProjectIndex {
  root: PathBuf, generation: u64,
  files:   HashMap<FileKey, FileEntry>          // alle nicht ignorierten Dateien (auch .js, .jrxml)
  objects: HashMap<FileKey, ObjectEntry>        // .aod in SCANNED_FOLDERS/<name>/<name>.aod
  by_name: HashMap<(&'static str, String), FileKey>
  refs:    ReferenceIndex
  static_problems: HashMap<FileKey, Vec<ProblemDto>>   // parse + validator
  modules: ModuleState
}
FileEntry   { path: PathBuf, rel: String, stamp: Option<FileStamp> }    // None = konnte nicht lesen, nächster Abgleich versucht neu
ObjectEntry { object_type: &'static str, name: String, root_tag: String, parsed: bool, alias_target_name: Option<String> }
ReferenceIndex { forward: HashMap<FileKey, Vec<RefEntry>>, reverse: HashMap<TargetKey, Vec<(FileKey, u32)>> }
RefEntry    { target: Target, kind: RefKind, site: String, line: Option<u32>, column: Option<u32> }
Target      { Object(ObjectId) | AliasShort(String) | LinkedFile(String) }
ModuleState { package_json, package_lock, hidden_lock: Option<FileStamp>,
              names_by_folder: HashMap<&'static str, HashSet<String>>, alias_targets: HashMap<String, String> }
```

**Entscheidung: Taugt `RefGraph` als Baustein? Nein, der Index bekommt eine eigene Struktur. Er nutzt aber den Leser `extract_edges`.** Gründe [Belegt + Einschätzung]:
1. Der Schlüssel muss die **Datei** sein. `RefGraph` arbeitet mit `ObjectId`, und `ObjectKind` kennt Context, Dashboard, Process usw. nicht. Mit `RefGraph` würde der Fehler "Absender ist immer Entity" in den Index wandern.
2. Alias-Verweise müssen von der Reihenfolge unabhängig sein. `RefGraph` verliert sie, wenn die Entity vor dem Alias kommt (A1). Der Index speichert stattdessen `AliasShort(text)` und löst ihn erst bei der Abfrage über `alias_targets` auf.
3. Der Index braucht Zeile/Spalte (für Find Usages ohne neues Parsen), Module (Existenz-Prüfung) und Teilbäume (Ordner umbenannt).
4. `remove_outgoing` mit `retain` wird bei beliebten Zielen langsam (O(k·m)). Der Index speichert rückwärts nur Positionen (`(FileKey, idx)`) und baut die Rückwärts-Liste je Ziel neu.
5. `rename_cascade` nutzt die App nicht. Das echte Umbenennen läuft über `rename.rs`.

Verweis-Probleme ("Ziel fehlt") sind **nicht** pro Datei fest. Löscht jemand Entity X, bekommen alle Contexts mit Verweis auf X ein Problem. Darum speichert der Index nur Parse- und Validator-Probleme pro Datei. Die Verweis-Probleme rechnet er bei der Abfrage aus (rund 100k Lookups in einer HashMap, Millisekunden [Einschätzung]). Für `affected` heißt das: Ist eine Datei neu, gelöscht oder umbenannt, dann sind alle `referenced_by` dieses Ziels betroffen.

**Event-Payloads (Rust)**
```
#[serde(rename_all = "camelCase")]
pub struct IndexProgress { project: String, generation: u64, phase: IndexPhase, done: u32, total: u32,
                           percent: Option<u8>, current_file: Option<String>, message: Option<String> }
#[serde(rename_all = "lowercase")]
pub enum IndexPhase { Queued, Listing, Reading, Linking, Ready, Cancelled, Failed }

pub struct ProjectChanged { project: String, generation: u64, reason: ChangeReason, changed: Vec<ChangedFile>,
                            truncated: bool, affected: Vec<String>, modules_changed: bool, full: bool, own_only: bool }
pub struct ChangedFile { path: String, kind: ChangeKind, own: bool, object_type: Option<String>, name: Option<String> }
pub enum ChangeKind { Added, Modified, Removed }
pub enum ChangeReason { Watcher, Git, Flood, Rescan, Focus, Modules }
pub struct IndexStatus { project, generation, phase, done, total, files: u32, objects: u32, references: u32, last_build_ms: Option<u64> }
pub struct VerifyOutcome { changed: u32, duration_ms: u64 }
```
`changed` wird bei 500 Einträgen gekappt (`truncated = true`). Bei `full` lädt die UI ohnehin alles neu.

**TypeScript (`app/ui/src/wire/types.ts`)**
```ts
export type IndexPhase = 'queued' | 'listing' | 'reading' | 'linking' | 'ready' | 'cancelled' | 'failed'
export interface IndexProgress { project: string; generation: number; phase: IndexPhase; done: number; total: number;
  percent: number | null; currentFile: string | null; message: string | null }
export type ChangeReason = 'watcher' | 'git' | 'flood' | 'rescan' | 'focus' | 'modules'
export interface ChangedFile { path: string; kind: 'added' | 'modified' | 'removed'; own: boolean; objectType: string | null; name: string | null }
export interface ProjectChanged { project: string; generation: number; reason: ChangeReason; changed: ChangedFile[];
  truncated: boolean; affected: string[]; modulesChanged: boolean; full: boolean; ownOnly: boolean }
export interface IndexStatus { project: string; generation: number; phase: IndexPhase; done: number; total: number;
  files: number; objects: number; references: number; lastBuildMs: number | null }
export interface VerifyOutcome { changed: number; durationMs: number }
```
Hinweis: Die alten DTOs sind snake_case (`TreeNode.object_type`, `ProblemDto.node_id`), `WebserviceDto` ist camelCase. Für die neuen Events schlage ich camelCase vor, wie in deinem Beispiel (`currentFile`).

### B5. Thread-Modell (mit C#-Vergleich)

- **Wer hält den Index?** Die `IndexRegistry` liegt als Tauri-State (`Arc<IndexRegistry>`). Darin steht `RwLock<HashMap<path_key, Arc<ProjectIndexHandle>>>`. Jeder Handle hält `Arc<RwLock<ProjectIndex>>`.
  - In C#: ein Singleton-Dienst mit `ConcurrentDictionary<string, ProjectIndexHandle>`.
  - `RwLock` entspricht `ReaderWriterLockSlim`.
  - `Arc` ist ein geteilter Verweis mit Zähler, wie eine Referenz auf ein Objekt, die mehrere Threads halten.
  - Der Index liegt **nicht** im Actor. Der Actor ist ein einzelner Thread mit `Rc`.
- **Wer baut?** Ein Worker-Thread pro Projekt (`forge-index-<name>`) mit einer Nachrichten-Schleife. Nachrichten: `Build`, `ApplyBatch`, `Reconcile`, `Verify(reply)`, `Stop`.
  - In C#: ein eigener `Thread` mit `BlockingCollection<Msg>`.
  - **Der Worker ist der einzige Schreiber.** Das macht die Konsistenz einfach.
- **Paralleles Lesen der Dateien:** Der Worker ruft `parallel_map` mit `io_threads()` auf (wie `Parallel.ForEach`, nur mit Ergebnissen in Eingabe-Reihenfolge).
- **Wer sendet Events?** Der Worker, über `Arc<dyn EventSink>`. Fortschritt melden die Lese-Threads über einen `ProgressSink` mit Drosselung.
- **Wie kommt Tauri an den State?** In `setup()`: `app.manage(Arc::new(IndexRegistry::new(Arc::new(TauriEvents(app.handle().clone())), Arc::new(CrashlogIndexLog), Arc::new(platform::native::NotifyFileWatcher::new()))))`. Befehle bekommen `State<'_, Arc<IndexRegistry>>`. Das Muster ist dasselbe wie bei der Feature-Registry (`lib.rs:124`).
- **Abbruch:** Ein `Arc<AtomicBool>` pro Generation (wie ein `CancellationToken`). Jedes Element in `parallel_map` prüft das Flag am Anfang und kehrt sofort zurück. `parallel_map` selbst bleibt unverändert.
- **Wie viele Aufbauten gleichzeitig?** [Empfehlung] Höchstens einer (Semaphore). Ein zweites Projekt zeigt "queued". Grund: Zwei Aufbauten hätten bis zu 64 Threads auf derselben Platte.

### B6. Sperren und Konsistenz
1. Der volle Aufbau läuft **ohne Sperre** auf einem neuen `ProjectIndex`. Am Ende gibt es einen Tausch unter Schreibsperre (Mikrosekunden).
2. Der Watcher startet **vor** dem Auflisten der Dateien. Batches, die während des Aufbaus kommen, warten in der Schleife. Nach dem Tausch werden sie eingespielt. Weil jedes Einspielen per Stempel prüft, ist es egal, ob eine Datei schon im Aufbau stand. Doppelt einspielen schadet nicht.
3. Beim Einspielen: Dateien **ohne Sperre** analysieren (bei vielen Dateien parallel), danach kurz unter Schreibsperre einfügen.
4. Regeln gegen Deadlocks: nie Events senden, während eine Sperre gehalten wird; nie den Actor aufrufen. Leser bekommen kopierte DTOs zurück.
5. Vergiftete Sperre (ein Thread ist mit Sperre abgestürzt): mit `into_inner()` weiterarbeiten und einen ERROR loggen.
6. Jede Nachricht im Worker läuft in `catch_unwind` (wie im Actor, `project_actor.rs:313`). Bei einem Panic gilt: Phase `Failed`, der alte Index bleibt, ein ERROR geht ins Log.

---

## C. Der Index-Aufbau im Detail

### C1. Phasen
| Phase | Inhalt | Prozent |
|---|---|---|
| `queued` | wartet auf die Semaphore | – |
| `listing` | Dateibaum durchgehen (IgnoreRules), `FileEntry` mit Stempel aus `DirEntry::metadata` (unter Windows billig) | ohne Prozent (laufender Streifen), zeigt die Zahl gefundener Dateien |
| `reading` | `.aod` in Objektordnern parallel: einmal lesen, `xml_error`, parsen, Validatoren, Verweise mit Zeile/Spalte, `targetAliasName`. Jedes Element in `catch_unwind`. | 5 % + 85 % × done/total |
| Module | `ModuleState` (Namen in `node_modules/*/<ordner>`, Alias-Ziele), parallel zu `reading` auf einem eigenen Thread | – |
| `linking` | `by_name`, Rückwärts-Tabelle, Zahl der ungelösten Verweise | 90–99 % |
| `ready` | Tausch, Event, PERF-Log | 100 % |

### C2. Drosselung
- Rust: höchstens ein `index-progress` alle 100 ms, dazu immer beim Wechsel der Phase und am Ende. `currentFile` ist die zuletzt fertige Datei. Gesetzt wird sie mit `try_lock`: Ist der Mutex belegt, wird übersprungen. So bremst sie die 32 Threads nicht aus.
- UI: Der Store schreibt höchstens einmal pro Animations-Frame.

### C3. Abbruch, Neustart, Reload
- **Projekt schließen** (`remove_open_project`): `registry.stop(root)`. Das Flag wird gesetzt, die `WatchSession` wird freigegeben, der Eintrag kommt aus der Registry, und `Stop` geht an den Worker. Es kommt genau ein Event `cancelled`.
- **Erneut öffnen:** neuer Handle mit `generation + 1`. Die UI ignoriert Events mit älterer Generation.
- **Reload während des Aufbaus:** `open_project` läuft bei jedem `reloadToken`. `ensure_started` tut dann nichts.
- **Reload, wenn der Index fertig ist:** `ensure_started` stößt zusätzlich einen `verify` an. So deckt jeder Reload aus der App (Git-Plugin, npm, Zip-Import, Neu, Umbenennen) die Windows-Lücke billig mit ab.
- **Explizites Neu-Aufbauen** (`index_rebuild`): alte Generation abbrechen, neu starten.

### C4. Fehler pro Datei (eine kaputte .aod blockiert nie)
- Nicht lesbar (Virenscanner, gesperrt): `stamp = None`, Problem "cannot be read", WARN. Der nächste Abgleich versucht es neu.
- Kein gültiges XML: Problem `parse` mit Zeile, wie heute.
- Panic im Parser: wird abgefangen, Problem "internal error while reading", ERROR mit Pfad.

### C5. Logging (IDE-Log)
**"IDE-Log" ist `crashlog::write_entry`:** Datei unter `%APPDATA%\de.threehillsit.dito-designer\logs` plus `forge://log-entry` in den Reiter "IDE Log". Die Maskierung mit `scrub` passiert dort automatisch.

| Stufe (kind) | Wann | Inhalt |
|---|---|---|
| `INFO` | Start, Abbruch, Git/Flut-Reload, Modul-Rescan | `index <root>: start (generation 3)`, `index <root>: Git change, 340 files re-read in 412 ms` |
| `WARN` | kaputte/unlesbare Datei | `index <root>: broken model entity/X/X.aod: <Parser-Text>`. Höchstens 20 Einträge, danach einer: `... and 37 more (see Problems tab)` |
| `ERROR` | Watcher fällt aus, Panic im Worker, vergiftete Sperre | Text mit Pfad |
| `PERF` | nach jedem vollen Aufbau und nach Batches mit mehr als 50 Dateien | `index <root>: 5012 files, 4810 models, 61234 references (812 unresolved), 3 broken; list 120 ms, read 2310 ms, link 90 ms, total 2540 ms` |

- Niemals XML-Inhalt oder Werte loggen. Aliase und Systeme können Passwörter enthalten. Nur Pfade und Parser-Meldungen loggen (die tragen nur Tag-Namen).
- `useOutputLogs.areaOf`: Nachrichten mit `index ` am Anfang bekommen den Bereich `index`.
- Für Tests: `IndexLog`-Trait mit Fake. Dann schreibt `cargo test` nicht ins echte Log.

### C6. Speicher und Zeit bei ca. 5000 Objekten [Einschätzung, in P0 messen]
- **Speicher:** pro Datei ca. 250 B, pro Verweis ca. 120 B (Site als kompakter String, Ziel-Namen als `Arc<str>`). 5000 Objekte × 20 Verweise ergibt rund 12 MB. Mit Problemen und Modulen etwa 15–40 MB.
- **Zeit:** ungefähr wie der heutige `scan_problems`. Der macht schon dieselbe Arbeit parallel, liest aber jede Datei doppelt. Kalt 1–4 s, warm 0,5–1,5 s.
- **Stempel-Abgleich** (`verify`): 50–200 ms.
- **Messplan P0:** Der PERF-Log der vorhandenen Befehle (`open project ... tree scan`, `problems scan ...`) sowie die Beispiele `scan_tree_timing`, `problems_dump`, `hardening_corpus` laufen auf dem größten echten Projekt. Dazu ein Messbeispiel `index_measure` (Stat-Walk-Zeit, Zahl der Dateien, Objekte und Kanten über `extract_edges`). Zielwerte festhalten:
  - Aufbau ≤ `scan_problems` + 10 %
  - eine einzelne Datei einspielen ≤ 50 ms
  - `verify` ≤ 200 ms
  - Speicher ≤ 50 MB

---

## D. UI

### D1. Statusleisten-Eintrag
- **Neu:** `app/ui/src/shell/IndexStatusItem.tsx` und `IndexStatusItem.css`. Die CSS kommt in `styles.css` nach `styles/statusbar.css`. Nur Variablen aus `theme/tokens.css`. Der Dateiname wird mit Ellipse gekürzt und hat eine feste Höchstbreite.
- **Anmelden** in einer neuen Datei `app/ui/src/shell/coreStatusItems.ts`: `registerStatusBarItem({ id: 'core.index', align: 'left', order: 10, component: IndexStatusItem })` (ohne `plugin` = Kern). Aufruf in `App.tsx` und `test/setup.ts`. Begründung: Projektregel "über das Register, nicht fest in StatusBar".
- **Anzeige:**
  - `Indexing 45%  entity/Foo_entity/Foo_entity.aod`, mit `ProgressBar percent`.
  - Bei `listing`: `Indexing... 1234 files` mit Streifen.
  - Bei mehreren Projekten: done/total wird summiert, im Tooltip stehen die Projekte.
  - Nach `ready`: 3 s lang `Index ready (2.5 s)`, dann leer.
  - Klick öffnet Output > IDE Log.
- **Store:** neu `app/ui/src/core/indexStatus.ts` (`useSyncExternalStore`, wie `core/scm.ts`), mit `_resetIndexStatusForTests`. Name bewusst **nicht** `projectIndex`, wegen `editors/projectIndex.ts`.

### D2. Hooks
- **Neu** `shell/hooks/useIndexStatus.ts`: hört `forge://index-progress` und füllt den Store. Für jedes Projekt in `projects` einmal `api.indexStatus(p)` (Stand nach einem Fenster-Reload). Ignoriert alte Generationen. Wird in `Shell.tsx` direkt nach `useProjects` aufgerufen.
- **Umbau** `shell/hooks/useExternalChanges.ts`:
  1. `setInterval` (`:74`) und `api.projectChanged` (`:40`) **entfernen**.
  2. `listenBackend('forge://project-changed')`:
     - `full` gesetzt: `setReloadToken`, `setScanTick`, Status `Project reloaded (Git)` (bei `reason = flood`: `Project reloaded (many files changed)`).
     - Sonst:
       - Objekt dazu/weg oder `modulesChanged`: `setReloadToken`.
       - Immer `setScanTick` (Probleme neu holen; wird billig, sobald P5.1 aus dem Index liest).
       - Offene Tabs (auch abgelöste Fenster), deren Datei in `changed` steht: wie heute über `api.externalChanges(ids)`. Ohne ungespeicherte Änderung neu laden. Mit ungespeicherter Änderung nur den Status-Hinweis zeigen; der Konflikt-Dialog kommt beim Speichern. Das Backup bleibt (Hook in `atomic_write`).
       - `ownOnly`: kein Tab-Reload, nur `setScanTick`.
  3. **Fokus-Abgleich:** `window` `focus`, entprellt mit 500 ms, für jedes Projekt `api.indexVerify(p)`. Der Index sendet bei Unterschieden selbst `project-changed` (`reason: 'focus'`). Danach wie heute `externalChanges` für offene Tabs.
  4. Das funktioniert auch **ohne Fokus**, weil die Events vom Backend kommen.
- `useProblemScan.ts` bleibt. Er hängt schon an `scanTick`. Zusätzlich holt er neu, wenn `index-progress` auf `ready` wechselt (über den Store).

### D3. Funktionen, die den Index brauchen, während er noch baut
[Empfehlung, das entscheidet das Backend]
- **Problems-Tab:** `scan_problems` wartet bis 60 s auf `ready` (abbrechbar). Ein paralleler alter Voll-Scan würde dieselbe Platte doppelt belasten.
- **Find Usages, Safely Delete, Rename-Plan** (Aktionen des Nutzers): fallen auf den alten Scan zurück (`legacy`), damit sie sofort antworten.
- **Schnellsuche:** fällt auf den alten Walk zurück.
- Die UI muss dafür nichts wissen. Die Tauri-Befehle behalten Namen und Signatur.

### D4. Output-Panel
Keine neue Leitung nötig. `write_entry` sendet schon `forge://log-entry`. Nur `areaOf` um `index` erweitern.

---

## E. Tauri-Hülle

**Neue Befehle? Ja, drei.** Der Index ist Kern, kein Plugin. Die Regel "Plugin-Befehle über `plugin_call`" gilt hier nicht.

| Weg | Vorteile | Nachteile |
|---|---|---|
| 1. Eigene Befehle in `commands/index.rs` (empfohlen) | typisiert, passt zum Kern (wie `scan_problems`), nicht abschaltbar | drei Einträge in `generate_handler!` |
| 2. Eingebautes `FeaturePlugin` "index" über `plugin_call` | keine neuen Handler | erscheint in Tools > Plugins und wäre scheinbar abschaltbar; falsche Bedeutung |
| 3. Keine neuen Befehle | nichts Neues | Stand nach einem Fenster-Reload und der Fokus-Abgleich gingen nicht |

Befehle (jeweils mit `guard`/`guard_async` und `blocking`):
- `index_status(project_root) -> Option<IndexStatus>` (sync `guard`; `Option`-Fallback gibt es schon)
- `index_verify(project_root) -> Result<VerifyOutcome, String>` (async + `blocking`)
- `index_rebuild(project_root) -> Result<(), String>` (sync)

Weitere Änderungen in der Hülle:
- `lib.rs`: in `setup` die Registry mit `app.manage(...)` anlegen (siehe B5), Befehle in `generate_handler!` eintragen. **Entfernen:** `.manage(ProjectFingerprints)` (`lib.rs:122`) und `commands::project::project_changed` (`lib.rs:186`).
- `commands/project.rs`:
  - `open_project`: nach dem Baum-Scan `registry.ensure_started(root)`; ist der Index fertig, einen `verify` anstoßen.
  - `remove_open_project`: `registry.stop(root)`.
  - `ProjectFingerprints` und `project_changed` löschen (`:116-130`).
- **P5:** `find_usages`, `scan_problems`, `list_project_files`, `rename_plan`/`rename_object` bekommen den Parameter `State<Arc<IndexRegistry>>` und geben `&IndexRegistry` an `project`-Funktionen weiter. Explizit als Parameter, nicht über ein globales `OnceLock`, damit es testbar bleibt.
- `app/src-tauri/Cargo.toml`: `project-index` als Abhängigkeit.

---

## F. Schritte in Reihenfolge

Prüfbefehle (alle aus der Root-`CLAUDE.md`):
- R1 = `cargo check --workspace --tests --examples`
- R2 = `cargo check -p designer-app --no-default-features --features git`
- U1 = `cd app/ui && npx tsc -p tsconfig.app.json --noEmit`
- U2 = `cd app/ui && npm test`

### P0 Messung und Basislinie (hängt von nichts ab)
| # | Was | Dateien | Ergebnis / Prüfung |
|---|---|---|---|
| 0.1 | Testbasis neu messen | – | `cargo test --workspace --no-fail-fast`, U2. Zahlen mit der Root-`CLAUDE.md` vergleichen (588/10 bzw. 587/11; UI 564/3). |
| 0.2 | Zeiten messen | neu `crates/project/examples/index_measure.rs` (Stat-Walk, Zählungen, `extract_edges` über alle Objekte) | `cargo run -p project --release --example index_measure -- <root>`. Dazu `scan_tree_timing` und `problems_dump`. Zahlen festhalten (C6). |
| 0.3 | Größtes echtes Projekt: **entschieden** `C:\Adito\Projects\hermesarzneitmittel-dev` (kein `node_modules` vorhanden: Modul-Fälle zusätzlich mit synthetischem Projekt oder npm install testen) | – | Zahlen für C6 hier messen. |

### P1 platform (Basis für alles)
| # | Was | Dateien | Test | Prüfung |
|---|---|---|---|---|
| 1.1 | `FileStamp`/`file_stamp` nach `platform::fs`; `project::watch` re-exportiert | `platform/src/fs.rs`, `project/src/watch.rs` | Stempel-Test verschieben | `cargo test -p platform -p project` |
| 1.2 | `path_key` | `platform/src/fs.rs` | Groß/klein, `/` und `\` | dto. |
| 1.3 | Register eigener Schreibvorgänge in `atomic_write` (nach `rename`), `note_own_change`, `take_own_write` (TTL 5 s, Uhr intern hineingeben) | `platform/src/fs.rs` | schreiben → genau einmal `true`; anderer Stempel → `false`; abgelaufen → `false` | dto. |
| 1.4 | `Rescan`, `watch_targets`, `add/remove`, `Err`/`need_rescan` → `Rescan` | `platform/src/watcher.rs`, `platform/src/windows/watcher.rs` | Unit-Test `to_watch_event` mit `notify::Event` samt `Flag::Rescan`; der bestehende Integrationstest bleibt | `cargo test -p platform`, R1 |
| 1.5 | `parallel_map`/`io_threads` nach `app-base`; `BUILD_FOLDERS` öffentlich | `app-base/src/parallel.rs`, `app-base/src/lib.rs`, `app-base/src/backup.rs`, `project/src/parallel.rs` (nur `pub use`) | Tests verschieben | `cargo test -p app-base -p project`, R1 |
| 1.6 | notify-Patch (D2): `vendor/notify` (Kopie 6.1.1), `[patch.crates-io]` im Root-`Cargo.toml`; in `windows.rs` bei `bytes_written == 0` ein Event mit `Flag::Rescan`. Vorher Clemens fragen. | `vendor/notify/src/windows.rs`, `Cargo.toml` | Unit-Test mit künstlich kleinem Puffer (Flut erzeugen, `Rescan` erwartet); Handtest 12 | `cargo test -p platform`, R1 |

### P2 file-watcher (nach P1; parallel zu P3.1–P3.6 möglich)
| # | Was | Dateien | Test |
|---|---|---|---|
| 2.1 | Crate-Gerüst | `crates/file-watcher/Cargo.toml`, `src/lib.rs` | `cargo check -p file-watcher` |
| 2.2 | `IgnoreRules` | `src/ignore.rs` | Tabellen-Test: `node_modules/x`, `.git/config` (ignoriert), `.git/HEAD` (nicht), `dist/...`, `.a.aod.12.3.tmp` |
| 2.3 | Batcher: Ruhezeit, Max-Wartezeit, Zusammenfassen, Eigen-Markierung | `src/batcher.rs` | reine Unit-Tests mit künstlichen `Instant`s: 400 ms Ruhe → 1 Batch; Dauerfeuer → spätestens nach 2 s; 201 Events → `Flood`; `HEAD` → `Flood(GitHead)`; ≥64 → `verify_after`; `Rescan` geht sofort durch |
| 2.4 | npm-Auslöser: Root-`package.json`, `package-lock.json`, `node_modules/.package-lock.json`, `node_modules` angelegt/weg → `modules_changed` erst nach 3 s Ruhe, **ohne** Max-Wartezeit | `src/batcher.rs` | Unit-Test: Install-Folge über 20 s → genau **ein** `modules_changed` |
| 2.5 | Watch-Menge + dynamisch erweitern (siehe D1 in H) | `src/watch_set.rs` | Unit (welche Ziele), Integration (neuer Ordner) |
| 2.6 | `WatchSession` (Thread, `Drop`) | `src/session.rs` | Fake-`FileWatcher` (Kanal) → genaue Batches; ein Integrationstest mit Temp-Ordner und `NotifyFileWatcher`, großzügige Timeouts wie `platform/src/windows/watcher.rs:76-92` |

Prüfung: `cargo test -p file-watcher`, R1.

### P3 project-index (3.1–3.6 parallel zu P2; ab 3.7 braucht es P2)
| # | Was | Dateien | Test |
|---|---|---|---|
| 3.1 | Gerüst, `layout.rs` (Ordner verschieben, `project/src/tree.rs` re-exportiert) | `crates/project-index/*`, `crates/project/Cargo.toml`, `crates/project/src/tree.rs` | `cargo test -p project` (Baum-Tests bleiben grün) |
| 3.2 | `text_pos.rs` + `analyze.rs` (aus `problems.rs` verschoben; `ProblemDto`/`UsageDto` hierher, `project::problems` re-exportiert, `problems.rs` ruft `analyze` auf → die drei Zeilen/Spalten-Kopien entfallen) | `project-index/src/analyze.rs`, `text_pos.rs`, `project/src/problems.rs` | Die bestehenden Tests in `problems.rs:336-397` müssen grün bleiben, dazu Unit-Tests in `analyze` |
| 3.3 | `ReferenceIndex` | `src/references.rs` | Tests aus `graph.rs:160-224` übernehmen; neu: Alias-Reihenfolge egal; Neu-Indizieren entfernt alte Kanten; Rückwärts-Liste bei 1000 Absendern |
| 3.4 | `ModuleState` (wie `problems.rs:89-125`, plus Alias-Ziele) | `src/modules.rs` | Temp-Projekt mit `node_modules/@scope/mod/entity/...` |
| 3.5 | `build_index` mit Phasen, Abbruch, Fortschritt | `src/build.rs`, `src/progress.rs` | Temp-Projekt; kaputte `.aod` → Problem, kein Fehler; Abbruch nach N Dateien → `Err(Cancelled)`; Fortschritt steigt nur, letztes Event 100 % |
| 3.6 | Abfragen | `src/query.rs` | Probleme inkl. Verweis-Probleme; `usages`; gelöschtes Ziel → neues Problem |
| 3.7 | `apply_paths`, `reconcile`, `affected`, Ordner-Teilbäume | `src/update.rs` | Datei geändert, gelöscht, Ordner umbenannt (nur Ordner-Pfad berührt), neue Datei; `affected` enthält die Verweiser |
| 3.8 | Logging | `src/log.rs` | Fake-`IndexLog`: Deckel bei 20 WARN, PERF-Zeile mit Zahlen |
| 3.9 | `IndexRegistry` + Worker + Watcher-Anbindung + Events + Semaphore | `src/service.rs`, `src/events.rs` | Fake-EventSink und Fake-Watcher: Start → `progress` … `ready`; Batch während Aufbau → wird nach `ready` eingespielt; `stop` beim Aufbau → `cancelled`, keine weiteren Events; zwei Projekte → das zweite `queued` |
| 3.10 | **Vergleichstest Index gegen Voll-Scan (Probleme)** | `crates/project/tests/index_parity.rs` (nutzt `../aod/tests/fixtures/{Hermes,Pichler,SVB,FFG}` und `tests/fixtures/DemoProject`) | sortiert vergleichen: `index.problems()` gleich `problems::scan_project(root)` |

Prüfung: `cargo test -p project-index`, `cargo test -p project --test index_parity`, R1.

### P4 Tauri + UI (nach P3; der UI-Teil 4.3–4.5 kann mit Fake-Events parallel zu P3 laufen, sobald B4 fest ist)
| # | Was | Dateien | Test / Prüfung |
|---|---|---|---|
| 4.1 | Registry in `setup`, `commands/index.rs`, `open_project`/`remove_open_project`, `project_changed` + `ProjectFingerprints` raus | `app/src-tauri/Cargo.toml`, `src/lib.rs`, `src/commands/mod.rs`, `src/commands/index.rs` (neu), `src/commands/project.rs` | `cargo check -p designer-app`, R2, `cargo test -p designer-app` |
| 4.2 | API: `projectChanged` raus; `indexStatus`, `indexVerify`, `indexRebuild` rein | `api/ForgeApi.ts`, `api/tauriApi.ts`, `test/mockApi.ts`, `wire/types.ts` | U1 |
| 4.3 | Store, Hook, Statusfeld, Anmeldung, CSS | `core/indexStatus.ts`, `shell/hooks/useIndexStatus.ts`, `shell/IndexStatusItem.tsx/.css`, `shell/coreStatusItems.ts`, `App.tsx`, `test/setup.ts`, `styles.css`, `shell/Shell.tsx` | Vitest (G2), U1 |
| 4.4 | `useExternalChanges` umbauen (Polling raus, Event, Fokus) | `shell/hooks/useExternalChanges.ts`, `shell/Shell.tsx:398` | Vitest (G2) |
| 4.5 | `areaOf` → `index` | `shell/hooks/useOutputLogs.ts` | kleiner Vitest |
| 4.6 | `watch::project_fingerprint` löschen | `project/src/watch.rs` | `cargo test -p project` |
| 4.7 | [D7] `note_own_change` in den `std::fs`-Schreibern | `rename.rs`, `new_object.rs`, `tree_ops.rs`, `file_ops.rs`, `project_zip.rs` | bestehende Tests, R1 |
| 4.8 | Handtests (G3) | – | `cd app && npx --prefix ui tauri dev` |

### P5 Funktionen auf den Index umstellen (jeweils einzeln, nach P4)
Für jeden Schritt gilt: Der alte Code bleibt als `legacy` (Fallback und Vergleich). Dazu kommt ein Vergleichstest in `crates/project/tests/index_parity.rs`.

| # | Funktion | Dateien | Vergleich |
|---|---|---|---|
| 5.1 | Problems-Tab (`scan_problems` wartet auf `ready`, liest dann aus dem Index) | `project/src/problems.rs`, `commands/project.rs:103-114` | schon in 3.10 |
| 5.2 | Find Usages / Safely Delete (`find_usages`) | `problems.rs` (`find_usages`), `commands/project.rs:93-99` | für jede Entity, View und jeden WS der Fixtures: Index-Usages gleich `scan_usages` |
| 5.3 | Rename-Plan/-Apply: vorher `verify`; Kandidaten aus `referenced_by`; **die Kandidaten-Dateien frisch parsen** für die Byte-Bereiche; Text-Treffer über die Dateiliste des Index (Filter `rename.rs:60` beibehalten) | `rename.rs`, `problems.rs` (`scan_usages` für Spans auf Kandidaten beschränkt), `commands/files.rs` | `plan()` mit Index gleich `plan()` ohne Index auf den Fixtures; Test "Index veraltet" (Datei ändern, ohne einzuspielen) → frisches Parsen findet es trotzdem |
| 5.4 | Löschen prüfen: Delete fragt Usages mit `verify` davor | `tree_ops.rs` (optional ein Check im Backend), `useRefactoring.ts` unverändert | Test: Verweis auf das zu löschende Objekt → wird gemeldet |
| 5.5 | Schnellsuche (`list_project_files`) | `file_list.rs`, `commands/project.rs:133-138` | gleiche Liste wie `file_list::list_project_files` (Filter `.idea`, `.vscode`, `.aditoprj` in der Abfrage) |
| 5.6 | `webservices.rs` (optional, kleiner Nutzen) | `webservices.rs`, `commands/rest.rs` | gleiche Liste |
| 5.7 | Projektbaum `tree.rs` (groß, eigener Plan) | – | – |

Prüfung je Schritt: `cargo test -p project`, R1, U2, ein Handtest der Funktion.

### P6 Umbau `aod::references` (nach P5)
| # | Was | Dateien |
|---|---|---|
| 6.1 | Modul `refs` → `references`; `edge.rs` → `reference.rs` (`Edge` → `Reference`, `RefKind` → `ReferenceKind`); `extract.rs` → `read.rs` (`extract_edges` → `read_references`); `ObjectId` bleibt | `aod/src/references/*`, `aod/src/lib.rs:9`, `aod/tests/rename_cascade.rs`, `project/src/problems.rs` (legacy), `project-index` (alle `aod::refs`-Nutzer). Kommentare: `plugin-api/src/action.rs:33`, `validator.rs:3`, `types.rs:90`, `aod/src/tree/observer.rs:4,11` |
| 6.2 | `RefGraph` aus `aod` entfernen. Speichern macht nur noch `project_index::references::ReferenceIndex`; `incoming`/`outgoing` heißen dort `referenced_by`/`references`. `rename_cascade` wird eine freie Funktion `aod::references::rename_cascade(incoming: &[Reference], new_name, trees)` [Empfehlung]. `delete_diagnostics` wird eine Abfrage im Index. | `aod/src/references/graph.rs` (weg), neu `rename.rs`, `aod/tests/rename_cascade.rs` |
| 6.3 | **Fehler 1:** `ObjectKind` um alle Typen aus `OBJECT_FOLDERS` erweitern, `ObjectKind::from_object_type(&str)`; Absender richtig setzen | `object_id.rs`, `problems.rs` (legacy), `project-index` |
| 6.4 | **Fehler 2:** Alias auflösen. `AliasShort` gegen `alias_targets` (Projekt + Module). Neues Problem "Reference to alias 'X' not found". Find Usages für `aliasDefinition` nur, wenn die UI das will (`tree/contextMenu.ts:188`). **Das ändert das Verhalten**, darum ein eigener Test und der Vergleichstest bekommt eine Ausnahme. | `project-index/src/query.rs`, `references.rs` |
| 6.5 | Zeilen/Spalten-Reste und der BOM-Verdacht: Test mit einer BOM-Datei | `text_pos.rs`, Test |
| 6.6 | `legacy`-Scan: parallel, ein Lesevorgang, oder nur noch als Test-Referenz | `problems.rs` |
| 6.7 | Falschen Kommentar `extract.rs:23-27` korrigieren | `read.rs` |

Prüfung: `cargo test -p aod -p project-index -p project`, R1, R2. Alle Aufrufer vorher mit Grep finden: `aod::refs|refs::|extract_edges|RefGraph|RefKind|Edge\b`. Den Stand dieser Liste zeigt A1.

### P7 Karten, Doku, Basislinie
Siehe I. Dazu `powershell -File scripts/check-maps.ps1` (Exit 0), neue Basislinie in die Root-`CLAUDE.md`, und `watch.rs:1-4` (der Doku-Text "Polling") anpassen.

---

## G. Tests

### G1. Rust
- **Rein ohne Dateisystem:** Batcher (2.3, 2.4), IgnoreRules, `ReferenceIndex`, Drosselung (Uhr hineingeben), `take_own_write` (TTL), `to_watch_event`-Zuordnung.
- **Integration mit Temp-Ordner und Fake-EventSink** (`Mutex<Vec<(String, Value)>>`): Aufbau → Folge der Fortschritts-Events (steigend, Generation gleich, Ende `ready`); Abbruch (`stop` nach den ersten Events → `cancelled`, danach Ruhe); Batch während des Aufbaus; Ordner umbenannt; kaputte `.aod`; zwei Projekte (Semaphore).
- **Fake-FileWatcher** (Kanal statt OS): macht die Session-Tests ohne Zeitprobleme.
- **Echte Watcher-Tests:** wenige, nur unter Windows, Timeouts 10 s (siehe `platform/src/windows/watcher.rs:84`).
- **Vergleichstests:** `crates/project/tests/index_parity.rs` (Probleme, Usages, Dateiliste, Rename-Plan) über `crates/aod/tests/fixtures/*` und `crates/project/tests/fixtures/DemoProject`.
  - [Einschätzung] Die Fixtures haben kein `node_modules` und keine `.js`. Für Verweise auf verknüpfte Dateien und Module braucht der Test einen kleinen synthetischen Projektordner im Temp-Verzeichnis.

### G2. Vitest
- `shell/IndexStatusItem.test.tsx`: Prozent, Dateiname, Summe über mehrere Projekte, `listing` ohne Prozent, `ready` blendet aus.
- `core/indexStatus.test.ts`: alte Generation wird ignoriert, Reset.
- Hook-Tests über eine Fake-`WindowBackend` (`setWindowBackend`, `windows/windowService.ts:99`), die `listen` aufzeichnet und Events selbst auslöst:
  - `project-changed` mit `full` → `setReloadToken` + Status-Text.
  - Mit `ownOnly` → kein `reloadObject`.
  - Tab mit ungespeicherten Änderungen → nur Hinweis.
  - Fokus → `indexVerify` genau einmal (entprellt).
  - Mit Fake-Timern: nach 10 s **kein** Aufruf von `projectChanged` oder `externalChanges` ohne Event (das Polling ist weg).
- [Belegt] Heute testet kein Test `projectChanged`/`externalChanges`. Neue Tests decken das Verhalten also zum ersten Mal ab.

### G3. Handtests unter Windows
1. `git checkout <anderer Branch>` mit vielen Änderungen → Statusleiste "Project reloaded (Git)", Baum neu, Probleme neu.
2. `git pull` mit 3 Dateien (ändert `HEAD` nicht!) → normaler Batch, Tabs neu.
3. `npm install` und `npm ci` → genau **ein** Modul-Rescan nach Ruhe; kein Flackern während der Installation.
4. Datei extern ändern, während das Designer-Fenster **keinen** Fokus hat → Reload ohne Fokus.
5. Datei extern ändern bei ungespeicherter Änderung im Tab → Hinweis; beim Speichern Konflikt-Dialog; Backup im Ordner.
6. Projekt schließen während des Aufbaus → keine weiteren Events, kein Panic im Log.
7. Zwei Projekte öffnen → das zweite "queued", dann Aufbau.
8. Großes Projekt (P0.3) → Zeit und Speicher (Task-Manager) gegen C6.
9. Speichern im Designer → kein Tab-Reload, keine Statusmeldung "changed on disk"; Problems aktualisiert.
10. Transpile → keine Index-Events durch `dist` und Cache-Ordner.
11. Objekt-Ordner im Explorer umbenennen → Objekt im Baum, Verweis-Probleme richtig.
12. Fokus weg, 300 Dateien per Skript kopieren, Fokus zurück → Abgleich findet alles (Überlauf-Lücke).

---

## H. Risiken, offene Entscheidungen, Aufwand, Parallelität

### H1. Offene Entscheidungen für Lion (mit Empfehlung)
| # | Frage | Empfehlung |
|---|---|---|
| D1 | Was beobachten? (a) Root rekursiv und dann filtern; (b) gezielt: jeden **nicht ignorierten** Ordner der obersten Ebene rekursiv, Root nicht rekursiv, `.git` nicht rekursiv (HEAD), `node_modules` nicht rekursiv (`.package-lock.json`) | **(b).** Windows meldet sonst alles aus `node_modules`, `dist` und `.git` in denselben 16-KB-Puffer, und npm/Transpile lassen ihn überlaufen. Mit (b) hat jeder Watch einen eigenen Puffer. Neue Ordner der obersten Ebene kommen dynamisch dazu. [Einschätzung] |
| D2 | Überlauf-Lücke unter Windows | **Entschieden (Lion): sofort mit behandeln.** Schicht 1: `Rescan` aus `platform` (Fehler, `need_rescan`). Schicht 2: Verdacht bei >=64 rohen Events -> `verify_after`. Schicht 3: Fokus-Abgleich. Schicht 4: jeder Reload aus der App gleicht ab. Schicht 5 (neu, P1.6): kleiner notify-Patch per `[patch.crates-io]` (lokale Kopie von notify 6.1.1 unter `vendor/notify`): bei `bytes_written == 0` ein Event mit `Flag::Rescan` senden. Mit Clemens vorher absprechen (betrifft das ganze Team, `Cargo.toml`). Alternative ohne Fremdcode-Kopie: eigener ReadDirectoryChangesW-Watcher in `platform` (braucht `unsafe`, Ausnahme zur Regel "nur credentials.rs"). Empfehlung: Patch. Handtest 12 prüft das Ergebnis. |
| D3 | Flut oder Git: "alles neu" | Stempel-Abgleich des ganzen Projekts (liest nur geänderte Dateien) plus UI-Komplett-Reload. Ein voller Neu-Aufbau nur über `index_rebuild`. |
| D4 | Sprache der Statusmeldung | Englisch wie die übrige UI: `Project reloaded (Git)`. |
| D5 | Verhalten während des Aufbaus | **Entschieden (Lion):** Probleme warten auf den Index; Usages, Rename und Schnellsuche nutzen währenddessen den alten Scan (`legacy`). |
| D6 | Wohin mit `RefGraph`? | Speicher-Teil in `project-index` (`ReferenceIndex`); der Leser bleibt in `aod`; `rename_cascade` als freie Funktion behalten (getestet, klein). Alternative: `RefGraph` in `aod` erweitern. Dagegen spricht: `aod` bekäme Datei-Schlüssel, Module und Zeile/Spalte, und der Umbau ginge zweimal durch `aod`. |
| D7 | Eigene `std::fs`-Schreiber (Rename, Neu, Löschen, Zip) | `note_own_change` eintragen (P4.7). Sonst lädt die UI nach diesen Aktionen zweimal neu. |
| D8 | Tauri-Befehle | drei eigene Befehle (E) |
| D9 | Gleichzeitige Aufbauten | höchstens einer |
| D10 | Alias-Probleme (neue Meldungen im Problems-Tab) | erst in P6.4, mit Hinweis im Changelog |
| D11 | Index auf Platte zwischenspeichern | jetzt nicht. Erst messen (P0). `tree.rs` hat schon einen Modul-Cache. |
| D12 | Ort von `parallel_map` | `app-base` (`project` re-exportiert) |
| D13 | Braucht `file-watcher` `EventSink`? | nein, Callback (B1) |

### H2. Risiken (was leicht schiefgeht)
1. **Pfad-Vergleich unter Windows:** notify liefert `root.join(name)`, die Node-IDs der UI können anders geschrieben sein. Überall `path_key` nutzen, sonst greift das Eigen-Save-Register nicht.
2. **Ordner-Events ohne Kind-Events** (Umbenennen im Explorer). Ohne Teilbaum-Abgleich bleiben Geister-Einträge.
3. **Sperren und Events:** Ein Event unter Schreibsperre senden kann blockieren, wenn Tauri hängt. Regel B6.4.
4. **Doppelte Platten-Last beim Öffnen:** Baum-Scan, Index-Aufbau und Problems-Scan lesen alles. Darum startet der Index erst **nach** dem Baum-Scan in `open_project`, und `scan_problems` wartet.
5. **Alte Events** nach Abbruch oder Neustart → Generation in jedem Payload, die UI filtert.
6. **`.git` ist eine Datei** (Worktree) oder das Repository liegt über dem Projekt → HEAD-Erkennung fällt aus. Dann vom Projekt nach oben suchen (wenige Ebenen); sonst nur die Zahl-Schwelle.
7. **`git pull` ändert `HEAD` nicht** (nur `refs/heads/...`). Kleine Pulls sind normale Batches, große erkennt die Flut-Schwelle. `ORIG_HEAD` mit beobachten.
8. **npm:** [Einschätzung] npm ab v7 schreibt am Ende `node_modules/.package-lock.json`; `npm ci` ändert `package-lock.json` nicht. Mit Handtest 3 prüfen. Dazu startet die App npm selbst (`npm_run`) und kann nach dem Ende `verify` plus Modul-Rescan auslösen.
9. **Unterschiede beim Vergleichstest:** Modulmenge (`node_modules/*` statt `resolve_lenient`), Ignore-Listen, Alias, BOM. Der Index muss im Vergleichs-Modus genau die alte Logik nachbilden. Gewollte Abweichungen kommen erst in P6.
10. **Log-Flut:** `write_entry` öffnet die Datei je Eintrag. Pro Datei loggen macht die App langsam.
11. **Reload ohne Fokus ist neu.** Ein Tab kann sich ändern, während der Nutzer woanders ist. Bei ungespeicherten Änderungen passiert nichts außer dem Hinweis, wie heute.
12. **Rust-Neuland für Lion:** Threads, `Arc`, `RwLock`. Eigener Code braucht **kein** `unsafe` (nur der optionale notify-Patch hätte welches).
13. **Flaky Watcher-Tests:** echte OS-Tests klein halten, die Logik rein testen.
14. **Doku-Lage:** Root-`CLAUDE.md` sagt "nicht committet", Git ist aber sauber (A2.6). Vor dem Start klären, damit die Basislinie stimmt.

### H3. Aufwand [Einschätzung, Arbeitstage mit Agent-Unterstützung]
| Phase | Tage |
|---|---|
| P0 | 0,5 |
| P1 | 1–1,5 |
| P2 | 2–3 |
| P3 | 4–6 |
| P4 | 3–4 |
| P5 | 3–5 (5.7 Baum nicht eingerechnet) |
| P6 | 1,5–2,5 |
| P7 | 0,5–1 |
| **Summe** | **15–23** |

### H4. Parallelität (getrennte Sessions ohne gemeinsame Dateien)
- **P1 zuerst und allein.** Es berührt `platform`, `app-base` und `project/src/{watch,parallel}.rs`.
- **Danach parallel:**
  - Strang A: P2 (nur `crates/file-watcher/*`).
  - Strang B: P3.1–P3.6 (`crates/project-index/*`, dazu `project/src/{tree,problems}.rs` und `project/Cargo.toml`).
  - Strang C: P4.2–P4.5 UI mit Fake-Events (`app/ui/src/{core/indexStatus.ts, shell/IndexStatusItem.*, shell/coreStatusItems.ts, shell/hooks/useIndexStatus.ts, wire/types.ts}`). `useExternalChanges.ts` und `Shell.tsx` erst nach 4.1.
- **Konflikt-Gefahr:** `Cargo.lock` (A und B legen Crates an) → nacheinander mergen und dann R1 laufen lassen. `styles.css` und `App.tsx` nur in Strang C.
- **P3.7–3.10 und P4.1** hintereinander (Wiring).
- **P5:** 5.1 und 5.2 berühren beide `problems.rs` → nacheinander. 5.5 (`file_list.rs`) und 5.6 (`webservices.rs`) parallel. 5.3 nach 5.2.
- **P6** allein (berührt `aod`, `project-index`, `project`).
- Mechanische Teile (Umbenennen in 6.1, Kommentare, Karten-Tabellen) passen zu `code-chores`.

---

## I. Karten und Doku

| Datei | Änderung |
|---|---|
| neu `crates/file-watcher/CLAUDE.md` | AUTO-Tabelle (Cargo.toml, `src/*.rs`); Zweck; Regeln: der Batch sagt nur "berührt", Ignore-Liste an einer Stelle, kein Tauri, keine Events |
| neu `crates/project-index/CLAUDE.md` | Dateien; Thread-Modell; Sperr-Regeln (B6); Events; Logging-Deckel; "Wenn du X ändern willst" (neue Verweis-Art → `aod` + `references.rs`; neue Abfrage → `query.rs`) |
| neu `crates/platform/CLAUDE.md` | gibt es noch nicht. Dateien, Watcher-Lücke (A1, mit notify-Zeilen), Register eigener Schreibvorgänge, `path_key`, nur hier OS-Aufrufe |
| `crates/CLAUDE.md` | 2 neue Zeilen; `app-base` mit `parallel`; `project` hängt an `project-index`; Abhängigkeits-Kette |
| `crates/project/CLAUDE.md` | `content_search.rs` ergänzen (alter Fehler); `parallel.rs` = Re-Export; `watch.rs` ohne Fingerabdruck; `problems.rs` = Index + legacy; Abhängigkeit `project-index` |
| `crates/aod/CLAUDE.md` | `refs` → `references`; Nutzer richtigstellen (`project-index`, `project`); `RefGraph` weg, `rename_cascade` frei; "Wenn du X ..."-Zeilen anpassen |
| `app/src-tauri/CLAUDE.md` | `commands/index.rs`; `project_changed` raus; fehlende Befehle ergänzen (A2.3); Tests-Zeile korrigieren; State `IndexRegistry` |
| `app/ui/CLAUDE.md` | "Neues Statusleisten-Feld" um Kern-Felder ergänzen (`shell/coreStatusItems.ts`) |
| `app/ui/src/shell/CLAUDE.md` | `IndexStatusItem.tsx`, `coreStatusItems.ts`; Hook-Reihenfolge (`useIndexStatus` nach `useProjects`) |
| `app/ui/src/shell/hooks/CLAUDE.md` | `useIndexStatus.ts`; `useExternalChanges` neu beschrieben (Event + Fokus, kein Polling); `listenBackend`-Liste (+ `log-entry`, `index-progress`, `project-changed`) |
| `app/ui/src/core/CLAUDE.md` | `indexStatus.ts` |
| Root-`CLAUDE.md` | Crate-Tabelle (Kern: `file-watcher`, `project-index`); "Vorhanden (21)" wird 24, Liste um `crates/{file-watcher,project-index,platform}` ergänzen; Datenfluss-Satz (Events `forge://index-progress`, `forge://project-changed`); "Bekannte Punkte" (Windows-Überlauf-Lücke, D2-Entscheid); neue Test-Basislinie; "Umbau"-Abschnitt prüfen (A2.6) |
| Workspace-`Cargo.toml` | **keine Änderung nötig** (`members = ["crates/*", ...]`, `Cargo.toml:11`) |
| `scripts/check-maps.ps1` | keine Änderung; nach jeder Phase laufen lassen, `-Fix` für neue Zeilen, dann den Satz von Hand schreiben |

### Wichtigste Dateien (absolute Pfade)

**Rust (Backend)**
- `E:\GitHub Projects\Project_Designer\crates\aod\src\refs\{mod,edge,extract,graph,object_id}.rs`
- `E:\GitHub Projects\Project_Designer\crates\project\src\problems.rs`
- `E:\GitHub Projects\Project_Designer\crates\project\src\parallel.rs`
- `E:\GitHub Projects\Project_Designer\crates\project\src\watch.rs`
- `E:\GitHub Projects\Project_Designer\crates\project\src\tree.rs`
- `E:\GitHub Projects\Project_Designer\crates\project\src\rename.rs`
- `E:\GitHub Projects\Project_Designer\crates\project\src\file_list.rs`
- `E:\GitHub Projects\Project_Designer\crates\project\src\project_actor.rs`
- `E:\GitHub Projects\Project_Designer\crates\platform\src\{fs,watcher}.rs`
- `E:\GitHub Projects\Project_Designer\crates\platform\src\windows\watcher.rs`
- `E:\GitHub Projects\Project_Designer\crates\app-base\src\{crashlog,scrub,backup}.rs`
- `E:\GitHub Projects\Project_Designer\crates\plugin-api\src\feature.rs`

**Tauri-Hülle**
- `E:\GitHub Projects\Project_Designer\app\src-tauri\src\lib.rs`
- `E:\GitHub Projects\Project_Designer\app\src-tauri\src\commands\{mod,project}.rs`

**UI**
- `E:\GitHub Projects\Project_Designer\app\ui\src\shell\hooks\{useExternalChanges,useOutputLogs,useProjects,useProblemScan}.ts`
- `E:\GitHub Projects\Project_Designer\app\ui\src\shell\StatusBar.tsx`
- `E:\GitHub Projects\Project_Designer\app\ui\src\core\plugins\registry.ts`
- `E:\GitHub Projects\Project_Designer\app\ui\src\core\ui\ProgressBar.tsx`

**Fremdcode (Cargo-Cache)**
- `C:\Users\Lion\.cargo\registry\src\index.crates.io-1949cf8c6b5b557f\notify-6.1.1\src\windows.rs` (Zeilen 39, 261, 313-317, 399)

Sources:
- [notify 8.2.0 src/windows.rs (docs.rs)](https://docs.rs/crate/notify/latest/source/src/windows.rs)
- [ReadDirectoryChangesW (Microsoft Learn)](https://learn.microsoft.com/windows/win32/api/winbase/nf-winbase-readdirectorychangesw)
