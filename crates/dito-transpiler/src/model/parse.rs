// Liest ein ADITO-Modell (UTF-8, `<?xml ...?>` am Anfang) in einen Baum. Absichtlich klein und streng:
// Kommentare, CDATA und gemischter Inhalt werden abgelehnt, dann fällt der Aufrufer auf den Byte-Weg zurück.

use super::tree::{Document, Node, NodeId};

#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    #[error("Unerwartetes Ende")]
    Eof,
    #[error("Nicht unterstützt: {0}")]
    Unsupported(&'static str),
    #[error("Schließendes Tag passt nicht: erwartet {expected}, gefunden {found}")]
    Mismatch { expected: String, found: String },
}

fn is_ws(b: u8) -> bool {
    matches!(b, b' ' | b'\t' | b'\r' | b'\n')
}

pub fn parse(bytes: &[u8]) -> Result<Document, ParseError> {
    let mut i = 0;
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        i = 3;
    }
    skip_ws(bytes, &mut i);
    if bytes[i..].starts_with(b"<?") {
        let end = find(bytes, i, b"?>").ok_or(ParseError::Eof)?;
        i = end + 2;
    }
    skip_ws(bytes, &mut i);

    let mut doc: Option<Document> = None;
    let mut stack: Vec<NodeId> = Vec::new();
    // Text, der zum aktuellen Element gehört.
    let mut text: Vec<u8> = Vec::new();

    while i < bytes.len() {
        if bytes[i] != b'<' {
            let start = i;
            while i < bytes.len() && bytes[i] != b'<' {
                i += 1;
            }
            if !stack.is_empty() {
                text.extend_from_slice(&bytes[start..i]);
            }
            continue;
        }
        if bytes[i..].starts_with(b"<!") {
            return Err(ParseError::Unsupported("Kommentar, CDATA oder DOCTYPE"));
        }
        if bytes[i..].starts_with(b"<?") {
            return Err(ParseError::Unsupported("Verarbeitungsanweisung im Inhalt"));
        }
        if bytes[i..].starts_with(b"</") {
            let end = find(bytes, i, b">").ok_or(ParseError::Eof)?;
            let name = trim_ws(&bytes[i + 2..end]);
            let current = stack.pop().ok_or(ParseError::Eof)?;
            let d = doc.as_mut().ok_or(ParseError::Eof)?;
            if d.node(current).tag != name {
                return Err(ParseError::Mismatch {
                    expected: String::from_utf8_lossy(&d.node(current).tag).into_owned(),
                    found: String::from_utf8_lossy(name).into_owned(),
                });
            }
            finish_text(d, current, &mut text)?;
            i = end + 1;
            continue;
        }
        let end = find_tag_end(bytes, i).ok_or(ParseError::Eof)?;
        let mut inner = &bytes[i + 1..end];
        let self_closing = inner.ends_with(b"/");
        if self_closing {
            inner = &inner[..inner.len() - 1];
        }
        let node = parse_start_tag(inner)?;
        if let Some(parent) = stack.last().copied() {
            let d = doc.as_mut().ok_or(ParseError::Eof)?;
            if text.iter().any(|b| !is_ws(*b)) {
                return Err(ParseError::Unsupported("gemischter Inhalt"));
            }
            text.clear();
            let id = d.append(parent, node);
            if !self_closing {
                stack.push(id);
            }
        } else {
            let d = Document::new(node);
            let root = d.root;
            doc = Some(d);
            if !self_closing {
                stack.push(root);
            }
        }
        i = end + 1;
    }
    if !stack.is_empty() {
        return Err(ParseError::Eof);
    }
    doc.ok_or(ParseError::Eof)
}

fn finish_text(doc: &mut Document, id: NodeId, text: &mut Vec<u8>) -> Result<(), ParseError> {
    let has_children = !doc.node(id).children.is_empty();
    let blank = text.iter().all(|b| is_ws(*b));
    if has_children {
        if !blank {
            return Err(ParseError::Unsupported("gemischter Inhalt"));
        }
    } else if !text.is_empty() {
        doc.node_mut(id).text = Some(std::mem::take(text));
    }
    text.clear();
    Ok(())
}

fn parse_start_tag(inner: &[u8]) -> Result<Node, ParseError> {
    let mut i = 0;
    while i < inner.len() && !is_ws(inner[i]) {
        i += 1;
    }
    let mut node = Node { tag: inner[..i].to_vec(), ..Node::default() };
    loop {
        skip_ws(inner, &mut i);
        if i >= inner.len() {
            break;
        }
        let start = i;
        while i < inner.len() && inner[i] != b'=' && !is_ws(inner[i]) {
            i += 1;
        }
        let name = inner[start..i].to_vec();
        skip_ws(inner, &mut i);
        if inner.get(i) != Some(&b'=') {
            return Err(ParseError::Unsupported("Attribut ohne Wert"));
        }
        i += 1;
        skip_ws(inner, &mut i);
        let quote = *inner.get(i).ok_or(ParseError::Eof)?;
        if quote != b'"' && quote != b'\'' {
            return Err(ParseError::Unsupported("Attributwert ohne Anführungszeichen"));
        }
        i += 1;
        let vstart = i;
        while i < inner.len() && inner[i] != quote {
            i += 1;
        }
        if i >= inner.len() {
            return Err(ParseError::Eof);
        }
        node.attrs.push((name, inner[vstart..i].to_vec()));
        i += 1;
    }
    Ok(node)
}

fn skip_ws(b: &[u8], i: &mut usize) {
    while *i < b.len() && is_ws(b[*i]) {
        *i += 1;
    }
}

fn trim_ws(b: &[u8]) -> &[u8] {
    let s = b.iter().position(|c| !is_ws(*c)).unwrap_or(b.len());
    let e = b.iter().rposition(|c| !is_ws(*c)).map_or(s, |p| p + 1);
    &b[s..e]
}

fn find(b: &[u8], from: usize, pat: &[u8]) -> Option<usize> {
    b[from..].windows(pat.len()).position(|w| w == pat).map(|p| p + from)
}

/// Ende eines Start-Tags (`>`), Anführungszeichen in Attributen beachten.
fn find_tag_end(b: &[u8], from: usize) -> Option<usize> {
    let mut quote: Option<u8> = None;
    for (k, c) in b[from..].iter().enumerate() {
        match (quote, *c) {
            (Some(q), c) if c == q => quote = None,
            (None, b'"') | (None, b'\'') => quote = Some(*c),
            (None, b'>') => return Some(from + k),
            _ => {}
        }
    }
    None
}
