//! `core-model` - the Forge project's `propertly`-equivalent (architecture.md §3, ADR-0005).
//!
//! Owns two things: the typed, observable `PropertyTree` projection over a document (via the
//! narrow `EventSource` trait boundary to `aod-io`), and patch-level undo/redo (`FileCommand`/
//! `Transaction`/`UndoStack`). Does not read/write files - callers apply the `FileCommand`s this
//! crate computes to whatever document representation implements `EventSource`.

pub mod aod_io_adapter;
pub mod codec;
pub mod command;
pub mod error;
pub mod event_source;
pub mod observer;
pub mod path;
pub mod testing;
pub mod transaction;
pub mod tree;
pub mod value;

pub use aod_io_adapter::{AdapterError, AodDocumentSource};
pub use command::{ByteRange, FileCommand};
pub use error::Error;
pub use event_source::EventSource;
pub use observer::ChangeEvent;
pub use path::{NodePath, PathSegment};
pub use transaction::{Transaction, UndoStack};
pub use tree::{NodeId, PropertyTree};
pub use value::{PropertyValue, ScalarValue};
