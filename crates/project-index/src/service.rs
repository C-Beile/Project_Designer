//! Der Dienst: pro offenem Projekt ein Worker-Thread, der den Index aufbaut, den File-Watcher
//! bedient und Events sendet. Der Worker ist der EINZIGE Schreiber des Index. Leser (Befehle der App)
//! nehmen die Lesesperre. Regeln gegen Deadlocks: nie Events senden, während eine Sperre gehalten
//! wird; nie den Actor aufrufen.
//!
//! In C# gedacht: `IndexRegistry` ist ein Singleton mit `ConcurrentDictionary<string, Handle>`,
//! `RwLock` ist `ReaderWriterLockSlim`, der Worker ein eigener `Thread` mit `BlockingCollection<Msg>`.

use crate::build::{build_index, BuildOptions, BuildReport};
use crate::events::*;
use crate::log::IndexLog;
use crate::model::{FileKey, ProjectIndex};
use crate::modules::{module_stamps, scan_modules, stamps_differ};
use crate::progress::{percent_of, ProgressSink, Throttle};
use crate::update::{apply_delta, compute_delta};
use file_watcher::{Batch, BatchKind, FloodReason, WatchConfig, WatchSession};
use platform::fs::path_key;
use platform::FileWatcher;
use plugin_api::EventSink;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Condvar, Mutex, RwLock};
use std::time::{Duration, Instant};

/// More files than this in one change: the UI reloads everything instead of patching.
const FULL_RELOAD_ABOVE: usize = 200;
/// Batches with more files than this are written to the log (PERF).
const PERF_LOG_ABOVE: usize = 50;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartOutcome {
    Started,
    Running,
    Ready,
}

#[derive(Clone)]
pub struct ServiceConfig {
    pub watch: WatchConfig,
    pub threads: usize,
}

impl Default for ServiceConfig {
    fn default() -> Self {
        Self { watch: WatchConfig::default(), threads: app_base::parallel::io_threads() }
    }
}

// ---------------------------------------------------------------- build slot (one build at a time)

#[derive(Default)]
struct BuildSlot {
    busy: Mutex<bool>,
    cv: Condvar,
}

impl BuildSlot {
    /// Waits for the slot. `on_wait` runs once if it has to wait. False if cancelled while waiting.
    fn acquire(&self, cancel: &AtomicBool, on_wait: impl FnOnce()) -> bool {
        let mut on_wait = Some(on_wait);
        let mut busy = self.busy.lock().unwrap_or_else(|p| p.into_inner());
        while *busy {
            if let Some(f) = on_wait.take() {
                f();
            }
            if cancel.load(Ordering::Relaxed) {
                return false;
            }
            busy = self.cv.wait_timeout(busy, Duration::from_millis(50)).unwrap_or_else(|p| p.into_inner()).0;
        }
        if cancel.load(Ordering::Relaxed) {
            return false;
        }
        *busy = true;
        true
    }

    fn release(&self) {
        *self.busy.lock().unwrap_or_else(|p| p.into_inner()) = false;
        self.cv.notify_all();
    }
}

// ---------------------------------------------------------------- handle

enum Msg {
    Batch(Batch),
    Verify(Sender<Result<VerifyOutcome, String>>, ChangeReason),
    Stop,
}

struct Shared {
    index: RwLock<ProjectIndex>,
    status: Mutex<IndexStatus>,
    status_cv: Condvar,
    cancel: AtomicBool,
}

pub struct ProjectIndexHandle {
    root: PathBuf,
    generation: u64,
    shared: Arc<Shared>,
    tx: Mutex<Sender<Msg>>,
}

impl ProjectIndexHandle {
    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn status(&self) -> IndexStatus {
        self.shared.status.lock().unwrap_or_else(|p| p.into_inner()).clone()
    }

    pub fn is_ready(&self) -> bool {
        self.status().phase == IndexPhase::Ready
    }

    /// Compares the disk with the index (stat only, reads what changed). Waits for the result.
    /// Does nothing while the index is still being built.
    pub fn verify(&self) -> Result<VerifyOutcome, String> {
        if !self.is_ready() {
            return Ok(VerifyOutcome { changed: 0, duration_ms: 0 });
        }
        let (tx, rx) = channel();
        self.tx.lock().unwrap_or_else(|p| p.into_inner()).send(Msg::Verify(tx, ChangeReason::Focus)).map_err(|_| "index worker is gone".to_string())?;
        rx.recv_timeout(Duration::from_secs(120)).map_err(|_| "index verify timed out".to_string())?
    }

    /// Runs `f` on the index. `None` while the index is not ready (or ended).
    pub fn read<R>(&self, f: impl FnOnce(&ProjectIndex) -> R) -> Option<R> {
        if !self.is_ready() {
            return None;
        }
        let guard = self.shared.index.read().unwrap_or_else(|p| p.into_inner());
        Some(f(&guard))
    }

    /// Waits until the index is ready. False on timeout or when the build ended without result.
    pub fn wait_ready(&self, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        let mut status = self.shared.status.lock().unwrap_or_else(|p| p.into_inner());
        loop {
            match status.phase {
                IndexPhase::Ready => return true,
                IndexPhase::Cancelled | IndexPhase::Failed => return false,
                _ => {}
            }
            let now = Instant::now();
            if now >= deadline {
                return false;
            }
            status = self.shared.status_cv.wait_timeout(status, deadline - now).unwrap_or_else(|p| p.into_inner()).0;
        }
    }

    fn stop(&self) {
        self.shared.cancel.store(true, Ordering::Relaxed);
        let _ = self.tx.lock().unwrap_or_else(|p| p.into_inner()).send(Msg::Stop);
    }
}

// ---------------------------------------------------------------- registry

struct RegistryInner {
    events: Arc<dyn EventSink>,
    log: Arc<dyn IndexLog>,
    watcher: Arc<dyn FileWatcher>,
    cfg: ServiceConfig,
    handles: Mutex<HashMap<String, Arc<ProjectIndexHandle>>>,
    generation: AtomicU64,
    slot: Arc<BuildSlot>,
}

pub struct IndexRegistry {
    inner: Arc<RegistryInner>,
}

impl IndexRegistry {
    pub fn new(events: Arc<dyn EventSink>, log: Arc<dyn IndexLog>, watcher: Arc<dyn FileWatcher>) -> Self {
        Self::with_config(events, log, watcher, ServiceConfig::default())
    }

    pub fn with_config(events: Arc<dyn EventSink>, log: Arc<dyn IndexLog>, watcher: Arc<dyn FileWatcher>, cfg: ServiceConfig) -> Self {
        Self {
            inner: Arc::new(RegistryInner { events, log, watcher, cfg, handles: Mutex::new(HashMap::new()), generation: AtomicU64::new(0), slot: Arc::new(BuildSlot::default()) }),
        }
    }

    /// Starts the index of `root` if it does not run yet. A ready index is compared with the disk again
    /// (every reload from inside the app covers the gaps of the OS watcher this way).
    pub fn ensure_started(&self, root: &Path) -> StartOutcome {
        let key = path_key(root);
        let mut handles = self.inner.handles.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(h) = handles.get(&key) {
            if h.is_ready() {
                let (tx, _rx) = channel();
                let _ = h.tx.lock().unwrap_or_else(|p| p.into_inner()).send(Msg::Verify(tx, ChangeReason::Rescan));
                return StartOutcome::Ready;
            }
            return StartOutcome::Running;
        }
        let handle = self.spawn(root);
        handles.insert(key, handle);
        StartOutcome::Started
    }

    /// Throws the current index away and builds a new one.
    pub fn rebuild(&self, root: &Path) {
        self.stop(root);
        self.ensure_started(root);
    }

    pub fn stop(&self, root: &Path) {
        let removed = self.inner.handles.lock().unwrap_or_else(|p| p.into_inner()).remove(&path_key(root));
        if let Some(h) = removed {
            h.stop();
        }
    }

    pub fn get(&self, root: &Path) -> Option<Arc<ProjectIndexHandle>> {
        self.inner.handles.lock().unwrap_or_else(|p| p.into_inner()).get(&path_key(root)).cloned()
    }

    fn spawn(&self, root: &Path) -> Arc<ProjectIndexHandle> {
        let generation = self.inner.generation.fetch_add(1, Ordering::Relaxed) + 1;
        let (tx, rx) = channel();
        let project = root.to_string_lossy().into_owned();
        let shared = Arc::new(Shared {
            index: RwLock::new(ProjectIndex { root: root.to_path_buf(), generation, ..ProjectIndex::default() }),
            status: Mutex::new(IndexStatus { project, generation, phase: IndexPhase::Queued, done: 0, total: 0, files: 0, objects: 0, references: 0, last_build_ms: None }),
            status_cv: Condvar::new(),
            cancel: AtomicBool::new(false),
        });
        let handle = Arc::new(ProjectIndexHandle { root: root.to_path_buf(), generation, shared: shared.clone(), tx: Mutex::new(tx.clone()) });
        let worker = Worker { root: root.to_path_buf(), generation, shared, reg: self.inner.clone(), tx };
        let name = format!("forge-index-{}", root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default());
        if std::thread::Builder::new().name(name).spawn(move || worker.run(rx)).is_err() {
            self.inner.log.write("ERROR", &format!("index {}: cannot start the worker thread", root.display()));
        }
        handle
    }
}

impl Drop for IndexRegistry {
    fn drop(&mut self) {
        let all: Vec<_> = self.inner.handles.lock().unwrap_or_else(|p| p.into_inner()).drain().map(|(_, h)| h).collect();
        for h in all {
            h.stop();
        }
    }
}

// ---------------------------------------------------------------- worker

struct EventProgress<'a> {
    worker: &'a Worker,
    throttle: Mutex<Throttle>,
}

impl ProgressSink for EventProgress<'_> {
    fn report(&self, phase: IndexPhase, done: u32, total: u32, current: Option<&str>) {
        // A busy throttle means another thread is reporting right now: skip, never wait.
        let Ok(mut t) = self.throttle.try_lock() else { return };
        if !t.allow(Instant::now(), phase) {
            return;
        }
        drop(t);
        self.worker.set_status(phase, done, total);
        self.worker.emit_progress(phase, done, total, current.map(str::to_string), None);
    }
}

struct Worker {
    root: PathBuf,
    generation: u64,
    shared: Arc<Shared>,
    reg: Arc<RegistryInner>,
    tx: Sender<Msg>,
}

impl Worker {
    fn project(&self) -> String {
        self.root.to_string_lossy().into_owned()
    }

    fn log(&self, kind: &str, message: &str) {
        self.reg.log.write(kind, message);
    }

    fn set_status(&self, phase: IndexPhase, done: u32, total: u32) {
        let mut s = self.shared.status.lock().unwrap_or_else(|p| p.into_inner());
        s.phase = phase;
        s.done = done;
        s.total = total;
        drop(s);
        self.shared.status_cv.notify_all();
    }

    fn emit_progress(&self, phase: IndexPhase, done: u32, total: u32, current: Option<String>, message: Option<String>) {
        let p = IndexProgress { project: self.project(), generation: self.generation, phase, done, total, percent: percent_of(phase, done, total), current_file: current, message };
        if let Ok(v) = serde_json::to_value(p) {
            self.reg.events.emit(EVENT_PROGRESS, v);
        }
    }

    fn finish(&self, phase: IndexPhase, message: Option<String>) {
        self.set_status(phase, 0, 0);
        self.emit_progress(phase, 0, 0, None, message);
    }

    fn run(self, rx: Receiver<Msg>) {
        let root_text = self.project();
        self.log("INFO", &format!("index {root_text}: start (generation {})", self.generation));
        // The watcher starts BEFORE the listing: changes during the build wait in the queue and are
        // compared by stat afterwards, so nothing is lost and nothing breaks if a file is seen twice.
        let tx = self.tx.clone();
        let session = WatchSession::start(&self.root, self.reg.watcher.clone(), self.reg.cfg.watch.clone(), move |b| {
            let _ = tx.send(Msg::Batch(b));
        });
        let _session = match session {
            Ok(s) => Some(s),
            Err(e) => {
                self.log("ERROR", &format!("index {root_text}: file watcher could not start: {e}"));
                None
            }
        };

        let slot = self.reg.slot.clone();
        let acquired = slot.acquire(&self.shared.cancel, || {
            self.set_status(IndexPhase::Queued, 0, 0);
            self.emit_progress(IndexPhase::Queued, 0, 0, None, None);
        });
        if !acquired {
            self.finish(IndexPhase::Cancelled, None);
            return;
        }
        let opts = BuildOptions { threads: self.reg.cfg.threads, ignore: self.reg.cfg.watch.ignore.clone() };
        let sink = EventProgress { worker: &self, throttle: Mutex::new(Throttle::new(Duration::from_millis(100))) };
        let built = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| build_index(&self.root, self.generation, &opts, &sink, &self.shared.cancel, self.reg.log.as_ref())));
        slot.release();
        let (index, report) = match built {
            Ok(Ok(r)) => r,
            Ok(Err(_)) => {
                self.log("INFO", &format!("index {root_text}: cancelled"));
                self.finish(IndexPhase::Cancelled, None);
                return;
            }
            Err(_) => {
                self.log("ERROR", &format!("index {root_text}: the build panicked"));
                self.finish(IndexPhase::Failed, Some("internal error while building the index".to_string()));
                return;
            }
        };
        self.install(index, &report);

        while let Ok(msg) = rx.recv() {
            if self.shared.cancel.load(Ordering::Relaxed) {
                break;
            }
            let handled = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| match msg {
                Msg::Stop => false,
                Msg::Batch(b) => {
                    self.handle_batch(b);
                    true
                }
                Msg::Verify(reply, reason) => {
                    let started = Instant::now();
                    let changed = self.sync(&[self.root.clone()], &HashSet::new(), reason, false, false);
                    let _ = reply.send(Ok(VerifyOutcome { changed, duration_ms: started.elapsed().as_millis() as u64 }));
                    true
                }
            }));
            match handled {
                Ok(true) => {}
                Ok(false) => break,
                Err(_) => self.log("ERROR", &format!("index {root_text}: an update panicked, the index may be out of date")),
            }
        }
        self.finish(IndexPhase::Cancelled, None);
    }

    fn install(&self, index: ProjectIndex, report: &BuildReport) {
        let counts = index.counts();
        *self.shared.index.write().unwrap_or_else(|p| p.into_inner()) = index;
        {
            let mut s = self.shared.status.lock().unwrap_or_else(|p| p.into_inner());
            s.phase = IndexPhase::Ready;
            s.done = counts.objects;
            s.total = counts.objects;
            s.files = counts.files;
            s.objects = counts.objects;
            s.references = counts.references;
            s.last_build_ms = Some(report.total_ms);
        }
        self.shared.status_cv.notify_all();
        self.emit_progress(IndexPhase::Ready, counts.objects, counts.objects, None, Some(format!("{} ms", report.total_ms)));
        self.log(
            "PERF",
            &format!(
                "index {}: {} files, {} models, {} references ({} unresolved), {} broken; list {} ms, read {} ms, link {} ms, total {} ms",
                self.root.display(),
                counts.files,
                counts.objects,
                counts.references,
                report.unresolved,
                report.broken,
                report.list_ms,
                report.read_ms,
                report.link_ms,
                report.total_ms
            ),
        );
    }

    fn handle_batch(&self, batch: Batch) {
        let own: HashSet<FileKey> = batch.paths.iter().filter(|p| p.own).map(|p| path_key(&p.path)).collect();
        let root_text = self.project();
        let (paths, reason, force_full) = match batch.kind {
            BatchKind::Normal => (batch.paths.iter().map(|p| p.path.clone()).collect::<Vec<_>>(), ChangeReason::Watcher, false),
            BatchKind::Flood(FloodReason::GitHead) => (vec![self.root.clone()], ChangeReason::Git, true),
            BatchKind::Flood(_) => (vec![self.root.clone()], ChangeReason::Flood, true),
            BatchKind::Rescan(_) => (vec![self.root.clone()], ChangeReason::Rescan, true),
        };
        if force_full {
            self.log("INFO", &format!("index {root_text}: {reason:?} change, comparing the whole project"));
        }
        let started = Instant::now();
        let changed = self.sync(&paths, &own, reason, force_full, batch.modules_changed);
        if changed as usize > PERF_LOG_ABOVE {
            self.log("PERF", &format!("index {root_text}: {changed} files re-read in {} ms", started.elapsed().as_millis()));
        }
        // Many events at once: the OS buffer may have overflowed. Compare everything to be sure.
        if batch.verify_after && batch.kind == BatchKind::Normal {
            self.sync(&[self.root.clone()], &HashSet::new(), ChangeReason::Rescan, false, false);
        }
    }

    /// Compares `paths` with the index, enters the differences and tells the UI. Returns how many files differed.
    fn sync(&self, paths: &[PathBuf], own: &HashSet<FileKey>, reason: ChangeReason, force_full: bool, modules: bool) -> u32 {
        let rules = &self.reg.cfg.watch.ignore;
        let new_modules = {
            let current = self.shared.index.read().unwrap_or_else(|p| p.into_inner());
            let check = modules || stamps_differ(&current.modules, &module_stamps(&self.root));
            drop(current);
            check.then(|| scan_modules(&self.root))
        };
        let delta = {
            let index = self.shared.index.read().unwrap_or_else(|p| p.into_inner());
            match compute_delta(&index, paths, own, rules, self.reg.cfg.threads, &self.shared.cancel) {
                Ok(d) => d,
                Err(_) => return 0,
            }
        };
        let modules_changed = new_modules.is_some();
        let (applied, counts) = {
            let mut index = self.shared.index.write().unwrap_or_else(|p| p.into_inner());
            let applied = apply_delta(&mut index, delta, own);
            if let Some(m) = new_modules {
                index.modules = m;
            }
            (applied, index.counts())
        };
        {
            let mut s = self.shared.status.lock().unwrap_or_else(|p| p.into_inner());
            s.files = counts.files;
            s.objects = counts.objects;
            s.references = counts.references;
        }
        let count = applied.changed.len() as u32;
        if applied.changed.is_empty() && !modules_changed {
            return 0;
        }
        let reason = if modules_changed && applied.changed.is_empty() { ChangeReason::Modules } else { reason };
        let own_only = !modules_changed && applied.changed.iter().all(|c| c.own);
        let full = force_full || applied.changed.len() > FULL_RELOAD_ABOVE;
        let truncated = applied.changed.len() > MAX_CHANGED_FILES;
        let mut changed = applied.changed;
        changed.truncate(MAX_CHANGED_FILES);
        let payload = ProjectChanged { project: self.project(), generation: self.generation, reason, changed, truncated, affected: applied.affected, modules_changed, full, own_only };
        if let Ok(v) = serde_json::to_value(payload) {
            self.reg.events.emit(EVENT_CHANGED, v);
        }
        count
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::build::testing::*;
    use crate::log::testing::FakeLog;
    use file_watcher::{BatchKind as BK, RescanReason};
    use platform::{PlatformError, WatchEvent, WatchEventKind, WatchHandle, WatchTarget};
    use serde_json::Value;

    #[derive(Default)]
    struct FakeEvents(Mutex<Vec<(String, Value)>>);
    impl EventSink for FakeEvents {
        fn emit(&self, event: &str, payload: Value) {
            self.0.lock().unwrap().push((event.to_string(), payload));
        }
    }

    /// Watcher that never reports anything by itself; the test feeds batches directly.
    struct SilentWatcher {
        tx: Mutex<Option<Sender<WatchEvent>>>,
    }
    impl FileWatcher for SilentWatcher {
        fn watch_targets(&self, _t: &[WatchTarget]) -> Result<WatchHandle, PlatformError> {
            let (tx, rx) = channel();
            *self.tx.lock().unwrap() = Some(tx);
            Ok(WatchHandle::new(rx, ()))
        }
    }

    fn registry() -> (IndexRegistry, Arc<FakeEvents>, Arc<SilentWatcher>, Arc<FakeLog>) {
        let events = Arc::new(FakeEvents::default());
        let watcher = Arc::new(SilentWatcher { tx: Mutex::new(None) });
        let log = Arc::new(FakeLog::default());
        let cfg = ServiceConfig { watch: WatchConfig { quiet: Duration::from_millis(30), max_wait: Duration::from_millis(100), ..WatchConfig::default() }, threads: 4 };
        (IndexRegistry::with_config(events.clone(), log.clone(), watcher.clone(), cfg), events, watcher, log)
    }

    fn events_named(events: &FakeEvents, name: &str) -> Vec<Value> {
        events.0.lock().unwrap().iter().filter(|(n, _)| n == name).map(|(_, v)| v.clone()).collect()
    }

    fn wait_for(mut cond: impl FnMut() -> bool) -> bool {
        let deadline = Instant::now() + Duration::from_secs(10);
        while Instant::now() < deadline {
            if cond() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        false
    }

    #[test]
    fn start_gives_progress_up_to_ready_and_a_readable_index() {
        let root = temp_project();
        write_object(&root, "entity", "A_entity", &entity("A_entity"));
        write_object(&root, "neonContext", "C", &context("C", "A_entity"));
        let (reg, events, _w, log) = registry();
        assert_eq!(reg.ensure_started(&root), StartOutcome::Started);
        let h = reg.get(&root).unwrap();
        assert!(h.wait_ready(Duration::from_secs(10)));
        assert_eq!(h.read(|i| i.objects.len()), Some(2));
        let progress = events_named(&events, EVENT_PROGRESS);
        assert_eq!(progress.last().unwrap()["phase"], "ready");
        assert_eq!(progress.last().unwrap()["percent"], 100);
        let generations: HashSet<u64> = progress.iter().map(|p| p["generation"].as_u64().unwrap()).collect();
        assert_eq!(generations.len(), 1);
        assert!(log.0.lock().unwrap().iter().any(|(k, m)| k == "PERF" && m.contains("2 models")));
        assert_eq!(reg.ensure_started(&root), StartOutcome::Ready);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_change_report_reaches_the_ui_and_own_writes_are_marked() {
        let root = temp_project();
        let a = write_object(&root, "neonContext", "A", &context("A", "X_entity"));
        let (reg, events, _w, _l) = registry();
        reg.ensure_started(&root);
        let h = reg.get(&root).unwrap();
        assert!(h.wait_ready(Duration::from_secs(10)));

        std::fs::write(&a, format!("{}<!-- changed -->", context("A", "Y_entity"))).unwrap();
        // The app wrote this file itself.
        platform::fs::note_own_change(&a);
        h.tx.lock().unwrap().send(Msg::Batch(Batch {
            root: root.clone(),
            paths: vec![file_watcher::TouchedPath { path: a.clone(), own: true }],
            kind: BK::Normal,
            modules_changed: false,
            raw_events: 1,
            verify_after: false,
        }))
        .unwrap();
        assert!(wait_for(|| !events_named(&events, EVENT_CHANGED).is_empty()));
        let c = &events_named(&events, EVENT_CHANGED)[0];
        assert_eq!(c["ownOnly"], true);
        assert_eq!(c["changed"][0]["kind"], "modified");
        assert_eq!(c["changed"][0]["name"], "A");
        assert_eq!(c["reason"], "watcher");
        assert_eq!(h.read(|i| i.problems().len()), Some(1));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_batch_during_the_build_is_applied_after_ready() {
        let root = temp_project();
        for i in 0..30 {
            write_object(&root, "entity", &format!("E{i}_entity"), &entity(&format!("E{i}_entity")));
        }
        let (reg, events, w, _l) = registry();
        reg.ensure_started(&root);
        let late = write_object(&root, "entity", "Late_entity", &entity("Late_entity"));
        let h = reg.get(&root).unwrap();
        // Queue the batch right away, before or during the build.
        h.tx.lock().unwrap().send(Msg::Batch(Batch { root: root.clone(), paths: vec![file_watcher::TouchedPath { path: late, own: false }], kind: BK::Normal, modules_changed: false, raw_events: 1, verify_after: false })).unwrap();
        assert!(h.wait_ready(Duration::from_secs(10)));
        assert!(wait_for(|| h.read(|i| i.objects.len()) == Some(31)));
        let _ = (events, w);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_rescan_batch_compares_the_whole_project() {
        let root = temp_project();
        write_object(&root, "entity", "A_entity", &entity("A_entity"));
        let (reg, events, _w, _l) = registry();
        reg.ensure_started(&root);
        let h = reg.get(&root).unwrap();
        assert!(h.wait_ready(Duration::from_secs(10)));
        write_object(&root, "entity", "B_entity", &entity("B_entity"));
        h.tx.lock().unwrap().send(Msg::Batch(Batch { root: root.clone(), paths: vec![], kind: BK::Rescan(RescanReason::OsReported), modules_changed: false, raw_events: 0, verify_after: false })).unwrap();
        assert!(wait_for(|| !events_named(&events, EVENT_CHANGED).is_empty()));
        let c = &events_named(&events, EVENT_CHANGED)[0];
        assert_eq!(c["full"], true);
        assert_eq!(c["reason"], "rescan");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn verify_finds_changes_without_any_watcher_event() {
        let root = temp_project();
        write_object(&root, "entity", "A_entity", &entity("A_entity"));
        let (reg, events, _w, _l) = registry();
        reg.ensure_started(&root);
        let h = reg.get(&root).unwrap();
        assert!(h.wait_ready(Duration::from_secs(10)));
        write_object(&root, "entity", "B_entity", &entity("B_entity"));
        let out = h.verify().unwrap();
        assert_eq!(out.changed, 1);
        assert_eq!(events_named(&events, EVENT_CHANGED)[0]["reason"], "focus");
        assert_eq!(h.verify().unwrap().changed, 0);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn stop_during_the_build_gives_one_cancelled_and_nothing_after() {
        let root = temp_project();
        for i in 0..200 {
            write_object(&root, "entity", &format!("E{i}_entity"), &entity(&format!("E{i}_entity")));
        }
        let (reg, events, _w, _l) = registry();
        reg.ensure_started(&root);
        let h = reg.get(&root).unwrap();
        reg.stop(&root);
        assert!(!h.wait_ready(Duration::from_secs(10)) || h.status().phase == IndexPhase::Ready);
        std::thread::sleep(Duration::from_millis(300));
        let progress = events_named(&events, EVENT_PROGRESS);
        let cancelled = progress.iter().filter(|p| p["phase"] == "cancelled").count();
        assert!(cancelled <= 1);
        let count_after = events.0.lock().unwrap().len();
        std::thread::sleep(Duration::from_millis(300));
        assert_eq!(events.0.lock().unwrap().len(), count_after, "no events after the end");
        assert!(reg.get(&root).is_none());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn the_second_project_waits_in_the_queue() {
        let r1 = temp_project();
        let r2 = temp_project();
        for i in 0..300 {
            write_object(&r1, "entity", &format!("E{i}_entity"), &entity(&format!("E{i}_entity")));
        }
        write_object(&r2, "entity", "Only_entity", &entity("Only_entity"));
        let (reg, events, _w, _l) = registry();
        reg.ensure_started(&r1);
        reg.ensure_started(&r2);
        let h2 = reg.get(&r2).unwrap();
        assert!(h2.wait_ready(Duration::from_secs(30)));
        assert!(reg.get(&r1).unwrap().wait_ready(Duration::from_secs(30)));
        let _ = events;
        std::fs::remove_dir_all(&r1).ok();
        std::fs::remove_dir_all(&r2).ok();
    }

    #[test]
    fn watch_events_from_the_watcher_become_a_change_event() {
        let root = temp_project();
        let a = write_object(&root, "entity", "A_entity", &entity("A_entity"));
        let (reg, events, w, _l) = registry();
        reg.ensure_started(&root);
        let h = reg.get(&root).unwrap();
        assert!(h.wait_ready(Duration::from_secs(10)));
        std::fs::write(&a, format!("{}<!-- more -->", entity("A_entity"))).unwrap();
        let tx = w.tx.lock().unwrap().clone().unwrap();
        tx.send(WatchEvent { path: a, kind: WatchEventKind::Modified }).unwrap();
        assert!(wait_for(|| !events_named(&events, EVENT_CHANGED).is_empty()));
        assert_eq!(events_named(&events, EVENT_CHANGED)[0]["changed"][0]["name"], "A_entity");
        std::fs::remove_dir_all(&root).ok();
    }
}
