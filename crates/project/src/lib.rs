//! `project` - every piece of the Forge Tauri app's own logic that does *not* need
//! `tauri`/`wry`/`webview2-com` to exist: project-tree scanning, the value/path wire format,
//! per-file undo/redo history, entity validators, linked-file I/O, and the project actor that
//! owns open `designer_core::ProjectHandle`s.
//!
//! **Why this is a separate crate from `app/src-tauri`, not just more modules there:** on this
//! machine's GNU/MinGW toolchain (R13/R18), any test binary that links `tauri`/`wry` crashes at
//! process startup (`STATUS_DLL_NOT_FOUND`/`STATUS_ENTRYPOINT_NOT_FOUND`) even with zero actual
//! `#[test]` functions exercising Tauri APIs - the *link*, not the logic, is what breaks (the
//! same dependency chain builds and runs fine as the real `designer-app` binary, matching
//! `spike-editor.md`'s own successful `cargo build` + launch - this is specifically a `cargo
//! test`-harness-binary issue). None of the logic below needs a window, an event loop, or COM at
//! all, so it lives here where `cargo test -p project` runs as plain, fast, GUI-free
//! Rust - `app/src-tauri`'s crate becomes a genuinely thin adapter (architecture.md §1
//! "Grundregel", now enforced by the crate boundary itself, not just by convention) with no
//! tests of its own. See `p4-editor-entity-notes.md` for the full writeup (candidate risk R22).

pub mod actions;
pub mod content_search;
pub mod discover;
pub mod file_list;
pub mod import_resolve;
pub mod watch;
pub mod catalog;
pub mod icons;
pub mod project_create;
pub mod transpile_compare;
pub mod file_ops;
pub mod problems;
pub(crate) mod parallel;
pub mod new_object;
pub mod object_names;
pub mod jdito_types;
pub mod rename;
pub mod project_zip;
pub mod local_data;
#[cfg(test)]
mod sheet_actor_tests;
pub mod history;
pub mod linked_file;
pub mod modification_write;
pub mod project_actor;
pub mod settings;
pub mod transpile_action;
pub mod tree;
pub mod tree_ops;
pub mod wire;
