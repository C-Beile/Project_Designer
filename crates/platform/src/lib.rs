//! `platform` - the single platform-specific seam for Forge (architecture.md §8, ADR-0004 rule
//! 2). `designer-core` and the CLI compile only against the trait interfaces declared at this
//! crate's root; no `std::process::Command`, `windows-sys`/`windows-rs`, or other OS-specific
//! call is allowed to leak outside this crate (ADR-0004 rule 1). `fs::atomic_write` is the one
//! exception to the "trait + per-OS impl" shape - `std::fs::rename` is already atomic-with-
//! overwrite on every target this project cares about, so there is nothing OS-specific to hide
//! behind a trait for it.
//!
//! Layout:
//! - Trait modules at the crate root (`process`, `fs`, `git`, `watcher`, `node`, `credentials`,
//!   `dialog`, `shell`) - platform-neutral types and interfaces only. `git` (R33, added
//!   post-P3) is implemented directly at the root like `fs::atomic_write` - it shells out to
//!   the system `git` CLI, which behaves identically on every target OS, so there is no
//!   `windows`/`macos` split for it.
//! - [`windows`] - the Windows implementation of every trait (P3/this round, per
//!   architecture.md §8 "vollständig").
//! - [`macos`] - structural stubs only (`todo!()` bodies), per ADR-0004 ("macOS nativ
//!   offenhalten" without being in-scope for Phase 1). See `macos`'s module doc for what a real
//!   implementation would need.

pub mod console;
pub mod credentials;
pub mod dialog;
pub mod error;
pub mod fs;
pub mod git;
pub mod node;
pub mod ppk;
pub mod process;
pub mod shell;
pub mod watcher;

#[cfg(target_os = "windows")]
pub mod windows;

/// macOS and Linux implementations (process groups instead of `taskkill`, `open`/`xdg-open`
/// instead of Explorer, Keychain instead of Credential Manager).
#[cfg(not(target_os = "windows"))]
pub mod unix;

#[cfg(target_os = "macos")]
pub mod macos;

/// The implementation set of the running operating system under one name, so callers never
/// need a `cfg` of their own.
#[cfg(target_os = "windows")]
pub use windows as native;
#[cfg(not(target_os = "windows"))]
pub use unix as native;

pub use credentials::{Credential, CredentialStore};
pub use dialog::{FileDialog, FileFilter, OpenFileOptions, PickFolderOptions, SaveFileOptions};
pub use error::PlatformError;
pub use git::{CommandGitOperations, GitBranch, GitCommandOutcome, GitCommit, GitFileStatus, GitOperations, GitStatus};
pub use node::{NodeInstallation, NodeResolver};
pub use process::{LineSink, OutputLine, OutputStream, ProcessSpawner, SpawnOutcome, SpawnRequest};
pub use shell::ShellIntegration;
pub use watcher::{FileWatcher, WatchEvent, WatchEventKind, WatchHandle};
