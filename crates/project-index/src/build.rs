//! Voller Aufbau des Index in Phasen: Dateien auflisten, Objekte parallel lesen (jede Datei einmal),
//! verknüpfen. Rein und ohne eigenen Thread testbar (`build_index`), mit Abbruch und Fortschritt.

use crate::analyze::{analyze_file, problem, FileAnalysis};
use crate::events::IndexPhase;
use crate::layout::object_of;
use crate::log::{IndexLog, WarnBudget};
use crate::model::{FileEntry, FileKey, ObjectEntry, ProjectIndex};
use crate::modules::scan_modules;
use crate::progress::ProgressSink;
use app_base::parallel::{io_threads, parallel_map};
use file_watcher::IgnoreRules;
use platform::fs::{path_key, stamp_of};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::Instant;

/// The build was cancelled (project closed or rebuilt).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Cancelled;

pub struct BuildOptions {
    pub threads: usize,
    pub ignore: IgnoreRules,
}

impl Default for BuildOptions {
    fn default() -> Self {
        Self { threads: io_threads(), ignore: IgnoreRules::standard() }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct BuildReport {
    pub list_ms: u64,
    pub read_ms: u64,
    pub link_ms: u64,
    pub total_ms: u64,
    pub broken: u32,
    pub unresolved: u32,
}

/// What reading one object file gave.
pub(crate) enum ObjectRead {
    Analyzed(FileAnalysis),
    Unreadable(String),
    Panicked,
}

/// Reads the file once and analyzes it. A panic in the parser never escapes.
pub(crate) fn read_object(path: &Path, object_type: &'static str, name: &str) -> ObjectRead {
    let bytes = match std::fs::read(path) {
        Ok(b) => b,
        Err(e) => return ObjectRead::Unreadable(e.to_string()),
    };
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| analyze_file(path, &bytes, object_type, name))) {
        Ok(a) => ObjectRead::Analyzed(a),
        Err(_) => ObjectRead::Panicked,
    }
}

/// Puts the result of `read_object` into the index (object, name, references, problems).
pub(crate) fn store_object(index: &mut ProjectIndex, key: &FileKey, path: &Path, object_type: &'static str, name: &str, read: ObjectRead) {
    let (analysis, parsed_problem) = match read {
        ObjectRead::Analyzed(a) => (a, None),
        ObjectRead::Unreadable(e) => (FileAnalysis::default(), Some(format!("the file cannot be read: {e}"))),
        ObjectRead::Panicked => (FileAnalysis::default(), Some("internal error while reading the file".to_string())),
    };
    let mut problems = analysis.problems;
    if let Some(message) = parsed_problem {
        problems.push(problem(path, name, object_type, "parse", "Error", message));
    }
    index.objects.insert(
        key.clone(),
        ObjectEntry { object_type, name: name.to_string(), root_tag: analysis.root_tag, parsed: analysis.parsed, alias_target_name: analysis.alias_target_name },
    );
    index.by_name.insert((object_type, name.to_string()), key.clone());
    index.refs.set_file(key, analysis.refs);
    if problems.is_empty() {
        index.static_problems.remove(key);
    } else {
        index.static_problems.insert(key.clone(), problems);
    }
}

/// Removes an object file and everything the index knows about it.
pub(crate) fn forget_file(index: &mut ProjectIndex, key: &FileKey) {
    index.files.remove(key);
    if let Some(obj) = index.objects.remove(key) {
        let name_key = (obj.object_type, obj.name);
        if index.by_name.get(&name_key) == Some(key) {
            index.by_name.remove(&name_key);
        }
    }
    index.refs.remove_file(key);
    index.static_problems.remove(key);
}

/// All files below `dir` that are not ignored. `root` is the project folder (for the relative path).
pub(crate) fn walk_files(root: &Path, dir: &Path, rules: &IgnoreRules, cancel: &AtomicBool, mut on_found: impl FnMut(usize)) -> Result<Vec<FileEntry>, Cancelled> {
    let root_comps = root.components().count();
    let mut out = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        if cancel.load(Ordering::Relaxed) {
            return Err(Cancelled);
        }
        let Ok(read) = std::fs::read_dir(&d) else { continue };
        for e in read.flatten() {
            let Ok(ft) = e.file_type() else { continue };
            let name = e.file_name().to_string_lossy().into_owned();
            let path = e.path();
            if ft.is_dir() {
                if !rules.is_ignored_folder_name(&name) {
                    stack.push(path);
                }
                continue;
            }
            let rel = rel_of(&path, root_comps);
            if rules.is_ignored(&rel) {
                continue;
            }
            let stamp = e.metadata().ok().map(|m| stamp_of(&m));
            out.push(FileEntry { path, rel, stamp });
        }
        on_found(out.len());
    }
    Ok(out)
}

pub(crate) fn rel_of(path: &Path, root_components: usize) -> String {
    path.components().skip(root_components).map(|c| c.as_os_str().to_string_lossy().into_owned()).collect::<Vec<_>>().join("/")
}

fn ms(t: Instant) -> u64 {
    t.elapsed().as_millis() as u64
}

/// Builds the whole index of `root`. Nothing is shared while it runs; the caller swaps the result in.
pub fn build_index(
    root: &Path,
    generation: u64,
    opts: &BuildOptions,
    progress: &dyn ProgressSink,
    cancel: &AtomicBool,
    log: &dyn IndexLog,
) -> Result<(ProjectIndex, BuildReport), Cancelled> {
    let started = Instant::now();
    let mut report = BuildReport::default();

    // 1. listing
    progress.report(IndexPhase::Listing, 0, 0, None);
    let listed = walk_files(root, root, &opts.ignore, cancel, |n| progress.report(IndexPhase::Listing, n as u32, 0, None))?;
    report.list_ms = ms(started);

    // 2. reading (the modules are scanned on their own thread at the same time)
    let read_started = Instant::now();
    let mut index = ProjectIndex { root: root.to_path_buf(), generation, ..ProjectIndex::default() };
    let mut files: BTreeMap<FileKey, FileEntry> = BTreeMap::new();
    let mut jobs: Vec<(FileKey, PathBuf, &'static str, String, String)> = Vec::new();
    for f in listed {
        let key = path_key(&f.path);
        if let Some((object_type, name)) = object_of(&f.rel) {
            jobs.push((key.clone(), f.path.clone(), object_type, name, f.rel.clone()));
        }
        files.insert(key, f);
    }
    let total = jobs.len() as u32;
    progress.report(IndexPhase::Reading, 0, total, None);
    let done = AtomicU32::new(0);
    let (results, modules) = std::thread::scope(|scope| {
        let modules = scope.spawn(|| scan_modules(root));
        let results = parallel_map(&jobs, opts.threads, |(_, path, object_type, name, rel)| {
            if cancel.load(Ordering::Relaxed) {
                return None;
            }
            let r = read_object(path, object_type, name);
            let n = done.fetch_add(1, Ordering::Relaxed) + 1;
            progress.report(IndexPhase::Reading, n, total, Some(rel));
            Some(r)
        });
        (results, modules.join().unwrap_or_default())
    });
    if cancel.load(Ordering::Relaxed) {
        return Err(Cancelled);
    }
    report.read_ms = ms(read_started);

    // 3. linking
    let link_started = Instant::now();
    progress.report(IndexPhase::Linking, total, total, None);
    let budget = WarnBudget::new(20);
    let prefix = format!("index {}", root.display());
    for ((key, path, object_type, name, rel), read) in jobs.into_iter().zip(results) {
        let Some(read) = read else { return Err(Cancelled) };
        store_object(&mut index, &key, &path, object_type, &name, read);
        if let Some(p) = index.static_problems.get(&key).and_then(|v| v.iter().find(|p| p.source == "parse")) {
            report.broken += 1;
            budget.warn(log, &format!("{prefix}: broken model {rel}: {}", p.message));
        }
    }
    budget.finish(log, &prefix);
    index.files = files;
    index.modules = modules;
    report.unresolved = index.unresolved_count();
    report.link_ms = ms(link_started);
    report.total_ms = ms(started);
    Ok((index, report))
}

#[cfg(test)]
pub(crate) mod testing {
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    pub fn temp_project() -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("forge-pi-{}-{n}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    pub fn write_object(root: &Path, folder: &str, name: &str, text: &str) -> PathBuf {
        let dir = root.join(folder).join(name);
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join(format!("{name}.aod"));
        std::fs::write(&file, text).unwrap();
        file
    }

    pub fn context(name: &str, entity: &str) -> String {
        format!("<neonContext>\n  <name>{name}</name>\n  <entity>{entity}</entity>\n</neonContext>\n")
    }

    pub fn entity(name: &str) -> String {
        format!("<entity>\n  <name>{name}</name>\n</entity>\n")
    }
}

#[cfg(test)]
mod tests {
    use super::testing::*;
    use super::*;
    use crate::log::testing::FakeLog;
    use crate::progress::NullProgress;
    use std::sync::Mutex;

    #[derive(Default)]
    struct Recorder(Mutex<Vec<(IndexPhase, u32, u32)>>);
    impl ProgressSink for Recorder {
        fn report(&self, phase: IndexPhase, done: u32, total: u32, _c: Option<&str>) {
            self.0.lock().unwrap().push((phase, done, total));
        }
    }

    fn build(root: &Path) -> (ProjectIndex, BuildReport) {
        build_index(root, 1, &BuildOptions::default(), &NullProgress, &AtomicBool::new(false), &FakeLog::default()).unwrap()
    }

    #[test]
    fn builds_files_objects_and_references() {
        let root = temp_project();
        write_object(&root, "entity", "Used_entity", &entity("Used_entity"));
        write_object(&root, "neonContext", "A", &context("A", "Used_entity"));
        std::fs::write(root.join("entity/Used_entity/helper.js"), "x").unwrap();
        std::fs::create_dir_all(root.join("dist")).unwrap();
        std::fs::write(root.join("dist/out.js"), "x").unwrap();
        let (index, report) = build(&root);
        assert_eq!(index.objects.len(), 2);
        assert_eq!(index.files.len(), 3, "the .js file counts, dist does not");
        assert_eq!(index.refs.count(), 1);
        assert_eq!(report.broken, 0);
        assert_eq!(report.unresolved, 0);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_broken_file_becomes_a_problem_not_an_error() {
        let root = temp_project();
        write_object(&root, "entity", "Broken_entity", "<entity><name>x</name></wrong>");
        write_object(&root, "entity", "Fine_entity", &entity("Fine_entity"));
        let log = FakeLog::default();
        let (index, report) = build_index(&root, 1, &BuildOptions::default(), &NullProgress, &AtomicBool::new(false), &log).unwrap();
        assert_eq!(index.objects.len(), 2);
        assert_eq!(report.broken, 1);
        assert!(log.0.lock().unwrap().iter().any(|(k, m)| k == "WARN" && m.contains("broken model")));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn cancel_gives_cancelled() {
        let root = temp_project();
        write_object(&root, "entity", "A_entity", &entity("A_entity"));
        let r = build_index(&root, 1, &BuildOptions::default(), &NullProgress, &AtomicBool::new(true), &FakeLog::default());
        assert!(r.is_err());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn progress_rises_and_ends_at_the_total() {
        let root = temp_project();
        for i in 0..20 {
            write_object(&root, "entity", &format!("E{i}_entity"), &entity(&format!("E{i}_entity")));
        }
        let rec = Recorder::default();
        build_index(&root, 1, &BuildOptions { threads: 1, ..BuildOptions::default() }, &rec, &AtomicBool::new(false), &FakeLog::default()).unwrap();
        let events = rec.0.lock().unwrap();
        let reading: Vec<u32> = events.iter().filter(|e| e.0 == IndexPhase::Reading).map(|e| e.1).collect();
        assert!(reading.windows(2).all(|w| w[0] <= w[1]), "{reading:?}");
        assert_eq!(*reading.last().unwrap(), 20);
        assert_eq!(events.last().unwrap().0, IndexPhase::Linking);
        std::fs::remove_dir_all(&root).ok();
    }
}
