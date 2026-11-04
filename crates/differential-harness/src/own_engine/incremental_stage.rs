// Sixth and final `OwnEngine` stage of the own Rust transpiler pipeline (Forge P5), after
// `linked_files_stage`. Implements `transpiler.md` §6 (Inkrementalitätsregeln) / the chef
// prompt's "PartialTranspileAction / FullTranspileAction, ExecutorCache,
// ApplyAllModificationsCache, TranspilationMetadata" class-name inventory.
//
// Corpus research (this agent's Phase 1 for this stage, see `p5-incremental-notes.md`): searched
// all 13 `GitRepos_ADITO` projects for `cache.txt`/`cacheMods.txt` (project root, per
// `transpiler.md` §6) and `.aditoprj/cache`/`transpile.version` - ZERO projects have
// `cache.txt`/`cacheMods.txt` (gitignored, never checked in anywhere). Four projects (`Hermes`,
// `FZ_Jürlich`, `SVB`, `thhit-adito-modules`) DO have a populated `.aditoprj/cache/`, but every
// single one contains only a Liquibase XSD catalog (`retriever/catalog.xml` +
// `dbchangelog-3.6.xsd`) - confirmed Liquibase tooling cache, unrelated to transpiler
// incrementality, consistent with `transpiler.md` §6's existing "vermutlich unrelated"
// hedge, now checked against every real occurrence instead of just Hermes's one. New field found
// in `transpile.version` (not previously documented): `transpileToolChecksum` alongside
// `version=V2` - a hash of the tool itself, presumably to force a full retranspile on an ENGINE
// version change, separate from per-object content caching.
//
// **Conclusion: there is still, after a second dedicated search, ZERO real example anywhere in
// the corpus of what `cache.txt`/`cacheMods.txt`/`ExecutorCache`/`ApplyAllModificationsCache`/
// `TranspilationMetadata` actually contain or how their invalidation is keyed.** This is the same
// situation as `.ts` linked files (`plugin-kernel`'s `UnverifiedTsCompiler` precedent,
// `linked-files`'s own TypeScript gap): nothing to reverse-engineer against. Rather than guess at
// an unverifiable byte-for-byte cache format, this stage implements a SEPARATE, OWN-DESIGN,
// clearly-labeled incremental cache that achieves the same FUNCTIONAL goal §2.4/§5 actually cares
// about - skip redundant work on a re-run when nothing relevant changed, while still producing
// byte-identical output to a full run every time (verified by test, see below). It does not
// claim to replicate the real engine's own cache file format or invalidation granularity.
//
// Design: a whole-project manifest (relative path + size + mtime for every file reachable from
// every resolved module, project root included) hashed into one fingerprint. Stored, together
// with a full snapshot of the last successful `output_dir`, under
// `<project_home>/.forge-incremental-cache/` (a NEW directory this stage owns - never collides
// with the real `.aditoprj`, which stays untouched). On a re-run: if the current manifest matches
// the stored one, the snapshot is copied straight into `output_dir` and the whole resolver/copy/
// modification/linked-file pipeline is skipped entirely; otherwise the full pipeline runs (exactly
// like `LinkedFilesEngine`) and the cache is refreshed for next time. Coarser than the real
// engine's presumed per-object `PartialTranspileAction` granularity (any change anywhere forces a
// full re-run here, not just the touched object) - an honest, documented trade-off given no real
// example exists to verify a finer-grained scheme against.

use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use module_graph::{ModuleDefinition, ModuleGraph};

use crate::own_engine::copy_phase_stage::run_copy_phase;
use crate::own_engine::modification_engine_stage::run_modification_phase;
use crate::own_engine::resolver_stage::resolve_module_graph;
use crate::own_engine::{OwnEngine, OwnEngineError};

const CACHE_DIR_NAME: &str = ".forge-incremental-cache";
const MANIFEST_FILE_NAME: &str = "manifest.txt";
const SNAPSHOT_DIR_NAME: &str = "snapshot";

#[derive(Debug, thiserror::Error)]
pub enum IncrementalError {
    #[error("failed to resolve module graph: {0}")]
    Resolve(String),
    #[error("failed to run the full pipeline: {0}")]
    Pipeline(String),
    #[error("failed to read/write the incremental cache at {path}: {source}")]
    Cache { path: PathBuf, source: std::io::Error },
}

/// Diagnostics from an incremental-engine run.
#[derive(Debug, Clone, Copy)]
pub struct IncrementalReport {
    /// True if the manifest matched the cached one and the snapshot was reused - the whole
    /// resolver/copy/modification/linked-file pipeline was skipped.
    pub cache_hit: bool,
    /// How many files the manifest walk inspected (diagnostic only).
    pub manifest_files_scanned: usize,
}

/// Raised whenever the output of the engine changes for the same sources (new or changed stage).
const ENGINE_REVISION: u32 = 25;

fn cache_dir(project_home: &Path) -> PathBuf {
    // A test harness can keep the cache outside of the project (read-only repositories, many projects).
    if let Some(base) = std::env::var_os("FORGE_INCREMENTAL_CACHE_DIR") {
        let name = project_home.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        return PathBuf::from(base).join(name);
    }
    project_home.join(CACHE_DIR_NAME)
}

fn manifest_file_path(project_home: &Path) -> PathBuf {
    cache_dir(project_home).join(MANIFEST_FILE_NAME)
}

fn snapshot_dir_path(project_home: &Path) -> PathBuf {
    cache_dir(project_home).join(SNAPSHOT_DIR_NAME)
}

/// Walks every file reachable from every resolved module (dependencies + project root) and
/// builds a sorted `"root|relative_path|size:mtime_nanos"` line list, hashed into one
/// fingerprint. Excludes this stage's own cache directory (would otherwise self-reference: the
/// manifest would include its own previous snapshot) and `output_dir` when it sits inside
/// `project_home` (mirrors `copy_phase_stage`'s own `never_copies_the_output_directory_into_itself`
/// guard - without this, the manifest would depend on the PREVIOUS run's own output, making a
/// stable fixed point impossible).
fn compute_manifest(graph: &ModuleGraph, project_home: &Path, output_dir: &Path) -> Result<(String, usize), IncrementalError> {
    let output_dir_canonical = fs::canonicalize(output_dir).ok();
    let cache_dir_canonical = fs::canonicalize(cache_dir(project_home)).ok();
    // The REFERENCE transpiler's own output (`<project_home>/dist`, `transpiler.md` §4) - the
    // differential harness always re-runs the reference transpiler before calling this stage,
    // and `harness.rs` deliberately leaves a stale `dist/` in place between runs (its own doc
    // comment: "the official transpiler owns that directory's lifecycle, not this harness").
    // `dist/` therefore changes on every single harness invocation regardless of whether any
    // SOURCE file changed - a real-corpus regression found by this agent: without this
    // exclusion, the manifest never stabilizes (every run is a cache miss) because it was
    // accidentally hashing the reference engine's own output as if it were a source input.
    let reference_dist_canonical = fs::canonicalize(project_home.join("dist")).ok();

    let mut modules: Vec<&ModuleDefinition> = graph.modules.values().collect();
    modules.push(&graph.project);

    let mut lines: Vec<String> = Vec::new();
    for module in modules {
        collect_manifest_lines(
            &module.path,
            &module.path,
            output_dir_canonical.as_deref(),
            cache_dir_canonical.as_deref(),
            reference_dist_canonical.as_deref(),
            &mut lines,
        )
        .map_err(|source| IncrementalError::Cache { path: module.path.clone(), source })?;
    }
    lines.sort();
    let count = lines.len();

    let mut hasher = DefaultHasher::new();
    // A new version of the engine itself must not be answered from the cache of an older one.
    ENGINE_REVISION.hash(&mut hasher);
    for line in &lines {
        line.hash(&mut hasher);
    }
    Ok((format!("{:x}", hasher.finish()), count))
}

fn collect_manifest_lines(
    root: &Path,
    dir: &Path,
    output_dir_canonical: Option<&Path>,
    cache_dir_canonical: Option<&Path>,
    reference_dist_canonical: Option<&Path>,
    out: &mut Vec<String>,
) -> std::io::Result<()> {
    if let Ok(dir_canonical) = fs::canonicalize(dir) {
        let excluded = Some(dir_canonical.as_path()) == output_dir_canonical
            || Some(dir_canonical.as_path()) == cache_dir_canonical
            || Some(dir_canonical.as_path()) == reference_dist_canonical;
        if excluded {
            return Ok(());
        }
    }
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let metadata = entry.metadata()?;
        if metadata.is_dir() {
            let name = entry.file_name();
            if crate::own_engine::copy_phase_stage::FORGE_OWNED_DIR_NAMES.contains(&name.to_string_lossy().as_ref()) {
                continue;
            }
            collect_manifest_lines(root, &path, output_dir_canonical, cache_dir_canonical, reference_dist_canonical, out)?;
        } else {
            let mtime_nanos = metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let rel = path.strip_prefix(root).unwrap_or(&path);
            out.push(format!("{}|{}|{}:{}", root.display(), rel.display(), metadata.len(), mtime_nanos));
        }
    }
    Ok(())
}

/// Plain recursive verbatim copy (source -> dest), no ignore logic - both the snapshot and
/// `output_dir` are already-filtered trees produced by the earlier pipeline stages, this just
/// duplicates one into the other.
fn copy_tree_verbatim(src: &Path, dest: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dest)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dest.join(entry.file_name());
        if entry.metadata()?.is_dir() {
            copy_tree_verbatim(&from, &to)?;
        } else {
            fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

/// Runs the incremental-aware pipeline. On a cache hit, copies the cached snapshot into
/// `output_dir` and returns without touching the resolver/copy/modification/linked-file stages at
/// all. On a miss, runs the full pipeline (identical to `LinkedFilesEngine`) and refreshes the
/// cache for next time.
pub fn run_incremental(project_home: &Path, output_dir: &Path) -> Result<IncrementalReport, IncrementalError> {
    crate::own_engine::progress::report(1, "Reading the modules");
    let graph = resolve_module_graph(project_home).map_err(|e| IncrementalError::Resolve(e.to_string()))?;
    crate::own_engine::progress::report(4, "Checking what changed");
    let (manifest, files_scanned) = compute_manifest(&graph, project_home, output_dir)?;

    let manifest_file = manifest_file_path(project_home);
    let snapshot = snapshot_dir_path(project_home);
    let previous_manifest = fs::read_to_string(&manifest_file).ok();

    if previous_manifest.as_deref() == Some(manifest.as_str()) && snapshot.is_dir() {
        crate::own_engine::progress::report(30, "Nothing changed, taking over the last result");
        fs::create_dir_all(output_dir).map_err(|source| IncrementalError::Cache { path: output_dir.to_path_buf(), source })?;
        copy_tree_verbatim(&snapshot, output_dir).map_err(|source| IncrementalError::Cache { path: snapshot.clone(), source })?;
        return Ok(IncrementalReport { cache_hit: true, manifest_files_scanned: files_scanned });
    }

    run_copy_phase(&graph, output_dir).map_err(|e| IncrementalError::Pipeline(e.to_string()))?;
    let mod_report = run_modification_phase(&graph, output_dir).map_err(|e| IncrementalError::Pipeline(e.to_string()))?;
    if std::env::var_os("FORGE_TRANSPILE_TRACE").is_some() {
        eprintln!("modifications: found {} applied {} failed {}", mod_report.modifications_found, mod_report.modifications_applied, mod_report.modifications_failed);
        for (file, reason) in &mod_report.failures {
            eprintln!("  modification failure {}: {reason}", file.display());
        }
    }
    crate::own_engine::progress::report(66, "Resolving the extension points");
    crate::own_engine::run_extension_point_resolution(output_dir).map_err(|e| IncrementalError::Pipeline(e.to_string()))?;
    crate::own_engine::progress::report(72, "Moving modifications to their objects");
    crate::own_engine::run_modification_relocation(output_dir).map_err(|e| IncrementalError::Pipeline(e.to_string()))?;
    crate::own_engine::progress::report(78, "Inlining the services");
    crate::own_engine::run_service_inline(project_home, output_dir).map_err(|e| IncrementalError::Pipeline(e.to_string()))?;
    // The modification files are consumed: the reference output has no `modification/` folder.
    let _ = fs::remove_dir_all(output_dir.join("modification"));
    crate::own_engine::progress::report(90, "Merging the aliases");
    crate::own_engine::run_alias_merge(output_dir).map_err(|e| IncrementalError::Pipeline(e.to_string()))?;
    crate::own_engine::run_preferences_merge(output_dir).map_err(|e| IncrementalError::Pipeline(e.to_string()))?;
    crate::own_engine::progress::report(94, "Merging the languages");
    crate::own_engine::run_language_merge(output_dir).map_err(|e| IncrementalError::Pipeline(e.to_string()))?;
    // The reference transpiler of this ADITO version keeps the `%aditoprj%/...` references in the
    // `.aod` files as they are (verified against a clean reference run), so nothing is inlined.
    // `run_linked_files_phase` stays available for the older behaviour.

    let cache_root = cache_dir(project_home);
    fs::create_dir_all(&cache_root).map_err(|source| IncrementalError::Cache { path: cache_root.clone(), source })?;
    if snapshot.is_dir() {
        fs::remove_dir_all(&snapshot).map_err(|source| IncrementalError::Cache { path: snapshot.clone(), source })?;
    }
    copy_tree_verbatim(output_dir, &snapshot).map_err(|source| IncrementalError::Cache { path: snapshot.clone(), source })?;
    fs::write(&manifest_file, &manifest).map_err(|source| IncrementalError::Cache { path: manifest_file.clone(), source })?;

    Ok(IncrementalReport { cache_hit: false, manifest_files_scanned: files_scanned })
}

/// `OwnEngine` wiring - the sixth and final pipeline stage.
pub struct IncrementalEngine;

impl OwnEngine for IncrementalEngine {
    fn name(&self) -> &str {
        "IncrementalEngine (resolver + copy-phase + modification-application + linked-file inlining, with a whole-project manifest cache - own design, no real .aditoprj cache-format example found in the corpus to verify against)"
    }

    fn run(&self, project_home: &Path, output_dir: &Path) -> Result<(), OwnEngineError> {
        run_incremental(project_home, output_dir).map(|_report| ()).map_err(|e| OwnEngineError::Message(e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use module_graph::AditoType;
    use semver::Version;
    use std::collections::BTreeMap;
    use std::time::{SystemTime, UNIX_EPOCH as EPOCH};

    fn scratch_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "incremental-test-{label}-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(&dir).expect("failed to create scratch dir");
        dir
    }

    fn write(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, contents).unwrap();
    }

    /// `run_incremental` calls `resolve_module_graph`, which needs a real, parseable
    /// project-root `package.json` (`module-graph`'s own requirement) - every test that drives
    /// the full `run_incremental` entry point (as opposed to calling `compute_manifest` directly
    /// against a hand-built `ModuleGraph`) needs this fixture.
    fn write_minimal_project_package_json(project_root: &Path) {
        write(
            &project_root.join("package.json"),
            r#"{"name": "@3hills-it/testproject", "version": "1.0.0", "adito": {"type": "project"}, "dependencies": {}, "overrides": {}}"#,
        );
    }

    fn fake_graph(project_root: PathBuf) -> ModuleGraph {
        ModuleGraph {
            project: ModuleDefinition {
                name: "@3hills-it/testproject".to_string(),
                version: Version::new(1, 0, 0),
                adito_type: AditoType::Project,
                dependencies: BTreeMap::new(),
                peer_dependencies: BTreeMap::new(),
                overrides: BTreeMap::new(),
                path: project_root,
            },
            modules: BTreeMap::new(),
            edges: BTreeMap::new(),
            unresolved_external: Default::default(),
            duplicates: Vec::new(),
            diamonds_resolved_via_override: Vec::new(),
        }
    }

    /// A second run against an UNCHANGED project is a cache hit: the whole pipeline is skipped
    /// (verified indirectly - the entity file is rewritten with a NEW, different value between
    /// runs via a side channel a real pipeline run would never touch, and that side effect
    /// survives into `output_dir`), and the two runs still produce byte-identical output.
    #[test]
    fn second_run_against_an_unchanged_project_is_a_cache_hit_and_byte_identical() {
        let project = scratch_dir("cache-hit-project");
        write_minimal_project_package_json(&project);
        write(&project.join("entity/Foo_entity/Foo_entity.aod"), "<entity>\r\n  <title>Original</title>\r\n</entity>");
        let output_dir = scratch_dir("cache-hit-output");

        let report1 = run_incremental(&project, &output_dir).expect("first run must succeed");
        assert!(!report1.cache_hit, "first run must always be a cache miss (no prior snapshot)");
        let first_bytes = fs::read(output_dir.join("entity/Foo_entity/Foo_entity.aod")).unwrap();
        assert!(String::from_utf8_lossy(&first_bytes).contains("Original"));

        // Tamper with output_dir's own content directly - a real second pipeline run would
        // overwrite this back to "Original"; a cache HIT must instead copy the untouched
        // snapshot over it, so this tampered value must disappear.
        fs::write(output_dir.join("entity/Foo_entity/Foo_entity.aod"), "<entity>\r\n  <title>Tampered</title>\r\n</entity>").unwrap();

        let report2 = run_incremental(&project, &output_dir).expect("second run must succeed");
        assert!(report2.cache_hit, "second run against an unchanged project must be a cache hit");

        let second_bytes = fs::read(output_dir.join("entity/Foo_entity/Foo_entity.aod")).unwrap();
        assert_eq!(second_bytes, first_bytes, "cache hit must restore the ORIGINAL pipeline output, proving the snapshot (not the tampered file) won");

        fs::remove_dir_all(&project).ok();
        fs::remove_dir_all(&output_dir).ok();
    }

    /// A source file change between runs is correctly detected as a cache MISS, and the new
    /// content is reflected in `output_dir` - proves the manifest actually invalidates on a real
    /// change, not just that the happy path works.
    #[test]
    fn changed_source_file_invalidates_the_cache() {
        let project = scratch_dir("cache-miss-project");
        write_minimal_project_package_json(&project);
        let target = project.join("entity/Foo_entity/Foo_entity.aod");
        write(&target, "<entity>\r\n  <title>Version1</title>\r\n</entity>");
        let output_dir = scratch_dir("cache-miss-output");

        run_incremental(&project, &output_dir).expect("first run must succeed");

        // A real filesystem write always advances mtime; also change size so the test is not
        // sensitive to filesystem mtime-resolution flakiness.
        write(&target, "<entity>\r\n  <title>Version2ChangedContent</title>\r\n</entity>");

        let report2 = run_incremental(&project, &output_dir).expect("second run must succeed");
        assert!(!report2.cache_hit, "changed source file must invalidate the cache");

        let result = fs::read_to_string(output_dir.join("entity/Foo_entity/Foo_entity.aod")).unwrap();
        assert!(result.contains("Version2ChangedContent"), "output must reflect the changed source: {result}");

        fs::remove_dir_all(&project).ok();
        fs::remove_dir_all(&output_dir).ok();
    }

    /// The cache directory itself must never be picked up by the manifest walk (self-reference
    /// guard) - proven directly by running three times in a row and confirming every run after
    /// the first is a cache hit (if the cache dir leaked into the manifest, the act of writing
    /// the snapshot/manifest in run N would itself invalidate run N+1's manifest, and no run
    /// after the first would ever hit).
    #[test]
    fn the_cache_directory_never_invalidates_itself() {
        let project = scratch_dir("self-reference-project");
        write_minimal_project_package_json(&project);
        write(&project.join("entity/Foo_entity/Foo_entity.aod"), "<entity/>");
        let output_dir = scratch_dir("self-reference-output");

        let r1 = run_incremental(&project, &output_dir).unwrap();
        let r2 = run_incremental(&project, &output_dir).unwrap();
        let r3 = run_incremental(&project, &output_dir).unwrap();
        assert!(!r1.cache_hit);
        assert!(r2.cache_hit, "second run must hit - cache dir must not have self-invalidated");
        assert!(r3.cache_hit, "third run must also still hit");

        fs::remove_dir_all(&project).ok();
        fs::remove_dir_all(&output_dir).ok();
    }

    /// `compute_manifest` on its own (no full pipeline) correctly excludes `output_dir` when it
    /// sits INSIDE `project_home` - the exact layout the differential-harness CLI defaults to
    /// (`project.join("_own_engine_dist")`). Without this guard the manifest would depend on the
    /// pipeline's own previous output, and a stable fixed point (repeatable cache hits) would be
    /// impossible.
    #[test]
    fn manifest_excludes_a_nested_output_dir() {
        let project = scratch_dir("nested-output-project");
        write(&project.join("entity/Foo_entity/Foo_entity.aod"), "<entity/>");
        let output_dir = project.join("_own_engine_dist");
        fs::create_dir_all(&output_dir).unwrap();
        write(&output_dir.join("entity/Foo_entity/Foo_entity.aod"), "<entity/>");

        let graph = fake_graph(project.clone());
        let (manifest_before, _) = compute_manifest(&graph, &project, &output_dir).unwrap();

        // Change ONLY a file inside output_dir - must NOT affect the manifest.
        fs::write(output_dir.join("entity/Foo_entity/Foo_entity.aod"), "<entity><changed/></entity>").unwrap();
        let (manifest_after, _) = compute_manifest(&graph, &project, &output_dir).unwrap();

        assert_eq!(manifest_before, manifest_after, "a change inside output_dir must not affect the source manifest");

        fs::remove_dir_all(&project).ok();
    }

    /// Real-corpus regression found by this agent: the REFERENCE transpiler's own output
    /// (`<project_home>/dist`) must also be excluded from the manifest, exactly like
    /// `output_dir`/the cache dir - `harness.rs` deliberately leaves a stale `dist/` around
    /// between runs and always re-runs the reference transpiler, which rewrites `dist/` on every
    /// single differential-harness invocation regardless of whether any real source file
    /// changed. Without this exclusion the manifest can never stabilize (every run looks like a
    /// cache miss), which is exactly what happened on a real Hermes run before this fix.
    #[test]
    fn manifest_excludes_the_reference_transpilers_own_dist_directory() {
        let project = scratch_dir("dist-exclusion-project");
        write(&project.join("entity/Foo_entity/Foo_entity.aod"), "<entity/>");
        let output_dir = project.join("_own_engine_dist");
        fs::create_dir_all(&output_dir).unwrap();
        write(&project.join("dist/entity/Foo_entity/Foo_entity.aod"), "<entity/>");

        let graph = fake_graph(project.clone());
        let (manifest_before, _) = compute_manifest(&graph, &project, &output_dir).unwrap();

        // Simulate what the reference transpiler does on every single harness run: rewrite
        // dist/ with new content/timestamps, completely independent of any real source change.
        fs::write(project.join("dist/entity/Foo_entity/Foo_entity.aod"), "<entity><rewritten-by-reference-run/></entity>").unwrap();
        fs::write(project.join("dist/entity/Foo_entity/brand_new_file.js"), "// new file the reference run happened to add").unwrap();
        let (manifest_after, _) = compute_manifest(&graph, &project, &output_dir).unwrap();

        assert_eq!(manifest_before, manifest_after, "a change inside <project_home>/dist must not affect the source manifest - it is the REFERENCE engine's output, not a source input");

        fs::remove_dir_all(&project).ok();
    }
}
