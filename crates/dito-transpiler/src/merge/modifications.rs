// Modifikationen: Dateien `modification/<id>/<id>.aod` lesen und auf den Baum des Zielmodells anwenden.
// Aufbau einer Modifikation: changeType (INSERT/MODIFY/DELETE), position, modelType, modelName, path, value.
// Der Pfad beginnt mit dem Modellnamen. Jedes weitere Stück ist ein Tag oder der `<name>` eines Kindes.
// Die Reihenfolge, in der mehrere Modifikationen auf ein Modell wirken, steht in `merge::order`.

use std::collections::HashMap;
use std::path::PathBuf;

use crate::api::{Diagnostic, Severity};
use crate::model::parse::parse;
use crate::model::{Document, Node, NodeId};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChangeType {
    Insert,
    Modify,
    Delete,
}

/// Was die Modifikation als Wert mitbringt.
#[derive(Debug, Clone)]
pub enum Payload {
    /// DELETE.
    None,
    /// Neue Elemente (INSERT). Wurzeln im Dokument `Modification::doc`.
    Elements(Vec<NodeId>),
    /// Neuer Text (MODIFY) oder Eintrag einer Textliste (INSERT).
    Text(Vec<u8>),
    /// Wert im Attribut `v` (Wahrheitswert, Zahl).
    Attr(Vec<u8>),
    /// MODIFY ohne Wert: die Eigenschaft geht zurück auf den Standard, das Element fällt weg.
    Reset,
    /// MODIFY mit einem Element als Wert: V2 wendet das nicht an.
    Structured,
}

#[derive(Debug, Clone)]
pub struct Modification {
    pub change: ChangeType,
    pub position: i64,
    pub model_type: String,
    pub model_name: String,
    /// Pfad ohne den führenden Modellnamen.
    pub path: Vec<String>,
    pub payload: Payload,
    /// Dokument, in dem `Payload::Elements` liegt.
    pub doc: Document,
    pub module: usize,
    pub is_project: bool,
    pub file: PathBuf,
}

fn text_of(doc: &Document, parent: NodeId, tag: &[u8]) -> Option<String> {
    doc.child_text(parent, tag).map(|t| String::from_utf8_lossy(t).trim().to_string())
}

/// Liest eine Modifikation. `doc` hat die verknüpften Dateien schon eingesetzt (Pfade ab Modulwurzel des Moduls der Modifikation).
pub fn parse_modification(doc: Document, module: usize, is_project: bool, file: PathBuf) -> Result<Modification, String> {
    let root = doc.root;
    let change = match text_of(&doc, root, b"changeType").as_deref() {
        Some("INSERT") => ChangeType::Insert,
        Some("MODIFY") => ChangeType::Modify,
        Some("DELETE") => ChangeType::Delete,
        other => return Err(format!("changeType unbekannt: {other:?}")),
    };
    let model_type = text_of(&doc, root, b"modelType").ok_or("modelType fehlt")?;
    let model_name = text_of(&doc, root, b"modelName").ok_or("modelName fehlt")?;
    let full_path = text_of(&doc, root, b"path").ok_or("path fehlt")?;
    let position = doc
        .child_by_tag(root, b"position")
        .and_then(|p| doc.node(p).attrs.iter().find(|(n, _)| n == b"v"))
        .and_then(|(_, v)| String::from_utf8_lossy(v).parse::<i64>().ok())
        .unwrap_or(0);
    let mut path: Vec<String> = full_path.split('/').map(str::to_string).collect();
    if !path.is_empty() {
        path.remove(0);
    }

    // `<value><xxxValueWrapper><name>value</name><value>PAYLOAD</value></xxxValueWrapper></value>`
    let inner = doc
        .child_by_tag(root, b"value")
        .and_then(|outer| doc.node(outer).children.first().copied())
        .and_then(|wrapper| doc.child_by_tag(wrapper, b"value"));
    let payload = match (change, inner) {
        (ChangeType::Delete, _) => Payload::None,
        (ChangeType::Modify, None) => Payload::Reset,
        (ChangeType::Insert, None) => return Err("INSERT ohne Wert".into()),
        (ChangeType::Modify, Some(v)) => {
            let node = doc.node(v);
            if let Some((_, value)) = node.attrs.iter().find(|(n, _)| n == b"v") {
                Payload::Attr(value.clone())
            } else if !node.children.is_empty() {
                Payload::Structured
            } else if let Some(text) = &node.text {
                Payload::Text(text.clone())
            } else {
                Payload::Reset
            }
        }
        (ChangeType::Insert, Some(v)) => {
            let node = doc.node(v);
            if !node.children.is_empty() {
                Payload::Elements(node.children.clone())
            } else if let Some(text) = &node.text {
                Payload::Text(text.clone())
            } else {
                return Err("INSERT mit leerem Wert".into());
            }
        }
    };
    Ok(Modification { change, position, model_type, model_name, path, payload, doc, module, is_project, file })
}

/// Eine Modifikation lesen und die Verweise in ihr einsetzen.
pub fn load_modification(
    bytes: &[u8],
    module: usize,
    is_project: bool,
    file: PathBuf,
    read: &dyn Fn(&str) -> Option<Vec<u8>>,
    unresolved: &mut Vec<String>,
) -> Result<Modification, String> {
    let mut doc = parse(bytes).map_err(|e| e.to_string())?;
    crate::format::v2::convert_tree(&mut doc, read, unresolved);
    parse_modification(doc, module, is_project, file)
}

// ---------------------------------------------------------------------------------------------------------------------
// Anwenden

const MIXIN_CONTAINERS: &[&[u8]] = &[
    b"layout", b"aliasDefinitionSub", b"auditSyncConfig", b"uiConfiguration", b"rendererConfig", b"entries", b"aliasConfigSub", b"company",
    b"aliasSub", b"templateSub",
];

fn is_container_name(seg: &str) -> bool {
    !seg.is_empty() && seg.chars().all(|c| c.is_ascii_alphabetic()) && seg.chars().next().is_some_and(|c| c.is_ascii_lowercase())
}

/// Kind mit diesem Tag, sonst Kind mit diesem `<name>`.
fn step(doc: &Document, parent: NodeId, seg: &str) -> Option<NodeId> {
    let direct = |p: NodeId| -> Option<NodeId> {
        doc.child_by_tag(p, seg.as_bytes()).or_else(|| doc.node(p).children.iter().copied().find(|c| doc.child_text(*c, b"name") == Some(seg.as_bytes())))
    };
    if let Some(found) = direct(parent) {
        return Some(found);
    }
    // Ein Mixin hat genau ein konkretes Unterobjekt, dessen Eigenschaften so angesprochen werden, als gehörten sie zum Mixin.
    let concrete = mixin_child(doc, parent)?;
    direct(concrete)
}

fn mixin_child(doc: &Document, parent: NodeId) -> Option<NodeId> {
    if !MIXIN_CONTAINERS.contains(&doc.node(parent).tag.as_slice()) {
        return None;
    }
    doc.node(parent).children.first().copied()
}

/// Reihenfolge der Kinder je Eltern-Tag (Tabelle aus dem Orakel gelernt, Quelle: `child_order.json`).
fn child_order() -> &'static HashMap<String, Vec<String>> {
    static ORDER: std::sync::OnceLock<HashMap<String, Vec<String>>> = std::sync::OnceLock::new();
    ORDER.get_or_init(|| serde_json::from_str(include_str!("child_order.json")).unwrap_or_default())
}

/// Stelle, an der ein neues Kind mit `tag` in `parent` stehen soll: hinter dem letzten Kind, das laut Tabelle nicht später kommt.
/// Ohne Tabelle oder bei unbekanntem Tag: ans Ende.
fn insertion_index(doc: &Document, parent: NodeId, tag: &[u8]) -> usize {
    let children = &doc.node(parent).children;
    let parent_tag = String::from_utf8_lossy(&doc.node(parent).tag).into_owned();
    let Some(order) = child_order().get(&parent_tag) else { return children.len() };
    let rank = |t: &[u8]| order.iter().position(|o| o.as_bytes() == t);
    let Some(new_rank) = rank(tag) else { return children.len() };
    let mut index = 0;
    for (i, child) in children.iter().enumerate() {
        match rank(&doc.node(*child).tag) {
            Some(r) if r <= new_rank => index = i + 1,
            Some(_) => {}
            None => index = i + 1,
        }
    }
    index
}

#[derive(Debug, Default, Clone, Copy)]
pub struct ApplyStats {
    pub applied: usize,
    pub failed: usize,
}

/// Wendet `mods` der Reihe nach auf `doc` an. Fehler werden als Meldung gesammelt, die übrigen laufen weiter.
pub fn apply_all(doc: &mut Document, mods: &[&Modification], diagnostics: &mut Vec<Diagnostic>) -> ApplyStats {
    let mut stats = ApplyStats::default();
    for m in mods {
        match apply_one(doc, m) {
            Ok(()) => stats.applied += 1,
            Err(reason) => {
                stats.failed += 1;
                diagnostics.push(Diagnostic {
                    severity: Severity::Warning,
                    message: format!("Modifikation nicht angewendet ({} {}): {reason}", m.model_type, m.model_name),
                    sources: vec![m.file.clone()],
                });
            }
        }
    }
    stats
}

fn apply_one(doc: &mut Document, m: &Modification) -> Result<(), String> {
    if matches!(m.payload, Payload::Structured) {
        return Ok(());
    }
    let mut current = doc.root;
    let last = m.path.len().saturating_sub(1);
    for (i, seg) in m.path.iter().enumerate() {
        match step(doc, current, seg) {
            Some(next) => current = next,
            None if m.change == ChangeType::Insert && is_container_name(seg) => {
                // Der Behälter fehlt im Zielmodell: V2 legt die fehlenden Behälter um das neue Element an.
                let parent = mixin_child(doc, current).unwrap_or(current);
                let at = insertion_index(doc, parent, seg.as_bytes());
                let mut container = doc.insert(parent, at, Node { tag: seg.as_bytes().to_vec(), ..Node::default() });
                for missing in &m.path[i + 1..] {
                    container = doc.append(container, Node { tag: missing.as_bytes().to_vec(), ..Node::default() });
                }
                return insert_payload(doc, container, m);
            }
            None if i == last && m.change == ChangeType::Modify && matches!(m.payload, Payload::Reset) => return Ok(()),
            None if i == last && m.change == ChangeType::Modify && !seg.contains('.') => {
                // Eine Eigenschaft, die das Zielmodell noch nicht hat, wird ans Ende des Elternknotens angehängt
                // (am V2-Orakel belegt: `usePermissions` und `grantUpdate` stehen am Ende, nicht an ihrer Schema-Stelle).
                let parent = mixin_child(doc, current).unwrap_or(current);
                let mut node = Node { tag: seg.as_bytes().to_vec(), ..Node::default() };
                match &m.payload {
                    Payload::Text(t) => node.text = Some(t.clone()),
                    Payload::Attr(v) => node.attrs.push((b"v".to_vec(), v.clone())),
                    _ => return Err("MODIFY ohne Wert auf fehlender Eigenschaft".into()),
                }
                doc.append(parent, node);
                return Ok(());
            }
            None => return Err(format!("Pfadstück '{seg}' nicht gefunden")),
        }
    }

    match m.change {
        ChangeType::Delete => {
            doc.detach(current);
            Ok(())
        }
        ChangeType::Modify => match &m.payload {
            Payload::Reset => {
                doc.detach(current);
                Ok(())
            }
            Payload::Text(t) => {
                let node = doc.node_mut(current);
                node.children.clear();
                node.text = Some(t.clone());
                Ok(())
            }
            Payload::Attr(v) => {
                let node = doc.node_mut(current);
                match node.attrs.iter_mut().find(|(n, _)| n == b"v") {
                    Some((_, value)) => *value = v.clone(),
                    None => node.attrs.push((b"v".to_vec(), v.clone())),
                }
                Ok(())
            }
            _ => Err("MODIFY mit unpassendem Wert".into()),
        },
        ChangeType::Insert => insert_payload(doc, current, m),
    }
}

/// Hängt den Wert der Modifikation als Kind(er) an `container`.
fn insert_payload(doc: &mut Document, container: NodeId, m: &Modification) -> Result<(), String> {
    match &m.payload {
        Payload::Elements(roots) => {
            for root in roots {
                let tag = m.doc.node(*root).tag.clone();
                let name = m.doc.child_text(*root, b"name").map(<[u8]>::to_vec);
                // Zwei Module bringen dasselbe Element (gleicher Name) mit: das Modell hat es einmal.
                // Erweiterungspunkte sind die Ausnahme, jedes Modul bringt eigene Implementierungen.
                if let Some(name) = &name {
                    let is_extension_point = tag.ends_with(b"ExtensionPoint");
                    let exists = doc.node(container).children.iter().any(|c| doc.child_text(*c, b"name") == Some(name.as_slice()));
                    if exists && !is_extension_point {
                        continue;
                    }
                }
                // Neue Listeneinträge kommen ans Ende, in der Reihenfolge der Modifikationen (am V2-Orakel belegt:
                // `neonContext/references` mischt `neonViewReference` und `webserviceReference` so).
                let id = doc.append(container, Node::default());
                copy_into(doc, id, &m.doc, *root);
            }
            Ok(())
        }
        Payload::Text(t) => {
            doc.append(container, Node { tag: b"element".to_vec(), text: Some(t.clone()), ..Node::default() });
            Ok(())
        }
        _ => Err("INSERT mit unpassendem Wert".into()),
    }
}

/// Überschreibt den leeren Knoten `target` mit dem Teilbaum `from` aus `other`.
fn copy_into(doc: &mut Document, target: NodeId, other: &Document, from: NodeId) {
    let src = other.node(from);
    {
        let node = doc.node_mut(target);
        node.tag = src.tag.clone();
        node.attrs = src.attrs.clone();
        node.text = src.text.clone();
    }
    for child in &src.children {
        doc.copy_subtree(target, other, *child);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::write::write_v2;

    fn modification(change: &str, path: &str, value: &str) -> Modification {
        let xml = format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<modification>\n  <changeType>{change}</changeType>\n  <position v=\"1\" />\n  <modelType>entity</modelType>\n  <modelName>E</modelName>\n  <path>{path}</path>\n  {value}\n</modification>\n"
        );
        parse_modification(parse(xml.as_bytes()).unwrap(), 0, false, PathBuf::from("m.aod")).unwrap()
    }

    fn target(xml: &str) -> Document {
        parse(xml.as_bytes()).unwrap()
    }

    fn written(doc: &Document) -> String {
        String::from_utf8(write_v2(doc)).unwrap()
    }

    #[test]
    fn insert_appends_element_to_list_by_name_path() {
        let mut doc = target("<entity><name>E</name><entityFields><entityField><name>A</name></entityField></entityFields></entity>");
        let m = modification(
            "INSERT",
            "E/entityFields",
            "<value><modelValueWrapper><name>value</name><value><entityField><name>B</name></entityField></value></modelValueWrapper></value>",
        );
        apply_all(&mut doc, &[&m], &mut Vec::new());
        assert!(written(&doc).contains("<name>B</name>"));
        // Zweites Mal: gleicher Name, wird nicht doppelt eingefügt.
        apply_all(&mut doc, &[&m], &mut Vec::new());
        assert_eq!(written(&doc).matches("<name>B</name>").count(), 1);
    }

    #[test]
    fn modify_replaces_text_and_attr() {
        let mut doc = target("<entity><name>E</name><entityFields><entityField><name>A</name><title>old</title><expose v=\"false\" /></entityField></entityFields></entity>");
        let t = modification("MODIFY", "E/entityFields/A/title", "<value><stringValueWrapper><name>value</name><value>new</value></stringValueWrapper></value>");
        let a = modification("MODIFY", "E/entityFields/A/expose", "<value><booleanValueWrapper><name>value</name><value v=\"true\" /></booleanValueWrapper></value>");
        let stats = apply_all(&mut doc, &[&t, &a], &mut Vec::new());
        assert_eq!(stats.applied, 2);
        let out = written(&doc);
        assert!(out.contains("<title>new</title>") && out.contains("<expose v=\"true\" />"));
    }

    #[test]
    fn delete_removes_element_and_missing_path_is_reported() {
        let mut doc = target("<entity><name>E</name><entityFields><entityField><name>A</name></entityField></entityFields></entity>");
        let d = modification("DELETE", "E/entityFields/A", "");
        let bad = modification("DELETE", "E/entityFields/Z", "");
        let mut notes = Vec::new();
        let stats = apply_all(&mut doc, &[&d, &bad], &mut notes);
        assert_eq!((stats.applied, stats.failed), (1, 1));
        assert!(!written(&doc).contains("<name>A</name>"));
        assert_eq!(notes.len(), 1);
    }
}
