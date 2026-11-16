// V2-Format (COMPACT, LF). Belegte Regeln aus dem Orakel (`dist_TranspilerV2`), Plan Abschnitt 3.
// Der Writer selbst kommt in Phase P1. Hier stehen nur die gesicherten Konstanten.

/// Einfachste V2-Umformung eines Modells ohne Skripte und Modifikationen: LF statt CRLF, COMPACT statt DISTRIBUTED.
/// Belegt am Orakel (Hermes): rund 1700 von 3000 Modellen sind danach byte-gleich. V2 normalisiert Modelle also nicht neu.
pub fn to_v2_bytes(source: &[u8]) -> Vec<u8> {
    // V2 schreibt kein BOM (Orakel: 12 Modelle mit BOM in der Quelle, keines in der Ausgabe).
    let source = source.strip_prefix(&[0xEF, 0xBB, 0xBF][..]).unwrap_or(source);
    let mut out = Vec::with_capacity(source.len());
    let mut i = 0;
    while i < source.len() {
        if source[i] == b'\r' && source.get(i + 1) == Some(&b'\n') {
            i += 1;
            continue;
        }
        out.push(source[i]);
        i += 1;
    }
    const FROM: &[u8] = b"<majorModelMode>DISTRIBUTED</majorModelMode>";
    const TO: &[u8] = b"<majorModelMode>COMPACT</majorModelMode>";
    if let Some(pos) = out.windows(FROM.len()).position(|w| w == FROM) {
        out.splice(pos..pos + FROM.len(), TO.iter().copied());
    }
    out
}

pub const XML_HEADER: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>";
pub const MAJOR_MODEL_MODE: &str = "COMPACT";
pub const LINE_END: &str = "\n";
pub const INDENT: &str = "  ";
/// Leeres Element: `<name />` (mit Leerzeichen), nie `<name></name>`.
pub const EMPTY_ELEMENT_SUFFIX: &str = " />";

/// Setzt die Dateien ein, auf die ein Modell mit `%aditoprj%/<pfad>` verweist (V2 = COMPACT).
/// `read` liefert die Bytes zu einem Pfad ab Modulwurzel oder `None` (Verweis ungültig: das Element bleibt leer, V2 meldet es).
/// Der Inhalt wird mit LF eingesetzt und für XML maskiert (`&`, `<`, `>`).
/// Nicht aufgelöste Verweise werden in `unresolved` gesammelt.
pub fn inline_linked(model: &[u8], read: &dyn Fn(&str) -> Option<Vec<u8>>, unresolved: &mut Vec<String>) -> Vec<u8> {
    const MARK: &[u8] = b"%aditoprj%/";
    let mut out = Vec::with_capacity(model.len());
    let mut i = 0;
    while i < model.len() {
        // Ein Verweis steht direkt nach `>` und reicht bis zum nächsten `<`.
        if model[i] == b'>' && model[i + 1..].starts_with(MARK) {
            let start = i + 1 + MARK.len();
            let Some(len) = model[start..].iter().position(|b| *b == b'<') else { break };
            let path = String::from_utf8_lossy(&model[start..start + len]).into_owned();
            out.push(b'>');
            match read(&path) {
                Some(content) if is_binary_element(element_name(&model[..i])) => {
                    use base64::Engine;
                    out.extend_from_slice(base64::engine::general_purpose::STANDARD.encode(&content).as_bytes());
                }
                Some(content) => escape_into(&strip_exports(&strip_cr(&content)), &mut out),
                None => unresolved.push(path),
            }
            i = start + len;
            continue;
        }
        out.push(model[i]);
        i += 1;
    }
    out
}

/// Elemente, deren verknüpfte Datei als Base64 eingesetzt wird (Orakel: `icon`, `iconInactive`, `imageData`, `reportData`).
const BINARY_ELEMENTS: &[&[u8]] = &[b"icon", b"iconInactive", b"imageData", b"reportData"];

fn is_binary_element(name: &[u8]) -> bool {
    BINARY_ELEMENTS.contains(&name)
}

/// Name des Elements, dessen Start-Tag direkt vor `before` endet (`...<name attr`). Leer, wenn nicht gefunden.
fn element_name(before: &[u8]) -> &[u8] {
    let Some(lt) = before.iter().rposition(|b| *b == b'<') else { return b"" };
    let tag = &before[lt + 1..];
    let end = tag.iter().position(|b| *b == b' ').unwrap_or(tag.len());
    &tag[..end]
}

/// V2 entfernt `export ` am Zeilenanfang (`export function f()` wird `function f()`).
/// Gilt für jeden eingesetzten Text, also auch Dokumentation. Zeilen, die damit beginnen, kommen dort kaum vor.
fn strip_exports(text: &[u8]) -> Vec<u8> {
    const EXPORT: &[u8] = b"export ";
    let mut out = Vec::with_capacity(text.len());
    // Am Zeilenanfang, auch hinter `//` (Orakel: `//export function f` wird `//function f`).
    let mut at_start = true;
    let mut i = 0;
    while i < text.len() {
        if at_start && text[i..].starts_with(EXPORT) {
            i += EXPORT.len();
            at_start = false;
            continue;
        }
        at_start = text[i] == 0x0A || (text[i] == b'/' && out.ends_with(b"/") && (out.len() == 1 || out[out.len() - 2] == 0x0A));
        out.push(text[i]);
        i += 1;
    }
    out
}

/// V2 liest Dateien, die kein UTF-8 sind, als Latin-1 und schreibt UTF-8 (Orakel: Byte 0xF3 wird `ó`).
fn to_utf8(bytes: Vec<u8>) -> Vec<u8> {
    match String::from_utf8(bytes) {
        Ok(s) => s.into_bytes(),
        Err(e) => e.into_bytes().iter().map(|b| *b as char).collect::<String>().into_bytes(),
    }
}

fn strip_cr(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\r' && bytes.get(i + 1) == Some(&b'\n') {
            i += 1;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    out
}

fn escape_into(text: &[u8], out: &mut Vec<u8>) {
    for &b in text {
        match b {
            b'&' => out.extend_from_slice(b"&amp;"),
            b'<' => out.extend_from_slice(b"&lt;"),
            b'>' => out.extend_from_slice(b"&gt;"),
            _ => out.push(b),
        }
    }
}

/// `<x></x>` wird `<x />`. Nur wenn nichts dazwischen steht.
pub fn compact_empty_elements(xml: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(xml.len());
    let mut i = 0;
    while i < xml.len() {
        // `<name ...></name>` erkennen: öffnendes Tag direkt gefolgt vom passenden schließenden.
        if xml[i] == b'<' && xml.get(i + 1).is_some_and(|c| c.is_ascii_alphabetic()) {
            if let Some(gt) = xml[i..].iter().position(|b| *b == b'>') {
                let tag = &xml[i + 1..i + gt];
                if !tag.ends_with(b"/") {
                    let name_end = tag.iter().position(|b| *b == b' ').unwrap_or(tag.len());
                    let name = &tag[..name_end];
                    let close_start = i + gt + 1;
                    let close_len = name.len() + 3;
                    if xml.len() >= close_start + close_len
                        && &xml[close_start..close_start + 2] == b"</"
                        && &xml[close_start + 2..close_start + 2 + name.len()] == name
                        && xml[close_start + 2 + name.len()] == b'>'
                    {
                        out.push(b'<');
                        out.extend_from_slice(tag);
                        out.extend_from_slice(b" />");
                        i = close_start + close_len;
                        continue;
                    }
                }
            }
        }
        out.push(xml[i]);
        i += 1;
    }
    out
}

/// V2-Umformung auf dem Baum: Verweise einsetzen, CR entfernen, COMPACT setzen. Das Schreiben macht `model::write::write_v2`.
/// Gleiche Regeln wie `inline_linked` und `to_v2_bytes`, aber auf Knoten statt auf Bytes.
pub fn convert_tree(doc: &mut crate::model::Document, read: &dyn Fn(&str) -> Option<Vec<u8>>, unresolved: &mut Vec<String>) {
    const MARK: &[u8] = b"%aditoprj%/";
    for id in 0..doc.len() as crate::model::NodeId {
        let node = doc.node(id);
        let Some(text) = node.text.as_ref() else { continue };
        let new_text = if let Some(path) = text.strip_prefix(MARK) {
            let path = String::from_utf8_lossy(path).into_owned();
            match read(&path) {
                Some(content) if is_binary_element(&node.tag) => {
                    use base64::Engine;
                    Some(base64::engine::general_purpose::STANDARD.encode(&content).into_bytes())
                }
                Some(content) => {
                    let mut out = Vec::new();
                    escape_into(&strip_exports(&strip_cr(&to_utf8(content))), &mut out);
                    Some(out)
                }
                None => {
                    unresolved.push(path);
                    None
                }
            }
        } else if text.contains(&0x0Du8) {
            Some(strip_cr(text))
        } else {
            continue;
        };
        let linked_missing = new_text.is_none();
        let node = doc.node_mut(id);
        node.text = new_text.filter(|t| !t.is_empty());
        let _ = linked_missing;
    }
    if let Some(mode) = doc.child_by_tag(doc.root, b"majorModelMode") {
        if doc.node(mode).text.as_deref() == Some(b"DISTRIBUTED") {
            doc.node_mut(mode).text = Some(MAJOR_MODEL_MODE.as_bytes().to_vec());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inline(model: &str, files: &[(&str, &[u8])]) -> (String, Vec<String>) {
        let read = |p: &str| files.iter().find(|(n, _)| *n == p).map(|(_, b)| b.to_vec());
        let mut unresolved = Vec::new();
        let out = inline_linked(model.as_bytes(), &read, &mut unresolved);
        (String::from_utf8(out).unwrap(), unresolved)
    }

    #[test]
    fn crlf_and_mode_and_bom() {
        let src = b"\xEF\xBB\xBF<a>\r\n<majorModelMode>DISTRIBUTED</majorModelMode>\r\n</a>\r\n";
        assert_eq!(to_v2_bytes(src), b"<a>\n<majorModelMode>COMPACT</majorModelMode>\n</a>\n");
    }

    #[test]
    fn link_is_inlined_escaped_and_without_cr() {
        let (out, missing) = inline("<p>%aditoprj%/x/a.js</p>", &[("x/a.js", b"if (a < b && c > d)\r\nexport function f() {}")]);
        assert_eq!(out, "<p>if (a &lt; b &amp;&amp; c &gt; d)\nfunction f() {}</p>");
        assert!(missing.is_empty());
    }

    #[test]
    fn export_only_at_line_start() {
        let (out, _) = inline("<p>%aditoprj%/a.js</p>", &[("a.js", b"export function f()\nvar x = 'export y';\nexport const c = 1;")]);
        assert_eq!(out, "<p>function f()\nvar x = 'export y';\nconst c = 1;</p>");
    }

    #[test]
    fn unresolved_link_is_removed_and_reported() {
        let (out, missing) = inline("<p>%aditoprj%/gone.js</p>", &[]);
        assert_eq!(out, "<p></p>");
        assert_eq!(missing, ["gone.js"]);
    }

    #[test]
    fn binary_elements_become_base64() {
        let (out, _) = inline("<icon>%aditoprj%/i.png</icon>", &[("i.png", &[0x89, b'P', b'N', b'G'])]);
        assert_eq!(out, "<icon>iVBORw==</icon>");
    }

    #[test]
    fn empty_elements_are_compacted() {
        let out = compact_empty_elements(b"<a><title></title><b x=\"1\"></b><c>t</c><d /></a>");
        assert_eq!(String::from_utf8(out).unwrap(), "<a><title /><b x=\"1\" /><c>t</c><d /></a>");
    }
}
