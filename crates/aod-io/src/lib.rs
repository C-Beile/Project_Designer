//! `aod-io` — byte-faithful event-stream parser/serializer for ADITO `.aod` files.
//!
//! P3 crate (Projekt "Forge"), built directly on top of the verified P2 round-trip spike
//! (`PROJECT/20_architecture/spike-round-trip.md`, 76/76 real files byte-identical). This crate
//! is the sole place that turns `.aod` bytes into an in-memory, editable representation and back
//! (architecture.md #4: "aod-io bleibt die einzige Stelle, die Bytes auf Platte liest" — the
//! actual disk I/O itself is `platform::fs`'s job, not this crate's; `serialize` returns
//! `Vec<u8>`, nothing here touches the filesystem).
//!
//! Three pieces, one per module:
//! - [`document`]: `AodDocument` (an ordered list of raw [`document::AodEvent`]s), `parse`,
//!   `serialize`. Untouched events round-trip byte-for-byte; this is "Schicht 1" of the
//!   two-layer model in architecture.md #3.
//! - [`index`]: the event index new for P3 — maps every reachable XML node/attribute
//!   ([`index::EventPath`]) to its location in the event list ([`index::IndexedRange`]). This is
//!   the bridge `core-model::PropertyTree` projects itself through (architecture.md #3).
//! - [`patch`]: the three event-level edit primitives (`replace_text_at`, `insert_at`,
//!   `delete_range`) `core-model` composes edits from, including the documented indentation
//!   rule and its `customProperties` exception (aod-format.md #1.2).
//!
//! See `PROJECT/20_architecture/p3-aod-io-notes.md` for test coverage and the Event-Index API
//! design rationale in more depth than the module docs below.

pub mod canonical;
pub mod document;
pub mod error;
pub mod index;
pub mod patch;

pub use canonical::{canonical_events, canonicalize};
pub use document::{parse, round_trip_check, serialize, AodDocument, AodEvent};
pub use error::{AodError, PatchError};
pub use index::{build_index, EventIndex, EventPath, IndexedRange, PathStep};
pub use patch::{delete_range, insert_at, replace_text_at, IndentQuirk, SiblingHint, KNOWN_INDENT_QUIRKS};
