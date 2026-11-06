// Third real `OwnEngine` stage of the own Rust transpiler pipeline (Forge P5), after
// `resolver_stage`. Implements the plain-copy portion of `transpiler.md` §4 (Copy-Phase): for
// every module the resolver stage reaches (the project root plus every resolved dependency),
// copy that module's directory tree into `output_dir`, minus the entries the module's own
// `.transpilerignore` excludes.
//
// Deliberately out of scope for this stage (see `p5-differential-harness-notes.md`'s
// `OwnEngine` doc comment, which lists `modification-engine` and `linked-files` as separate,
// not-yet-built stages that come AFTER copy-phase in the pipeline):
// - Linked-file inlining (`%aditoprj%/.../x.js` path -> inline script content inside the
//   `.aod` tag). `transpiler.md` §4 documents this as part of what the real Designer's
//   Copy-Phase does, but the engine seam here is deliberately split finer than that: this
//   stage only ever performs a byte-for-byte copy, never rewrites `.aod` content. The
//   standalone `.js` files themselves ARE still copied as regular files (real corpus evidence:
//   `dist/entity/ResourceOperation_entity/afterUiInit.js` sits next to the `.aod` in `dist/`
//   exactly as it does in the source module - the inlining is an ADDITIONAL transformation
//   applied only inside the `.aod` tag content, not a replacement for the plain file copy).
// - Applying `modification/<uuid>/<uuid>.aod` MODIFY/INSERT/DELETE changes to the copied
//   `.aod` files.
// Because of this, an `.aod` file that carries a linked-file reference or is the target of a
// modification will NOT byte-match the reference `dist/` yet - only untouched files match.
// That is an expected, honest limitation of this stage, not a bug - see the match-rate
// analysis in `p5-copy-phase-notes.md`.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use module_graph::{ModuleDefinition, ModuleGraph};

use crate::own_engine::resolver_stage::resolve_module_graph;
use crate::own_engine::{OwnEngine, OwnEngineError};

/// The exclusion list documented in `transpiler.md` §4/§6, used only as a fallback when a
/// module carries no `.transpilerignore` of its own (every real module checked in the corpus
/// has one, see `p5-copy-phase-notes.md`, but a defensively-built fallback avoids a hard
/// dependency on that file always being present for every future project/fixture).
const DEFAULT_IGNORE_ENTRIES: &[&str] = &[
    ".git",
    ".gitignore",
    ".gitattributes",
    ".gitlab-ci.yml",
    "README.md",
    "CHANGELOG.md",
    ".aditoprj",
    "data",
    "dist",
    "others",
    "scripts",
    "jsconfig.json",
    "jsconfig.template.json",
    ".eslintrc.json",
    "eslint.config.mjs",
    "node_modules",
    "package.json",
    "package-lock.json",
    ".idea",
    ".vscode",
    "cache.txt",
    "cacheMods.txt",
    ".netbeans.xml",
    "cypress.config.ts",
];

#[derive(Debug, thiserror::Error)]
pub enum CopyPhaseError {
    #[error("failed to read {path}: {source}")]
    Read { path: PathBuf, source: std::io::Error },
    #[error("failed to create directory {path}: {source}")]
    CreateDir { path: PathBuf, source: std::io::Error },
    #[error("failed to write {path}: {source}")]
    Write { path: PathBuf, source: platform::error::PlatformError },
}

/// Diagnostics from a copy-phase run - deliberately minimal (this is not the differential
/// report, `compare.rs` already covers correctness; this is just enough to sanity-check a run
/// without re-reading the whole output tree).
#[derive(Debug, Default, Clone, Copy)]
pub struct CopyPhaseReport {
    pub files_copied: usize,
    pub modules_processed: usize,
}

/// `.transpilerignore` parsing: one exclusion entry per non-empty, non-comment line (spec
/// §6 - `#`-led comment headers group entries, blank lines separate groups). Every entry
/// observed in the real corpus is a bare name (no path separators, no wildcards), matched
/// against an entry's name at ANY depth in the module tree - like `.gitignore`, which spec §6
/// explicitly compares this format to. (An earlier version of this stage matched only a
/// module's direct top-level children, reasoning from `.liquibase/...` surviving into `dist/`
/// despite not being on the ignore list - but that only shows `.liquibase` isn't excluded, not
/// that matching is top-level-only. A real run against the full Hermes corpus surfaced the gap
/// directly: nested `.idea`/`.vscode` folders several levels deep leaked into the output. Fixed
/// by re-checking `ignore` at every recursion step, see `copy_recursive`.)
fn read_ignore_entries(module_path: &Path) -> Result<HashSet<String>, CopyPhaseError> {
    let ignore_file = module_path.join(".transpilerignore");
    // The ignore file itself is never present in the real `dist/` output (verified against
    // Hermes), even though it does not list its own name as an entry - the engine excludes it
    // implicitly rather than requiring every project to self-reference it.
    let mut entries: HashSet<String> = [".transpilerignore".to_string()].into_iter().collect();
    if !ignore_file.exists() {
        entries.extend(DEFAULT_IGNORE_ENTRIES.iter().map(|s| s.to_string()));
        return Ok(entries);
    }
    let text = fs::read_to_string(&ignore_file).map_err(|source| CopyPhaseError::Read {
        path: ignore_file.clone(),
        source,
    })?;
    entries.extend(
        text.lines()
            .map(str::trim)
            .filter(|line| !line.is_empty() && !line.starts_with('#'))
            .map(|line| line.to_string()),
    );
    Ok(entries)
}

/// Copies one module's directory tree into `output_dir`, skipping any entry (at ANY depth, see
/// `copy_recursive`'s doc comment) named in `ignore`.
fn copy_module_tree(
    module_root: &Path,
    ignore: &HashSet<String>,
    output_dir: &Path,
) -> Result<usize, CopyPhaseError> {
    // The harness places `output_dir` INSIDE `project_home` by default (see main.rs:
    // `project.join("_own_engine_dist")`), and the project root is itself one of the modules
    // copied here. Without this exclusion, copying the project root's tree would copy
    // `output_dir` into itself, and the destination directory - freshly created moments
    // earlier and still being written into by this very walk - would be read as a SOURCE too,
    // causing runaway self-nesting (real incident during this round: a run without this guard
    // produced 600k+ files before being killed, for a project whose real `dist/` has ~18k -
    // see p5-copy-phase-notes.md). Canonicalized once per module so every nested comparison is
    // a cheap equality check; `output_dir` is guaranteed to exist by the time this runs
    // (`run_copy_phase` creates it before calling this).
    let output_dir_canonical = fs::canonicalize(output_dir).map_err(|source| CopyPhaseError::Read {
        path: output_dir.to_path_buf(),
        source,
    })?;

    let mut files_copied = 0;
    let mut jobs: Vec<(PathBuf, PathBuf)> = Vec::new();
    let entries = fs::read_dir(module_root).map_err(|source| CopyPhaseError::Read {
        path: module_root.to_path_buf(),
        source,
    })?;
    for entry in entries {
        let entry = entry.map_err(|source| CopyPhaseError::Read {
            path: module_root.to_path_buf(),
            source,
        })?;
        let name = entry.file_name();
        let name_str = name.to_string_lossy().to_string();
        if ignore.contains(&name_str) || FORGE_OWNED_DIR_NAMES.contains(&name_str.as_str()) {
            continue;
        }
        let src_path = entry.path();
        let dest_path = output_dir.join(&name);
        files_copied += copy_recursive(&src_path, &dest_path, ignore, &output_dir_canonical, &mut jobs)?;
    }
    // Writing a file is dominated by waiting (file system, virus scanner), so many files are written at once.
    parallel_try_each(&jobs, |(src, dest)| copy_one_file(src, dest))?;
    Ok(files_copied)
}

/// Recursive copy. Applies the SAME ignore-list check at every depth, not just the module
/// root's direct children - a real-corpus finding during this round (see
/// `p5-copy-phase-notes.md`): an earlier top-level-only version let a nested `.idea`/`.vscode`
/// folder several levels deep leak into the output, because `.transpilerignore` behaves like
/// `.gitignore` (spec §6 draws that comparison directly) where a bare name matches at ANY
/// depth, not only at the root. Also refuses to copy `output_dir` itself if it is ever reached
/// as a source path - the second half of the self-copy guard described in
/// `copy_module_tree`'s doc comment (that guard alone would not be enough if a module's own
/// tree happened to contain a same-named subdirectory deeper down).
/// Folders Forge itself writes next to a project (own-engine output and cache). They are never
/// ADITO project content, so copying them would feed one run's output into the next run's
/// input (observed: snapshots nested inside snapshots in the `minimal` fixture, RISKS.md R43).
pub const FORGE_OWNED_DIR_NAMES: [&str; 3] = [".forge-incremental-cache", "_forge_experimental_dist", "_own_engine_dist"];

fn copy_recursive(
    src: &Path,
    dest: &Path,
    ignore: &HashSet<String>,
    output_dir_canonical: &Path,
    jobs: &mut Vec<(PathBuf, PathBuf)>,
) -> Result<usize, CopyPhaseError> {
    let metadata = fs::symlink_metadata(src).map_err(|source| CopyPhaseError::Read {
        path: src.to_path_buf(),
        source,
    })?;
    // Only a folder can be the output folder itself; resolving the path of every file would cost a system call each.
    if metadata.is_dir() {
        if let Ok(src_canonical) = fs::canonicalize(src) {
            if src_canonical == output_dir_canonical {
                return Ok(0);
            }
        }
        fs::create_dir_all(dest).map_err(|source| CopyPhaseError::CreateDir {
            path: dest.to_path_buf(),
            source,
        })?;
        let mut count = 0;
        let entries = fs::read_dir(src).map_err(|source| CopyPhaseError::Read {
            path: src.to_path_buf(),
            source,
        })?;
        for entry in entries {
            let entry = entry.map_err(|source| CopyPhaseError::Read {
                path: src.to_path_buf(),
                source,
            })?;
            let name = entry.file_name();
            // Changelog data below `.liquibase` is part of the result even though a module's own
            // `data` folder is not.
            let liquibase_data = name == "data" && src.components().any(|c| c.as_os_str() == ".liquibase");
            // The `scripts` folder a module ignores is its top-level one; a folder of that name further down
            // (`tools/AditoFaker/scripts`) is part of the result.
            let nested_scripts = name == "scripts";
            if ignore.contains(&name.to_string_lossy().to_string()) && !liquibase_data && !nested_scripts {
                continue;
            }
            if FORGE_OWNED_DIR_NAMES.contains(&name.to_string_lossy().as_ref()) {
                continue;
            }
            count += copy_recursive(&entry.path(), &dest.join(&name), ignore, output_dir_canonical, jobs)?;
        }
        Ok(count)
    } else if is_modification_definition_file(src) {
        // Real-corpus finding (this agent, cross-checking `linked-files`'s R35 investigation):
        // `modification/<id>/<id>.aod` - the modification DEFINITION file itself - is NEVER
        // present in the real `dist/` output, even though no real `.transpilerignore` in the
        // corpus lists `modification` as an ignore entry (checked against Hermes's own file).
        // Evidence: `GitRepos_ADITO\Hermes\dist\modification\` holds exactly ONE surviving entry
        // across the whole project - a single orphaned `.js` SIDECAR file for the rare case
        // where a modification's own linked-file reference was never inlined - never a `.aod`
        // definition file. So only the `.aod` definition itself is skipped here; a
        // `modification/<id>/*.js` (or any other extension) sidecar is still copied normally
        // by the branch below, exactly like any other linked file `linked-files`'s inlining
        // stage may need to resolve against `output_dir`.
        Ok(0)
    } else {
        jobs.push((src.to_path_buf(), dest.to_path_buf()));
        Ok(1)
    }
}

/// Copies one file of a module into the output; `.aod` files get CRLF line endings (see below).
/// The reference writes every object in its regular form (indentation, line endings, no byte order mark), whatever
/// form the module shipped it in. A file that does not parse is only brought to CRLF line endings.
fn normalize_aod(bytes: &[u8]) -> Vec<u8> {
    match aod_io::canonicalize(bytes) {
        Ok(regular) => regular,
        Err(_) => normalize_to_crlf(bytes),
    }
}

fn copy_one_file(src: &Path, dest: &Path) -> Result<(), CopyPhaseError> {
    let bytes = fs::read(src).map_err(|source| CopyPhaseError::Read { path: src.to_path_buf(), source })?;
    // Real-corpus finding: every `.aod` file in the reference `dist/` uses CRLF line endings, even when its source module
    // file uses bare LF. Every other file type is copied byte-for-byte.
    let bytes = if is_aod_file(dest) { normalize_aod(&bytes) } else { bytes };
    // The output folder is a build result: no temporary file and no forced flush per file.
    let write_error = |source: std::io::Error| CopyPhaseError::Write { path: dest.to_path_buf(), source: platform::PlatformError::AtomicWrite { path: dest.to_path_buf(), source } };
    if let Err(first) = fs::write(dest, &bytes) {
        let Some(parent) = dest.parent() else { return Err(write_error(first)) };
        fs::create_dir_all(parent).map_err(|source| CopyPhaseError::CreateDir { path: parent.to_path_buf(), source })?;
        fs::write(dest, &bytes).map_err(write_error)?;
    }
    Ok(())
}

/// Runs `work` for every item on several threads (the first error wins).
pub(crate) fn parallel_try_each<T: Sync, E: Send>(items: &[T], work: impl Fn(&T) -> Result<(), E> + Sync) -> Result<(), E> {
    if items.len() < 64 {
        return items.iter().try_for_each(work);
    }
    let next = std::sync::atomic::AtomicUsize::new(0);
    let failure: std::sync::Mutex<Option<E>> = std::sync::Mutex::new(None);
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).clamp(4, 16);
    std::thread::scope(|scope| {
        for _ in 0..threads {
            scope.spawn(|| loop {
                let i = next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                if i >= items.len() || failure.lock().map(|f| f.is_some()).unwrap_or(true) {
                    break;
                }
                if let Err(e) = work(&items[i]) {
                    if let Ok(mut f) = failure.lock() {
                        f.get_or_insert(e);
                    }
                    break;
                }
            });
        }
    });
    match failure.into_inner().ok().flatten() {
        Some(e) => Err(e),
        None => Ok(()),
    }
}

fn is_aod_file(path: &Path) -> bool {
    path.extension().and_then(|ext| ext.to_str()).is_some_and(|ext| ext.eq_ignore_ascii_case("aod"))
}

/// True for a `modification/<id>/<id>.aod` DEFINITION file specifically (an `.aod` file with a
/// `modification` path component somewhere above it) - see the doc comment at this function's
/// call site in `copy_recursive` for the real-corpus evidence this never appears in `dist/`.
/// Deliberately checks ANY ancestor component, not just the direct parent's parent, matching
/// this module's general any-depth ignore-matching convention (`read_ignore_entries`'s doc
/// comment) - a module's own `modification/` directory can itself be nested if a future corpus
/// example shows that, though every real example found so far has it at the module root.
fn is_modification_definition_file(path: &Path) -> bool {
    is_aod_file(path) && path.components().any(|c| c.as_os_str() == "modification")
}

/// Normalizes every line ending to CRLF: strips any existing `\r` first (so an already-CRLF
/// or stray-CR source never ends up double-converted), then turns every remaining `\n` into
/// `\r\n`. Real `.aod` sources observed in the corpus never contain a bare `\r` to begin with
/// (see module doc), so this is a straightforward LF-to-CRLF rewrite in practice.
fn normalize_to_crlf(bytes: &[u8]) -> Vec<u8> {
    let mut without_cr = Vec::with_capacity(bytes.len());
    without_cr.extend(bytes.iter().copied().filter(|&b| b != b'\r'));

    let mut out = Vec::with_capacity(without_cr.len() + without_cr.len() / 20);
    for &b in &without_cr {
        if b == b'\n' {
            out.push(b'\r');
        }
        out.push(b);
    }
    out
}

/// Runs the plain-copy phase for every module in `graph` (the project root plus every
/// resolved dependency) into `output_dir`. Modules are processed in a deterministic order -
/// dependencies first (BTreeMap iteration = sorted by name), the project root LAST - so that
/// on the rare path collision between a dependency's file and a project-root file at the same
/// relative path, the project root wins (an author's own project-level object is expected to
/// take precedence over a library module's, matching how ADITO's module system is generally
/// understood to layer project content over installed modules). No real corpus example of
/// such a collision was found during this round (see `p5-copy-phase-notes.md`) - this
/// ordering is a documented assumption, not an empirically verified rule.
pub fn run_copy_phase(graph: &ModuleGraph, output_dir: &Path) -> Result<CopyPhaseReport, CopyPhaseError> {
    fs::create_dir_all(output_dir).map_err(|source| CopyPhaseError::CreateDir {
        path: output_dir.to_path_buf(),
        source,
    })?;

    let mut report = CopyPhaseReport::default();
    let mut ordered: Vec<&ModuleDefinition> = graph.modules.values().collect();
    ordered.push(&graph.project);

    let total = ordered.len();
    for (done, module) in ordered.into_iter().enumerate() {
        let label = module.path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        crate::own_engine::progress::report_between(8, 35, done, total, &format!("Copying the modules ({} of {total}): {label}", done + 1));
        let ignore = read_ignore_entries(&module.path)?;
        report.files_copied += copy_module_tree(&module.path, &ignore, output_dir)?;
        if module.path == graph.project.path {
            let version = module.path.join(".aditoprj").join("project.version");
            if let Ok(bytes) = fs::read(&version) {
                let dest = output_dir.join(".aditoprj");
                if fs::create_dir_all(&dest).is_ok() && fs::write(dest.join("project.version"), bytes).is_ok() {
                    report.files_copied += 1;
                }
            }
        }
        report.modules_processed += 1;
    }

    Ok(report)
}

/// `OwnEngine` wiring: resolves the module graph (reusing `resolver_stage`, no duplicated
/// path logic) then runs the plain copy phase against the result.
pub struct CopyPhaseEngine;

impl OwnEngine for CopyPhaseEngine {
    fn name(&self) -> &str {
        "CopyPhaseEngine (resolver + plain-copy stage; no modifications/linked-files yet)"
    }

    fn run(&self, project_home: &Path, output_dir: &Path) -> Result<(), OwnEngineError> {
        let graph = resolve_module_graph(project_home)?;
        run_copy_phase(&graph, output_dir)
            .map(|_report| ())
            .map_err(|source| OwnEngineError::Message(source.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use module_graph::AditoType;
    use semver::Version;
    use std::collections::BTreeMap;

    fn scratch_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "copy-phase-test-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
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

    fn fake_module(name: &str, path: PathBuf) -> ModuleDefinition {
        ModuleDefinition {
            name: name.to_string(),
            version: Version::new(1, 0, 0),
            adito_type: AditoType::Module,
            dependencies: BTreeMap::new(),
            peer_dependencies: BTreeMap::new(),
            overrides: BTreeMap::new(),
            path,
        }
    }

    /// Own, hand-built fixture (per role brief's "unit test against a small, self-built
    /// fixture" requirement): one module with an ignored top-level dir, a kept top-level
    /// dir, and a nested file - proves basic ignore-list matching and the recursive copy in
    /// one pass. See `ignores_a_match_at_any_depth_not_just_the_top_level` for the
    /// nested-depth case this one does not cover.
    #[test]
    fn copies_kept_entries_and_skips_ignored_top_level_entries() {
        let module_root = scratch_dir("module");
        write(&module_root.join("entity/Foo_entity/Foo_entity.aod"), "<entity/>");
        write(&module_root.join("entity/Foo_entity/onValidation.js"), "// js");
        write(&module_root.join("node_modules/should-not-appear/x.txt"), "nope");
        write(&module_root.join("package.json"), "{}");
        write(&module_root.join(".transpilerignore"), "node_modules\npackage.json\n# comment\n");

        let output_dir = scratch_dir("output");
        let ignore = read_ignore_entries(&module_root).unwrap();
        assert_eq!(ignore.len(), 3, "the two listed entries plus the implicit .transpilerignore itself");
        let copied = copy_module_tree(&module_root, &ignore, &output_dir).unwrap();

        assert_eq!(copied, 2, "expected exactly the two entity files to be copied");
        assert_eq!(
            fs::read_to_string(output_dir.join("entity/Foo_entity/Foo_entity.aod")).unwrap(),
            "<entity/>\r\n"
        );
        assert_eq!(
            fs::read_to_string(output_dir.join("entity/Foo_entity/onValidation.js")).unwrap(),
            "// js"
        );
        assert!(!output_dir.join("node_modules").exists());
        assert!(!output_dir.join("package.json").exists());

        fs::remove_dir_all(&module_root).ok();
        fs::remove_dir_all(&output_dir).ok();
    }

    /// Falls back to `DEFAULT_IGNORE_ENTRIES` when a module has no `.transpilerignore` of its
    /// own - proven by excluding `node_modules` without one being written to disk at all.
    #[test]
    fn falls_back_to_default_ignore_list_without_a_transpilerignore_file() {
        let module_root = scratch_dir("module-no-ignore-file");
        write(&module_root.join("entity/Bar_entity/Bar_entity.aod"), "<entity/>");
        write(&module_root.join("node_modules/dep/x.txt"), "nope");

        let output_dir = scratch_dir("output-no-ignore-file");
        let ignore = read_ignore_entries(&module_root).unwrap();
        assert!(ignore.contains("node_modules"));
        copy_module_tree(&module_root, &ignore, &output_dir).unwrap();

        assert!(output_dir.join("entity/Bar_entity/Bar_entity.aod").exists());
        assert!(!output_dir.join("node_modules").exists());

        fs::remove_dir_all(&module_root).ok();
        fs::remove_dir_all(&output_dir).ok();
    }

    #[test]
    fn normalize_to_crlf_converts_bare_lf_and_leaves_already_crlf_alone() {
        assert_eq!(normalize_to_crlf(b"a\nb\nc"), b"a\r\nb\r\nc");
        assert_eq!(normalize_to_crlf(b"a\r\nb\r\nc"), b"a\r\nb\r\nc");
        assert_eq!(normalize_to_crlf(b"no newlines"), b"no newlines");
    }

    /// Real-corpus finding (see the doc comment on the call site in `copy_recursive`): `.aod`
    /// files get their line endings normalized to CRLF on copy, every other file type is
    /// copied byte-for-byte untouched - proven end-to-end through `copy_module_tree` rather
    /// than just at the helper-function level.
    #[test]
    fn aod_files_are_normalized_to_crlf_while_other_files_are_copied_verbatim() {
        let module_root = scratch_dir("module-crlf");
        write(&module_root.join("entity/Foo_entity/Foo_entity.aod"), "<entity>\n  <name>Foo</name>\n</entity>");
        write(&module_root.join("entity/Foo_entity/onValidation.js"), "var x = 1;\nvar y = 2;\n");

        let output_dir = scratch_dir("output-crlf");
        let ignore = read_ignore_entries(&module_root).unwrap();
        copy_module_tree(&module_root, &ignore, &output_dir).unwrap();

        let aod_bytes = fs::read(output_dir.join("entity/Foo_entity/Foo_entity.aod")).unwrap();
        assert_eq!(aod_bytes, b"<entity>\r\n  <name>Foo</name>\r\n</entity>\r\n".to_vec());

        let js_bytes = fs::read(output_dir.join("entity/Foo_entity/onValidation.js")).unwrap();
        assert_eq!(js_bytes, b"var x = 1;\nvar y = 2;\n".to_vec(), "non-.aod files must stay byte-for-byte untouched");

        fs::remove_dir_all(&module_root).ok();
        fs::remove_dir_all(&output_dir).ok();
    }

    /// Real-corpus finding (this agent, cross-checking `linked-files`'s R35 investigation): a
    /// `modification/<id>/<id>.aod` DEFINITION file is never copied into `dist/`, even though no
    /// real `.transpilerignore` lists `modification` as an entry - but a sidecar file (any other
    /// extension) inside that SAME `modification/<id>/` directory IS still copied normally,
    /// since `linked-files`'s inlining stage may need to resolve it against `output_dir`.
    #[test]
    fn modification_definition_files_are_skipped_but_their_sidecar_files_are_not() {
        let module_root = scratch_dir("module-modification");
        write(&module_root.join("modification/abc-123/abc-123.aod"), "<modification/>");
        write(&module_root.join("modification/abc-123/valueProcess.js"), "result.string(1);");
        write(&module_root.join("entity/Foo_entity/Foo_entity.aod"), "<entity/>");

        let output_dir = scratch_dir("output-modification");
        let ignore = read_ignore_entries(&module_root).unwrap();
        let copied = copy_module_tree(&module_root, &ignore, &output_dir).unwrap();

        assert_eq!(copied, 2, "only the sidecar .js and the unrelated entity file, not the modification .aod itself");
        assert!(!output_dir.join("modification/abc-123/abc-123.aod").exists(), "modification DEFINITION file must never be copied");
        assert!(output_dir.join("modification/abc-123/valueProcess.js").exists(), "modification SIDECAR file must still be copied");
        assert!(output_dir.join("entity/Foo_entity/Foo_entity.aod").exists());

        fs::remove_dir_all(&module_root).ok();
        fs::remove_dir_all(&output_dir).ok();
    }

    /// Project root wins over a dependency on a path collision - the documented ordering
    /// assumption above, proven directly rather than only described.
    #[test]
    fn project_root_wins_over_a_dependency_on_a_path_collision() {
        let dep_root = scratch_dir("dep-root");
        write(&dep_root.join("entity/Shared_entity/Shared_entity.aod"), "<from-dependency/>");
        let project_root = scratch_dir("project-root");
        write(&project_root.join("entity/Shared_entity/Shared_entity.aod"), "<from-project/>");

        let mut modules = BTreeMap::new();
        modules.insert("@aditosoftware/dep".to_string(), fake_module("@aditosoftware/dep", dep_root.clone()));
        let graph = ModuleGraph {
            project: fake_module("@3hills-it/testproject", project_root.clone()),
            modules,
            edges: BTreeMap::new(),
            unresolved_external: Default::default(),
            duplicates: Vec::new(),
            diamonds_resolved_via_override: Vec::new(),
        };

        let output_dir = scratch_dir("output-collision");
        run_copy_phase(&graph, &output_dir).unwrap();

        assert_eq!(
            fs::read_to_string(output_dir.join("entity/Shared_entity/Shared_entity.aod")).unwrap(),
            "<from-project/>\r\n"
        );

        fs::remove_dir_all(&dep_root).ok();
        fs::remove_dir_all(&project_root).ok();
        fs::remove_dir_all(&output_dir).ok();
    }

    /// Real-corpus regression (see `read_ignore_entries`'s doc comment for the incident): a
    /// `.transpilerignore` entry must be excluded no matter how deep it appears, not just at
    /// the module root - proven with an ignored dir nested three levels down next to a kept
    /// sibling file at the same depth.
    #[test]
    fn ignores_a_match_at_any_depth_not_just_the_top_level() {
        let module_root = scratch_dir("module-nested-ignore");
        write(&module_root.join("entity/Foo_entity/sub/.idea/workspace.xml"), "<ide/>");
        write(&module_root.join("entity/Foo_entity/sub/keep.js"), "// keep");
        write(&module_root.join(".transpilerignore"), ".idea\n");

        let output_dir = scratch_dir("output-nested-ignore");
        let ignore = read_ignore_entries(&module_root).unwrap();
        copy_module_tree(&module_root, &ignore, &output_dir).unwrap();

        assert!(!output_dir.join("entity/Foo_entity/sub/.idea").exists(), "nested .idea must be excluded, not just a top-level one");
        assert!(output_dir.join("entity/Foo_entity/sub/keep.js").exists());

        fs::remove_dir_all(&module_root).ok();
        fs::remove_dir_all(&output_dir).ok();
    }

    /// Real-incident regression (see `copy_module_tree`'s doc comment): when `output_dir` sits
    /// INSIDE the module being copied (exactly how the CLI wires `_own_engine_dist` under the
    /// project home), the project-root module must never copy `output_dir` into itself. A run
    /// without this guard produced 600k+ files for a project whose real `dist/` has ~18k before
    /// it had to be killed - this proves the fix directly rather than only by absence of a
    /// hang.
    #[test]
    fn never_copies_the_output_directory_into_itself() {
        let project_root = scratch_dir("project-root-self-copy");
        write(&project_root.join("entity/Foo_entity/Foo_entity.aod"), "<entity/>");
        let output_dir = project_root.join("_own_engine_dist");

        let graph = ModuleGraph {
            project: fake_module("@3hills-it/testproject", project_root.clone()),
            modules: BTreeMap::new(),
            edges: BTreeMap::new(),
            unresolved_external: Default::default(),
            duplicates: Vec::new(),
            diamonds_resolved_via_override: Vec::new(),
        };

        let report = run_copy_phase(&graph, &output_dir).expect("copy phase must not hang or fail on a nested output_dir");

        assert_eq!(report.files_copied, 1, "only Foo_entity.aod should be copied, never output_dir's own (empty) content");
        assert!(output_dir.join("entity/Foo_entity/Foo_entity.aod").exists());
        assert!(!output_dir.join("_own_engine_dist").exists(), "output_dir must never appear nested inside itself");

        fs::remove_dir_all(&project_root).ok();
    }

    #[test]
    fn never_copies_forge_owned_cache_or_output_folders_of_other_runs() {
        let project_root = scratch_dir("project-root-forge-owned");
        write(&project_root.join("entity/Foo_entity/Foo_entity.aod"), "<entity/>");
        write(&project_root.join(".forge-incremental-cache/manifest.txt"), "x");
        write(&project_root.join("_own_engine_dist/entity/Foo_entity/Foo_entity.aod"), "<entity/>");
        let output_dir = project_root.join("_forge_experimental_dist");

        let graph = ModuleGraph {
            project: fake_module("@3hills-it/testproject", project_root.clone()),
            modules: BTreeMap::new(),
            edges: BTreeMap::new(),
            unresolved_external: Default::default(),
            duplicates: Vec::new(),
            diamonds_resolved_via_override: Vec::new(),
        };

        let report = run_copy_phase(&graph, &output_dir).expect("copy phase");

        assert_eq!(report.files_copied, 1);
        assert!(!output_dir.join(".forge-incremental-cache").exists());
        assert!(!output_dir.join("_own_engine_dist").exists());

        fs::remove_dir_all(&project_root).ok();
    }
}
