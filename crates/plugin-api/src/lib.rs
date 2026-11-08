//! `plugin-kernel` — the four extension-point traits (`EditorProvider`, `LinkedFileCompiler`,
//! `Validator`, `Action`) plus the static `PluginRegistry`, per architecture.md §2.
//!
//! Scope note: this crate has no dependency on `core-model`/`aod-io`/`refs` by design (see the
//! owning agent's scope guardrail). All trait signatures are expressed against small,
//! self-contained placeholder types in [`types`] rather than the real project-model types; a
//! later integration pass is expected to retarget these traits at the real types (see
//! `PROJECT\20_architecture\p3-plugin-kernel-notes.md`).

pub mod action;
pub mod builtin;
pub mod editor_provider;
pub mod linked_file_compiler;
pub mod registry;
pub mod types;
pub mod validator;

pub use action::{Action, ActionError};
pub use editor_provider::EditorProvider;
pub use linked_file_compiler::{CompileError, JsInlineCompiler, LinkedFileCompiler, UnverifiedTsCompiler};
pub use registry::PluginRegistry;
pub use types::{
    ActionContext, CompiledOutput, Diagnostic, FileCommand, LinkedFileExtension, LinkedFileRef,
    ObjectType, ProjectModel, PropertyNode, PropertyValue, Severity, Transaction,
};
pub use validator::Validator;
