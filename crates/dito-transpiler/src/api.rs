// Öffentliche Schnittstelle des Crates: `Builder::build` liefert ein `BuildResult`.
// Noch Gerüst: es entdeckt Module und baut das Overlay. Artefakte kommen mit den nächsten Phasen.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::cache;
use crate::discover::{self, DiscoverError};
use crate::format::FormatId;
use crate::overlay::Overlay;
use crate::pipeline::{self, OutputFile};
use crate::sink;

/// Abbruch-Schalter (C#: `CancellationToken`). Wird zwischen den Schritten geprüft.
#[derive(Clone, Default)]
pub struct CancelToken(Arc<AtomicBool>);

impl CancelToken {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn cancel(&self) {
        self.0.store(true, Ordering::Relaxed);
    }
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Relaxed)
    }
}

#[derive(Debug, Clone)]
pub struct BuildConfig {
    pub project_root: PathBuf,
    pub format: FormatId,
    /// Ort für `dist`. `None`: nichts auf die Platte schreiben (Vorgabe, wegen Virenscanner).
    pub materialize_dist: Option<PathBuf>,
    /// 0 = alle Kerne.
    pub threads: usize,
    /// Cache-Datei (eine je Projekt, siehe `cache`). `None`: ohne Cache bauen.
    pub cache_file: Option<PathBuf>,
}

impl BuildConfig {
    /// Mit dem Cache an seinem üblichen Ort (`%LOCALAPPDATA%\DitoDesigner\transpile-cache`).
    pub fn with_default_cache(project_root: impl Into<PathBuf>) -> Self {
        let root: PathBuf = project_root.into();
        let mut config = Self::new(root.clone());
        config.cache_file = Some(crate::cache::default_cache_file(&root));
        config
    }

    pub fn new(project_root: impl Into<PathBuf>) -> Self {
        Self { project_root: project_root.into(), format: FormatId::V2, materialize_dist: None, threads: 0, cache_file: None }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Severity {
    Info,
    Warning,
    Error,
}

/// Meldung mit Quellen. Konflikte nennen immer alle beteiligten Dateien (siehe Plan, "Reihenfolge ist Pflicht").
#[derive(Debug, Clone)]
pub struct Diagnostic {
    pub severity: Severity,
    pub message: String,
    pub sources: Vec<PathBuf>,
}

#[derive(Debug, Clone, Default)]
pub struct BuildStats {
    pub modules: usize,
    pub overlay_files: usize,
    pub ignored_files: usize,
    pub output_files: usize,
    pub written: usize,
    pub unchanged: usize,
    pub write_failed: usize,
    /// Das Ergebnis kam ganz aus dem Cache (Planen entfiel).
    pub cache_hit: bool,
    pub cache_time: Duration,
    pub discover_time: Duration,
    pub overlay_time: Duration,
    pub plan_time: Duration,
    pub write_time: Duration,
    pub total_time: Duration,
}

#[derive(Debug, Default)]
pub struct BuildResult {
    /// Geteilt, damit das Schreiben des Caches im Hintergrund nichts kopieren muss.
    pub files: Arc<Vec<OutputFile>>,
    pub diagnostics: Vec<Diagnostic>,
    pub stats: BuildStats,
    pending_cache: Option<std::thread::JoinHandle<()>>,
}

impl BuildResult {
    /// Wartet, bis der Cache im Hintergrund geschrieben ist (für Programme, die gleich enden, und für Tests).
    pub fn wait_for_cache(&mut self) {
        if let Some(handle) = self.pending_cache.take() {
            let _ = handle.join();
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum BuildError {
    #[error(transparent)]
    Discover(#[from] DiscoverError),
    #[error("Abgebrochen")]
    Cancelled,
    #[error("dist konnte nicht geschrieben werden: {0}")]
    Write(std::io::Error),
}

pub struct Builder {
    config: BuildConfig,
}

impl Builder {
    pub fn new(config: BuildConfig) -> Self {
        Self { config }
    }

    pub fn config(&self) -> &BuildConfig {
        &self.config
    }

    pub fn build(&self, cancel: &CancelToken) -> Result<BuildResult, BuildError> {
        self.build_with_progress(cancel, &|_, _| {})
    }

    /// Wie `build`, meldet aber den Fortschritt (Prozent 0 bis 100 und die Stufe) an `progress`.
    pub fn build_with_progress(&self, cancel: &CancelToken, progress: &dyn Fn(u8, &str)) -> Result<BuildResult, BuildError> {
        let started = Instant::now();
        let mut result = BuildResult::default();
        progress(2, "Finding the modules");

        let t = Instant::now();
        let modules = discover::discover_modules(&self.config.project_root)?;
        result.stats.discover_time = t.elapsed();
        result.stats.modules = modules.len();
        progress(10, "Listing the files");
        if cancel.is_cancelled() {
            return Err(BuildError::Cancelled);
        }

        let t = Instant::now();
        let overlay = Overlay::build(&modules);
        result.stats.overlay_time = t.elapsed();
        result.stats.overlay_files = overlay.len();
        result.stats.ignored_files = overlay.ignored_count();
        result.diagnostics.extend(overlay.diagnostics().iter().cloned());
        if cancel.is_cancelled() {
            return Err(BuildError::Cancelled);
        }

        progress(30, "Checking the cache");
        // Cache: gleicher Fingerabdruck der Eingaben, dann steht das Ergebnis schon da.
        let (print, newest_input) = cache::fingerprint(&modules, &overlay, self.config.format);
        let mut cached = None;
        if let Some(file) = &self.config.cache_file {
            let t = Instant::now();
            cached = cache::load(file, print);
            result.stats.cache_time = t.elapsed();
        }

        match cached {
            Some(hit) => {
                result.stats.cache_hit = true;
                result.files = Arc::new(hit.files);
                result.diagnostics.extend(hit.diagnostics);
            }
            None => {
                progress(40, "Building the models");
                let t = Instant::now();
                let (files, notes) = pipeline::plan_outputs(&overlay, &modules);
                result.stats.plan_time = t.elapsed();
                result.files = Arc::new(files);
                if let Some(file) = self.config.cache_file.clone() {
                    let (files, saved_notes) = (result.files.clone(), notes.clone());
                    result.pending_cache = Some(std::thread::spawn(move || {
                        // Fehler beim Speichern sind kein Fehler des Laufs: der nächste Lauf baut dann eben neu.
                        let _ = cache::store(&file, print, newest_input, &files, &saved_notes);
                    }));
                }
                result.diagnostics.extend(notes);
            }
        }
        result.stats.output_files = result.files.len();
        if cancel.is_cancelled() {
            return Err(BuildError::Cancelled);
        }

        progress(85, "Writing the result");
        if let Some(dist) = &self.config.materialize_dist {
            let t = Instant::now();
            let written = sink::write_dist(&result.files, dist).map_err(BuildError::Write)?;
            result.stats.written = written.written;
            result.stats.unchanged = written.unchanged;
            result.stats.write_failed = written.failed;
            result.stats.write_time = t.elapsed();
        }

        result.stats.total_time = started.elapsed();
        progress(100, "Done");
        Ok(result)
    }
}
