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
/// ID des neuen Transpilers (V2-Format, im Speicher) in der Registry.
pub const DITO_V2_ID: &str = "dito-v2";

/// Welche Engine ein `"transpile"`-Aufruf nutzt. Standard ist `Official` (der ADITO-Transpiler).
/// Nur der Wert `"experimental"` wählt die eigene Engine. Fehlt der Param oder ist er unbekannt,
/// gilt `Official`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TranspilerEngine {
    Official,
    ExperimentalForge,
    /// Der neue Transpiler `dito-transpiler` (V2-Format, im Speicher, mit Cache).
    DitoV2,
}

impl Default for TranspilerEngine {
    fn default() -> Self {
        TranspilerEngine::Official
    }
}

impl TranspilerEngine {
    /// Liest den Action-Param `engine`. Nur der genaue Wert `"experimental"` wählt
    /// `ExperimentalForge`, alles andere ist `Official` (kein Fehler).
    pub fn from_param(value: Option<&str>) -> Self {
        match value {
            Some("experimental") => TranspilerEngine::ExperimentalForge,
            Some("dito-v2") => TranspilerEngine::DitoV2,
            _ => TranspilerEngine::Official,
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

/// Wohin ein Transpile-Lauf seine fertigen Modelle legt (Deploy aus dem Speicher). Die App setzt es beim Start.
type ArtifactSink = Arc<dyn Fn(&Path, Option<Arc<Vec<plugin_api::BuildArtifact>>>) + Send + Sync>;
static ARTIFACT_SINK: OnceLock<ArtifactSink> = OnceLock::new();

pub fn set_artifact_sink(sink: ArtifactSink) {
    let _ = ARTIFACT_SINK.set(sink);
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
        result.map(|()| TranspileOutcome::new(output_dir))
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
        TranspilerEngine::DitoV2 => DITO_V2_ID,
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
    let outcome = transpiler.transpile(project_home, options, &sink)?;
    // Auch eine Engine ohne Artefakte meldet sich (mit `None`), damit ein alter Satz im Speicher nicht stehen bleibt.
    if let Some(store) = ARTIFACT_SINK.get() {
        store(project_home, outcome.artifacts);
    }
    Ok(())
}

/// Welche Transpile-Version das Projekt wählt: der Wert `version` aus `.aditoprj/transpile.version` (`V1` oder `V2`), wenn die Datei da ist.
/// Die Datei gehört dem ADITO-Plugin; wir lesen sie nur.
pub fn project_transpile_version(project_home: &Path) -> Option<String> {
    let text = std::fs::read_to_string(project_home.join(".aditoprj").join("transpile.version")).ok()?;
    text.lines().find_map(|line| line.trim().strip_prefix("version=").map(|v| v.trim().to_string())).filter(|v| !v.is_empty())
}

/// Der neue Transpiler als Plugin (ID `dito-v2`). Optionen: `write_dist` (`true`: `dist` schreiben, Vorgabe aus, wegen Virenscanner).
/// Die Modelle bleiben im Speicher und gehen an das Deploy.
pub struct DitoTranspiler {
    cancel: Mutex<Option<dito_transpiler::CancelToken>>,
}

impl DitoTranspiler {
    pub fn new() -> Self {
        Self { cancel: Mutex::new(None) }
    }
}

impl Default for DitoTranspiler {
    fn default() -> Self {
        Self::new()
    }
}

/// Aus dem Ergebnis des Transpilers die Modelle fürs Deploy: `<ordner>/<name>/<name>.aod` mit Inhalt im Speicher.
fn artifacts_of(files: &[dito_transpiler::pipeline::OutputFile]) -> Vec<plugin_api::BuildArtifact> {
    use dito_transpiler::pipeline::{Content, MODEL_FOLDERS};
    files
        .iter()
        .filter_map(|f| {
            let Content::Bytes(bytes) = &f.content else { return None };
            let mut parts = f.path.split('/');
            let (folder, name, file) = (parts.next()?, parts.next()?, parts.next()?);
            if parts.next().is_some() || !MODEL_FOLDERS.contains(&folder) || file != format!("{name}.aod") {
                return None;
            }
            Some(plugin_api::BuildArtifact { folder: folder.to_string(), name: name.to_string(), content: bytes.clone() })
        })
        .collect()
}

impl Transpiler for DitoTranspiler {
    fn id(&self) -> &'static str {
        DITO_V2_ID
    }

    fn name(&self) -> &'static str {
        "Dito Transpiler V2"
    }

    fn transpile(&self, project_root: &Path, options: &TranspileOptions, progress: &ProgressSink) -> Result<TranspileOutcome, String> {
        let write_dist = options.values.get("write_dist").is_some_and(|v| v == "true");
        let dist = project_root.join("dist");
        let mut config = dito_transpiler::BuildConfig::with_default_cache(project_root);
        if write_dist {
            config.materialize_dist = Some(dist.clone());
        }
        let token = dito_transpiler::CancelToken::new();
        *self.cancel.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = Some(token.clone());
        let stages = Arc::clone(progress);
        let result = dito_transpiler::Builder::new(config).build_with_progress(&token, &move |percent, stage| {
            stages(Progress::Stage { percent, stage: stage.to_string() });
        });
        *self.cancel.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = None;
        let mut result = result.map_err(|e| e.to_string())?;
        result.wait_for_cache();

        // Meldungen ins Build-Log: Konflikte und nicht angewendete Modifikationen sind Warnungen, reine Hinweise (Info) bleiben weg.
        let s = &result.stats;
        let mode = if s.cache_hit { "from the cache" } else { "built" };
        progress(Progress::Log { error: false, line: format!("{} models and files {mode} in {:.1} s ({} modules, {} source files)", s.output_files, s.total_time.as_secs_f64(), s.modules, s.overlay_files) });
        let mut warnings = 0;
        for d in result.diagnostics.iter().filter(|d| d.severity != dito_transpiler::Severity::Info) {
            warnings += 1;
            if warnings <= 200 {
                progress(Progress::Log { error: true, line: d.message.clone() });
            }
        }
        if warnings > 200 {
            progress(Progress::Log { error: true, line: format!("... and {} more warnings", warnings - 200) });
        }
        if write_dist {
            progress(Progress::Log { error: false, line: format!("dist: {} written, {} unchanged", s.written, s.unchanged) });
        }
        Ok(TranspileOutcome { output_dir: dist, artifacts: Some(Arc::new(artifacts_of(&result.files))) })
    }

    fn cancel(&self) -> bool {
        match self.cancel.lock().unwrap_or_else(std::sync::PoisonError::into_inner).as_ref() {
            Some(token) => {
                token.cancel();
                true
            }
            None => false,
        }
    }
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

    fn mini_project(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("dito-v2-engine-{label}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("node_modules")).unwrap();
        std::fs::create_dir_all(root.join("entity/A_entity")).unwrap();
        std::fs::write(root.join("package.json"), r#"{"name":"mini","version":"1.0.0","adito":{"type":"project"}}"#).unwrap();
        std::fs::write(
            root.join("entity/A_entity/A_entity.aod"),
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\r\n<entity>\r\n  <name>A_entity</name>\r\n  <majorModelMode>DISTRIBUTED</majorModelMode>\r\n</entity>\r\n",
        )
        .unwrap();
        root
    }

    #[test]
    fn engine_from_param_knows_the_new_transpiler() {
        assert_eq!(TranspilerEngine::from_param(Some("dito-v2")), TranspilerEngine::DitoV2);
    }

    #[test]
    fn transpile_version_is_read_from_the_project_file() {
        let root = std::env::temp_dir().join(format!("dito-v2-version-{}", std::process::id()));
        std::fs::create_dir_all(root.join(".aditoprj")).unwrap();
        assert_eq!(project_transpile_version(&root), None);
        std::fs::write(root.join(".aditoprj/transpile.version"), "#generated
transpileToolChecksum=abc
version=V2
").unwrap();
        assert_eq!(project_transpile_version(&root).as_deref(), Some("V2"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_new_transpiler_returns_the_models_in_memory_and_writes_no_dist_by_default() {
        let root = mini_project("memory");
        let events = Arc::new(Mutex::new(Vec::<Progress>::new()));
        let log = Arc::clone(&events);
        let sink: ProgressSink = Arc::new(move |p| log.lock().unwrap().push(p));
        let outcome = DitoTranspiler::new().transpile(&root, &TranspileOptions::new(), &sink).unwrap();
        let artifacts = outcome.artifacts.expect("artifacts");
        assert_eq!(artifacts.len(), 1);
        assert_eq!((artifacts[0].folder.as_str(), artifacts[0].name.as_str()), ("entity", "A_entity"));
        let text = String::from_utf8(artifacts[0].content.clone()).unwrap();
        assert!(text.contains("<majorModelMode>COMPACT</majorModelMode>") && !text.contains('\r'));
        assert!(!root.join("dist").exists(), "dist is only written on request");
        assert!(events.lock().unwrap().iter().any(|e| matches!(e, Progress::Stage { percent: 100, .. })));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_new_transpiler_writes_dist_when_asked() {
        let root = mini_project("dist");
        let sink: ProgressSink = Arc::new(|_| {});
        let options = TranspileOptions::new().with("write_dist", "true");
        DitoTranspiler::new().transpile(&root, &options, &sink).unwrap();
        assert!(root.join("dist/entity/A_entity/A_entity.aod").is_file());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn cancel_without_a_running_build_is_false() {
        assert!(!DitoTranspiler::new().cancel());
    }

    #[test]
    fn engine_from_param_defaults_to_the_adito_transpiler_for_missing_or_unknown_values() {
        assert_eq!(TranspilerEngine::from_param(None), TranspilerEngine::Official);
        assert_eq!(TranspilerEngine::from_param(Some("")), TranspilerEngine::Official);
        assert_eq!(TranspilerEngine::from_param(Some("typo")), TranspilerEngine::Official);
        assert_eq!(TranspilerEngine::default(), TranspilerEngine::Official);
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
