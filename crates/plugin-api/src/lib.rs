//! `plugin-api` — die Schnittstellen zwischen Kern und Erweiterungen.
//!
//! - Feature-Plugins: `FeaturePlugin`, `FeatureRegistry`, `EventSink` (`feature`).
//! - Transpiler-Engines: `Transpiler`, `TranspilerRegistry` (`transpiler`).
//! - Ältere Erweiterungspunkte in `PluginRegistry` (`registry`): `Validator`, `Action`,
//!   `EditorProvider`, `LinkedFileCompiler`.
//!
//! Die Crate hängt von keiner anderen Workspace-Crate ab. Ihre Typen in [`types`] sind eigene
//! Platzhalter. Die Umwandlung in die echten Typen steht in `designer-core/src/plugin_bridge.rs`.

pub mod action;
pub mod builtin;
pub mod editor_provider;
pub mod feature;
pub mod linked_file_compiler;
pub mod registry;
pub mod transpiler;
pub mod types;
pub mod validator;

pub use action::{Action, ActionError};
pub use editor_provider::EditorProvider;
pub use feature::{Args, EventSink, FeaturePlugin, FeatureRegistry};
pub use linked_file_compiler::{CompileError, JsInlineCompiler, LinkedFileCompiler, UnverifiedTsCompiler};
pub use registry::PluginRegistry;
pub use types::{
    ActionContext, CompiledOutput, Diagnostic, FileCommand, LinkedFileExtension, LinkedFileRef,
    ObjectType, ProjectModel, PropertyNode, PropertyValue, Severity, Transaction,
};
pub use transpiler::{Progress, ProgressSink, TranspileOptions, TranspileOutcome, Transpiler, TranspilerRegistry};
pub use validator::Validator;
