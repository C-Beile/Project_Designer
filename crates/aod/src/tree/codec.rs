//! Renders `PropertyValue`s to the exact bytes a new/changed `.aod` node should carry.
//!
//! This is the one place that knows the value-encoding conventions verified in aod-format.md
//! §1.1/§1.2: plain text content, `<foo v="..."/>` for typed scalars, CRLF line endings, no BOM,
//! and the "2 spaces per nesting level" default indentation rule together with its known
//! exception table (currently just `customProperties`, aod-format.md §1.2). Neither `PropertyTree`
//! nor `EventSource` implementations need to know these rules themselves.

use crate::tree::value::{PropertyValue, ScalarValue};

/// Line ending verified byte-for-byte in aod-format.md §1.2 for every sampled file.
pub const LINE_ENDING: &[u8] = b"\r\n";

/// Minimal XML text/attribute escaping. `aod::tree` computes *content* bytes for a Text event
/// or typed-scalar attribute value; `aod::document` only ever echoes bytes verbatim, so escaping the
/// characters that would otherwise break well-formedness is this crate's responsibility, not
/// aod::document's (see event_source.rs doc comment on the layering).
pub fn encode_text(raw: &str) -> String {
    raw.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn encode_attr(raw: &str) -> String {
    encode_text(raw).replace('"', "&quot;")
}

/// Business meaning: the bytes that go inside a scalar node's `value_span` after an edit -
/// plain escaped text for `Text`, `true`/`false` for `Bool`, decimal digits for `Int` (the
/// typed-scalar `v="..."` attribute's value content, per aod-format.md §1.1).
pub fn encode_scalar(value: &ScalarValue) -> Vec<u8> {
    match value {
        ScalarValue::Text(t) => encode_text(t).into_bytes(),
        ScalarValue::Bool(b) => encode_attr(if *b { "true" } else { "false" }).into_bytes(),
        ScalarValue::Int(i) => i.to_string().into_bytes(),
    }
}

/// Nesting-level indent override for element names with a documented formatting quirk.
/// Seeded with the one verified case from aod-format.md §1.2: `customProperties` blocks under
/// `entityFieldDb` sit shallower than their siblings in real Designer output. New quirks found
/// while building against real files belong here, not as silent "pretty" behaviour.
pub fn indent_exception(element_name: &str, default_indent: &[u8]) -> Option<Vec<u8>> {
    match element_name {
        // Verified: aod-format.md §1.2 - sits at a shallower level than sibling entityFieldDb
        // children instead of the expected "2 spaces deeper than parent" default.
        "customProperties" => {
            let default_len = default_indent.len();
            let shallower = default_len.saturating_sub(2);
            Some(vec![b' '; shallower])
        }
        _ => None,
    }
}

/// Renders `name`/`value` as a full element (including nested children) at the given
/// indentation, terminated the way every sampled `.aod` file terminates its elements: no
/// trailing content after the closing tag, CRLF between elements. Used for the insert edit flow
/// (architecture.md §3): a template value becomes one `FileCommand.new_bytes` blob spliced in
/// at `EventSource::insertion_point`.
pub fn render_element(name: &str, value: &PropertyValue, indent: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    render_element_into(&mut out, name, value, indent);
    out
}

fn render_element_into(out: &mut Vec<u8>, name: &str, value: &PropertyValue, indent: &[u8]) {
    out.extend_from_slice(indent);
    match value {
        PropertyValue::Scalar(ScalarValue::Text(t)) => {
            if t.is_empty() {
                // Empty strings are still emitted as an explicit open/close pair, never
                // self-closed - aod-format.md §1.1, verified across entityFieldDb blocks.
                out.extend_from_slice(format!("<{name}></{name}>").as_bytes());
            } else {
                out.extend_from_slice(format!("<{name}>{}</{name}>", encode_text(t)).as_bytes());
            }
        }
        PropertyValue::Scalar(ScalarValue::Bool(b)) => {
            out.extend_from_slice(
                format!("<{name} v=\"{}\" />", if *b { "true" } else { "false" }).as_bytes(),
            );
        }
        PropertyValue::Scalar(ScalarValue::Int(i)) => {
            out.extend_from_slice(format!("<{name} v=\"{i}\" />").as_bytes());
        }
        PropertyValue::Object(fields) => {
            out.extend_from_slice(format!("<{name}>").as_bytes());
            let child_indent = child_indent_for(name, indent);
            for (child_name, child_value) in fields {
                out.extend_from_slice(LINE_ENDING);
                let this_indent = indent_exception(child_name, &child_indent).unwrap_or_else(|| child_indent.clone());
                render_element_into(out, child_name, child_value, &this_indent);
            }
            out.extend_from_slice(LINE_ENDING);
            out.extend_from_slice(indent);
            out.extend_from_slice(format!("</{name}>").as_bytes());
        }
        PropertyValue::Array(items) => {
            // An array value itself has no wrapping element - each item is rendered under the
            // shared `name` (e.g. multiple `entityField` elements), matching the repeatable-
            // element flattening convention documented in value.rs.
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.extend_from_slice(LINE_ENDING);
                }
                render_element_into(out, name, item, indent);
            }
        }
    }
}

fn child_indent_for(_parent_name: &str, parent_indent: &[u8]) -> Vec<u8> {
    // Default rule verified in aod-format.md §1.2: 2 spaces deeper than the parent's own
    // indentation. Per-element overrides go through `indent_exception`, applied by the caller.
    let mut v = parent_indent.to_vec();
    v.extend_from_slice(b"  ");
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_text_is_open_close_not_self_closed() {
        let v = PropertyValue::Scalar(ScalarValue::Text(String::new()));
        let bytes = render_element("category", &v, b"");
        assert_eq!(String::from_utf8(bytes).unwrap(), "<category></category>");
    }

    #[test]
    fn typed_scalar_bool_uses_v_attribute() {
        let v = PropertyValue::Scalar(ScalarValue::Bool(true));
        let bytes = render_element("groupable", &v, b"");
        assert_eq!(String::from_utf8(bytes).unwrap(), "<groupable v=\"true\" />");
    }

    #[test]
    fn object_renders_nested_children_indented_two_deeper() {
        let v = PropertyValue::Object(vec![(
            "name".to_string(),
            PropertyValue::Scalar(ScalarValue::Text("COUNTRY".to_string())),
        )]);
        let bytes = render_element("entityField", &v, b"  ");
        let text = String::from_utf8(bytes).unwrap();
        assert_eq!(
            text,
            "  <entityField>\r\n    <name>COUNTRY</name>\r\n  </entityField>"
        );
    }

    #[test]
    fn custom_properties_gets_the_documented_shallower_indent_exception() {
        let inner = PropertyValue::Object(vec![(
            "customProperties".to_string(),
            PropertyValue::Object(vec![]),
        )]);
        // parent indent is 14 spaces (a realistic entityFieldDb nesting depth); the exception
        // must land 2 shallower than the *default* child indent (16), i.e. at 14, matching the
        // aod-format.md §1.2 observation that it sits shallower than true siblings.
        let parent_indent = vec![b' '; 14];
        let bytes = render_element("entityFieldDb", &inner, &parent_indent);
        let text = String::from_utf8(bytes).unwrap();
        assert!(text.contains(&format!("\r\n{}<customProperties>", " ".repeat(14))));
    }
}
