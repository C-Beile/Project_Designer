// First real `OwnEngine` stage of the own Rust transpiler pipeline (Forge P5). Wires the
// already-finished, real-corpus-verified `npm-modules` crate (Forge P3, see
// PROJECT/20_architecture/p3-npm-modules-notes.md) into the `OwnEngine` seam instead of
// rebuilding module resolution from scratch - see PROJECT/20_architecture/
// p5-resolver-engine-notes.md for the full reasoning.

use std::path::Path;

use npm_modules::ModuleGraph;

use crate::own_engine::{OwnEngine, OwnEngineError};

/// Resolves the module graph for `project_home` via `npm-modules::resolve`, translating
/// its error type into [`OwnEngineError`] so callers in this crate do not need a direct
/// dependency on `npm_modules::ModuleGraphError`. This is the function the next pipeline
/// stage (`copy-phase`) is expected to call to get the resolved module set (including each
/// module's on-disk `path`, added to `npm_modules::ModuleDefinition` for exactly this
/// purpose - see the npm-modules changelog note in `p5-resolver-engine-notes.md`) without
/// going through the `OwnEngine` trait, which has no return channel for data.
pub fn resolve_npm_modules(project_home: &Path) -> Result<ModuleGraph, OwnEngineError> {
    // The modules are taken as they are installed: an installed version that does not match a requested range (the project's
    // package.json asks for ^2.7.3, node_modules holds 2.7.0) does not stop the build.
    npm_modules::resolve_lenient(project_home)
        .map_err(|source| OwnEngineError::Message(source.to_string()))
}

/// First real pipeline stage: performs module resolution (dependency graph traversal,
/// diamond-conflict handling via `overrides`) against a real project copy, replacing
/// `StubEngine` for the resolver portion of the pipeline.
///
/// `output_dir` is deliberately left empty on a successful run. Module resolution alone has
/// nothing to copy into a `dist`-equivalent tree yet - turning resolved modules into actual
/// output files is the `copy-phase` agent's job (next in P5), not this one. A run against
/// Hermes therefore still reports 0% match against the reference `dist/`, same as
/// `StubEngine` and for the same honest reason (see `p5-resolver-engine-notes.md` for the
/// confirmed number): success here means "the resolver stage passed against the real
/// project" (no cycle, no unresolved diamond, every `package.json` parsed), not "dist is
/// byte-exact".
pub struct ResolverEngine;

impl OwnEngine for ResolverEngine {
    fn name(&self) -> &str {
        "ResolverEngine (npm-modules resolution stage; copy-phase not yet wired)"
    }

    fn run(&self, project_home: &Path, _output_dir: &Path) -> Result<(), OwnEngineError> {
        // Resolve and discard: today's only job is proving resolution succeeds against a
        // real project. The graph itself is available to callers (and the next agent) via
        // `resolve_npm_modules`, called directly rather than through this trait method,
        // which has no data return channel.
        resolve_npm_modules(project_home)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};

    /// Fixtures are reused directly from the already-verified `npm-modules` crate (P3) per
    /// the role brief - no new fixture corpus is built here.
    fn npm_modules_fixture(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../npm-modules/tests/fixtures")
            .join(name)
    }

    /// The `OwnEngine`-wrapped resolution must succeed (no error) for a real, previously
    /// verified project fixture - proves the wiring itself, not npm-modules's own logic
    /// (already covered by `cargo test -p npm-modules`).
    #[test]
    fn resolver_engine_run_succeeds_against_real_pichler_fixture() {
        let project = npm_modules_fixture("pichler_diamond");
        let output_dir = std::env::temp_dir().join(format!(
            "resolver-engine-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&output_dir).expect("failed to create scratch output dir");

        let engine = ResolverEngine;
        let result = engine.run(&project, &output_dir);
        assert!(result.is_ok(), "expected resolver stage to succeed: {result:?}");

        // Honest placeholder: no dist-equivalent output is produced yet.
        let entries: Vec<_> = std::fs::read_dir(&output_dir)
            .expect("output dir must still exist")
            .collect();
        assert!(entries.is_empty(), "resolver stage must not write files yet");

        std::fs::remove_dir_all(&output_dir).ok();
    }

    /// Proves the two entry points (the `OwnEngine::run` seam and the direct
    /// `resolve_npm_modules` function the next pipeline stage will call) agree with
    /// `npm-modules` resolved in isolation, for the same real fixture used by
    /// `npm-modules`'s own `pichler_diamond_resolves_via_project_root_override` test.
    #[test]
    fn resolve_npm_modules_matches_npm_modules_resolved_in_isolation() {
        let project = npm_modules_fixture("pichler_diamond");

        let direct = npm_modules::resolve(&project).expect("npm-modules must resolve directly");
        let via_stage = resolve_npm_modules(&project).expect("resolver stage must resolve too");

        assert_eq!(direct.project.name, via_stage.project.name);
        assert_eq!(direct.modules.len(), via_stage.modules.len());
        assert_eq!(
            direct.modules.keys().collect::<Vec<_>>(),
            via_stage.modules.keys().collect::<Vec<_>>()
        );
        assert_eq!(direct.edges, via_stage.edges);
        assert_eq!(direct.unresolved_external, via_stage.unresolved_external);
        assert_eq!(
            direct.diamonds_resolved_via_override.len(),
            via_stage.diamonds_resolved_via_override.len()
        );

        // The new `path` field (added in this round, see p5-resolver-engine-notes.md) must
        // point at the fixture's own module directory, not the project root, for a real
        // installed module.
        let platform = via_stage
            .modules
            .get("@aditosoftware/platform")
            .expect("platform must be reachable in the pichler_diamond fixture");
        assert!(
            platform.path.ends_with("node_modules/@aditosoftware/platform")
                || platform.path.ends_with("node_modules\\@aditosoftware\\platform"),
            "expected platform's resolved path to point at its node_modules directory, got {:?}",
            platform.path
        );
    }

    /// A resolution failure (cycle, unresolved diamond, bad package.json) must surface as an
    /// `OwnEngineError`, not panic or silently succeed - reuses `npm-modules`'s own
    /// synthetic-cycle fixture rather than building a new one.
    #[test]
    fn resolver_engine_run_surfaces_npm_modules_errors() {
        let project = npm_modules_fixture("synthetic_cycle");
        let output_dir = std::env::temp_dir().join(format!(
            "resolver-engine-test-err-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&output_dir).expect("failed to create scratch output dir");

        let engine = ResolverEngine;
        let result = engine.run(&project, &output_dir);
        assert!(result.is_err(), "cyclic fixture must surface as an error");

        std::fs::remove_dir_all(&output_dir).ok();
    }
}
