// The pluggable seam the P5 engine agents (`resolver-engine`, `copy-phase`,
// `modification-engine`, `linked-files`, `incremental`) implement step by step. The harness
// itself never assumes anything about HOW `OwnEngine` produces its output tree - only that it
// writes a `dist`-equivalent directory structure to `output_dir` so `compare` can hold it
// byte-for-byte against the reference transpiler's own `dist/`.
//
// `output_dir` is deliberately separate from the project's own `<project_home>/dist` (which the
// reference transpiler run already occupies) - this lets the harness run both engines against
// the SAME project copy without one overwriting the other's result, and lets `OwnEngine`
// implementations stay ignorant of the reference run entirely.

use std::path::Path;

pub mod alias_merge_stage;
pub mod linked_unshare_stage;
pub mod preferences_merge_stage;
pub mod progress;
pub mod copy_phase_stage;
pub mod incremental_stage;
pub mod extension_point_stage;
pub mod language_merge_stage;
pub mod service_inline_stage;
pub mod modification_relocate_stage;
pub mod linked_files_stage;
pub mod modification_engine_stage;
pub mod resolver_stage;

pub use alias_merge_stage::{run_alias_merge, AliasMergeReport};
pub use linked_unshare_stage::{run_linked_unshare, UnshareReport};
pub use preferences_merge_stage::{run_preferences_merge, PreferencesMergeReport};
pub use modification_relocate_stage::{run_modification_relocation, RelocateReport};
pub use extension_point_stage::{run_extension_point_resolution, ExtensionPointReport};
pub use service_inline_stage::{run_service_inline, ServiceInlineReport};
pub use language_merge_stage::{run_language_merge, LanguageMergeReport};
pub use copy_phase_stage::{run_copy_phase, CopyPhaseEngine, CopyPhaseError, CopyPhaseReport};
pub use incremental_stage::{run_incremental, IncrementalEngine, IncrementalError, IncrementalReport};
pub use linked_files_stage::{run_linked_files_phase, LinkedFilesEngine, LinkedFilesError, LinkedFilesReport};
pub use modification_engine_stage::{
    merge_modifications_into_bytes,
    run_modification_phase, ModificationEngine, ModificationEngineError, ModificationEngineReport,
};
pub use resolver_stage::{resolve_module_graph, ResolverEngine};

#[derive(Debug, thiserror::Error)]
pub enum OwnEngineError {
    #[error("{0}")]
    Message(String),
}

pub trait OwnEngine {
    /// Human-readable name for the report (e.g. "StubEngine", later "ForgeEngine v0.3").
    fn name(&self) -> &str;

    /// Transpiles `project_home` and writes the resulting `dist`-equivalent tree to
    /// `output_dir`. `output_dir` is created fresh (empty) by the caller before this is
    /// invoked - implementations may assume it exists and is empty.
    fn run(&self, project_home: &Path, output_dir: &Path) -> Result<(), OwnEngineError>;
}

/// Honest placeholder for this round: there is no real Rust transpiler engine yet (that is the
/// job of the agents that follow this one). `StubEngine` produces no output at all, which the
/// comparison step will correctly report as 100% "only in reference" / 0% match - the truthful
/// starting point, not a harness defect.
///
/// Kept intentionally free of any copy-phase logic. A later round MAY choose to grow a second
/// stub that simulates the simplest known copy-phase case (plain non-linked-file `.aod` files,
/// `transpiler.md` §4) if that turns out to be useful for exercising the comparison path with a
/// partial match - deliberately not done here to avoid the stub silently drifting into "half an
/// engine" that later agents feel obliged to preserve compatibility with.
pub struct StubEngine;

impl OwnEngine for StubEngine {
    fn name(&self) -> &str {
        "StubEngine (placeholder - no real engine yet)"
    }

    fn run(&self, _project_home: &Path, _output_dir: &Path) -> Result<(), OwnEngineError> {
        Ok(())
    }
}
