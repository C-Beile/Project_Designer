//! `aod`: .aod-Dokumente lesen/schreiben (`document`), Eigenschaftsbaum mit Undo (`tree`)
//! und Referenzgraph (`refs`). Haeufige Typen sind zusaetzlich direkt unter `aod::` erreichbar.

pub mod document;
pub mod refs;
pub mod tree;

pub use document::{AodDocument, AodError, AodEvent, EventIndex, EventPath, PatchError};
pub use refs::{Edge, ObjectId, ObjectKind, RefGraph, RefKind, RefsError};
pub use tree::{
    AodDocumentSource, ByteRange, EventSource, FileCommand, NodeId, NodePath, PathSegment, PropertyTree, PropertyValue,
    ScalarValue, Transaction, UndoStack,
};
