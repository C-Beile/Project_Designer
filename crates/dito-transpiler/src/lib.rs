// Dito Transpiler: baut aus einem ADITO-Projekt die transpilierten Artefakte, im Speicher.
// Erstes Ausgabeformat ist V2 (COMPACT, LF). V1 kann später als zweites Format dazukommen.
// Plan: docs/transpiler-v2-plan.md. Der Kern (`discover`, `overlay`, `merge`) kennt keine Formate.

pub mod api;
pub mod cache;
pub mod discover;
pub mod format;
pub mod merge;
pub mod model;
pub mod overlay;
pub mod pipeline;
pub mod rules;
pub mod scripts;
pub mod sink;

pub use api::{BuildConfig, BuildResult, BuildStats, Builder, CancelToken, Diagnostic, Severity};
pub use format::FormatId;
