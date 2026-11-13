//! Eine `.aod`-Datei EINMAL lesen und alles daraus holen: Parse-Fehler, Prüfer-Funde, Verweise
//! (mit Zeile/Spalte). Reine Funktion auf Bytes, ohne Index und ohne Sperren.

use crate::model::{ProblemDto, RefEntry, Target};
use crate::text_pos::{line_col, parse_node_path, span_line_col};
use aod::references::{read_references, target_alias_name};
use aod::references::{ObjectId, ObjectKind};
use aod::tree::path::NodePath;
use aod::tree::value::PropertyValue as CoreValue;
use std::path::Path;
use validators::validator_table::{root_tag, VALIDATORS_BY_OBJECT_TYPE};

const BOM: [u8; 3] = [0xEF, 0xBB, 0xBF];

#[derive(Debug, Default)]
pub struct FileAnalysis {
    /// Parse and validator problems.
    pub problems: Vec<ProblemDto>,
    pub refs: Vec<RefEntry>,
    pub alias_target_name: Option<String>,
    pub root_tag: String,
    /// The file could be opened as a model.
    pub parsed: bool,
}

/// First well-formedness error (strict end-tag matching) with its line and column.
pub fn xml_error(bytes: &[u8]) -> Option<(String, u32, u32)> {
    let mut reader = quick_xml::Reader::from_reader(bytes);
    reader.config_mut().check_end_names = true;
    let mut buf = Vec::new();
    let mut depth: i64 = 0;
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(quick_xml::events::Event::Eof) => {
                if depth > 0 {
                    let (l, c) = line_col(bytes, bytes.len());
                    return Some((format!("unexpected end of file, {depth} element(s) are not closed"), l, c));
                }
                return None;
            }
            Ok(quick_xml::events::Event::Start(_)) => depth += 1,
            Ok(quick_xml::events::Event::End(_)) => depth -= 1,
            Ok(_) => {}
            Err(e) => {
                let (l, c) = line_col(bytes, reader.error_position().max(reader.buffer_position()) as usize);
                return Some((e.to_string(), l, c));
            }
        }
        buf.clear();
    }
}

/// Refuses files that are not an XML document with a root element (empty, binary, plain text,
/// cut off in the middle) with a message naming line and column, so opening them fails cleanly.
pub fn validate_aod_bytes(bytes: &[u8]) -> Result<(), String> {
    let body = bytes.strip_prefix(&BOM).unwrap_or(bytes);
    if body.iter().all(u8::is_ascii_whitespace) {
        return Err("the file is empty".to_string());
    }
    if let Some((message, line, col)) = xml_error(body) {
        return Err(format!("the file is not well-formed XML (line {line}, column {col}): {message}"));
    }
    let mut reader = quick_xml::Reader::from_reader(body);
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(quick_xml::events::Event::Start(_) | quick_xml::events::Event::Empty(_)) => break,
            Ok(quick_xml::events::Event::Eof) | Err(_) => return Err("the file has no root element, it is not an ADITO model file".to_string()),
            Ok(_) => {}
        }
        buf.clear();
    }
    Ok(())
}

pub fn problem(file: &Path, object: &str, object_type: &str, source: &str, severity: &str, message: String) -> ProblemDto {
    ProblemDto {
        node_id: file.to_string_lossy().into_owned(),
        object: object.to_string(),
        object_type: object_type.to_string(),
        source: source.to_string(),
        severity: severity.to_string(),
        message,
        path: None,
        line: None,
        column: None,
    }
}

/// Reads `bytes` of the object file `path` (type `object_type`, name `name`).
pub fn analyze_file(path: &Path, bytes: &[u8], object_type: &str, name: &str) -> FileAnalysis {
    let mut out = FileAnalysis::default();
    let body = bytes.strip_prefix(&BOM).unwrap_or(bytes);
    out.root_tag = root_tag(body);

    let strict = xml_error(body);
    if let Some((message, l, c)) = &strict {
        let mut p = problem(path, name, object_type, "parse", "Error", format!("Malformed XML: {message}"));
        p.line = Some(*l);
        p.column = Some(*c);
        out.problems.push(p);
    }
    let handle = match designer_core::open_project_bytes(path.to_path_buf(), bytes) {
        Ok(h) => h,
        Err(e) => {
            if strict.is_none() {
                out.problems.push(problem(path, name, object_type, "parse", "Error", e.to_string()));
            }
            return out;
        }
    };
    let Some(root) = handle.value_at(&NodePath::root()).cloned() else { return out };
    out.parsed = true;
    if object_type == "aliasDefinition" {
        out.alias_target_name = target_alias_name(&root);
    }

    if let Some((_, validate)) = VALIDATORS_BY_OBJECT_TYPE.iter().find(|(t, _)| *t == object_type) {
        for d in validate(&root) {
            let mut p = problem(path, name, object_type, "validator", &format!("{:?}", d.severity), d.message);
            if let Some(site) = d.path.as_deref() {
                p.path = Some(site.to_string());
                if let Some(span) = parse_node_path(site).ok().and_then(|np| handle.element_span(&np)) {
                    let (l, c) = span_line_col(body, span);
                    p.line = Some(l);
                    p.column = Some(c);
                }
            }
            out.problems.push(p);
        }
    }

    let wrapped = CoreValue::Object(vec![(out.root_tag.clone(), root)]);
    let from = ObjectId::new(ObjectKind::from_object_type(object_type), name);
    // Alias references are kept as the short name; the query resolves them.
    let keep_alias = |short: &str| Some(ObjectId::alias(short));
    for edge in read_references(&from, &wrapped, &keep_alias) {
        let target = match edge.to.kind {
            ObjectKind::Alias => Target::AliasShort(edge.to.name.clone()),
            ObjectKind::LinkedFile => Target::LinkedFile(edge.to.name.clone()),
            _ => Target::Object(edge.to.clone()),
        };
        let site = edge.site.to_string();
        let site_path = site.strip_prefix(&format!("{}.", out.root_tag)).unwrap_or(&site).to_string();
        let (mut line, mut column) = (None, None);
        if let Ok(np) = parse_node_path(&site_path) {
            if let Some(span) = handle.element_span(&np) {
                let (l, c) = span_line_col(body, span);
                line = Some(l);
                column = Some(c);
            }
        }
        out.refs.push(RefEntry { target, kind: edge.kind, site: site_path, line, column });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_broken_file_gives_a_parse_problem_with_its_line() {
        let text = "<?xml version=\"1.0\"?>\n<entity>\n  <name>B</name>\n  <title>x</wrong>\n</entity>\n";
        let a = analyze_file(Path::new("B.aod"), text.as_bytes(), "entity", "B");
        assert!(!a.parsed || a.problems.iter().any(|p| p.source == "parse"));
        let p = a.problems.iter().find(|p| p.source == "parse").unwrap();
        assert_eq!(p.line, Some(4));
    }

    #[test]
    fn references_carry_line_and_alias_stays_short() {
        let text = "<neonContext>\n  <name>A</name>\n  <entity>Used_entity</entity>\n</neonContext>\n";
        let a = analyze_file(Path::new("A.aod"), text.as_bytes(), "neonContext", "A");
        assert!(a.parsed);
        assert_eq!(a.refs.len(), 1);
        assert_eq!(a.refs[0].line, Some(3));
        assert_eq!(a.refs[0].site, "entity");
        assert_eq!(a.refs[0].target, Target::Object(ObjectId::entity("Used_entity")));
    }

    #[test]
    fn a_bom_does_not_shift_the_column() {
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice(b"<neonContext>\n  <name>A</name>\n  <entity>E</entity>\n</neonContext>\n");
        let a = analyze_file(Path::new("A.aod"), &bytes, "neonContext", "A");
        assert_eq!(a.refs[0].line, Some(3));
        assert_eq!(a.refs[0].column, Some(3));
    }

    #[test]
    fn validate_refuses_empty_and_cut_off_files() {
        assert!(validate_aod_bytes(b"   ").is_err());
        assert!(validate_aod_bytes(b"<a><b></a>").is_err());
        assert!(validate_aod_bytes(b"<a/>").is_ok());
    }
}
