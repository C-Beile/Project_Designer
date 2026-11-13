//! `references` - what points to what (architecture.md §7).
//!
//! `read` pulls the outgoing references (typed per the verified catalogue in aod-format.md §4) out
//! of one object's `PropertyValue` tree; it needs no `EventSource`, so it runs on plain in-memory
//! fixtures. Storing and querying them project-wide is the job of the `project-index` crate
//! (`ReferenceIndex`): it keeps the references per FILE, answers "who points to X" and reports
//! missing targets. `rename` is the undo-capable cascade over `PropertyTree`s; the app itself renames
//! through `crates/project/src/rename.rs`.

pub mod object_id;
pub mod read;
pub mod reference;
pub mod rename;

pub use object_id::{ObjectId, ObjectKind};
pub use read::{read_references, target_alias_name};
pub use reference::{Reference, ReferenceKind};
pub use rename::{rename_cascade, ReferencesError};
