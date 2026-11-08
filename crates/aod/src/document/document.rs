//! Byte-faithful event-stream representation of an `.aod` file.
//!
//! Ported and hardened from the P2 round-trip spike
//! (`_scratch/p2-round-trip-spike/app/aod_core/src/lib.rs`, verified PASS on 76/76 real files).
//! Design choice carried over unchanged: rather than building a "pretty" DOM/AST and
//! regenerating formatting from nesting depth (which would have to reverse-engineer every
//! formatting quirk the real Designer serializer produces, including ones not yet discovered —
//! see the `customProperties` indentation irregularity in `aod-format.md` #1.2), we capture the
//! raw byte stream as an ordered list of typed events and replay it verbatim. Untouched parts of
//! a document round-trip exactly because their raw bytes are never regenerated, only echoed.

use crate::document::error::AodError;
use quick_xml::events::Event;
use quick_xml::reader::Reader;
use quick_xml::writer::Writer;
use std::io::Cursor;

/// One raw XML token, holding the exact bytes quick-xml captured for it (owned, so the
/// document can be held in memory independent of the original file buffer). `Start`/`Empty`/
/// `Decl`/`PI` bytes are the tag's raw content (name + attributes, no angle brackets); `End`
/// is the closing tag's raw name; `Text`/`Comment`/`CData`/`DocType` are the raw inner bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AodEvent {
    Start(Vec<u8>),
    End(Vec<u8>),
    Empty(Vec<u8>),
    Text(Vec<u8>),
    Comment(Vec<u8>),
    CData(Vec<u8>),
    Decl(Vec<u8>),
    PI(Vec<u8>),
    DocType(Vec<u8>),
}

impl AodEvent {
    /// True for a `Text` event whose bytes are entirely XML whitespace (space/tab/CR/LF).
    /// Used by the indentation logic in [`crate::document::patch`] to recognize the whitespace-only
    /// `Text` events that carry indentation between sibling elements.
    pub fn is_whitespace_only(&self) -> bool {
        matches!(self, AodEvent::Text(b) if b.iter().all(|c| c.is_ascii_whitespace()))
    }

    /// Raw tag content for `Start`/`Empty` events (name + attributes), `None` otherwise.
    pub fn tag_bytes(&self) -> Option<&[u8]> {
        match self {
            AodEvent::Start(b) | AodEvent::Empty(b) => Some(b),
            _ => None,
        }
    }
}

/// An `.aod` document as an ordered list of raw events — the loaded, in-memory form. This is
/// "Schicht 1" of the two-layer model (`architecture.md` #3): `aod::tree::PropertyTree`
/// projects a typed view on top of this via the [`crate::document::index::EventIndex`].
#[derive(Debug, Clone)]
pub struct AodDocument {
    pub events: Vec<AodEvent>,
}

/// Parses raw file bytes into an event stream. Fails only on malformed XML; formatting quirks
/// (odd indentation, empty elements written as open/close pairs, etc.) are not errors — they
/// are captured verbatim in the `Text` events between tags.
pub fn parse(bytes: &[u8]) -> Result<AodDocument, AodError> {
    let mut reader = Reader::from_reader(bytes);
    // trim_text(false): indentation whitespace lives in Text events between tags and must be
    // preserved verbatim, not stripped, or byte-identical round-trip is impossible.
    reader.config_mut().trim_text(false);
    // expand_empty_elements(false): keep `<foo />` distinct from `<foo></foo>` — the format
    // uses both forms meaningfully (see aod-format.md #1.1 on empty-string vs. self-closing).
    reader.config_mut().expand_empty_elements = false;
    // check_end_names(false): real files are well-formed; disabling the check avoids paying
    // for a validation this crate does not need (mismatched tags are a parse.rs bug to find
    // via the corpus round-trip test, not something to guard against at runtime).
    reader.config_mut().check_end_names = false;

    let mut events = Vec::new();
    loop {
        match reader.read_event()? {
            Event::Eof => break,
            Event::Start(e) => events.push(AodEvent::Start(e.to_vec())),
            Event::End(e) => events.push(AodEvent::End(e.to_vec())),
            Event::Empty(e) => events.push(AodEvent::Empty(e.to_vec())),
            Event::Text(e) => events.push(AodEvent::Text(e.into_inner().into_owned())),
            Event::Comment(e) => events.push(AodEvent::Comment(e.into_inner().into_owned())),
            Event::CData(e) => events.push(AodEvent::CData(e.into_inner().into_owned())),
            Event::Decl(e) => events.push(AodEvent::Decl(e.to_vec())),
            Event::PI(e) => events.push(AodEvent::PI(e.to_vec())),
            Event::DocType(e) => events.push(AodEvent::DocType(e.into_inner().into_owned())),
        }
    }
    Ok(AodDocument { events })
}

/// Serializes the event stream back into bytes. For an untouched document (loaded, then saved
/// without edits) this is byte-identical to the original file — the property the corpus test
/// in `tests/corpus_round_trip.rs` proves over the real-project fixture set. For an edited
/// document (via `crate::document::patch`), everything outside the patched event range is still echoed
/// verbatim; only the patched events reflect newly generated bytes.
pub fn serialize(doc: &AodDocument) -> Vec<u8> {
    let mut writer = Writer::new(Cursor::new(Vec::new()));
    for ev in &doc.events {
        let quick_xml_event = match ev {
            AodEvent::Start(b) => Event::Start(quick_xml::events::BytesStart::from_content(
                String::from_utf8_lossy(b),
                tag_name_len(b),
            )),
            AodEvent::End(b) => {
                Event::End(quick_xml::events::BytesEnd::new(String::from_utf8_lossy(b)))
            }
            AodEvent::Empty(b) => Event::Empty(quick_xml::events::BytesStart::from_content(
                String::from_utf8_lossy(b),
                tag_name_len(b),
            )),
            AodEvent::Text(b) => Event::Text(quick_xml::events::BytesText::from_escaped(
                String::from_utf8_lossy(b),
            )),
            AodEvent::Comment(b) => Event::Comment(quick_xml::events::BytesText::from_escaped(
                String::from_utf8_lossy(b),
            )),
            AodEvent::CData(b) => {
                Event::CData(quick_xml::events::BytesCData::new(String::from_utf8_lossy(b)))
            }
            AodEvent::Decl(b) => Event::Decl(quick_xml::events::BytesDecl::from_start(
                quick_xml::events::BytesStart::from_content(
                    String::from_utf8_lossy(b),
                    tag_name_len(b),
                ),
            )),
            AodEvent::PI(b) => {
                Event::PI(quick_xml::events::BytesPI::new(String::from_utf8_lossy(b)))
            }
            AodEvent::DocType(b) => Event::DocType(quick_xml::events::BytesText::from_escaped(
                String::from_utf8_lossy(b),
            )),
        };
        writer
            .write_event(quick_xml_event)
            .expect("in-memory write cannot fail");
    }
    writer.into_inner().into_inner()
}

/// Byte-length of an element's tag name (the part before the first whitespace/attribute) within
/// a `Start`/`Empty`/`Decl` event's raw content. Needed because quick-xml's
/// `BytesStart::from_content` takes name and attributes as one slice plus this length to tell
/// them apart.
pub(crate) fn tag_name_len(raw: &[u8]) -> usize {
    raw.iter()
        .position(|&c| c == b' ' || c == b'\t' || c == b'\r' || c == b'\n')
        .unwrap_or(raw.len())
}

/// Tag name of a `Start`/`Empty`/`End` event's raw bytes, as a `&str`. Used throughout
/// `crate::document::index` to build tag-qualified [`crate::document::index::EventPath`]s. Falls back to lossy
/// UTF-8 decoding; `.aod` tag names are always ASCII in every file observed so far
/// (aod-format.md), so this is not expected to lose information in practice.
pub(crate) fn tag_name(raw: &[u8]) -> std::borrow::Cow<'_, str> {
    String::from_utf8_lossy(&raw[..tag_name_len(raw)])
}

/// Convenience wrapper for the round-trip proof: load bytes, serialize back, compare.
/// Returns `Ok(())` if identical, `Err(mismatch description)` otherwise.
pub fn round_trip_check(original: &[u8]) -> Result<(), String> {
    let doc = parse(original).map_err(|e| format!("parse error: {e}"))?;
    let regenerated = serialize(&doc);
    if regenerated == original {
        Ok(())
    } else {
        Err(diff_summary(original, &regenerated))
    }
}

fn diff_summary(a: &[u8], b: &[u8]) -> String {
    let min_len = a.len().min(b.len());
    let mut first_diff = min_len;
    for i in 0..min_len {
        if a[i] != b[i] {
            first_diff = i;
            break;
        }
    }
    let ctx = 20usize;
    let a_start = first_diff.saturating_sub(ctx);
    let b_start = first_diff.saturating_sub(ctx);
    let a_ctx = String::from_utf8_lossy(&a[a_start..(first_diff + ctx).min(a.len())]);
    let b_ctx = String::from_utf8_lossy(&b[b_start..(first_diff + ctx).min(b.len())]);
    format!(
        "length original={} regenerated={}, first diff at byte {}\n  original:    ...{:?}...\n  regenerated: ...{:?}...",
        a.len(),
        b.len(),
        first_diff,
        a_ctx,
        b_ctx
    )
}
