// Orchestration: run the reference (official) transpiler and the pluggable `OwnEngine` against
// the SAME project copy, then byte-compare their outputs. This is the P5 gate itself (chef
// prompt §2.4) - nothing downstream may switch to `OwnEngine` as the production path until a
// run of this harness reports `comparison.is_perfect_match() == true` across the full corpus.

use crate::compare::{compare_trees, ComparisonReport};
use crate::error::HarnessError;
use crate::own_engine::OwnEngine;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use adito_transpiler::{EventSink, NbexecTranspilerRunner, TranspilerConfig, TranspilerRunner};

pub struct DifferentialHarness {
    transpiler_config: TranspilerConfig,
}

pub struct HarnessRunResult {
    pub reference_exit_code: Option<i32>,
    pub reference_dir: PathBuf,
    pub own_dir: PathBuf,
    pub comparison: ComparisonReport,
}

impl DifferentialHarness {
    pub fn new(transpiler_config: TranspilerConfig) -> Self {
        Self { transpiler_config }
    }

    /// Runs both engines against `project_home` (a project copy the caller owns - MUST already
    /// be a scratch copy, never a `GitRepos_ADITO` original; this crate does not enforce that,
    /// the caller (CLI/agent) does, per the scope guardrail).
    ///
    /// `own_output_dir` is where `OwnEngine::run` is told to write its output. It is created
    /// fresh here (removed first if it already exists from a previous run) so a stale prior
    /// output never leaks into the comparison.
    pub fn run(
        &self,
        project_home: &Path,
        own_engine: &dyn OwnEngine,
        own_output_dir: &Path,
    ) -> Result<HarnessRunResult, HarnessError> {
        if !project_home.is_dir() {
            return Err(HarnessError::ProjectHomeNotFound(project_home.to_path_buf()));
        }

        let reference_dir = project_home.join("dist");
        // Reference run: the official transpiler writes into <project_home>/dist itself (see
        // transpiler.md §4) - nothing to prepare here beyond letting it run. A stale dist/ from
        // a previous manual run is intentionally left in place; the official transpiler owns
        // that directory's lifecycle, not this harness.
        let sink: EventSink = Arc::new(|_event| {
            // Deliberately dropped: the harness does not stream progress to the console by
            // default (Kontext-Disziplin - a full transpiler log must never end up in an
            // agent's context). A caller that wants live progress can build its own runner
            // with a custom sink; this orchestration only needs the final TranspileOutcome.
        });
        let runner = NbexecTranspilerRunner::new(self.transpiler_config.clone());
        let outcome = runner.run(project_home, sink)?;

        if own_output_dir.exists() {
            std::fs::remove_dir_all(own_output_dir).map_err(|source| HarnessError::Walk {
                path: own_output_dir.to_path_buf(),
                source,
            })?;
        }
        std::fs::create_dir_all(own_output_dir).map_err(|source| HarnessError::Walk {
            path: own_output_dir.to_path_buf(),
            source,
        })?;

        own_engine
            .run(project_home, own_output_dir)
            .map_err(|e| HarnessError::OwnEngine(e.to_string()))?;

        let comparison = compare_trees(&reference_dir, own_output_dir).map_err(|source| HarnessError::Walk {
            path: reference_dir.clone(),
            source,
        })?;

        Ok(HarnessRunResult {
            reference_exit_code: outcome.exit_code,
            reference_dir,
            own_dir: own_output_dir.to_path_buf(),
            comparison,
        })
    }
}
