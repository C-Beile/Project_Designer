//! Event index: maps every reachable XML node/attribute to its location in the flat event
//! list, bridging `AodDocument`'s raw event stream to `core-model::PropertyTree`
//! (`architecture.md` #3 — new for P3, not needed by the P2 spike).
//!
//! ## Design decision (documented here since `core-model` is being built in parallel and needs
//! to know what to expect from this API without re-deriving it):
//!
//! `architecture.md` describes the index as "`EventPath -> Range<usize>`". A single
//! `Range<usize>` over the flat event list is a precise fit for **elements** (a contiguous run
//! of events from the opening `Start`/`Empty` tag to the matching `End`, inclusive) but does
//! not fit **attributes**, which are not separate events at all — they are substrings inside a
//! `Start`/`Empty` event's raw tag bytes (see `AodEvent::tag_bytes`). Rather than force
//! attributes into a fake one-event `Range<usize>` that would hide where the value actually
//! lives, [`IndexedRange`] is a small enum with an explicit `Attribute` variant carrying the
//! owning event's index plus a byte range *within that event's raw bytes*. This keeps the common
//! case (elements) exactly as simple as the architecture doc describes, while making the
//! attribute case explicit and safe to act on (`core-model` never has to guess whether a
//! `Range<usize>` means "events" or "bytes within one event").
//!
//! [`EventPath`] identifies a node by walking down from the document root through child tag
//! name + occurrence index (the Nth same-tag sibling under that parent), not by raw sequential
//! position. This makes paths stable under edits to unrelated siblings: inserting or deleting an
//! `entityField` only renumbers occurrences of `entityField` under that same parent, never
//! `entityProvider` or any other sibling tag. `core-model::NodeRef` (architecture.md #3) is
//! expected to hold one `EventPath` per projected `PropertyNode`.

use crate::document::{tag_name, AodDocument, AodEvent};
use std::collections::HashMap;
use std::ops::Range;

/// One step down the tree from a parent element to a specific child.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum PathStep {
    /// The `occurrence`-th (0-based) child element with this tag name under the current
    /// parent — counting only same-tag siblings, so an insert/delete of a *different* tag
    /// never shifts this step's meaning.
    Child { tag: String, occurrence: usize },
    /// An attribute on the element identified by the preceding steps. Always the last step
    /// in a path, if present.
    Attribute(String),
}

/// A path from the document root to one reachable XML node or attribute. Root-relative and
/// stable across edits that don't touch the same-tag sibling group along the path (see module
/// docs). `EventPath(vec![])` is reserved (not emitted by `build_index`) and denotes "the
/// document itself" for callers that want a sentinel root value.
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash)]
pub struct EventPath(pub Vec<PathStep>);

impl EventPath {
    pub fn root() -> Self {
        EventPath(Vec::new())
    }

    /// Depth of this path (number of `Child` steps before any trailing `Attribute` step) —
    /// used by `crate::patch` to compute standard indentation (`depth * 2` spaces, per
    /// aod-format.md #1.2's baseline rule).
    pub fn element_depth(&self) -> usize {
        self.0
            .iter()
            .filter(|s| matches!(s, PathStep::Child { .. }))
            .count()
    }

    fn child(&self, tag: &str, occurrence: usize) -> Self {
        let mut steps = self.0.clone();
        steps.push(PathStep::Child {
            tag: tag.to_string(),
            occurrence,
        });
        EventPath(steps)
    }

    fn attribute(&self, name: &str) -> Self {
        let mut steps = self.0.clone();
        steps.push(PathStep::Attribute(name.to_string()));
        EventPath(steps)
    }
}

/// Where a [`EventPath`] resolves to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IndexedRange {
    /// An element: the contiguous run of events from its opening `Start`/`Empty` tag to its
    /// matching `End` (inclusive). For a self-closing element this is a single-event range
    /// (`i..i+1`) with no `End`.
    Element(Range<usize>),
    /// An attribute: the event index of the owning `Start`/`Empty` tag, plus the byte range of
    /// the attribute's *value* (the bytes between the quotes, not including them) within that
    /// event's raw tag bytes. See module docs for why this isn't a `Range<usize>` alone.
    Attribute { event: usize, value_bytes: Range<usize> },
}

/// `EventPath -> IndexedRange` map for one document, built once after `parse` (or rebuilt after
/// any patch operation, since a patch shifts every subsequent event index — `core-model` is
/// expected to call `build_index` again after applying a `Transaction`, matching
/// architecture.md #3's "projiziert ... über den Event-Index" description).
#[derive(Debug, Clone, Default)]
pub struct EventIndex {
    map: HashMap<EventPath, IndexedRange>,
}

impl EventIndex {
    pub fn get(&self, path: &EventPath) -> Option<&IndexedRange> {
        self.map.get(path)
    }

    pub fn len(&self) -> usize {
        self.map.len()
    }

    pub fn is_empty(&self) -> bool {
        self.map.is_empty()
    }

    pub fn iter(&self) -> impl Iterator<Item = (&EventPath, &IndexedRange)> {
        self.map.iter()
    }

    /// Convenience for the common "scalar field" case: if `path` resolves to an element whose
    /// entire content is a single `Text` event (no nested elements — e.g. `<title>Tour</title>`),
    /// returns that `Text` event's index. `None` for elements with nested elements, multiple
    /// text runs, self-closing elements, or unknown paths — callers should fall back to
    /// `insert_at`/structural handling in those cases rather than treat it as a scalar edit.
    pub fn text_event_index(&self, doc: &AodDocument, path: &EventPath) -> Option<usize> {
        match self.map.get(path)? {
            IndexedRange::Element(range) if range.len() == 3 => {
                let text_idx = range.start + 1;
                match doc.events.get(text_idx) {
                    Some(AodEvent::Text(_)) => Some(text_idx),
                    _ => None,
                }
            }
            _ => None,
        }
    }
}

/// Walks the full event list once and builds the [`EventIndex`]. O(n) in the number of events,
/// O(attributes-per-tag) extra work per `Start`/`Empty` event for attribute scanning.
pub fn build_index(doc: &AodDocument) -> EventIndex {
    let mut map = HashMap::new();
    // One frame per currently-open element: its own EventPath, the index of its opening event,
    // and a per-parent counter of how many children of each tag name have been seen so far
    // (drives the `occurrence` in PathStep::Child).
    struct Frame {
        path: EventPath,
        start_idx: usize,
        child_counts: HashMap<String, usize>,
    }
    let mut stack: Vec<Frame> = Vec::new();
    let mut root_counts: HashMap<String, usize> = HashMap::new();

    for (i, ev) in doc.events.iter().enumerate() {
        match ev {
            AodEvent::Start(raw) | AodEvent::Empty(raw) => {
                let tag = tag_name(raw).into_owned();
                let (parent_path, counts) = match stack.last_mut() {
                    Some(frame) => (frame.path.clone(), &mut frame.child_counts),
                    None => (EventPath::root(), &mut root_counts),
                };
                let occurrence = *counts.get(&tag).unwrap_or(&0);
                *counts.entry(tag.clone()).or_insert(0) += 1;
                let this_path = parent_path.child(&tag, occurrence);

                index_attributes(&mut map, raw, i, &this_path);

                if matches!(ev, AodEvent::Empty(_)) {
                    map.insert(this_path, IndexedRange::Element(i..i + 1));
                } else {
                    stack.push(Frame {
                        path: this_path,
                        start_idx: i,
                        child_counts: HashMap::new(),
                    });
                }
            }
            AodEvent::End(_) => {
                if let Some(frame) = stack.pop() {
                    map.insert(frame.path, IndexedRange::Element(frame.start_idx..i + 1));
                }
                // An End with no matching open frame would mean malformed XML that `parse`
                // should already have rejected (check_end_names is off, but quick-xml still
                // requires structurally balanced Start/End to reach Eof) — silently skip
                // rather than panic, since indexing must never be the thing that crashes on
                // a real file the round-trip test already accepts.
            }
            _ => {}
        }
    }

    EventIndex { map }
}

/// Scans a `Start`/`Empty` event's raw tag bytes for `key="value"` pairs and indexes each as an
/// `Attribute` path. `.aod` attribute values never contain a literal, unescaped `"` (XML escapes
/// it as `&quot;`), so simple quote-matching is sufficient — no need to depend on quick-xml's
/// internal attribute-span representation, which is not part of its public API surface.
fn index_attributes(
    map: &mut HashMap<EventPath, IndexedRange>,
    raw: &[u8],
    event_idx: usize,
    element_path: &EventPath,
) {
    let name_len = crate::document::tag_name_len(raw);
    let mut i = name_len;
    while i < raw.len() {
        while i < raw.len() && raw[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= raw.len() || raw[i] == b'/' {
            break;
        }
        let key_start = i;
        while i < raw.len() && raw[i] != b'=' && !raw[i].is_ascii_whitespace() {
            i += 1;
        }
        let key_end = i;
        while i < raw.len() && raw[i] != b'"' {
            i += 1;
        }
        if i >= raw.len() {
            break; // malformed tail; nothing more to index
        }
        i += 1; // opening quote
        let value_start = i;
        while i < raw.len() && raw[i] != b'"' {
            i += 1;
        }
        let value_end = i;
        if i < raw.len() {
            i += 1; // closing quote
        }
        if key_end > key_start {
            let key = String::from_utf8_lossy(&raw[key_start..key_end]).into_owned();
            map.insert(
                element_path.attribute(&key),
                IndexedRange::Attribute {
                    event: event_idx,
                    value_bytes: value_start..value_end,
                },
            );
        }
    }
}
