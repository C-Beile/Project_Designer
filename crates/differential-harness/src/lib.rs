//! Differential test harness for the P5 own-Rust-transpiler-engine effort (Forge project).
//!
//! Purpose (chef prompt §2.4, non-negotiable): the own Rust engine may only replace the
//! official-transpiler wrapper as the production path once a run of this harness reports a
//! byte-exact match across the full project corpus. This crate builds that safety mechanism -
//! it does not implement the engine itself.
//!
//! Layering:
//! - [`own_engine::OwnEngine`] - the seam the engine agents (`resolver-engine`, `copy-phase`,
//!   `modification-engine`, `linked-files`, `incremental`) implement step by step, replacing
//!   [`own_engine::StubEngine`] without touching this crate.
//! - [`compare::compare_trees`] - pure, byte-exact recursive directory comparison.
//! - [`harness::DifferentialHarness`] - orchestrates one reference run (via the `transpiler`
//!   crate) plus one `OwnEngine` run against the same project copy, then compares their output.
//! - [`report`] - renders a run into a human/agent-readable Markdown report on disk.

pub mod compare;
pub mod error;
pub mod harness;
pub mod own_engine;
pub mod report;

pub use compare::{compare_trees, ComparisonReport, FileComparison, FileVerdict};
pub use error::HarnessError;
pub use harness::{DifferentialHarness, HarnessRunResult};
pub use own_engine::{
    resolve_module_graph, run_copy_phase, run_incremental, run_linked_files_phase,
    run_modification_phase, CopyPhaseEngine, CopyPhaseError, CopyPhaseReport, IncrementalEngine,
    IncrementalError, IncrementalReport, LinkedFilesEngine, LinkedFilesError, LinkedFilesReport,
    ModificationEngine, ModificationEngineError, ModificationEngineReport, OwnEngine,
    OwnEngineError, ResolverEngine, StubEngine,
};
pub use report::{render_markdown, write_report, RunReport};
