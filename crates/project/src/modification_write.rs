//! Writes ADITO modifications (`<project>/modification/<id>/<id>.aod`) for objects that live in an
//! installed module under `node_modules` - the Forge counterpart of "edit a module object in the
//! Designer". Merger rule (transpiler): the project root wins over the module.
//!
//! Git-friendly by construction:
//! - one modification file per changed property (same granularity as the corpus: one MODIFY per
//!   scalar leaf, one INSERT per added element, one DELETE per removed element); never a copy of
//!   the whole object;
//! - the directory name is derived deterministically from model, path and change type, so the same
//!   logical change always lands in the same file and re-editing it only touches the value bytes;
//! - an existing modification is patched byte-faithfully (aod::document events), `<position>` and every
//!   unchanged line stay as they are;
//! - a change back to the original value does not write anything: the now redundant modification is
//!   reported as `RemovalSuggested` and only deleted by `discard` after the user confirmed.
//!
//! Module objects themselves are never touched. Name pattern `<model[..11]>-<leaf[..11]>-<8 hex>-<2 hex>`
//! and the envelope are taken from the real corpus; the hash part is Forge's own (deterministic)
//! choice - the Designer uses random ids, so the pattern is imitated, not reproduced.

use aod::document::{build_index, AodEvent, EventPath, IndexedRange, PathStep};
use aod::tree::path::{NodePath, PathSegment};
use aod::tree::value::{PropertyValue as CoreValue, ScalarValue};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

const ENVELOPE_HEAD: &str = "<modification xmlns=\"http://www.adito.de/2018/ao/Model\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" VERSION=\"1.2.0\" xsi:schemaLocation=\"http://www.adito.de/2018/ao/Model adito://models/xsd/modification/1.2.0\">";

/// New value of a scalar property.
#[derive(Debug, Clone, PartialEq)]
pub enum ModValue {
    Text(String),
    Bool(bool),
    Int(i64),
    /// Linked script: the content is stored next to the modification, the model points to it.
    Script { file_name: String, content: String },
}

impl ModValue {
    fn compare_text(&self) -> String {
        match self {
            ModValue::Text(t) => t.clone(),
            ModValue::Bool(b) => b.to_string(),
            ModValue::Int(i) => i.to_string(),
            ModValue::Script { content, .. } => content.clone(),
        }
    }
    fn wrapper(&self) -> &'static str {
        match self {
            ModValue::Text(_) | ModValue::Script { .. } => "stringValueWrapper",
            ModValue::Bool(_) => "booleanValueWrapper",
            ModValue::Int(_) => "intValueWrapper",
        }
    }
}

/// The module object a modification belongs to.
#[derive(Debug, Clone)]
pub struct ObjectRef {
    pub project_root: PathBuf,
    pub model_type: String,
    pub model_name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    Created,
    Updated,
    Unchanged,
    /// The change equals the original again; the modification is redundant. Nothing was deleted.
    RemovalSuggested,
    /// The project's modification was deleted (Set to Default).
    Removed,
}

#[derive(Debug, Clone, Serialize)]
pub struct Outcome {
    pub action: Action,
    /// Directory name below `<project>/modification/`, if a modification is involved.
    pub dir: Option<String>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Change {
    Modify,
    Insert,
    Delete,
}

impl Change {
    fn as_str(self) -> &'static str {
        match self {
            Change::Modify => "MODIFY",
            Change::Insert => "INSERT",
            Change::Delete => "DELETE",
        }
    }
}

/// Maps a sheet position (`entityFields[3]` + property name) to the modification path segments
/// (`entityFields`, `<item name>`, property). Array items are addressed by their `<name>`.
pub fn modification_path(root: &CoreValue, parent: &NodePath, property: &str) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    let mut current = root;
    for seg in parent.segments() {
        match seg {
            PathSegment::Field(name) => {
                let CoreValue::Object(fields) = current else { return Err(format!("'{name}' is not below an object")) };
                current = fields.iter().find(|(k, _)| k == name).map(|(_, v)| v).ok_or_else(|| format!("'{name}' not found"))?;
                // A repeated tag (`entityField`) is not part of the path: its items are addressed by name.
                if !matches!(current, CoreValue::Array(_)) {
                    out.push(name.clone());
                }
            }
            PathSegment::Index(i) => {
                let CoreValue::Array(items) = current else { return Err("index on a non-list".into()) };
                current = items.get(*i).ok_or_else(|| format!("list item {i} not found"))?;
                let CoreValue::Object(fields) = current else { return Err("list item is not an object".into()) };
                let name = fields
                    .iter()
                    .find(|(k, _)| k == "name")
                    .and_then(|(_, v)| v.as_scalar())
                    .map(|s| match s {
                        ScalarValue::Text(t) => t.clone(),
                        ScalarValue::Bool(b) => b.to_string(),
                        ScalarValue::Int(i) => i.to_string(),
                    })
                    .ok_or_else(|| "list item has no name, cannot address it in a modification".to_string())?;
                out.push(name);
            }
        }
    }
    out.push(property.to_string());
    Ok(out)
}

/// MODIFY of one scalar property. `original` is the value of the module object as stored (None if
/// the module does not carry the property); `existing_script_original` semantics: for scripts the
/// original is the content of the module's script.
pub fn modify(obj: &ObjectRef, path: &[String], new: ModValue, original: Option<&str>) -> Result<Outcome, String> {
    guard(obj)?;
    let full = full_path(obj, path);
    let existing = find_existing(obj, Change::Modify, &full, None);
    if original == Some(new.compare_text().as_str()) {
        return Ok(match existing {
            Some(dir) => Outcome { action: Action::RemovalSuggested, dir: Some(dir) },
            None => Outcome { action: Action::Unchanged, dir: None },
        });
    }
    let leaf = path.last().cloned().unwrap_or_default();
    let eol = line_ending(&obj.project_root);
    match existing {
        Some(dir) => {
            let file = mod_file(&obj.project_root, &dir);
            let bytes = fs::read(&file).map_err(|e| e.to_string())?;
            let mut value = new.clone();
            if let ModValue::Script { content, .. } = &new {
                let current_ref = read_value_text(&bytes).unwrap_or_default();
                let name = current_ref.rsplit('/').next().filter(|n| !n.is_empty()).unwrap_or("script.js").to_string();
                value = ModValue::Script { file_name: name, content: content.clone() };
            }
            let updated = patch_value(&bytes, &value, &dir)?;
            let mut changed = false;
            if let ModValue::Script { file_name, content } = &value {
                changed |= write_if_different(&obj.project_root.join("modification").join(&dir).join(file_name), content.as_bytes())?;
            }
            if updated != bytes {
                write_atomic(&file, &updated)?;
                changed = true;
            }
            Ok(Outcome { action: if changed { Action::Updated } else { Action::Unchanged }, dir: Some(dir) })
        }
        None => {
            let dir = dir_name(&obj.model_name, &leaf, &[&obj.model_type, &obj.model_name, &full, "MODIFY"]);
            let value_block = match &new {
                ModValue::Script { file_name, .. } => value_xml(&new, &format!("%aditoprj%/modification/{dir}/{file_name}")),
                other => value_xml(other, ""),
            };
            let text = envelope(Change::Modify, &dir, now_secs(), obj, &full, Some(&value_block));
            let bytes = with_eol(&text, eol);
            write_new(&obj.project_root, &dir, &bytes)?;
            if let ModValue::Script { file_name, content } = &new {
                write_atomic(&obj.project_root.join("modification").join(&dir).join(file_name), content.as_bytes())?;
            }
            Ok(Outcome { action: Action::Created, dir: Some(dir) })
        }
    }
}

/// INSERT of a new element into the collection at `container`. `element_xml` is the element as
/// plain XML with LF line breaks and 2-space nesting starting at depth 0; it is re-indented to the
/// depth the envelope uses. Inserting the same element (same container and `<name>`) again replaces
/// its payload instead of adding a second modification.
pub fn insert(obj: &ObjectRef, container: &[String], element_name: &str, element_xml: &str) -> Result<Outcome, String> {
    guard(obj)?;
    let full = full_path(obj, container);
    let eol = line_ending(&obj.project_root);
    let block = insert_value_xml(element_xml);
    let existing = find_existing(obj, Change::Insert, &full, Some(element_name));
    match existing {
        Some(dir) => {
            let file = mod_file(&obj.project_root, &dir);
            let old = fs::read_to_string(&file).map_err(|e| e.to_string())?;
            let position = read_position(&old).unwrap_or_else(now_secs);
            let text = envelope(Change::Insert, &dir, position, obj, &full, Some(&block));
            let bytes = with_eol(&text, eol);
            if bytes == old.as_bytes() {
                return Ok(Outcome { action: Action::Unchanged, dir: Some(dir) });
            }
            write_atomic(&file, &bytes)?;
            Ok(Outcome { action: Action::Updated, dir: Some(dir) })
        }
        None => {
            let dir = dir_name(&obj.model_name, container.last().map(String::as_str).unwrap_or(""), &[&obj.model_type, &obj.model_name, &full, "INSERT", element_name]);
            let text = envelope(Change::Insert, &dir, now_secs(), obj, &full, Some(&block));
            write_new(&obj.project_root, &dir, &with_eol(&text, eol))?;
            Ok(Outcome { action: Action::Created, dir: Some(dir) })
        }
    }
}

/// DELETE of the element at `path`. If the project itself inserted that element, the INSERT is
/// reported as redundant instead (`RemovalSuggested`), because inserting and deleting cancel out.
pub fn delete(obj: &ObjectRef, path: &[String]) -> Result<Outcome, String> {
    guard(obj)?;
    if path.len() >= 2 {
        let container = full_path(obj, &path[..path.len() - 1]);
        if let Some(dir) = find_existing(obj, Change::Insert, &container, Some(&path[path.len() - 1])) {
            return Ok(Outcome { action: Action::RemovalSuggested, dir: Some(dir) });
        }
    }
    let full = full_path(obj, path);
    if let Some(dir) = find_existing(obj, Change::Delete, &full, None) {
        return Ok(Outcome { action: Action::Unchanged, dir: Some(dir) });
    }
    let leaf = path.last().cloned().unwrap_or_default();
    let dir = dir_name(&obj.model_name, &leaf, &[&obj.model_type, &obj.model_name, &full, "DELETE"]);
    let text = envelope(Change::Delete, &dir, now_secs(), obj, &full, None);
    write_new(&obj.project_root, &dir, &with_eol(&text, line_ending(&obj.project_root)))?;
    Ok(Outcome { action: Action::Created, dir: Some(dir) })
}

/// Deletes one modification directory of the project. Only called after the user confirmed.
pub fn discard(project_root: &Path, dir: &str) -> Result<(), String> {
    if dir.is_empty() || dir.contains(['/', '\\']) || dir == "." || dir == ".." {
        return Err("invalid modification name".into());
    }
    app_base::fs_guard::ensure_writable(project_root)?;
    let target = project_root.join("modification").join(dir);
    if !mod_file(project_root, dir).is_file() {
        return Err(format!("modification '{dir}' not found"));
    }
    fs::remove_dir_all(&target).map_err(|e| e.to_string())
}

/// Directory of the project's MODIFY of the property at `path`, if there is one.
pub fn find_modify(obj: &ObjectRef, path: &[String]) -> Option<String> {
    find_existing(obj, Change::Modify, &full_path(obj, path), None)
}

/// Directory of the project's INSERT of element `name` into `container`, if there is one.
pub fn find_insert(obj: &ObjectRef, container: &[String], name: &str) -> Option<String> {
    find_existing(obj, Change::Insert, &full_path(obj, container), Some(name))
}
fn guard(obj: &ObjectRef) -> Result<(), String> {
    app_base::fs_guard::ensure_writable(&obj.project_root)?;
    if obj.model_type.is_empty() || obj.model_name.is_empty() {
        return Err("model type/name of the object are unknown".into());
    }
    Ok(())
}

fn full_path(obj: &ObjectRef, segments: &[String]) -> String {
    let mut p = obj.model_name.clone();
    for s in segments {
        p.push('/');
        p.push_str(s);
    }
    p
}

fn mod_file(project_root: &Path, dir: &str) -> PathBuf {
    project_root.join("modification").join(dir).join(format!("{dir}.aod"))
}

fn sanitize(s: &str, max: usize) -> String {
    s.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_').take(max).collect()
}

fn dir_name(model_name: &str, leaf: &str, key: &[&str]) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for part in key {
        for b in part.bytes().chain(std::iter::once(0u8)) {
            h ^= b as u64;
            h = h.wrapping_mul(0x100000001b3);
        }
    }
    format!("{}-{}-{:08x}-{:02x}", sanitize(model_name, 11), sanitize(leaf, 11), (h >> 8) as u32, (h & 0xff) as u8)
}

fn now_secs() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// CRLF unless the project's existing modifications consistently use LF.
fn line_ending(project_root: &Path) -> &'static str {
    let Ok(entries) = fs::read_dir(project_root.join("modification")) else { return "\r\n" };
    for e in entries.flatten() {
        let dir = e.file_name().to_string_lossy().into_owned();
        if let Ok(b) = fs::read(mod_file(project_root, &dir)) {
            return if b.contains(&b'\r') { "\r\n" } else { "\n" };
        }
    }
    "\r\n"
}

fn with_eol(text: &str, eol: &str) -> Vec<u8> {
    let mut s = text.replace("\r\n", "\n");
    if eol == "\r\n" {
        s = s.replace('\n', "\r\n");
    }
    s.into_bytes()
}

fn enc(raw: &str) -> String {
    aod::tree::codec::encode_text(raw)
}

fn value_xml(v: &ModValue, script_ref: &str) -> String {
    let inner = match v {
        ModValue::Text(t) => format!("<value>{}</value>", enc(t)),
        ModValue::Bool(b) => format!("<value v=\"{b}\" />"),
        ModValue::Int(i) => format!("<value v=\"{i}\" />"),
        ModValue::Script { .. } => format!("<value>{}</value>", enc(script_ref)),
    };
    let w = v.wrapper();
    format!("  <value>\n    <{w}>\n      <name>value</name>\n      {inner}\n    </{w}>\n  </value>\n")
}

fn insert_value_xml(element_xml: &str) -> String {
    let body: String = element_xml
        .replace("\r\n", "\n")
        .trim_matches('\n')
        .lines()
        .map(|l| format!("{}{}\n", " ".repeat(8), l))
        .collect();
    format!("  <value>\n    <modelValueWrapper>\n      <name>value</name>\n      <value>\n{body}      </value>\n    </modelValueWrapper>\n  </value>\n")
}

fn envelope(change: Change, name: &str, position: i64, obj: &ObjectRef, path: &str, value: Option<&str>) -> String {
    let mut s = String::new();
    s.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    s.push_str(ENVELOPE_HEAD);
    s.push('\n');
    s.push_str(&format!("  <name>{}</name>\n", enc(name)));
    s.push_str("  <majorModelMode>DISTRIBUTED</majorModelMode>\n");
    s.push_str(&format!("  <changeType>{}</changeType>\n", change.as_str()));
    s.push_str(&format!("  <position v=\"{position}\" />\n"));
    s.push_str(&format!("  <modelType>{}</modelType>\n", enc(&obj.model_type)));
    s.push_str(&format!("  <modelName>{}</modelName>\n", enc(&obj.model_name)));
    s.push_str(&format!("  <path>{}</path>\n", enc(path)));
    if let Some(v) = value {
        s.push_str(v);
    }
    s.push_str("</modification>\n");
    s
}

fn tag_text(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let i = xml.find(&open)? + open.len();
    let j = xml[i..].find(&format!("</{tag}>"))? + i;
    Some(xml[i..j].to_string())
}

fn read_position(xml: &str) -> Option<i64> {
    let i = xml.find("<position v=\"")? + 13;
    xml[i..xml[i..].find('"')? + i].parse().ok()
}

/// Looks for a modification of the project with the same change type, model and path (and, for an
/// INSERT, the same inserted element name).
fn find_existing(obj: &ObjectRef, change: Change, full_path: &str, element_name: Option<&str>) -> Option<String> {
    let mut dirs: Vec<String> = fs::read_dir(obj.project_root.join("modification")).ok()?.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    dirs.sort();
    for dir in dirs {
        let Ok(xml) = fs::read_to_string(mod_file(&obj.project_root, &dir)) else { continue };
        let same = tag_text(&xml, "changeType").as_deref() == Some(change.as_str())
            && tag_text(&xml, "modelType").as_deref() == Some(obj.model_type.as_str())
            && tag_text(&xml, "modelName").as_deref() == Some(obj.model_name.as_str())
            && tag_text(&xml, "path").map(|p| p == enc(full_path)).unwrap_or(false);
        if !same {
            continue;
        }
        if let Some(name) = element_name {
            let payload_name = xml.find("<modelValueWrapper>").and_then(|i| {
                let rest = &xml[i..];
                let rest = &rest[rest.find("<value>")? + 7..];
                tag_text(rest, "name")
            });
            if payload_name.as_deref() != Some(name) {
                continue;
            }
        }
        return Some(dir);
    }
    None
}

fn read_value_text(bytes: &[u8]) -> Option<String> {
    let xml = String::from_utf8_lossy(bytes);
    let i = xml.find("<name>value</name>")?;
    tag_text(&xml[i..], "value")
}

/// Replaces only the value bytes of an existing MODIFY file; regenerates the value block when the
/// wrapper type changed.
fn patch_value(bytes: &[u8], new: &ModValue, dir: &str) -> Result<Vec<u8>, String> {
    let mut doc = aod::document::parse(bytes).map_err(|e| e.to_string())?;
    let index = build_index(&doc);
    let step = |tag: &str| PathStep::Child { tag: tag.to_string(), occurrence: 0 };
    let base = vec![step("modification"), step("value")];
    let wrapper = new.wrapper();
    let mut inner = EventPath(base.clone());
    inner.0.push(step(wrapper));
    inner.0.push(step("value"));
    if index.get(&inner).is_none() {
        return regenerate(bytes, new, dir);
    }
    match new {
        ModValue::Bool(_) | ModValue::Int(_) => {
            let mut attr = inner.clone();
            attr.0.push(PathStep::Attribute("v".into()));
            let Some(IndexedRange::Attribute { event, value_bytes }) = index.get(&attr).cloned() else { return regenerate(bytes, new, dir) };
            let text = new.compare_text().into_bytes();
            if let AodEvent::Empty(raw) | AodEvent::Start(raw) = &mut doc.events[event] {
                raw.splice(value_bytes, text);
            }
        }
        ModValue::Text(t) => {
            let Some(i) = index.text_event_index(&doc, &inner) else { return regenerate(bytes, new, dir) };
            aod::document::replace_text_at(&mut doc, i..i + 1, enc(t).into_bytes()).map_err(|e| e.to_string())?;
        }
        ModValue::Script { .. } => {}
    }
    Ok(aod::document::serialize(&doc))
}

fn regenerate(bytes: &[u8], new: &ModValue, dir: &str) -> Result<Vec<u8>, String> {
    let text = String::from_utf8_lossy(bytes).into_owned();
    let eol = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let norm = text.replace("\r\n", "\n");
    let start = norm.find("  <value>\n").ok_or("modification has no value block")?;
    let end = norm.rfind("</modification>").ok_or("modification is not closed")?;
    let script_ref = match new {
        ModValue::Script { file_name, .. } => format!("%aditoprj%/modification/{dir}/{file_name}"),
        _ => String::new(),
    };
    let rebuilt = format!("{}{}{}", &norm[..start], value_xml(new, &script_ref), &norm[end..]);
    Ok(with_eol(&rebuilt, eol))
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    designer_core::platform::fs::atomic_write(path, bytes).map_err(|e| format!("failed to write '{}': {e}", path.display()))
}

fn write_if_different(path: &Path, bytes: &[u8]) -> Result<bool, String> {
    if fs::read(path).map(|b| b == bytes).unwrap_or(false) {
        return Ok(false);
    }
    write_atomic(path, bytes)?;
    Ok(true)
}

fn write_new(project_root: &Path, dir: &str, bytes: &[u8]) -> Result<(), String> {
    write_atomic(&mod_file(project_root, dir), bytes)
}

#[cfg(test)]
#[path = "modification_write_tests.rs"]
mod tests;
