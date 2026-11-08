//! Project-wide problem scan behind the Problems tab and the error badges: files that cannot be
//! parsed (with line), validator findings (with line where the element can be located) and
//! references to objects or linked files that do not exist. Strictly read-only; every object is
//! opened transiently and nothing stays in memory afterwards.

use crate::project_actor::{root_tag, VALIDATORS_BY_OBJECT_TYPE};
use crate::tree::OBJECT_FOLDERS;
use crate::wire::parse_node_path;
use core_model::path::NodePath;
use core_model::value::PropertyValue as CoreValue;
use refs::extract::extract_edges;
use refs::{ObjectId, ObjectKind};
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ProblemDto {
    /// The object file (also the tree node id).
    pub node_id: String,
    pub object: String,
    pub object_type: String,
    /// `parse`, `validator` or `reference`.
    pub source: String,
    pub severity: String,
    pub message: String,
    pub path: Option<String>,
    pub line: Option<u32>,
    pub column: Option<u32>,
}

fn line_col(bytes: &[u8], offset: usize) -> (u32, u32) {
    let upto = &bytes[..offset.min(bytes.len())];
    let line = upto.iter().filter(|&&b| b == b'\n').count() as u32 + 1;
    let col = upto.iter().rev().take_while(|&&b| b != b'\n').count() as u32 + 1;
    (line, col)
}

/// First well-formedness error (strict end-tag matching) with its line and column.
fn xml_error(bytes: &[u8]) -> Option<(String, u32, u32)> {
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
    let body = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
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

fn module_package_dirs(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let nm = root.join("node_modules");
    let Ok(entries) = std::fs::read_dir(&nm) else { return out };
    for e in entries.flatten() {
        let p = e.path();
        let name = e.file_name().to_string_lossy().into_owned();
        if name.starts_with('@') {
            if let Ok(inner) = std::fs::read_dir(&p) {
                out.extend(inner.flatten().map(|i| i.path()).filter(|i| i.is_dir()));
            }
        } else if p.is_dir() && !name.starts_with('.') {
            out.push(p);
        }
    }
    out
}

fn names_in(dir: &Path, into: &mut HashSet<String>) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for e in entries.flatten() {
            if e.path().is_dir() {
                into.insert(e.file_name().to_string_lossy().into_owned());
            }
        }
    }
}

/// Names of all existing objects of a type folder in the project and its installed modules.
fn existing_names(root: &Path, folder: &str) -> HashSet<String> {
    let mut names = HashSet::new();
    names_in(&root.join(folder), &mut names);
    for pkg in module_package_dirs(root) {
        names_in(&pkg.join(folder), &mut names);
    }
    names
}

fn dto(file: &Path, object: &str, object_type: &str, source: &str, severity: &str, message: String) -> ProblemDto {
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

pub fn scan_project(project_root: &Path) -> Vec<ProblemDto> {
    let entities = existing_names(project_root, "entity");
    let views = existing_names(project_root, "neonView");
    let webservices = existing_names(project_root, "entityWebservice");
    let mut out = Vec::new();

    for (folder, object_type) in OBJECT_FOLDERS {
        let Ok(entries) = std::fs::read_dir(project_root.join(folder)) else { continue };
        let mut dirs: Vec<_> = entries.flatten().filter(|e| e.path().is_dir()).collect();
        dirs.sort_by_key(|e| e.file_name());
        for entry in dirs {
            let name = entry.file_name().to_string_lossy().into_owned();
            let file = entry.path().join(format!("{name}.aod"));
            let Ok(bytes) = std::fs::read(&file) else { continue };
            let strict = xml_error(&bytes);
            if let Some((message, l, c)) = &strict {
                let mut p = dto(&file, &name, object_type, "parse", "Error", format!("Malformed XML: {message}"));
                p.line = Some(*l);
                p.column = Some(*c);
                out.push(p);
            }
            let handle = match forge_core::open_project(file.clone()) {
                Ok(h) => h,
                Err(e) => {
                    if strict.is_none() {
                        out.push(dto(&file, &name, object_type, "parse", "Error", e.to_string()));
                    }
                    continue;
                }
            };
            let Some(root) = handle.value_at(&NodePath::root()).cloned() else { continue };

            if let Some((_, validate)) = VALIDATORS_BY_OBJECT_TYPE.iter().find(|(t, _)| t == object_type) {
                for d in validate(&root) {
                    let mut p = dto(&file, &name, object_type, "validator", &format!("{:?}", d.severity), d.message);
                    if let Some(path) = d.path.as_deref() {
                        p.path = Some(path.to_string());
                        if let Some(span) = parse_node_path(path).ok().and_then(|np| handle.element_span(&np)) {
                            let skip = bytes[span.start..span.end.min(bytes.len())].iter().take_while(|b| b.is_ascii_whitespace()).count();
                            let (l, c) = line_col(&bytes, span.start + skip);
                            p.line = Some(l);
                            p.column = Some(c);
                        }
                    }
                    out.push(p);
                }
            }

            let tag = root_tag(&bytes);
            let wrapped = CoreValue::Object(vec![(tag, root)]);
            let from = ObjectId::new(ObjectKind::Entity, name.clone());
            for edge in extract_edges(&from, &wrapped, &|_| None) {
                let (exists, what) = match edge.to.kind {
                    ObjectKind::Entity => (entities.contains(&edge.to.name), "entity"),
                    ObjectKind::View => (views.contains(&edge.to.name), "view"),
                    ObjectKind::Webservice => (webservices.contains(&edge.to.name), "webservice"),
                    ObjectKind::LinkedFile => {
                        let rel = edge.to.name.strip_prefix("%aditoprj%/").unwrap_or(&edge.to.name);
                        (project_root.join(rel).is_file(), "linked file")
                    }
                    ObjectKind::Alias => continue,
                };
                if exists {
                    continue;
                }
                let site = edge.site.to_string();
                let site_path = site.strip_prefix(&format!("{}.", object_type_tag(&wrapped))).unwrap_or(&site).to_string();
                let mut p = dto(&file, &name, object_type, "reference", "Error", format!("Reference to {what} '{}' not found", edge.to.name));
                if let Some(np) = parse_node_path(&site_path).ok() {
                    if let Some(span) = handle.element_span(&np) {
                        let skip = bytes[span.start..span.end.min(bytes.len())].iter().take_while(|b| b.is_ascii_whitespace()).count();
                        let (l, c) = line_col(&bytes, span.start + skip);
                        p.line = Some(l);
                        p.column = Some(c);
                    }
                    p.path = Some(site_path);
                }
                out.push(p);
            }
        }
    }
    out
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct UsageDto {
    pub node_id: String,
    pub object: String,
    pub object_type: String,
    pub path: Option<String>,
    pub line: Option<u32>,
    pub column: Option<u32>,
    /// What the referencing element is, e.g. `ViewReference`.
    pub kind: String,
}

/// Every place in the project's own objects that points to `object_type`/`name` (Find Usages and
/// the check behind Safely Delete). Read-only; references from installed modules are not listed.
pub fn find_usages(project_root: &Path, object_type: &str, name: &str) -> Vec<UsageDto> {
    scan_usages(project_root, object_type, name).into_iter().map(|(u, _)| u).collect()
}

/// Byte range of the referencing element inside a file.
pub type UsageSpan = (PathBuf, usize, usize);

/// Like `find_usages`, plus the byte range of each referencing element (used by Rename).
pub fn scan_usages(project_root: &Path, object_type: &str, name: &str) -> Vec<(UsageDto, Option<UsageSpan>)> {
    let target = match object_type {
        "entity" => ObjectId::new(ObjectKind::Entity, name),
        "neonView" => ObjectId::new(ObjectKind::View, name),
        "entityWebservice" => ObjectId::new(ObjectKind::Webservice, name),
        _ => return Vec::new(),
    };
    let mut out = Vec::new();
    for (folder, own_type) in OBJECT_FOLDERS {
        let Ok(entries) = std::fs::read_dir(project_root.join(folder)) else { continue };
        let mut dirs: Vec<_> = entries.flatten().filter(|e| e.path().is_dir()).collect();
        dirs.sort_by_key(|e| e.file_name());
        for entry in dirs {
            let obj = entry.file_name().to_string_lossy().into_owned();
            let file = entry.path().join(format!("{obj}.aod"));
            let Ok(bytes) = std::fs::read(&file) else { continue };
            let Ok(handle) = forge_core::open_project(file.clone()) else { continue };
            let Some(root) = handle.value_at(&NodePath::root()).cloned() else { continue };
            let tag = root_tag(&bytes);
            let wrapped = CoreValue::Object(vec![(tag.clone(), root)]);
            let from = ObjectId::new(ObjectKind::Entity, obj.clone());
            for edge in extract_edges(&from, &wrapped, &|_| None) {
                if edge.to != target {
                    continue;
                }
                let site = edge.site.to_string();
                let site_path = site.strip_prefix(&format!("{tag}.")).unwrap_or(&site).to_string();
                let mut span_out = None;
                let mut u = UsageDto {
                    node_id: file.to_string_lossy().into_owned(),
                    object: obj.clone(),
                    object_type: own_type.to_string(),
                    path: None,
                    line: None,
                    column: None,
                    kind: format!("{:?}", edge.kind),
                };
                if let Ok(np) = parse_node_path(&site_path) {
                    if let Some(span) = handle.element_span(&np) {
                        let skip = bytes[span.start..span.end.min(bytes.len())].iter().take_while(|b| b.is_ascii_whitespace()).count();
                        let (l, c) = line_col(&bytes, span.start + skip);
                        u.line = Some(l);
                        u.column = Some(c);
                        span_out = Some((file.clone(), span.start, span.end.min(bytes.len())));
                    }
                    u.path = Some(site_path);
                }
                out.push((u, span_out));
            }
        }
    }
    out
}

fn object_type_tag(wrapped: &CoreValue) -> String {
    match wrapped {
        CoreValue::Object(fields) => fields.first().map(|(k, _)| k.clone()).unwrap_or_default(),
        _ => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

    fn temp_project() -> PathBuf {
        let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("forge-problems-{}-{n}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(root: &Path, folder: &str, name: &str, text: &str) {
        let dir = root.join(folder).join(name);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(format!("{name}.aod")), text).unwrap();
    }

    #[test]
    fn a_broken_file_is_reported_with_its_line() {
        let root = temp_project();
        write(&root, "entity", "Broken_entity", "<?xml version=\"1.0\"?>\n<entity>\n  <name>Broken_entity</name>\n  <title>x</wrong>\n</entity>\n");
        let problems = scan_project(&root);
        let p = problems.iter().find(|p| p.source == "parse").expect("parse problem");
        assert_eq!(p.object, "Broken_entity");
        assert_eq!(p.severity, "Error");
        assert_eq!(p.line, Some(4), "{p:?}");
    }

    #[test]
    fn a_context_pointing_to_a_missing_entity_is_a_reference_error() {
        let root = temp_project();
        write(&root, "neonContext", "Lost", "<neonContext>\n  <name>Lost</name>\n  <entity>Missing_entity</entity>\n</neonContext>\n");
        let problems = scan_project(&root);
        let p = problems.iter().find(|p| p.source == "reference").expect("reference problem");
        assert!(p.message.contains("Missing_entity"));
        assert_eq!(p.line, Some(3), "{p:?}");

        write(&root, "entity", "Missing_entity", "<entity>\n  <name>Missing_entity</name>\n</entity>\n");
        assert!(scan_project(&root).iter().all(|p| p.source != "reference"));
    }

    #[test]
    fn a_reference_into_an_installed_module_is_not_dangling() {
        let root = temp_project();
        write(&root, "neonContext", "Uses", "<neonContext>\n  <name>Uses</name>\n  <entity>FromModule_entity</entity>\n</neonContext>\n");
        write(&root.join("node_modules").join("@scope").join("mod"), "entity", "FromModule_entity", "<entity><name>FromModule_entity</name></entity>");
        assert!(scan_project(&root).iter().all(|p| p.source != "reference"));
    }

    #[test]
    fn usages_of_an_entity_list_the_referencing_contexts_with_their_line() {
        let root = temp_project();
        write(&root, "entity", "Used_entity", "<entity>
  <name>Used_entity</name>
</entity>
");
        write(&root, "neonContext", "A", "<neonContext>
  <name>A</name>
  <entity>Used_entity</entity>
</neonContext>
");
        write(&root, "neonContext", "B", "<neonContext>
  <name>B</name>
  <entity>Other_entity</entity>
</neonContext>
");
        let usages = find_usages(&root, "entity", "Used_entity");
        assert_eq!(usages.len(), 1, "{usages:?}");
        assert_eq!(usages[0].object, "A");
        assert_eq!(usages[0].line, Some(3));
        assert!(find_usages(&root, "language", "x").is_empty());
    }

    #[test]
    fn the_demo_project_scans_without_parse_errors() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/DemoProject");
        let problems = scan_project(&root);
        assert!(problems.iter().all(|p| p.source != "parse"), "{problems:?}");
    }
}
