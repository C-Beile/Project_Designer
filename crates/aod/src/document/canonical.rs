//! The regular form of an object file: two-space indentation, one element per line, CRLF line endings. Files that
//! reach the build in another form (compact XML, odd indentation, a byte order mark) are written in this form.

use crate::document::document::{parse, serialize, AodDocument, AodEvent};
use crate::document::error::AodError;

const NEWLINE: &[u8] = b"\r\n";

fn indent_text(depth: usize) -> AodEvent {
    let mut bytes = NEWLINE.to_vec();
    bytes.extend(std::iter::repeat(b' ').take(depth * 2));
    AodEvent::Text(bytes)
}

/// The line break in front of a node: none at the very start, a plain one behind the declaration, the indentation otherwise.
fn push_break(out: &mut Vec<AodEvent>, depth: usize) {
    match out.last() {
        None => {}
        Some(AodEvent::Decl(_)) => out.push(AodEvent::Text(NEWLINE.to_vec())),
        Some(_) => out.push(indent_text(depth)),
    }
}

/// The document with its layout whitespace replaced by the regular layout. Text that carries content stays as it is.
pub fn canonical_events(doc: &AodDocument) -> AodDocument {
    let events = &doc.events;
    let mut out: Vec<AodEvent> = Vec::with_capacity(events.len() + events.len() / 2);
    let mut depth = 0usize;
    let mut i = 0;
    // `true` when the last thing written was an opening tag, so a closing tag follows directly.
    let mut just_opened = false;
    while i < events.len() {
        match &events[i] {
            AodEvent::Text(t) if t.iter().all(|c| c.is_ascii_whitespace()) => {
                // An empty element that holds only a line break (`<list>` newline `</list>`) keeps its closing tag on a
                // line of its own; the reference inserts into such a list below the opening tag.
                if just_opened && t.contains(&10u8) && matches!(events.get(i + 1), Some(AodEvent::End(_))) {
                    just_opened = false;
                }
                i += 1;
                continue;
            }
            AodEvent::Text(t) => {
                // Text of an element that has no child element stays right behind its opening tag.
                out.push(AodEvent::Text(t.clone()));
                just_opened = false;
                i += 1;
                // A closing tag after content text stays on the same line.
                if let Some(AodEvent::End(b)) = events.get(i) {
                    out.push(AodEvent::End(b.clone()));
                    depth = depth.saturating_sub(1);
                    i += 1;
                    let _ = b;
                }
            }
            AodEvent::Decl(b) => {
                out.push(AodEvent::Decl(b.clone()));
                i += 1;
            }
            AodEvent::Start(b) => {
                push_break(&mut out, depth);
                out.push(AodEvent::Start(b.clone()));
                depth += 1;
                just_opened = true;
                i += 1;
            }
            AodEvent::Empty(b) => {
                push_break(&mut out, depth);
                out.push(AodEvent::Empty(b.clone()));
                just_opened = false;
                i += 1;
            }
            AodEvent::End(b) => {
                depth = depth.saturating_sub(1);
                if !just_opened {
                    out.push(indent_text(depth));
                }
                out.push(AodEvent::End(b.clone()));
                just_opened = false;
                i += 1;
            }
            other => {
                out.push(indent_text(depth));
                out.push(other.clone());
                just_opened = false;
                i += 1;
            }
        }
    }
    out.push(AodEvent::Text(NEWLINE.to_vec()));
    AodDocument { events: out }
}

/// Every line break, also inside multi-line texts, becomes CRLF.
fn crlf(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(bytes.len() + bytes.len() / 40);
    for &b in bytes {
        match b {
            13 => {}
            10 => out.extend_from_slice(NEWLINE),
            other => out.push(other),
        }
    }
    out
}

/// The bytes of an object file in the regular form; a leading byte order mark is dropped.
pub fn canonicalize(bytes: &[u8]) -> Result<Vec<u8>, AodError> {
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    let doc = parse(bytes)?;
    Ok(crlf(&serialize(&canonical_events(&doc))))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compact_xml_with_a_byte_order_mark_gets_the_regular_layout() {
        let source = b"\xEF\xBB\xBF<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<entity><name>A</name><list><element>x</element><flag v=\"true\" /></list><empty></empty></entity>";
        let expected = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\r\n<entity>\r\n  <name>A</name>\r\n  <list>\r\n    <element>x</element>\r\n    <flag v=\"true\" />\r\n  </list>\r\n  <empty></empty>\r\n</entity>\r\n";
        assert_eq!(String::from_utf8(canonicalize(source).unwrap()).unwrap(), expected);
    }

    #[test]
    fn line_breaks_inside_a_text_become_crlf_too() {
        let source = b"<a>\n  <d>one\ntwo</d>\n</a>";
        let expected = "<a>\r\n  <d>one\r\ntwo</d>\r\n</a>\r\n";
        assert_eq!(String::from_utf8(canonicalize(source).unwrap()).unwrap(), expected);
    }

    #[test]
    fn a_file_in_the_regular_layout_stays_as_it_is() {
        let regular = b"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\r\n<a>\r\n  <b>1</b>\r\n  <c />\r\n</a>\r\n";
        assert_eq!(canonicalize(regular).unwrap(), regular.to_vec());
    }
}
