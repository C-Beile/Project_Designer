//! `designer-core` - the facade crate bundling every P3 crate into one public API, usable and fully
//! testable without any UI (ADR-0002 "Kern ohne UI"; architecture.md §1). CLI `forge` and the
//! later Tauri shell are both thin consumers of this crate's surface; neither depends on the
//! individual P3 crates directly, and no business logic lives in either of them (architecture.md
//! §1 "Grundregel").
//!
//! ## What is *really* wired here (not just re-exported), per this round's brief
//!
//! - [`aod::tree::AodDocumentSource`] (`crates/core-model/src/aod_io_adapter.rs`): a real
//!   `aod::tree::EventSource` implementation over `aod::document::AodDocument`, replacing
//!   `aod::tree::testing::InMemoryEventSource` for actual `.aod` files. See that module's docs
//!   for the coordinate-translation and byte-offset bridging it does.
//! - [`transpiler::PlatformTranspilerRunner`] (`crates/transpiler/src/platform_runner.rs`): a
//!   second `transpiler::TranspilerRunner`, backed by `platform::ProcessSpawner` instead of
//!   `std::process::Command`, added alongside the existing verified `NbexecTranspilerRunner`.
//! - [`plugin_bridge`]: conversion functions between `core-model`'s real project-model types and
//!   `plugin-api`'s deliberately independent placeholder types.
//! - [`project::ProjectHandle::save`]: the real architecture.md §4 persistence path -
//!   `aod::document::serialize` -> `platform::fs::atomic_write` - not a direct `std::fs::write`.
//!
//! [`project::open_project`]/[`project::ProjectHandle`] is this round's minimal, real
//! end-to-end proof that all of the above actually work together against a real, on-disk `.aod`
//! file (see `crates/designer-core/tests` in `project.rs` for the load -> edit -> save -> reload and
//! the unedited-save-is-byte-identical tests).

pub mod plugin_bridge;
pub mod plugins;
pub mod project;

pub use plugin_bridge::{
    to_plugin_file_command, to_plugin_property_node, to_plugin_transaction, to_plugin_value,
};
pub use plugins::build_plugin_registry;
pub use project::{open_project, ForgeError, ProjectHandle};

// Facade re-exports (architecture.md §1: "bündelt obige Crates zu einer öffentlichen API") - a
// caller depending only on `designer-core` can reach every P3 crate's own public API through here
// without a direct Cargo dependency on it.
pub use aod;
pub use npm_modules;
pub use plugin_api;
pub use platform;
