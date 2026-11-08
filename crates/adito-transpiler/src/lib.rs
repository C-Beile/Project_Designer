//! Wrapper around the official headless ADITO TranspilerCLI (`nbexec64.exe --projecthome
//! ...`). Production crate for P3, built directly on top of the P2
//! `transpiler-wrapper-spike`, which already proved the subprocess/exit-code handling works
//! (see `PROJECT/20_architecture/spike-transpiler-wrapper.md`).
//!
//! Layering:
//! - [`config::TranspilerConfig`] - which installation/userdir/timeout to use.
//! - [`runner::TranspilerRunner`] - the seam a caller runs a project through; implemented by
//!   [`runner::NbexecTranspilerRunner`] using `std::process::Command` directly (no
//!   `platform::ProcessSpawner` abstraction in this round - see crate-level integration
//!   notes in `PROJECT/20_architecture/p3-transpiler-notes.md`).
//! - [`events::TranspileEvent`] - structured stdout/stderr/progress/done events, the basis
//!   for a later Tauri event bridge.
//! - [`exit_code`] - pure interpretation of the process exit code as a business outcome.
//! - [`error::TranspilerError`] - wrapper-side setup/spawn failures (distinct from a
//!   transpiler run that completed but failed - that is `exit_code::ExitOutcome::Failure`).

pub mod config;
pub mod error;
pub mod events;
pub mod exit_code;
pub mod plugin;
pub mod setup;
pub mod platform_runner;
pub mod runner;

pub use app_base::layout;
pub use config::TranspilerConfig;
pub use error::TranspilerError;
pub use events::{EventSink, LogStream, ProgressStage, TranspileEvent};
pub use exit_code::{interpret_exit_code, ExitOutcome, FailureReason};
pub use platform_runner::PlatformTranspilerRunner;
pub use runner::{cancel_active_run, take_cancelled, NbexecTranspilerRunner, TranspileOutcome, TranspilerRunner};
