//! `refs` - project-wide reference integrity (architecture.md §7).
//!
//! `RefGraph` indexes outgoing/incoming edges between ADITO objects (and linked files) per the
//! verified reference catalogue in aod-format.md §4, and exposes the two operations built on top
//! of it: a rename cascade (bundles every incoming reference's patch into one atomic
//! `Transaction`, reusing `core_model`'s undo primitive) and delete diagnostics (reports dangling
//! references instead of auto-cascading a delete across files - too risky per architecture.md §7).
//!
//! Extraction runs against `PropertyValue` trees (see `extract`), so it needs no `EventSource` and
//! can be exercised with plain in-memory fixtures; only the rename cascade needs a real
//! `PropertyTree`, to compute the byte-range patch at each reference site.

pub mod edge;
pub mod extract;
pub mod graph;
pub mod object_id;

pub use edge::{Edge, RefKind};
pub use graph::{Diagnostic, RefGraph, RefsError};
pub use object_id::{ObjectId, ObjectKind};
