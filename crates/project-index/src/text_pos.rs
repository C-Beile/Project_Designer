//! Zeile/Spalte aus Byte-Positionen und der Pfad-Text der Oberfläche (`a.b[2].c`).

use aod::tree::path::NodePath;
use aod::tree::ByteRange;

/// Line and column (both 1-based) of a byte offset.
pub fn line_col(bytes: &[u8], offset: usize) -> (u32, u32) {
    let upto = &bytes[..offset.min(bytes.len())];
    let line = upto.iter().filter(|&&b| b == b'\n').count() as u32 + 1;
    let col = upto.iter().rev().take_while(|&&b| b != b'\n').count() as u32 + 1;
    (line, col)
}

/// Line and column of the first non-blank character of an element's byte range.
pub fn span_line_col(bytes: &[u8], span: ByteRange) -> (u32, u32) {
    let end = span.end.min(bytes.len());
    let start = span.start.min(end);
    let skip = bytes[start..end].iter().take_while(|b| b.is_ascii_whitespace()).count();
    line_col(bytes, span.start + skip)
}

/// Parses the dotted/indexed path notation `NodePath`'s own `Display` impl produces
/// (`"entityFields.entityField[2].valueProcess"`, root is `"$"` or `""`) back into a real
/// `NodePath`. This is the exact inverse of `path.rs`'s `Display` impl, kept out of `aod::tree`
/// since it is purely an IPC-string-format concern.
pub fn parse_node_path(raw: &str) -> Result<NodePath, String> {
    if raw.is_empty() || raw == "$" {
        return Ok(NodePath::root());
    }

    let chars: Vec<char> = raw.chars().collect();
    let mut i = 0usize;
    let mut path = NodePath::root();

    while i < chars.len() {
        if chars[i] == '.' {
            i += 1;
            continue;
        }
        if chars[i] == '[' {
            let start = i + 1;
            let mut j = start;
            while j < chars.len() && chars[j] != ']' {
                j += 1;
            }
            if j >= chars.len() {
                return Err(format!("unterminated '[' in node path '{raw}'"));
            }
            let digits: String = chars[start..j].iter().collect();
            let idx: usize = digits.parse().map_err(|_| format!("non-numeric index '[{digits}]' in node path '{raw}'"))?;
            path = path.index(idx);
            i = j + 1;
            continue;
        }
        let start = i;
        let mut j = i;
        while j < chars.len() && chars[j] != '.' && chars[j] != '[' {
            j += 1;
        }
        let field: String = chars[start..j].iter().collect();
        if field.is_empty() {
            return Err(format!("empty field segment in node path '{raw}'"));
        }
        path = path.field(field);
        i = j;
    }

    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn line_and_column_are_one_based() {
        let text = b"ab\ncd\n  x";
        assert_eq!(line_col(text, 0), (1, 1));
        assert_eq!(line_col(text, 4), (2, 2));
        assert_eq!(span_line_col(text, ByteRange { start: 5, end: 9 }), (3, 3), "leading blanks are skipped");
    }

    #[test]
    fn node_path_round_trips() {
        let original = NodePath::root().field("entityFields").field("entityField").index(2).field("valueProcess");
        assert_eq!(parse_node_path(&original.to_string()).unwrap(), original);
        assert_eq!(parse_node_path("$").unwrap(), NodePath::root());
    }
}
