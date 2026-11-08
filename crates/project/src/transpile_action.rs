//! Die `Action` hinter der Wahl der Transpiler-Engine (id `"transpile"`, siehe `actions::dispatch_action`).
//!
//! Dieses Modul kennt nur die `plugin_api::TranspilerRegistry`, nie einen konkreten offiziellen
//! Transpiler. Die App baut die Registry beim Start: `native` (eigene Engine, [`NativeTranspiler`])
//! ist immer da, `adito` (offizieller Transpiler) nur, wenn das Plugin eingebaut ist.
//! Fehlt ein gewuenschter Transpiler, faellt die Wahl auf die Vorgabe der Registry zurueck.
//!
//! Der Lauf schreibt in einen `dist`-Ordner und aendert keine `.aod`-Datei. Er geht deshalb nicht durch
//! `ProjectActorHandle` und die Undo-Historie, sondern durch die allgemeine `Action`-Schnittstelle.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use native_transpiler::{IncrementalEngine, OwnEngine};
use plugin_api::action::{Action, ActionError};
use plugin_api::transpiler::{Progress, ProgressSink, TranspileOptions, TranspileOutcome, Transpiler, TranspilerRegistry};
use plugin_api::types::{ActionContext, Transaction};

/// ID der eigenen Engine in der Registry.
pub const NATIVE_ID: &str = "native";
/// ID des offiziellen ADITO-Transpilers in der Registry.
pub const OFFICIAL_ID: &str = "adito";

/// Welche Engine ein `"transpile"`-Aufruf nutzt. Standard ist `ExperimentalForge` (die eigene
/// Engine). Nur der Wert `"official"` wählt den offiziellen Transpiler. Fehlt der Param oder ist
/// er unbekannt, gilt `ExperimentalForge`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TranspilerEngine {
    Official,
    ExperimentalForge,
}

impl Default for TranspilerEngine {
    fn default() -> Self {
        TranspilerEngine::ExperimentalForge
    }
}

impl TranspilerEngine {
    /// Liest den Action-Param `engine`. Nur der genaue Wert `"official"` wählt `Official`,
    /// alles andere ist `ExperimentalForge` (kein Fehler).
    pub fn from_param(value: Option<&str>) -> Self {
        match value {
            Some("official") => TranspilerEngine::Official,
            _ => TranspilerEngine::ExperimentalForge,
        }
    }
}

/// Output directory the experimental engine writes to. Deliberately distinct from
/// `native-transpiler`'s own `_own_engine_dist` convention so a transpile triggered from the
/// app UI is never mistaken for (or clobbered by) a native-transpiler corpus run against the
/// same project copy.
fn experimental_output_dir(project_home: &Path) -> PathBuf {
    project_home.join("dist")
}

type BuildLogSink = Arc<dyn Fn(bool, &str) + Send + Sync>;
static BUILD_LOG_SINK: OnceLock<BuildLogSink> = OnceLock::new();
type ProgressReporter = Arc<dyn Fn(u8, &str) + Send + Sync>;
static PROGRESS_REPORTER: Mutex<Option<ProgressReporter>> = Mutex::new(None);
static TRANSPILERS: OnceLock<Arc<TranspilerRegistry>> = OnceLock::new();

/// Receives every line of the official transpiler while it runs (`true` = stderr). The shell
/// registers one sink at start-up and shows the lines in Output > Build.
pub fn set_build_log_sink(sink: BuildLogSink) {
    let _ = BUILD_LOG_SINK.set(sink);
}

/// Die Registry, mit der die Action arbeitet. Die App setzt sie einmal beim Start.
pub fn set_transpilers(registry: Arc<TranspilerRegistry>) {
    let _ = TRANSPILERS.set(registry);
}

/// Die gesetzte Registry, sonst eine nur mit der eigenen Engine (Tests, Beispiele).
pub fn transpilers() -> Arc<TranspilerRegistry> {
    Arc::clone(TRANSPILERS.get_or_init(|| {
        let mut registry = TranspilerRegistry::new();
        registry.register(Arc::new(NativeTranspiler));
        Arc::new(registry)
    }))
}

/// Ends the running official transpiler (after the user confirmed). False when none is running.
pub fn cancel_build() -> bool {
    transpilers().cancel_any()
}

/// Receives the progress (0 to 100 and the running stage) of the built-in transpiler while it runs.
pub fn set_progress_reporter(reporter: Option<ProgressReporter>) {
    if let Ok(mut slot) = PROGRESS_REPORTER.lock() {
        *slot = reporter;
    }
}

/// Folders of a project that are never part of the snapshot: the dependencies are linked instead of copied,
/// the output and the tool folders do not influence a transpile.
const SNAPSHOT_SKIP: &[&str] = &["node_modules", "dist", ".git", ".claude", ".idea", ".vscode", ".forge-cache", ".forge-incremental-cache"];

fn snapshot_root(project_home: &Path, data_dir: &Path) -> PathBuf {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    project_home.hash(&mut hasher);
    let name = project_home.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "project".into());
    data_dir.join("transpile-snapshot").join(format!("{:x}", hasher.finish())).join(name)
}

fn mirror_dir(src: &Path, dst: &Path, top_level: bool, copied: &mut usize) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    let mut present = std::collections::HashSet::new();
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let name = entry.file_name();
        if top_level && SNAPSHOT_SKIP.iter().any(|s| name.to_string_lossy() == *s) {
            continue;
        }
        present.insert(name.clone());
        let from = entry.path();
        let to = dst.join(&name);
        let meta = entry.metadata()?;
        if meta.is_dir() {
            mirror_dir(&from, &to, false, copied)?;
        } else {
            let same = std::fs::metadata(&to).ok().is_some_and(|m| m.len() == meta.len() && m.modified().ok() == meta.modified().ok());
            if !same {
                std::fs::copy(&from, &to)?;
                if let Ok(time) = meta.modified() {
                    if let Ok(file) = std::fs::OpenOptions::new().write(true).open(&to) {
                        let _ = file.set_modified(time);
                    }
                }
                *copied += 1;
            }
        }
    }
    for entry in std::fs::read_dir(dst)? {
        let entry = entry?;
        let name = entry.file_name();
        if present.contains(&name) || (top_level && (SNAPSHOT_SKIP.iter().any(|s| name.to_string_lossy() == *s) || name.to_string_lossy().starts_with(".forge"))) {
            continue;
        }
        let path = entry.path();
        if entry.metadata()?.is_dir() { std::fs::remove_dir_all(&path)?; } else { std::fs::remove_file(&path)?; }
    }
    Ok(())
}

#[cfg(windows)]
fn link_dir(target: &Path, link: &Path) -> bool {
    std::process::Command::new("cmd").args(["/C", "mklink", "/J"]).arg(link.to_string_lossy().replace('/', "\\")).arg(target.to_string_lossy().replace('/', "\\")).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status().map(|s| s.success()).unwrap_or(false)
}

#[cfg(not(windows))]
fn link_dir(target: &Path, link: &Path) -> bool {
    std::os::unix::fs::symlink(target, link).is_ok()
}

/// A consistent copy of the project sources: the transpile reads this copy, so edits made while it runs
/// only count for the next transpile. Unchanged files are not copied again (same size and time), the
/// dependencies are linked. Returns the folder the engine reads, or the project itself when no copy is possible.
pub fn snapshot_project(project_home: &Path, data_dir: &Path) -> PathBuf {
    try_snapshot_project(project_home, data_dir).unwrap_or_else(|_| project_home.to_path_buf())
}

/// Like `snapshot_project`, but says why no copy was possible.
pub fn try_snapshot_project(project_home: &Path, data_dir: &Path) -> Result<PathBuf, String> {
    let root = snapshot_root(project_home, data_dir);
    let mut copied = 0;
    mirror_dir(project_home, &root, true, &mut copied).map_err(|e| format!("copying the project failed: {e}"))?;
    let modules = project_home.join("node_modules");
    let link = root.join("node_modules");
    if modules.is_dir() && !link.exists() && !link_dir(&modules, &link) {
        return Err("the node_modules folder could not be linked".into());
    }
    Ok(root)
}

/// Die eigene Engine als Transpiler-Plugin (ID `native`). Optionen: `forge_data_dir` (Cache und Projektkopie).
pub struct NativeTranspiler;

impl Transpiler for NativeTranspiler {
    fn id(&self) -> &'static str {
        NATIVE_ID
    }

    fn name(&self) -> &'static str {
        "Dito Transpiler"
    }

    fn transpile(&self, project_root: &Path, options: &TranspileOptions, progress: &ProgressSink) -> Result<TranspileOutcome, String> {
        let output_dir = experimental_output_dir(project_root);
        // The engine empties the folder itself when it has to write a new result; an up-to-date result stays untouched.
        std::fs::create_dir_all(&output_dir).map_err(|e| e.to_string())?;
        // The engine's cache lives in the app's own data folder, never inside the project.
        let data_dir = options.path("forge_data_dir");
        if let Some(dir) = &data_dir {
            std::env::set_var("FORGE_INCREMENTAL_CACHE_DIR", dir.join("transpile-cache"));
        }
        let source = match &data_dir {
            Some(dir) => snapshot_project(project_root, dir),
            None => project_root.to_path_buf(),
        };
        let stages = Arc::clone(progress);
        native_transpiler::own_engine::progress::set_reporter(Some(Arc::new(move |percent: u8, stage: &str| {
            stages(Progress::Stage { percent, stage: stage.to_string() });
        })));
        let result = IncrementalEngine.run(&source, &output_dir).map_err(|e| e.to_string());
        native_transpiler::own_engine::progress::set_reporter(None);
        result.map(|()| TranspileOutcome { output_dir })
    }
}

/// Runs the selected engine against `project_home`. Pure function, no `ActionContext`/
/// `Transaction` ceremony, so it is reusable from the `Action` impl below and directly from
/// tests. A missing transpiler (e.g. the official one is not built in) falls back to the registry default.
pub fn run_transpile(project_home: &Path, engine: TranspilerEngine, options: &TranspileOptions) -> Result<(), String> {
    let registry = transpilers();
    let id = match engine {
        TranspilerEngine::Official => OFFICIAL_ID,
        TranspilerEngine::ExperimentalForge => NATIVE_ID,
    };
    let transpiler = registry.select(id).ok_or_else(|| "Kein Transpiler installiert".to_string())?;
    let sink: ProgressSink = Arc::new(|event| match event {
        Progress::Log { error, line } => {
            if let Some(out) = BUILD_LOG_SINK.get() {
                out(error, &line);
            }
        }
        Progress::Stage { percent, stage } => {
            let reporter = PROGRESS_REPORTER.lock().ok().and_then(|slot| slot.clone());
            if let Some(report) = reporter {
                report(percent, &stage);
            }
        }
    });
    transpiler.transpile(project_home, options, &sink).map(|_| ())
}

/// `Action` wrapper (id `"transpile"`) around [`run_transpile`]. Always returns an empty
/// `Transaction` on success - a transpile run writes files outside the undo-tracked project
/// model (`dist/`), so there is genuinely nothing for the undo/redo path to record, not an oversight.
pub struct TranspileAction;

impl Action for TranspileAction {
    fn execute(&self, ctx: &mut ActionContext) -> Result<Transaction, ActionError> {
        let engine = TranspilerEngine::from_param(ctx.params.get("engine").map(String::as_str));
        let project_home = PathBuf::from(&ctx.target_path);
        if !project_home.is_dir() {
            return Err(ActionError::new(format!("project folder not found: {}", project_home.display())));
        }
        let mut options = TranspileOptions::new();
        for name in ["forge_data_dir", "install_dir", "user_dir"] {
            if let Some(value) = ctx.params.get(name).filter(|v| !v.trim().is_empty()) {
                options = options.with(name, value.as_str());
            }
        }
        run_transpile(&project_home, engine, &options).map(|()| Transaction::new(vec![])).map_err(ActionError::new)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_from_param_defaults_to_the_built_in_engine_for_missing_or_unknown_values() {
        assert_eq!(TranspilerEngine::from_param(None), TranspilerEngine::ExperimentalForge);
        assert_eq!(TranspilerEngine::from_param(Some("")), TranspilerEngine::ExperimentalForge);
        assert_eq!(TranspilerEngine::from_param(Some("typo")), TranspilerEngine::ExperimentalForge);
        assert_eq!(TranspilerEngine::default(), TranspilerEngine::ExperimentalForge);
    }

    #[test]
    fn engine_from_param_recognises_the_official_choice() {
        assert_eq!(TranspilerEngine::from_param(Some("official")), TranspilerEngine::Official);
        assert_eq!(TranspilerEngine::from_param(Some("experimental")), TranspilerEngine::ExperimentalForge);
    }

    #[test]
    fn transpile_action_rejects_a_project_home_that_does_not_exist_for_the_official_engine() {
        let mut ctx = ActionContext::new(r"C:\this\path\does\not\exist").with_param("engine", "official");
        let err = TranspileAction.execute(&mut ctx).unwrap_err();
        assert!(err.0.to_lowercase().contains("project") || err.0.to_lowercase().contains("not found"));
    }

    #[test]
    fn transpile_action_experimental_engine_creates_a_distinct_output_dir() {
        let tmp = std::env::temp_dir().join(format!("forge-transpile-action-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        // A bare empty directory is not a resolvable module graph root, so this is expected to
        // fail - the point of this test is that it fails INSIDE the experimental path (creates
        // `_forge_experimental_dist` before erroring on resolution), proving the engine
        // selection itself took effect rather than silently falling back to the official path
        // (which would instead try to spawn nbexec64.exe and fail differently).
        let mut ctx = ActionContext::new(tmp.to_string_lossy().into_owned()).with_param("engine", "experimental");
        let _ = TranspileAction.execute(&mut ctx);
        assert!(experimental_output_dir(&tmp).exists(), "experimental engine must create its own output dir");

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
