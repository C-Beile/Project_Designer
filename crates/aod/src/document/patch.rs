//! Event-level patch operations: the three primitives `aod::tree::PropertyTree` builds edits
//! on top of (architecture.md #3 "Edit-Fluss"). Each operation mutates only the events it must;
//! every other event keeps its original bytes, which is what makes "save without edits produces
//! an empty diff" (ADR-0002) hold once these are wired into a real edit path.
//!
//! Indentation rule (aod-format.md #1.2): a newly inserted element gets 2 spaces per nesting
//! level deeper than its parent's own opening tag, CRLF line endings, no BOM — this is the
//! *standard* case and matches every object type except the documented `customProperties`
//! exception (see [`KNOWN_INDENT_QUIRKS`]).

use crate::document::document::{tag_name, AodDocument, AodEvent};
use crate::document::error::PatchError;
use crate::document::index::{EventIndex, EventPath, IndexedRange};
use std::ops::Range;

/// Where to place a newly inserted element relative to an existing child of `parent_path`.
pub enum SiblingHint {
    /// Insert as the parent's last child, immediately before its closing tag.
    AppendAsLastChild,
    /// Insert immediately before the child element currently at this path.
    Before(EventPath),
    /// Insert immediately after the child element currently at this path.
    After(EventPath),
}

/// A documented exception to the standard "parent indent + 2 spaces" rule, seeded with the one
/// quirk verified so far (aod-format.md #1.2: `customProperties` blocks under `entityFieldDb`
/// sit shallower than their siblings). When `element_tag` is being inserted and an existing
/// sibling with the same tag is found under the same parent, its indentation is copied verbatim
/// instead of computing the standard depth-based indent — a "match an existing example" fallback
/// rather than trying to encode the irregular rule itself, per `spike-round-trip.md`'s Lesson 3.
/// Extend this table (and `aod-format.md` #1.2) whenever a new irregularity is verified.
pub struct IndentQuirk {
    pub element_tag: &'static str,
    pub parent_tag: &'static str,
    pub note: &'static str,
}

pub const KNOWN_INDENT_QUIRKS: &[IndentQuirk] = &[IndentQuirk {
    element_tag: "customProperties",
    parent_tag: "entityFieldDb",
    note: "aod-format.md #1.2: customProperties (and the entityFieldDb close tag around it) sits \
           shallower than sibling entityFieldDb children in every real file observed so far; root \
           cause unverified, so inserting a new customProperties block copies an existing \
           sibling's indentation instead of guessing the standard depth-based indent.",
}];

/// Replaces exactly one `Text` event's content — the scalar-edit case
/// (architecture.md #3: "ersetzt genau das eine Text-Event an der NodeRef-Range"). `range` must
/// be a single-event range (`i..i+1`) pointing at a `Text` event, typically obtained from
/// [`EventIndex::text_event_index`]. `new_bytes` must already be XML-escaped (the same
/// convention `AodEvent::Text` uses everywhere else — `serialize` writes it via
/// `BytesText::from_escaped`, it does not escape on write). Returns the replaced event's old
/// bytes, so callers building `undo::FileCommand` (architecture.md #3) don't need a second
/// lookup.
pub fn replace_text_at(
    doc: &mut AodDocument,
    range: Range<usize>,
    new_bytes: Vec<u8>,
) -> Result<Vec<u8>, PatchError> {
    if range.end > doc.events.len() {
        return Err(PatchError::RangeOutOfBounds(range, doc.events.len()));
    }
    if range.end != range.start + 1 {
        return Err(PatchError::NotASingleTextEvent(range));
    }
    match doc.events.get_mut(range.start) {
        Some(AodEvent::Text(b)) => Ok(std::mem::replace(b, new_bytes)),
        _ => Err(PatchError::NotASingleTextEvent(range)),
    }
}

/// Inserts a new element (parsed from `template_bytes`, which must contain exactly one
/// well-formed root element — its own nested content is copied through untouched) as a child of
/// `parent_path`, positioned per `sibling_hint`. Generates one fresh indentation `Text` event
/// (CRLF + N spaces) immediately before the inserted element; every existing event, including
/// neighbouring whitespace, keeps its original bytes and position (shifted, never rewritten).
/// Returns the event-index range the new element (including its leading indent) now occupies.
pub fn insert_at(
    doc: &mut AodDocument,
    index: &EventIndex,
    parent_path: &EventPath,
    template_bytes: &[u8],
    sibling_hint: SiblingHint,
) -> Result<Range<usize>, PatchError> {
    let parent_range = resolve_element(index, parent_path)?;

    if matches!(doc.events.get(parent_range.start), Some(AodEvent::Empty(_))) {
        return Err(PatchError::CannotInsertIntoEmptyElement(format!(
            "{parent_path:?}"
        )));
    }

    let template_events = parse_template(template_bytes)?;
    let element_tag = match &template_events[0] {
        AodEvent::Start(b) | AodEvent::Empty(b) => tag_name(b).into_owned(),
        _ => unreachable!("parse_template guarantees a single root Start/Empty"),
    };

    let insert_pos = match &sibling_hint {
        SiblingHint::AppendAsLastChild => {
            // parent_range.end - 1 is the index of the parent's own closing tag. Insert before
            // its leading whitespace (if any), not between that whitespace and the closing tag
            // itself, or the new element would end up jammed directly against `</parent>` with
            // no indentation lead-in before the close tag.
            let close_tag_idx = parent_range.end - 1;
            if close_tag_idx > parent_range.start
                && doc.events[close_tag_idx - 1].is_whitespace_only()
            {
                close_tag_idx - 1
            } else {
                close_tag_idx
            }
        }
        SiblingHint::Before(child_path) => {
            let child_range = resolve_element(index, child_path)?;
            // Insert before the child's own leading whitespace (if any) rather than between it
            // and the child tag, so that existing whitespace still leads the (now shifted)
            // child afterwards — never two whitespace-only Text events back to back.
            if child_range.start > parent_range.start
                && doc.events[child_range.start - 1].is_whitespace_only()
            {
                child_range.start - 1
            } else {
                child_range.start
            }
        }
        SiblingHint::After(sibling_path) => resolve_element(index, sibling_path)?.end,
    };

    // aod-format.md #1.2 / architecture.md #3: a child sits 2 spaces deeper than its parent's
    // OWN opening tag. Since `parent_path.element_depth()` already counts the parent itself as
    // one level (root's own path has length 1, and root's direct children indent 2 spaces), the
    // child indent is exactly `parent_path.element_depth() * 2` spaces — no further +1 needed.
    let indent = resolve_indent(doc, &parent_range, &element_tag, parent_path.element_depth());

    let mut block = Vec::with_capacity(template_events.len() + 1);
    block.push(AodEvent::Text(indent));
    block.extend(template_events);
    let inserted_len = block.len();

    doc.events.splice(insert_pos..insert_pos, block);
    Ok(insert_pos..insert_pos + inserted_len)
}

/// Removes `range` from the event list entirely, along with a single whitespace-only `Text`
/// event immediately preceding it (its indentation lead-in), so deleting an element never
/// leaves a blank line where its indentation used to be. Returns the removed events (including
/// the absorbed whitespace, if any) so callers can build an undo `FileCommand`
/// (architecture.md #3) without re-deriving what was removed.
pub fn delete_range(doc: &mut AodDocument, range: Range<usize>) -> Result<Vec<AodEvent>, PatchError> {
    if range.end > doc.events.len() || range.start > range.end {
        return Err(PatchError::RangeOutOfBounds(range, doc.events.len()));
    }
    let mut start = range.start;
    if start > 0 && doc.events[start - 1].is_whitespace_only() {
        start -= 1;
    }
    Ok(doc.events.splice(start..range.end, std::iter::empty()).collect())
}

fn resolve_element(index: &EventIndex, path: &EventPath) -> Result<Range<usize>, PatchError> {
    match index.get(path) {
        Some(IndexedRange::Element(r)) => Ok(r.clone()),
        Some(IndexedRange::Attribute { .. }) => Err(PatchError::NotAnElement(format!("{path:?}"))),
        None => Err(PatchError::PathNotFound(format!("{path:?}"))),
    }
}

/// Parses an insert template into its own event list and validates it holds exactly one
/// top-level element (leading/trailing whitespace in the caller-supplied template is trimmed
/// first, so callers can write templates with natural formatting).
fn parse_template(template_bytes: &[u8]) -> Result<Vec<AodEvent>, PatchError> {
    let doc = crate::document::document::parse(template_bytes)
        .map_err(|crate::document::error::AodError::Xml(x)| PatchError::InvalidTemplate(x))?;
    let mut events = doc.events;
    while matches!(events.first(), Some(e) if e.is_whitespace_only()) {
        events.remove(0);
    }
    while matches!(events.last(), Some(e) if e.is_whitespace_only()) {
        events.pop();
    }
    if events.is_empty() {
        return Err(PatchError::TemplateNotSingleElement(0));
    }

    let mut depth = 0i32;
    let mut roots = 0usize;
    for e in &events {
        match e {
            AodEvent::Start(_) => {
                if depth == 0 {
                    roots += 1;
                }
                depth += 1;
            }
            AodEvent::End(_) => depth -= 1,
            AodEvent::Empty(_) => {
                if depth == 0 {
                    roots += 1;
                }
            }
            _ => {}
        }
    }
    if roots != 1 || depth != 0 {
        return Err(PatchError::TemplateNotSingleElement(roots));
    }
    Ok(events)
}

/// Standard indentation: CRLF followed by `depth * 2` spaces (aod-format.md #1.2 baseline rule).
pub fn standard_indent(depth: usize) -> Vec<u8> {
    let mut v = Vec::with_capacity(2 + depth * 2);
    v.extend_from_slice(b"\r\n");
    v.extend(std::iter::repeat(b' ').take(depth * 2));
    v
}

/// Resolves the indentation bytes for a newly inserted element: the standard depth-based rule,
/// unless `element_tag` is a known quirk (`KNOWN_INDENT_QUIRKS`) and an existing sibling with
/// the same tag is present under `parent_range` to copy indentation from.
fn resolve_indent(
    doc: &AodDocument,
    parent_range: &Range<usize>,
    element_tag: &str,
    depth: usize,
) -> Vec<u8> {
    if KNOWN_INDENT_QUIRKS.iter().any(|q| q.element_tag == element_tag) {
        if let Some(ws) = find_sibling_indent(doc, parent_range, element_tag) {
            return ws;
        }
    }
    standard_indent(depth)
}

fn find_sibling_indent(doc: &AodDocument, parent_range: &Range<usize>, tag: &str) -> Option<Vec<u8>> {
    for i in parent_range.clone() {
        if let Some(raw) = doc.events[i].tag_bytes() {
            if tag_name(raw) == tag && i > 0 && doc.events[i - 1].is_whitespace_only() {
                if let AodEvent::Text(ws) = &doc.events[i - 1] {
                    return Some(ws.clone());
                }
            }
        }
    }
    None
}
