//! Real `EventSource` implementation backed by `crate::document::AodDocument` (integration round,
//! designer-core). Closes the seam `event_source.rs` documents: `core-model` now has a concrete
//! projection source instead of only `testing::InMemoryEventSource`.
//!
//! ## Coordinate translation
//!
//! `crate::tree::NodePath` addresses a node as a chain of business field names, with an index
//! step for the N-th element of a repeatable field (`path.rs`). `crate::document::EventPath` addresses a
//! node as a chain of `Child { tag, occurrence }` steps directly against the XML tag structure.
//! Both describe the same coordinate system (see `path.rs`'s module doc), so translation is a
//! straightforward, schema-free rule: a `Field(name)` step becomes `Child { tag: name,
//! occurrence: 0 }`, unless immediately followed by an `Index(n)` step, in which case that index
//! supplies the occurrence and both `NodePath` steps collapse into one `EventPath` step. No JSON
//! schema knowledge is used here - a schema-driven projector (mapping e.g. a wrapper field to a
//! differently-named repeated child tag) remains future work, flagged in this round's
//! integration notes.
//!
//! ## Byte offsets vs. event indices
//!
//! `crate::document::EventIndex` locates nodes in *event-index* space (a `Range<usize>` over
//! `AodDocument::events`), but `crate::tree::EventSource` speaks in *byte-offset* space (a
//! `ByteRange` into the fully serialized document, matching `command::FileCommand`). This
//! adapter bridges the two by serializing each event individually (`crate::document::serialize` performs
//! no cross-event formatting - each `AodEvent` converts to bytes independently, verified by
//! `aod-io`'s own round-trip corpus test) and accumulating the byte offsets, giving an exact
//! `Vec<Range<usize>>` parallel to the event list without needing any private `aod-io` API.
//!
//! ## Scope of the scalar edit path
//!
//! Only the `Text`-content scalar case (`<foo>bar</foo>`) is wired through to a real document
//! mutation (`apply_scalar_text_replace`, used by `set_scalar`/`save()` in the designer-core
//! facade). The typed-scalar attribute case (`<foo v="..."/>`) is read (`value_span` resolves
//! it correctly, tested below) but `aod-io`'s public `patch` module has no
//! "replace one attribute's value" primitive yet - adding one would mean touching `aod-io`'s
//! core patch logic, which this round's guardrail reserves for cases with no adapter-side
//! alternative. Flagged as an open point for the next round rather than silently unsupported.

use crate::tree::command::ByteRange;
use crate::tree::event_source::EventSource;
use crate::tree::path::{NodePath, PathSegment};
use crate::tree::value::{PropertyValue, ScalarValue};
use crate::document::{AodDocument, AodEvent, EventIndex, EventPath, IndexedRange, PathStep};
use std::collections::HashMap;
use std::ops::Range;
use std::path::{Path, PathBuf};

#[derive(Debug, thiserror::Error)]
pub enum AdapterError {
    #[error("path {0} could not be resolved to a location in the source document")]
    UnknownPath(String),
    #[error(transparent)]
    Patch(#[from] crate::document::PatchError),
}

/// Real `EventSource` over a parsed `.aod` document. Owns the document, its event index, and a
/// cached byte-offset table + fully serialized buffer (both rebuilt after every mutation).
pub struct AodDocumentSource {
    file: PathBuf,
    doc: AodDocument,
    index: EventIndex,
    event_ranges: Vec<Range<usize>>,
    serialized: Vec<u8>,
    /// Tag name of the document's single top-level element (e.g. `"role"`, `"entity"`).
    /// `NodePath::root()` addresses this element's own children, matching the convention
    /// `PropertyTree::from_value` already uses for its `root_value`.
    root_tag: String,
}

impl AodDocumentSource {
    pub fn new(file: impl Into<PathBuf>, doc: AodDocument) -> Self {
        let index = crate::document::build_index(&doc);
        let (event_ranges, serialized) = compute_byte_ranges(&doc);
        let root_tag = doc
            .events
            .iter()
            .find_map(|e| match e {
                AodEvent::Start(raw) | AodEvent::Empty(raw) => Some(local_tag_name(raw)),
                _ => None,
            })
            .unwrap_or_default();
        AodDocumentSource { file: file.into(), doc, index, event_ranges, serialized, root_tag }
    }

    pub fn document(&self) -> &AodDocument {
        &self.doc
    }

    /// The fully serialized document as it stands right now - what `save()` should write to
    /// disk (architecture.md §4: `crate::document::serialize` -> `platform::fs::atomic_write`).
    pub fn serialized_bytes(&self) -> &[u8] {
        &self.serialized
    }

    /// Projects the whole document into a schema-free `PropertyValue` tree: an element with only
    /// text content becomes `Scalar::Text`, a self-closing element becomes a typed scalar read
    /// from its `v="..."` attribute (ADITO's typed-scalar convention, aod-format.md §1.1), and an
    /// element with child elements becomes an `Object` whose fields collapse same-tag siblings
    /// into an `Array` when there is more than one occurrence. This is intentionally *not* the
    /// JSON-schema-driven projector `tree.rs`'s doc comment defers to a later round - see this
    /// round's integration notes for why a generic structural projector was chosen instead given
    /// the scope/token budget, and what a schema-driven projector would add.
    pub fn project(&self) -> PropertyValue {
        let start = self
            .doc
            .events
            .iter()
            .position(|e| matches!(e, AodEvent::Start(_) | AodEvent::Empty(_)));
        match start {
            Some(idx) => project_element(&self.doc.events, idx).0,
            None => PropertyValue::Object(Vec::new()),
        }
    }

    /// Applies a scalar-text edit directly to the in-memory document (the counterpart to
    /// `value_span`'s Text-event case) and refreshes the byte-offset cache. Event *count* is
    /// unchanged by a text replace, so the event index itself does not need rebuilding - only
    /// the byte lengths after the edited event shift.
    pub fn apply_scalar_text_replace(
        &mut self,
        path: &NodePath,
        new_bytes: Vec<u8>,
    ) -> Result<(), AdapterError> {
        let ep = self.translate(path).ok_or_else(|| AdapterError::UnknownPath(path.to_string()))?;
        let idx = self
            .index
            .text_event_index(&self.doc, &ep)
            .ok_or_else(|| AdapterError::UnknownPath(path.to_string()))?;
        crate::document::replace_text_at(&mut self.doc, idx..idx + 1, new_bytes)?;
        let (event_ranges, serialized) = compute_byte_ranges(&self.doc);
        self.event_ranges = event_ranges;
        self.serialized = serialized;
        Ok(())
    }

    /// Translates a `NodePath` into the equivalent `crate::document::EventPath`, prefixed with the
    /// document's own top-level element (see `root_tag` doc comment). See module docs for the
    /// translation rule. Returns `None` only for a malformed `NodePath` (a bare `Index` step
    /// with no preceding `Field` - never produced by `NodePath`'s own builder methods).
    fn translate(&self, path: &NodePath) -> Option<EventPath> {
        let mut steps = vec![PathStep::Child { tag: self.root_tag.clone(), occurrence: 0 }];
        let segs = path.segments();
        let mut i = 0;
        while i < segs.len() {
            match &segs[i] {
                PathSegment::Field(name) => {
                    let occurrence = match segs.get(i + 1) {
                        Some(PathSegment::Index(n)) => {
                            i += 1;
                            *n
                        }
                        _ => 0,
                    };
                    steps.push(PathStep::Child { tag: name.clone(), occurrence });
                    i += 1;
                }
                PathSegment::Index(_) => return None,
            }
        }
        Some(EventPath(steps))
    }
}

impl EventSource for AodDocumentSource {
    fn file_path(&self) -> &Path {
        &self.file
    }

    fn value_span(&self, path: &NodePath) -> Option<ByteRange> {
        let ep = self.translate(path)?;
        if let Some(text_idx) = self.index.text_event_index(&self.doc, &ep) {
            let r = &self.event_ranges[text_idx];
            return Some(ByteRange::new(r.start, r.end));
        }
        // Not a single-Text-event element: check whether it is a self-closing typed scalar
        // (`<foo v="..."/>`), whose value lives in the `v` attribute rather than a Text event.
        match self.index.get(&ep) {
            Some(IndexedRange::Element(range)) if range.len() == 1 => {
                let mut attr_steps = ep.0.clone();
                attr_steps.push(PathStep::Attribute("v".to_string()));
                match self.index.get(&EventPath(attr_steps)) {
                    Some(IndexedRange::Attribute { event, value_bytes }) => {
                        // crate::document::serialize echoes a Start/Empty event's raw tag bytes verbatim
                        // after the leading '<' (see document.rs) - value_bytes is an offset into
                        // those raw bytes, so shifting by 1 lands on the serialized position.
                        let base = self.event_ranges[*event].start + 1;
                        Some(ByteRange::new(base + value_bytes.start, base + value_bytes.end))
                    }
                    _ => None,
                }
            }
            _ => None,
        }
    }

    fn element_span(&self, path: &NodePath) -> Option<ByteRange> {
        let ep = self.translate(path)?;
        match self.index.get(&ep) {
            Some(IndexedRange::Element(range)) => {
                let mut start_idx = range.start;
                if start_idx > 0 && self.doc.events[start_idx - 1].is_whitespace_only() {
                    start_idx -= 1;
                }
                let start = self.event_ranges[start_idx].start;
                let end = self.event_ranges[range.end - 1].end;
                Some(ByteRange::new(start, end))
            }
            _ => None,
        }
    }

    fn bytes_in(&self, range: ByteRange) -> Vec<u8> {
        self.serialized[range.start..range.end].to_vec()
    }

    fn insertion_point(&self, parent: &NodePath, after: Option<&NodePath>) -> Option<usize> {
        // Only the "append as last child" case is wired up so far - see module docs.
        if after.is_some() {
            return None;
        }
        let ep = self.translate(parent)?;
        match self.index.get(&ep) {
            Some(IndexedRange::Element(range)) => {
                let close_tag_idx = range.end - 1;
                let insert_idx = if close_tag_idx > range.start
                    && self.doc.events[close_tag_idx - 1].is_whitespace_only()
                {
                    close_tag_idx - 1
                } else {
                    close_tag_idx
                };
                Some(self.event_ranges[insert_idx].start)
            }
            _ => None,
        }
    }

    fn indent_for(&self, parent: &NodePath) -> Vec<u8> {
        // Quirk handling (e.g. customProperties) is core-model's own responsibility, applied by
        // `codec::indent_exception` on top of this default - see tree.rs::insert.
        match self.translate(parent) {
            Some(ep) => crate::document::patch::standard_indent(ep.element_depth()),
            None => crate::document::patch::standard_indent(1),
        }
    }
}

fn compute_byte_ranges(doc: &AodDocument) -> (Vec<Range<usize>>, Vec<u8>) {
    let mut ranges = Vec::with_capacity(doc.events.len());
    let mut buf = Vec::new();
    for ev in &doc.events {
        let single = AodDocument { events: vec![ev.clone()] };
        let bytes = crate::document::serialize(&single);
        let start = buf.len();
        buf.extend_from_slice(&bytes);
        ranges.push(start..buf.len());
    }
    (ranges, buf)
}

fn local_tag_name(raw: &[u8]) -> String {
    let end = raw
        .iter()
        .position(|&c| c == b' ' || c == b'\t' || c == b'\r' || c == b'\n')
        .unwrap_or(raw.len());
    String::from_utf8_lossy(&raw[..end]).into_owned()
}

fn is_whitespace_only(bytes: &[u8]) -> bool {
    bytes.iter().all(|c| c.is_ascii_whitespace())
}

fn decode_text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes)
        .replace("&gt;", ">")
        .replace("&lt;", "<")
        .replace("&amp;", "&")
}

/// Reads a self-closing element's `v="..."` typed-scalar attribute (aod-format.md §1.1) and
/// classifies it: `"true"`/`"false"` -> `Bool`, else a parseable `i64` -> `Int`, else the raw
/// text -> `Text`. An element with no `v` attribute at all projects as an empty `Object` (no
/// fields) - a reasonable schema-free fallback for a self-closing structural element.
fn scalar_from_empty_tag(raw: &[u8]) -> PropertyValue {
    match find_attr_value(raw, "v") {
        Some(v) => match v.as_str() {
            "true" => PropertyValue::Scalar(ScalarValue::Bool(true)),
            "false" => PropertyValue::Scalar(ScalarValue::Bool(false)),
            other => match other.parse::<i64>() {
                Ok(i) => PropertyValue::Scalar(ScalarValue::Int(i)),
                Err(_) => PropertyValue::Scalar(ScalarValue::Text(other.to_string())),
            },
        },
        None => PropertyValue::Object(Vec::new()),
    }
}

fn find_attr_value(raw: &[u8], key: &str) -> Option<String> {
    let name_len = raw
        .iter()
        .position(|&c| c == b' ' || c == b'\t' || c == b'\r' || c == b'\n')
        .unwrap_or(raw.len());
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
            break;
        }
        i += 1;
        let value_start = i;
        while i < raw.len() && raw[i] != b'"' {
            i += 1;
        }
        let value_end = i;
        if i < raw.len() {
            i += 1;
        }
        if key_end > key_start && &raw[key_start..key_end] == key.as_bytes() {
            return Some(decode_text(&raw[value_start..value_end]));
        }
    }
    None
}

/// Projects one element (its event starts at `events[start]`) into a `PropertyValue`, returning
/// the value plus the index of the event immediately after this element (past its matching `End`
/// for a `Start`, or `start + 1` for a self-closing `Empty`).
fn project_element(events: &[AodEvent], start: usize) -> (PropertyValue, usize) {
    match &events[start] {
        AodEvent::Empty(raw) => (scalar_from_empty_tag(raw), start + 1),
        AodEvent::Start(_) => {
            let mut i = start + 1;
            let mut text_parts: Vec<String> = Vec::new();
            let mut children: Vec<(String, PropertyValue)> = Vec::new();
            loop {
                // An element that is never closed (file cut off) ends at the end of the events instead of panicking.
                let Some(event) = events.get(i) else { break };
                match event {
                    AodEvent::End(_) => {
                        i += 1;
                        break;
                    }
                    AodEvent::Start(raw) | AodEvent::Empty(raw) => {
                        let tag = local_tag_name(raw);
                        let (value, next) = project_element(events, i);
                        children.push((tag, value));
                        i = next;
                    }
                    AodEvent::Text(bytes) => {
                        if !is_whitespace_only(bytes) {
                            text_parts.push(decode_text(bytes));
                        }
                        i += 1;
                    }
                    _ => i += 1,
                }
            }
            if children.is_empty() {
                (PropertyValue::Scalar(ScalarValue::Text(text_parts.concat())), i)
            } else {
                (group_children(children), i)
            }
        }
        _ => unreachable!("project_element called on a non-element event"),
    }
}

fn group_children(children: Vec<(String, PropertyValue)>) -> PropertyValue {
    let mut order: Vec<String> = Vec::new();
    let mut groups: HashMap<String, Vec<PropertyValue>> = HashMap::new();
    for (tag, value) in children {
        if !groups.contains_key(&tag) {
            order.push(tag.clone());
        }
        groups.entry(tag).or_default().push(value);
    }
    let fields = order
        .into_iter()
        .map(|tag| {
            let mut values = groups.remove(&tag).unwrap();
            if values.len() == 1 {
                (tag, values.pop().unwrap())
            } else {
                (tag, PropertyValue::Array(values))
            }
        })
        .collect();
    PropertyValue::Object(fields)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(bytes: &[u8]) -> AodDocument {
        crate::document::parse(bytes).expect("test fixture must be well-formed XML")
    }

    const ROLE_XML: &[u8] = b"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\r\n\
<role xmlns=\"http://www.adito.de/2018/ao/Model\" VERSION=\"1.3.0\">\r\n  \
<name>PROJECT_Sales</name>\r\n  \
<title>Role_Sales</title>\r\n  \
<majorModelMode>DISTRIBUTED</majorModelMode>\r\n\
</role>\r\n";

    #[test]
    fn translate_maps_a_field_path_onto_the_root_tags_child_step() {
        let source = AodDocumentSource::new("role.aod", parse(ROLE_XML));
        let ep = source.translate(&NodePath::root().field("title")).unwrap();
        assert_eq!(
            ep,
            EventPath(vec![
                PathStep::Child { tag: "role".into(), occurrence: 0 },
                PathStep::Child { tag: "title".into(), occurrence: 0 },
            ])
        );
    }

    #[test]
    fn value_span_locates_the_text_content_of_a_scalar_field() {
        let source = AodDocumentSource::new("role.aod", parse(ROLE_XML));
        let path = NodePath::root().field("title");

        let span = source.value_span(&path).expect("title must resolve to a value span");
        assert_eq!(source.bytes_in(span), b"Role_Sales");
    }

    #[test]
    fn value_span_locates_a_typed_scalar_attribute_on_a_self_closing_element() {
        // A synthetic typed-scalar sibling, exercising the Attribute branch of value_span.
        let xml = b"<role><flag v=\"true\" /></role>";
        let source = AodDocumentSource::new("f.aod", parse(xml));
        let path = NodePath::root().field("flag");

        let span = source.value_span(&path).expect("flag must resolve to a value span");
        assert_eq!(source.bytes_in(span), b"true");
    }

    #[test]
    fn element_span_includes_leading_whitespace_indentation() {
        let source = AodDocumentSource::new("role.aod", parse(ROLE_XML));
        let path = NodePath::root().field("title");

        let span = source.element_span(&path).expect("title must resolve to an element span");
        let bytes = source.bytes_in(span);
        assert!(bytes.starts_with(b"\r\n  <title>"));
        assert!(bytes.ends_with(b"</title>"));
    }

    #[test]
    fn project_yields_the_expected_object_shape_for_a_real_role_file() {
        let source = AodDocumentSource::new("role.aod", parse(ROLE_XML));
        let value = source.project();

        assert_eq!(value.field("name").and_then(|v| v.as_text()), Some("PROJECT_Sales"));
        assert_eq!(value.field("title").and_then(|v| v.as_text()), Some("Role_Sales"));
        assert_eq!(
            value.field("majorModelMode").and_then(|v| v.as_text()),
            Some("DISTRIBUTED")
        );
    }

    #[test]
    fn apply_scalar_text_replace_mutates_the_document_and_reserializes_correctly() {
        let mut source = AodDocumentSource::new("role.aod", parse(ROLE_XML));
        let path = NodePath::root().field("title");

        source.apply_scalar_text_replace(&path, b"Role_Sales_Changed".to_vec()).unwrap();

        let span = source.value_span(&path).unwrap();
        assert_eq!(source.bytes_in(span), b"Role_Sales_Changed");
        assert!(crate::document::round_trip_check(source.serialized_bytes()).is_ok());
    }

    #[test]
    fn unedited_document_serializes_byte_identical_to_the_original() {
        let source = AodDocumentSource::new("role.aod", parse(ROLE_XML));
        assert_eq!(source.serialized_bytes(), ROLE_XML);
    }

    #[test]
    fn insertion_point_resolves_to_the_append_position_before_the_closing_tag() {
        let source = AodDocumentSource::new("role.aod", parse(ROLE_XML));
        let at = source.insertion_point(&NodePath::root(), None).expect("root must be a container");
        let tail = &source.serialized_bytes()[at..];
        assert!(tail.starts_with(b"\r\n</role>"), "insertion point must sit right before the closing tag's own indentation run");
    }
}
