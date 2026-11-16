// V2-Writer: aus dem Baum Bytes machen. Regeln (am Orakel belegt, siehe `format::v2`): LF, 2 Leerzeichen je Ebene,
// `<x />` für leere Elemente, Text direkt zwischen den Tags, LF am Dateiende.

use super::tree::{Document, NodeId};
use crate::format::v2::{INDENT, LINE_END, XML_HEADER};

pub fn write_v2(doc: &Document) -> Vec<u8> {
    let mut out = Vec::with_capacity(4096);
    out.extend_from_slice(XML_HEADER.as_bytes());
    out.extend_from_slice(LINE_END.as_bytes());
    write_node(doc, doc.root, 0, &mut out);
    out
}

fn indent(depth: usize, out: &mut Vec<u8>) {
    for _ in 0..depth {
        out.extend_from_slice(INDENT.as_bytes());
    }
}

fn write_node(doc: &Document, id: NodeId, depth: usize, out: &mut Vec<u8>) {
    let node = doc.node(id);
    indent(depth, out);
    out.push(b'<');
    out.extend_from_slice(&node.tag);
    for (name, value) in &node.attrs {
        out.push(b' ');
        out.extend_from_slice(name);
        out.extend_from_slice(b"=\"");
        out.extend_from_slice(value);
        out.push(b'"');
    }
    if !node.children.is_empty() {
        out.push(b'>');
        out.extend_from_slice(LINE_END.as_bytes());
        for child in &node.children {
            write_node(doc, *child, depth + 1, out);
        }
        indent(depth, out);
        out.extend_from_slice(b"</");
        out.extend_from_slice(&node.tag);
        out.push(b'>');
    } else if let Some(text) = &node.text {
        out.push(b'>');
        out.extend_from_slice(text);
        out.extend_from_slice(b"</");
        out.extend_from_slice(&node.tag);
        out.push(b'>');
    } else {
        out.extend_from_slice(b" />");
    }
    out.extend_from_slice(LINE_END.as_bytes());
}

#[cfg(test)]
mod tests {
    use super::super::parse::parse;
    use super::*;

    #[test]
    fn roundtrip_is_stable_and_normalizes_layout() {
        let src = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<a x=\"1\">\n  <b>t &amp; u</b>\n  <c />\n  <d><e>1</e></d>\n</a>\n";
        let doc = parse(src.as_bytes()).unwrap();
        let out = String::from_utf8(write_v2(&doc)).unwrap();
        assert_eq!(out, "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<a x=\"1\">\n  <b>t &amp; u</b>\n  <c />\n  <d>\n    <e>1</e>\n  </d>\n</a>\n");
        let again = String::from_utf8(write_v2(&parse(out.as_bytes()).unwrap())).unwrap();
        assert_eq!(out, again);
    }

    #[test]
    fn rejects_comments_and_mixed_content() {
        assert!(parse(b"<a><!-- x --></a>").is_err());
        assert!(parse(b"<a>text<b/></a>").is_err());
    }

    #[test]
    fn script_text_with_newlines_stays_verbatim() {
        let src = "<a>\n  <p>line1\nline2\n    indented</p>\n</a>";
        let out = String::from_utf8(write_v2(&parse(src.as_bytes()).unwrap())).unwrap();
        assert!(out.contains("<p>line1\nline2\n    indented</p>"));
    }
}
