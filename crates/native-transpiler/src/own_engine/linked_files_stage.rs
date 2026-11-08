// Fifth and final `OwnEngine` stage of the own Rust transpiler pipeline (Forge P5), after
// `modification_engine_stage`. Implements the linked-file inlining portion of `transpiler.md`
// §4/§5: any `.aod` tag whose ENTIRE text content is a single `%aditoprj%/<relative-path>`
// reference gets that content replaced, in place, with the referenced file's raw bytes
// (XML-escaped) - real-corpus-verified generic across every file type observed (`.js`, `.adoc`),
// not only script/process tags (`documentation` inlines the same way, see this agent's Phase 1
// corpus check).
//
// Corpus research (Phase 1, see `p5-linked-files-notes.md` for the full writeup): re-verified
// `transpiler.md` §5's finding across the FULL corpus (all 13 projects under `GitRepos_ADITO`,
// not just Hermes) - zero `.ts` files anywhere under an object folder (`entity/`, `process/`,
// `neonView/`, `neonContext/`). TypeScript linked-file compilation therefore stays an honest,
// documented gap (see `LinkedFilesError::TypeScriptNotImplemented`) rather than untested,
// speculative `tsc`-invocation code - same precedent as `plugin-kernel`'s `UnverifiedTsCompiler`.
//
// `%aditoprj%` resolution (verified against the real corpus, not assumed): it is NOT the
// top-level project root - it is relative to whichever MODULE the referencing `.aod` file itself
// belongs to. Real example: `node_modules/@aditosoftware/resource-operation/entity/
// ResourceOperation_entity/ResourceOperation_entity.aod` references
// `%aditoprj%/entity/ResourceOperation_entity/entityfields/status/displayValueProcess.js`, which
// resolves to `node_modules/@aditosoftware/resource-operation/entity/.../displayValueProcess.js`
// - NOT to a same-named path under the Hermes project root (which does not exist). Crucially,
// this stage does NOT need to re-derive per-object module ownership to resolve this: by the time
// this stage runs (after copy-phase has copied every module's full tree - `.js`/`.adoc` sidecars
// included - into `output_dir`, and after modification-phase has patched `.aod` text in place),
// every `%aditoprj%/<path>` reference already resolves directly as `output_dir/<path>` - verified
// directly against a real run (`_own_engine_dist/entity/ResourceOperation_entity/entityfields/
// status/displayValueProcess.js` and `_own_engine_dist/modification/<uuid>/<uuid>.js` both exist
// exactly where their `.aod` tags say they should).

use std::fs;
use std::path::{Path, PathBuf};

use aod_io::{build_index, replace_text_at, AodDocument, AodEvent, EventIndex, EventPath, IndexedRange};
use module_graph::ModuleGraph;

use crate::own_engine::copy_phase_stage::run_copy_phase;
use crate::own_engine::modification_engine_stage::run_modification_phase;
use crate::own_engine::resolver_stage::resolve_module_graph;
use crate::own_engine::{OwnEngine, OwnEngineError};

/// The literal prefix every linked-file reference in the corpus starts with (`transpiler.md`
/// §4/§5). No other prefix (`%...%`) was found anywhere in the corpus during this agent's own
/// Phase 1 re-check.
const LINKED_FILE_PREFIX: &str = "%aditoprj%/";

#[derive(Debug, thiserror::Error)]
pub enum LinkedFilesError {
    #[error("failed to read {path}: {source}")]
    Read { path: PathBuf, source: std::io::Error },
    #[error("failed to parse {path}: {source}")]
    Parse { path: PathBuf, source: aod_io::AodError },
    #[error("failed to write {path}: {source}")]
    Write { path: PathBuf, source: platform::error::PlatformError },
}

/// Diagnostics from a linked-files run - same minimal-sanity-check scope as the previous stages'
/// reports (`compare.rs` remains the correctness authority).
#[derive(Debug, Default, Clone)]
pub struct LinkedFilesReport {
    pub aod_files_scanned: usize,
    pub references_inlined: usize,
    /// `.ts` references found - always 0 against the real corpus (see module doc), counted
    /// rather than silently ignored so a future corpus change would surface here first.
    pub typescript_references_skipped: usize,
    pub references_failed: usize,
    pub failures: Vec<(PathBuf, String)>,
}

fn xml_escape(bytes: &[u8]) -> Vec<u8> {
    // `AodEvent::Text` bytes are stored pre-escaped everywhere else in this codebase (aod-io's
    // own convention - `serialize` never escapes on write). Inlined linked-file content needs
    // the same treatment before becoming a Text event's bytes - real-corpus-verified against
    // `dist/`: `&` -> `&amp;`, `<` -> `&lt;`, `>` -> `&gt;` (e.g. `&&` becomes `&amp;&amp;`, `=>`
    // becomes `=&gt;` inside inlined script bodies). `&` must be escaped FIRST or the other two
    // escapes' own `&` would be double-escaped.
    let mut out = Vec::with_capacity(bytes.len());
    for &b in bytes {
        match b {
            b'&' => out.extend_from_slice(b"&amp;"),
            b'<' => out.extend_from_slice(b"&lt;"),
            b'>' => out.extend_from_slice(b"&gt;"),
            _ => out.push(b),
        }
    }
    out
}

/// Finds every element in `doc` whose entire content is a single `Text` event starting with
/// `%aditoprj%/` - a linked-file reference. Returns `(path, referenced relative path)` pairs.
/// Safe to compute once and apply all of them against the SAME `index`/`doc` afterwards:
/// `replace_text_at` only swaps an existing `Text` event's byte content in place (no insert/
/// remove), so the event list's length - and therefore every other `EventPath`'s meaning - never
/// shifts across multiple calls, unlike `insert_at`/`delete_range`.
fn find_linked_file_references(doc: &AodDocument, index: &EventIndex) -> Vec<(EventPath, String)> {
    let mut found = Vec::new();
    for (path, range) in index.iter() {
        if !matches!(range, IndexedRange::Element(_)) {
            continue;
        }
        if let Some(text_idx) = index.text_event_index(doc, path) {
            if let AodEvent::Text(bytes) = &doc.events[text_idx] {
                if let Some(rel) = std::str::from_utf8(bytes).ok().and_then(|s| s.strip_prefix(LINKED_FILE_PREFIX)) {
                    found.push((path.clone(), rel.to_string()));
                }
            }
        }
    }
    found
}

/// Inlines every linked-file reference found in `path` (a single `.aod` file already sitting in
/// `output_dir` after copy-phase + modification-phase), rewriting it in place. `.ts` references
/// are counted and skipped (see module doc - honest, documented gap, never observed in the real
/// corpus) rather than guessed at.
fn inline_file(path: &Path, output_dir: &Path, report: &mut LinkedFilesReport) -> Result<(), LinkedFilesError> {
    let bytes = fs::read(path).map_err(|source| LinkedFilesError::Read { path: path.to_path_buf(), source })?;
    let mut doc = aod_io::parse(&bytes).map_err(|source| LinkedFilesError::Parse { path: path.to_path_buf(), source })?;
    let index = build_index(&doc);
    let refs = find_linked_file_references(&doc, &index);
    if refs.is_empty() {
        return Ok(());
    }

    let mut changed = false;
    for (event_path, rel) in refs {
        if rel.to_ascii_lowercase().ends_with(".ts") {
            report.typescript_references_skipped += 1;
            report.failures.push((
                path.to_path_buf(),
                format!("TypeScript linked file {rel:?} - compilation not implemented, no real corpus example ever found to verify against (transpiler.md §5)"),
            ));
            continue;
        }
        let referenced_path = output_dir.join(&rel);
        match fs::read(&referenced_path) {
            Ok(content) => {
                let text_idx = match index.text_event_index(&doc, &event_path) {
                    Some(i) => i,
                    None => {
                        report.references_failed += 1;
                        report.failures.push((path.to_path_buf(), format!("linked-file target {rel:?} resolved but its own element is no longer a scalar leaf")));
                        continue;
                    }
                };
                let escaped = xml_escape(&content);
                if let Err(e) = replace_text_at(&mut doc, text_idx..text_idx + 1, escaped) {
                    report.references_failed += 1;
                    report.failures.push((path.to_path_buf(), format!("replace_text_at failed for {rel:?}: {e}")));
                    continue;
                }
                report.references_inlined += 1;
                changed = true;
            }
            Err(e) => {
                report.references_failed += 1;
                report.failures.push((path.to_path_buf(), format!("linked file {rel:?} not found under output_dir ({referenced_path:?}): {e}")));
            }
        }
    }

    if changed {
        let out_bytes = aod_io::serialize(&doc);
        platform::fs::atomic_write(path, &out_bytes).map_err(|source| LinkedFilesError::Write { path: path.to_path_buf(), source })?;
    }
    Ok(())
}

fn is_aod_file(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("aod"))
}

/// Recursively walks `dir` (hand-rolled, no new dependency - mirrors `copy_phase_stage`'s own
/// recursion style) collecting every `.aod` file's path.
fn collect_aod_files(dir: &Path, out: &mut Vec<PathBuf>) -> std::io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let p = entry.path();
        if p.is_dir() {
            collect_aod_files(&p, out)?;
        } else if is_aod_file(&p) {
            out.push(p);
        }
    }
    Ok(())
}

/// Runs the linked-file inlining phase over every `.aod` file already present in `output_dir`
/// (copy-phase + modification-phase's combined output). Each file is processed independently -
/// linked-file references never point at another `.aod` file, so there is no cross-file ordering
/// concern here unlike the modification phase.
pub fn run_linked_files_phase(output_dir: &Path) -> LinkedFilesReport {
    let mut report = LinkedFilesReport::default();
    let mut files = Vec::new();
    if collect_aod_files(output_dir, &mut files).is_err() {
        return report;
    }
    report.aod_files_scanned = files.len();
    for file in files {
        if let Err(e) = inline_file(&file, output_dir, &mut report) {
            report.failures.push((file, e.to_string()));
        }
    }
    report
}

/// `OwnEngine` wiring: resolves the module graph, runs copy-phase, then modification-phase, then
/// linked-file inlining - the full pipeline, all five P5 building blocks composed.
pub struct LinkedFilesEngine;

impl OwnEngine for LinkedFilesEngine {
    fn name(&self) -> &str {
        "LinkedFilesEngine (resolver + copy-phase + modification-application + linked-file inlining; .ts not implemented, no corpus example)"
    }

    fn run(&self, project_home: &Path, output_dir: &Path) -> Result<(), OwnEngineError> {
        let graph: ModuleGraph = resolve_module_graph(project_home)?;
        run_copy_phase(&graph, output_dir).map_err(|e| OwnEngineError::Message(e.to_string()))?;
        run_modification_phase(&graph, output_dir).map_err(|e| OwnEngineError::Message(e.to_string()))?;
        let _report = run_linked_files_phase(output_dir);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn scratch_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "linked-files-test-{label}-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(&dir).expect("failed to create scratch dir");
        dir
    }

    fn write(path: &Path, contents: &[u8]) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, contents).unwrap();
    }

    /// Real corpus shape (`ResourceOperation_entity.aod`'s `displayValueProcess`/`STATUS`
    /// field): a script tag whose sole content is a `%aditoprj%/...js` reference gets replaced
    /// with the referenced file's raw content.
    #[test]
    fn inlines_a_js_linked_file_reference() {
        let output_dir = scratch_dir("js");
        write(
            &output_dir.join("entity/Foo_entity/Foo_entity.aod"),
            b"<entity>\r\n  <entityFields>\r\n    <entityField>\r\n      <name>STATUS</name>\r\n      <displayValueProcess>%aditoprj%/entity/Foo_entity/entityfields/status/displayValueProcess.js</displayValueProcess>\r\n    </entityField>\r\n  </entityFields>\r\n</entity>",
        );
        write(
            &output_dir.join("entity/Foo_entity/entityfields/status/displayValueProcess.js"),
            b"result.string(a && b);",
        );

        let report = run_linked_files_phase(&output_dir);
        assert_eq!(report.references_inlined, 1, "{:?}", report.failures);
        assert_eq!(report.references_failed, 0);

        let result = fs::read_to_string(output_dir.join("entity/Foo_entity/Foo_entity.aod")).unwrap();
        assert!(result.contains("<displayValueProcess>result.string(a &amp;&amp; b);</displayValueProcess>"), "got: {result}");

        fs::remove_dir_all(&output_dir).ok();
    }

    /// Real corpus shape (`documentation` tag, `.adoc` extension): inlining is NOT limited to
    /// script/process tags or to `.js` - any tag, any extension, gets the same treatment.
    #[test]
    fn inlines_a_non_js_linked_file_reference_regardless_of_tag_or_extension() {
        let output_dir = scratch_dir("adoc");
        write(
            &output_dir.join("entity/Foo_entity/Foo_entity.aod"),
            b"<entity>\r\n  <documentation>%aditoprj%/entity/Foo_entity/documentation.adoc</documentation>\r\n</entity>",
        );
        write(&output_dir.join("entity/Foo_entity/documentation.adoc"), b"= Foo_entity\n\nSome docs.");

        let report = run_linked_files_phase(&output_dir);
        assert_eq!(report.references_inlined, 1, "{:?}", report.failures);

        let result = fs::read_to_string(output_dir.join("entity/Foo_entity/Foo_entity.aod")).unwrap();
        assert!(result.contains("<documentation>= Foo_entity\n\nSome docs.</documentation>"), "got: {result}");

        fs::remove_dir_all(&output_dir).ok();
    }

    /// A `.ts` reference is counted and reported, never guessed at (module doc: no real corpus
    /// example exists to verify a `tsc` invocation against).
    #[test]
    fn typescript_linked_files_are_reported_not_guessed_at() {
        let output_dir = scratch_dir("ts");
        write(
            &output_dir.join("entity/Foo_entity/Foo_entity.aod"),
            b"<entity>\r\n  <valueProcess>%aditoprj%/entity/Foo_entity/entityfields/status/valueProcess.ts</valueProcess>\r\n</entity>",
        );

        let report = run_linked_files_phase(&output_dir);
        assert_eq!(report.typescript_references_skipped, 1);
        assert_eq!(report.references_inlined, 0);

        let result = fs::read_to_string(output_dir.join("entity/Foo_entity/Foo_entity.aod")).unwrap();
        assert!(result.contains("%aditoprj%/entity/Foo_entity/entityfields/status/valueProcess.ts"), "must be left untouched: {result}");

        fs::remove_dir_all(&output_dir).ok();
    }

    /// A modification-owned linked file (real shape: `%aditoprj%/modification/<uuid>/x.js`,
    /// created by the modification-engine stage's own MODIFY path rewrite) resolves and inlines
    /// exactly like a module-owned one - proves the "everything resolves relative to
    /// `output_dir`" claim in the module doc comment for this specific real case too.
    #[test]
    fn inlines_a_modification_owned_linked_file() {
        let output_dir = scratch_dir("mod-owned");
        write(
            &output_dir.join("entity/Foo_entity/Foo_entity.aod"),
            b"<entity>\r\n  <displayValueProcess>%aditoprj%/modification/abc-123/displayValueProcess.js</displayValueProcess>\r\n</entity>",
        );
        write(&output_dir.join("modification/abc-123/displayValueProcess.js"), b"result.string(1);");

        let report = run_linked_files_phase(&output_dir);
        assert_eq!(report.references_inlined, 1, "{:?}", report.failures);

        let result = fs::read_to_string(output_dir.join("entity/Foo_entity/Foo_entity.aod")).unwrap();
        assert!(result.contains("<displayValueProcess>result.string(1);</displayValueProcess>"), "got: {result}");

        fs::remove_dir_all(&output_dir).ok();
    }

    /// A missing referenced file is reported as a failure, not silently skipped or panicking.
    #[test]
    fn missing_referenced_file_is_reported_as_a_failure() {
        let output_dir = scratch_dir("missing");
        write(
            &output_dir.join("entity/Foo_entity/Foo_entity.aod"),
            b"<entity>\r\n  <valueProcess>%aditoprj%/entity/Foo_entity/does-not-exist.js</valueProcess>\r\n</entity>",
        );

        let report = run_linked_files_phase(&output_dir);
        assert_eq!(report.references_failed, 1);
        assert_eq!(report.references_inlined, 0);

        fs::remove_dir_all(&output_dir).ok();
    }

    /// A file with no linked-file references at all is left byte-for-byte untouched (no
    /// spurious rewrite, no atomic_write call for files that do not need one).
    #[test]
    fn file_without_references_is_left_untouched() {
        let output_dir = scratch_dir("no-refs");
        let original = b"<entity>\r\n  <title>Plain</title>\r\n</entity>".to_vec();
        write(&output_dir.join("entity/Foo_entity/Foo_entity.aod"), &original);

        let report = run_linked_files_phase(&output_dir);
        assert_eq!(report.references_inlined, 0);
        assert_eq!(report.aod_files_scanned, 1);

        let result = fs::read(output_dir.join("entity/Foo_entity/Foo_entity.aod")).unwrap();
        assert_eq!(result, original);

        fs::remove_dir_all(&output_dir).ok();
    }

    /// Two independent linked-file references in the SAME file both get inlined correctly -
    /// proves the "safe to apply all references found in one pass against the same index"
    /// reasoning in `find_linked_file_references`'s doc comment (event list length must stay
    /// stable across both `replace_text_at` calls for the second EventPath to remain valid).
    #[test]
    fn inlines_multiple_references_in_the_same_file() {
        let output_dir = scratch_dir("multi");
        write(
            &output_dir.join("entity/Foo_entity/Foo_entity.aod"),
            b"<entity>\r\n  <valueProcess>%aditoprj%/entity/Foo_entity/a.js</valueProcess>\r\n  <stateProcess>%aditoprj%/entity/Foo_entity/b.js</stateProcess>\r\n</entity>",
        );
        write(&output_dir.join("entity/Foo_entity/a.js"), b"result.string(1);");
        write(&output_dir.join("entity/Foo_entity/b.js"), b"result.string(2);");

        let report = run_linked_files_phase(&output_dir);
        assert_eq!(report.references_inlined, 2, "{:?}", report.failures);

        let result = fs::read_to_string(output_dir.join("entity/Foo_entity/Foo_entity.aod")).unwrap();
        assert!(result.contains("<valueProcess>result.string(1);</valueProcess>"), "got: {result}");
        assert!(result.contains("<stateProcess>result.string(2);</stateProcess>"), "got: {result}");

        fs::remove_dir_all(&output_dir).ok();
    }
}
