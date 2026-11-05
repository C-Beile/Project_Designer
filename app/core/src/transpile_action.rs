//! P7 (transpiler-selector): the `Action` behind the "which transpiler engine runs?" UI setting
//! (architecture.md §2 last extension point, same `execute_action` seam entity actions will
//! later use). Registered under the id `"transpile"` in `actions::dispatch_action`.
//!
//! Business background: Forge has two engines capable of turning an ADITO project into a `dist`
//! tree:
//! - [`transpiler::NbexecTranspilerRunner`] (crate `transpiler`, P2/P3) - wraps the real,
//!   official `nbexec64.exe --projecthome ...` TranspilerCLI. Production-grade, verified against
//!   real exit-0/exit-150 runs. This is the default and the only engine a user should rely on
//!   for real deployment work.
//! - [`differential_harness::IncrementalEngine`] (crate `differential-harness`, P5) - Forge's own
//!   from-scratch Rust transpiler pipeline. Real and runnable, but its own differential-harness
//!   measurements against a full real project (FZ_Juerlich) report a 57.25% byte-exact match
//!   rate against the official output, not the zero-deviation bar the project's own gate
//!   (chef prompt §2.4) requires before it could become the production default. It is offered
//!   here strictly as an opt-in, clearly labelled experimental choice - never the default, never
//!   silently remembered across a restart (no persistence layer backs the `engine` param: the
//!   frontend setting that drives it is plain in-memory React state, see
//!   `ui/src/settings/TranspilerEngineSelector.tsx`).
//!
//! This module intentionally does not touch `app/core/src/project_actor.rs` - transpilation
//! produces an on-disk `dist`-equivalent tree, not an edit to any `.aod` content the undo/redo
//! history tracks, so it has no business going through `ProjectActorHandle`. It goes through the
//! existing generic `Action` seam instead (`actions::dispatch_action`, already wired end to end
//! from the frontend via `ForgeApi.executeAction` - no new Tauri command needed).

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use differential_harness::{IncrementalEngine, OwnEngine};
use plugin_kernel::action::{Action, ActionError};
use plugin_kernel::types::{ActionContext, Transaction};
use transpiler::{EventSink, NbexecTranspilerRunner, TranspilerConfig, TranspilerRunner};

/// Which engine a `"transpile"` action invocation should use. Defaults to `Official` - the one
/// safe choice if the `engine` param is missing or holds an unrecognised value, so a typo or a
/// stale/unexpected param never silently routes a real transpile through the experimental
/// engine.
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
    /// Parses the `engine` action param. Anything other than the exact experimental marker
    /// resolves to `Official` - see the type doc for why that is the deliberate safe default,
    /// not an error.
    pub fn from_param(value: Option<&str>) -> Self {
        match value {
            Some("official") => TranspilerEngine::Official,
            _ => TranspilerEngine::ExperimentalForge,
        }
    }
}

/// Output directory the experimental engine writes to. Deliberately distinct from
/// `differential-harness`'s own `_own_engine_dist` convention so a transpile triggered from the
/// app UI is never mistaken for (or clobbered by) a differential-harness corpus run against the
/// same project copy.
fn experimental_output_dir(project_home: &Path) -> PathBuf {
    project_home.join("dist")
}

/// Runs the selected engine against `project_home`. Pure function, no `ActionContext`/
/// `Transaction` ceremony, so it is reusable from the `Action` impl below and directly from
/// tests. Returns `Ok(())` only on a genuine transpile success (exit 0 for the official engine,
/// pipeline success for the experimental one) - a business failure (e.g. official exit 150) is
/// reported as `Err`, same as a wrapper/setup error, since callers only care "did this produce a
/// usable dist/ output or not".
type BuildLogSink = Arc<dyn Fn(bool, &str) + Send + Sync>;
static BUILD_LOG_SINK: std::sync::OnceLock<BuildLogSink> = std::sync::OnceLock::new();

/// Receives every line of the official transpiler while it runs (`true` = stderr). The shell
/// registers one sink at start-up and shows the lines in Output > Build.
pub fn set_build_log_sink(sink: BuildLogSink) {
    let _ = BUILD_LOG_SINK.set(sink);
}

/// Ends the running official transpiler (after the user confirmed). False when none is running.
pub fn cancel_build() -> bool {
    transpiler::cancel_active_run()
}

/// Receives the progress (0 to 100 and the running stage) of the built-in transpiler while it runs.
pub fn set_progress_reporter(reporter: Option<std::sync::Arc<dyn Fn(u8, &str) + Send + Sync>>) {
    differential_harness::own_engine::progress::set_reporter(reporter);
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

pub fn run_transpile(project_home: &Path, engine: TranspilerEngine, install_dir: &Path, user_dir: &Path, cache_dir: Option<&Path>) -> Result<(), String> {
    match engine {
        TranspilerEngine::Official => {
            let config = TranspilerConfig::new(install_dir.to_path_buf(), user_dir.to_path_buf())
                .with_timeout(Duration::from_secs(300));
            let runner = NbexecTranspilerRunner::new(config);
            // No live progress forwarded to the UI this round (architecture.md's own event
            // bridge for this is a separate integration step, see transpiler::events) - only the
            // final outcome, matching this action's "did it work" contract.
            let sink: EventSink = Arc::new(|event| {
                if let (transpiler::TranspileEvent::Log { stream, line }, Some(out)) = (event, BUILD_LOG_SINK.get()) {
                    out(stream == transpiler::LogStream::Stderr, &line);
                }
            });
            let outcome = runner.run(project_home, sink).map_err(|e| e.to_string())?;
            if transpiler::take_cancelled() {
                return Err("Build cancelled.".to_string());
            }
            if outcome.is_success() {
                Ok(())
            } else {
                Err(format!("official transpiler run did not succeed: {:?}", outcome.outcome))
            }
        }
        TranspilerEngine::ExperimentalForge => {
            let output_dir = experimental_output_dir(project_home);
            // The engine empties the folder itself when it has to write a new result; an up-to-date result stays untouched.
            std::fs::create_dir_all(&output_dir).map_err(|e| e.to_string())?;
            // The engine's cache lives in the app's own data folder, never inside the project.
            if let Some(dir) = cache_dir {
                std::env::set_var("FORGE_INCREMENTAL_CACHE_DIR", dir);
            }
            let data_dir = cache_dir.and_then(|d| d.parent());
            let source = match data_dir {
                Some(dir) => snapshot_project(project_home, dir),
                None => project_home.to_path_buf(),
            };
            let own_engine = IncrementalEngine;
            own_engine.run(&source, &output_dir).map_err(|e| e.to_string())
        }
    }
}

/// `Action` wrapper (id `"transpile"`) around [`run_transpile`]. Always returns an empty
/// `Transaction` on success - a transpile run writes files outside the undo-tracked project
/// model (`dist/`, `_forge_experimental_dist/`), so there is genuinely nothing for the
/// undo/redo path to record, not an oversight.
pub struct TranspileAction;

impl Action for TranspileAction {
    fn execute(&self, ctx: &mut ActionContext) -> Result<Transaction, ActionError> {
        let engine = TranspilerEngine::from_param(ctx.params.get("engine").map(String::as_str));
        let project_home = PathBuf::from(&ctx.target_path);
        let param = |name: &str| ctx.params.get(name).filter(|v| !v.trim().is_empty()).map(PathBuf::from);
        if !project_home.is_dir() {
            return Err(ActionError::new(format!("project folder not found: {}", project_home.display())));
        }

        if engine == TranspilerEngine::ExperimentalForge {
            let cache = param("forge_data_dir").map(|d| d.join("transpile-cache"));
            return run_transpile(&project_home, engine, Path::new(""), Path::new(""), cache.as_deref())
                .map(|()| Transaction::new(vec![]))
                .map_err(ActionError::new);
        }

        // The installed app must never depend on a developer scratch folder (RISKS.md R43):
        // install dir comes from Tools > Options or discovery, the profile is Forge's own,
        // seeded once from the user's real Designer profile. `user_dir` stays overridable for
        // tests that run against a prepared profile.
        let (install_dir, user_dir) = match param("user_dir") {
            Some(user_dir) => (param("install_dir").unwrap_or_default(), user_dir),
            None => {
                let forge_data_dir = param("forge_data_dir").unwrap_or_else(|| std::env::temp_dir().join("forge"));
                let setup = crate::official_transpiler_setup::resolve(
                    param("install_dir").as_deref(),
                    &crate::official_transpiler_setup::default_search_roots(),
                    &forge_data_dir,
                    &crate::official_transpiler_setup::default_profiles_root(),
                )
                .map_err(ActionError::new)?;
                (setup.install_dir, setup.user_dir)
            }
        };

        run_transpile(&project_home, engine, &install_dir, &user_dir, None)
            .map(|()| Transaction::new(vec![]))
            .map_err(ActionError::new)
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
