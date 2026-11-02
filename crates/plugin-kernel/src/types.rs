//! Placeholder domain types for the plugin-kernel crate.
//!
//! `plugin-kernel` is deliberately built without a dependency on `core-model`/`aod-io`/`refs`
//! (see architecture.md §2 and the scope guardrail in this crate's owning agent brief), so the
//! trait signatures below are expressed against small, self-contained stand-ins rather than the
//! real project-model types. The intent is that a later integration pass swaps these placeholders
//! for the real `core-model` types (see `PROJECT\20_architecture\p3-plugin-kernel-notes.md` for
//! the concrete mapping proposal) without touching the trait shapes themselves.

use std::collections::HashMap;
use std::ops::Range;

/// Coarse object family, mirroring the editor families found in the feature-matrix (Entity,
/// View, Context, Dashboard, ...). Kept as a placeholder enum here; the real `core-model` type
/// is expected to be richer (e.g. carrying schema metadata).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum ObjectType {
    Entity,
    View,
    Context,
    Dashboard,
    System,
    Alias,
    Application,
    Language,
    Webservice,
    /// P4 fifth editor family (`preferences`) - project-wide runtime settings, distinct from
    /// `System` (per-environment server/tunnel config). Added additively; no existing variant
    /// fit, so this is a new one rather than misusing `System`/`Other`.
    Preferences,
    /// Escape hatch for object families not yet enumerated here, keyed by their design-time name
    /// (e.g. "process", "aliasDefinition"). Avoids having to extend this enum for every new
    /// family discovered while `core-model`'s real type inventory is still in flux.
    Other(String),
}

/// A single typed scalar value on a property node. Minimal stand-in for whatever value
/// representation `core-model::PropertyTree` ends up using.
#[derive(Debug, Clone, PartialEq)]
pub enum PropertyValue {
    String(String),
    Bool(bool),
    Int(i64),
    Missing,
}

/// Placeholder for `core-model::PropertyNode`: a single addressable node in a project object,
/// identified by a slash-separated path (e.g. `"Order_entity/entityFields/STATUS/title"`).
#[derive(Debug, Clone, PartialEq)]
pub struct PropertyNode {
    pub path: String,
    pub object_type: ObjectType,
    pub value: PropertyValue,
}

impl PropertyNode {
    pub fn new(path: impl Into<String>, object_type: ObjectType, value: PropertyValue) -> Self {
        Self { path: path.into(), object_type, value }
    }
}

/// Severity of a single finding surfaced by an `EditorProvider` or `Validator`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Severity {
    Error,
    Warning,
    Info,
}

/// A single validation finding, attached to the path of the node it concerns.
#[derive(Debug, Clone, PartialEq)]
pub struct Diagnostic {
    pub severity: Severity,
    pub message: String,
    pub path: Option<String>,
}

impl Diagnostic {
    pub fn error(message: impl Into<String>, path: impl Into<String>) -> Self {
        Self { severity: Severity::Error, message: message.into(), path: Some(path.into()) }
    }

    pub fn warning(message: impl Into<String>, path: impl Into<String>) -> Self {
        Self { severity: Severity::Warning, message: message.into(), path: Some(path.into()) }
    }
}

/// Placeholder for the whole in-memory project (what a `Validator` inspects project-wide, e.g.
/// reference-integrity checks that span multiple objects). Flattened to a node list here; the
/// real `core-model` equivalent will be a proper tree plus a `refs::RefGraph`.
#[derive(Debug, Clone, Default)]
pub struct ProjectModel {
    pub nodes: Vec<PropertyNode>,
}

impl ProjectModel {
    pub fn new(nodes: Vec<PropertyNode>) -> Self {
        Self { nodes }
    }
}

/// The file extension of a linked file (`%aditoprj%/...` reference), see transpiler.md §4/§5.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum LinkedFileExtension {
    Js,
    Ts,
    Other(String),
}

/// Reference to a linked file to be resolved during the copy phase (transpiler.md §4).
///
/// `source_content` carries the already-loaded file bytes as text. This crate has no file-IO
/// capability of its own (that is `platform`'s/`aod-io`'s job) — callers are expected to read the
/// file via `platform::fs` and hand the content in here.
#[derive(Debug, Clone, PartialEq)]
pub struct LinkedFileRef {
    pub project_path: String,
    pub extension: LinkedFileExtension,
    pub source_content: String,
}

/// Result of compiling/resolving a linked file: the content to inline into the `dist` copy at
/// the tag that referenced it (transpiler.md §4, "Linked-File-Inlining").
#[derive(Debug, Clone, PartialEq)]
pub struct CompiledOutput {
    pub inline_content: String,
}

/// A single byte-range replacement within one file, the atomic unit of undo/redo
/// (architecture.md §3, "Undo/Redo").
#[derive(Debug, Clone, PartialEq)]
pub struct FileCommand {
    pub file: String,
    pub old_bytes_range: Range<usize>,
    pub old_bytes: Vec<u8>,
    pub new_bytes: Vec<u8>,
}

/// One or more `FileCommand`s bundled as a single, atomically undoable user action
/// (architecture.md §3/§7, e.g. a rename with cascading reference updates).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Transaction {
    pub commands: Vec<FileCommand>,
}

impl Transaction {
    pub fn new(commands: Vec<FileCommand>) -> Self {
        Self { commands }
    }

    pub fn is_empty(&self) -> bool {
        self.commands.is_empty()
    }
}

/// Placeholder for the mutable context an `Action` runs against (target object, parameters).
/// Deliberately untyped/string-keyed here since the real shape depends on `core-model`'s tree
/// API, which this crate does not depend on.
#[derive(Debug, Clone, Default)]
pub struct ActionContext {
    pub target_path: String,
    pub params: HashMap<String, String>,
}

impl ActionContext {
    pub fn new(target_path: impl Into<String>) -> Self {
        Self { target_path: target_path.into(), params: HashMap::new() }
    }

    pub fn with_param(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.params.insert(key.into(), value.into());
        self
    }
}
