//! The narrow trait boundary to the document layer (architecture.md §3, "Schicht 1").
//!
//! `aod-io` builds `AodDocument` (the byte-treu event list) in parallel with this crate. Rather
//! than depend on its concrete types - which would couple two crates being built at the same
//! time by different agents, and would leak `aod-io`'s internal event representation into
//! `core-model` - `core-model` defines this trait against its *own* vocabulary (`NodePath`,
//! `ByteRange`) and depends only on that. `aod-io` (or a thin adapter over it) implements this
//! trait during the later integration round; until then, `crate::tree::testing::InMemoryEventSource`
//! stands in for it so `PropertyTree` can be built and tested without waiting on `aod-io`.
//!
//! Every method answers exactly one question the edit-flow in architecture.md §3 needs, and
//! nothing else - keeping the surface small is what makes both sides free to keep changing their
//! own internals independently.

use crate::tree::command::ByteRange;
use crate::tree::path::NodePath;
use std::path::Path;

pub trait EventSource {
    /// The file this source projects, for stamping onto `FileCommand`.
    fn file_path(&self) -> &Path;

    /// The exact byte range holding a scalar node's *value* (the `Text` event's content, or a
    /// typed-scalar's `v="..."` attribute value) - the range a scalar edit replaces.
    fn value_span(&self, path: &NodePath) -> Option<ByteRange>;

    /// The byte range of an entire element, including its own leading whitespace/indentation run,
    /// as documented in architecture.md §3 ("Löschen ... inkl. ihres Whitespace-Vorlaufs, damit
    /// keine Leerzeilen-Artefakte entstehen"). Used for delete; a scalar edit must not use this
    /// range, or it would clobber the tag and any sibling formatting around it.
    fn element_span(&self, path: &NodePath) -> Option<ByteRange>;

    /// Raw bytes currently occupying a range, so a command's `old_bytes` can be computed without
    /// a second source of truth for "what is actually on disk/in memory right now".
    fn bytes_in(&self, range: ByteRange) -> Vec<u8>;

    /// The byte offset at which a new child of `parent` should be spliced in, optionally placed
    /// right after a given existing sibling (`None` = append as the last child).
    fn insertion_point(&self, parent: &NodePath, after: Option<&NodePath>) -> Option<usize>;

    /// Indentation bytes a newly inserted child of `parent` should be prefixed with. Default rule
    /// is "2 spaces deeper than the parent's own indentation" (aod-format.md §1.2 verified
    /// baseline); implementations are expected to special-case documented quirks (e.g.
    /// `customProperties` under `entityFieldDb`, aod-format.md §1.2) rather than always applying
    /// the default.
    fn indent_for(&self, parent: &NodePath) -> Vec<u8>;
}
