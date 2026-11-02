//! `module-graph` — npm-based module resolution for ADITO projects (Forge P3).
//!
//! Builds a full dependency graph from a project's `package.json` plus its installed
//! `node_modules/@aditosoftware/*` / `@3hills-it/*` modules, detects cycles in the
//! `dependencies` graph, and resolves/flags "diamond" version conflicts using the
//! project's `overrides` field.
//!
//! See `PROJECT/30_spec/transpiler.md` §1-2 and
//! `PROJECT/20_architecture/p3-module-graph-notes.md` for the corpus evidence behind
//! every rule implemented here — in particular, the diamond `overrides` rule is verified
//! against a real shipped conflict in the Pichler project, not just inferred from class
//! names.

pub mod error;
pub mod graph;
pub mod model;

pub use error::ModuleGraphError;
pub use graph::{resolve, DiamondResolution, DuplicateReport, ModuleGraph, PROJECT_NODE};
pub use model::{AditoType, ModuleDefinition};
