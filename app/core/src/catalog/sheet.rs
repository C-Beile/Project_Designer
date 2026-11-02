//! Property sheet and navigator outline of one object (or one element inside it), resolved
//! against the property catalog: what the Properties panel and the Navigator display
//! (LAYOUT_SPEC §5, §7).

use super::{Catalog, PropDef, PropKind, GENERAL_GROUP};
use crate::wire::WireValue;
use core_model::path::{NodePath, PathSegment};
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SheetRow {
    pub name: String,
    pub kind: PropKind,
    /// Current value as stored in the file; absent for an unset property.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<WireValue>,
    /// Text shown in the value column (for linked files: the start of the file's content).
    pub display: String,
    pub set: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub enum_values: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub editable: bool,
    /// Why the row cannot be edited (tooltip).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// Stored as a typed `v="..."` attribute rather than element text.
    pub typed: bool,
    /// The row could be edited if the object were writable; module objects are then edited as
    /// modifications instead.
    pub would_edit: bool,
    /// Unset linked property (code field): where its new file would be created.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_reference: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SheetGroup {
    pub key: String,
    /// Empty for the first, untitled group (as in the Designer).
    pub label: String,
    pub rows: Vec<SheetRow>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct PropertySheet {
    pub name: String,
    pub type_label: String,
    pub path: String,
    pub groups: Vec<SheetGroup>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub read_only: Option<String>,
    /// Edits of this module object are written as modifications of the project.
    pub modification: bool,
    pub catalog_missing: bool,
}

pub const READ_ONLY_MODULE: &str = "Objects of modules under node_modules are read-only.";
const NOT_IN_SCHEMA: &str = "Not stored in the model file.";
const LIST_READ_ONLY: &str = "Editing lists is not available yet.";
/// Marks a Navigator entry that has no definition in the file yet (<container path>#new:<name>).
pub const NEW_MARK: &str = "#new:";
const LINKED_NEW: &str = "Not set yet: open the code editor with the button to create it.";
const NAME_READ_ONLY: &str = "Renaming is a refactoring and not available yet.";

pub fn field<'a>(value: &'a WireValue, name: &str) -> Option<&'a WireValue> {
    match value {
        WireValue::Object { fields } => fields.iter().find(|f| f.key == name).map(|f| &f.value),
        _ => None,
    }
}

pub fn text_of(value: &WireValue) -> Option<String> {
    match value {
        WireValue::Text { value } => Some(value.clone()),
        WireValue::Bool { value } => Some(value.to_string()),
        WireValue::Int { value } => Some(value.to_string()),
        _ => None,
    }
}

pub fn value_at<'a>(root: &'a WireValue, path: &NodePath) -> Option<&'a WireValue> {
    let mut current = root;
    for seg in path.segments() {
        current = match (seg, current) {
            (PathSegment::Field(name), _) => field(current, name)?,
            (PathSegment::Index(i), WireValue::Array { items }) => items.get(*i)?,
            // A single occurrence is projected without an array; index 0 addresses it.
            (PathSegment::Index(0), other) => other,
            _ => return None,
        };
    }
    Some(current)
}

/// Element tags along `path` (indices dropped), the coordinates the catalog uses.
pub fn tags_of(path: &NodePath) -> Vec<String> {
    path.segments()
        .iter()
        .filter_map(|s| match s {
            PathSegment::Field(n) => Some(n.clone()),
            PathSegment::Index(_) => None,
        })
        .collect()
}

fn display_of(value: &WireValue) -> String {
    match value {
        WireValue::Array { items } => items.iter().map(display_of).collect::<Vec<_>>().join(", "),
        WireValue::Object { fields } => {
            if let Some(name) = fields.iter().find(|f| f.key == "name").and_then(|f| text_of(&f.value)) {
                return name;
            }
            fields.iter().map(|f| display_of(&f.value)).filter(|s| !s.is_empty()).collect::<Vec<_>>().join(", ")
        }
        other => text_of(other).unwrap_or_default(),
    }
}

/// Resolves the sheet of the element at `path` inside `root` (the object's whole property tree).
/// `linked_preview` returns the beginning of a linked file's content for a `%aditoprj%` reference.
pub fn resolve_sheet(
    catalog: Option<&Catalog>,
    model_type: &str,
    root: &WireValue,
    path: &NodePath,
    read_only: Option<&str>,
    linked_preview: &dyn Fn(&str) -> Option<String>,
) -> Result<PropertySheet, String> {
    let element = value_at(root, path).ok_or_else(|| format!("no element at '{path}'"))?;
    let tags = tags_of(path);
    let type_label = tags.last().cloned().unwrap_or_else(|| model_type.to_string());
    let name = field(element, "name").and_then(text_of).unwrap_or_else(|| type_label.clone());
    let by_path = catalog.and_then(|c| c.type_at(model_type, &tags)).filter(|e| e.has_metadata);
    // Fallback by the element's own type name (`dbRecordFieldMapping` -> `dbRecordFieldMappingType`).
    let entry = by_path.or_else(|| catalog.and_then(|c| c.types.get(&format!("{type_label}Type"))).filter(|e| e.has_metadata));

    let mut rows: Vec<(String, i32, SheetRow)> = Vec::new();
    let editable_or = |ok: bool, reason: &str| -> (bool, Option<String>) {
        match read_only {
            Some(r) => (false, Some(r.to_string())),
            None if ok => (true, None),
            None => (false, Some(reason.to_string())),
        }
    };

    if !path.is_root() && field(element, "name").is_some() {
        let (_, reason) = editable_or(false, NAME_READ_ONLY);
        rows.push((
            GENERAL_GROUP.into(),
            i32::MIN,
            SheetRow {
                name: "name".into(),
                kind: PropKind::Text,
                value: field(element, "name").cloned(),
                display: name.clone(),
                set: true,
                enum_values: Vec::new(),
                reference: None,
                description: None,
                editable: false,
                reason,
                typed: false,
                would_edit: false,
                new_reference: None,
            },
        ));
    }

    let mut known: Vec<String> = vec!["name".into()];
    if let Some(entry) = entry {
        // `type` is the model/element type itself: shown after the title rows like the Designer.
        rows.push((
            GENERAL_GROUP.into(),
            19,
            SheetRow {
                name: "type".into(),
                kind: PropKind::Text,
                value: None,
                display: type_label.clone(),
                set: true,
                enum_values: Vec::new(),
                reference: None,
                description: None,
                editable: false,
                reason: editable_or(false, "The type of the model.").1,
                typed: false,
                would_edit: false,
                new_reference: None,
            },
        ));
        for def in &entry.props {
            known.push(def.name.clone());
            rows.push((def.group.clone(), def.position, row_for(def, element, &editable_or, linked_preview)));
        }
        // Structural children are the Navigator's business.
        for (n, t) in &entry.elements {
            if catalog.map(|c| c.types.get(t).map(|e| e.is_list).unwrap_or(false)).unwrap_or(false) {
                known.push(n.clone());
            }
        }
    }

    // Values in the file the catalog does not describe are never hidden.
    if let WireValue::Object { fields } = element {
        for f in fields {
            if known.contains(&f.key) || matches!(f.value, WireValue::Object { .. } | WireValue::Array { .. }) && entry.is_some() {
                continue;
            }
            if f.key == "name" {
                continue;
            }
            let scalar = !matches!(f.value, WireValue::Object { .. } | WireValue::Array { .. });
            let kind = match &f.value {
                WireValue::Bool { .. } => PropKind::Bool,
                WireValue::Int { .. } => PropKind::Int,
                WireValue::Object { .. } | WireValue::Array { .. } => PropKind::List,
                WireValue::Text { value } if value.starts_with("%aditoprj%") => PropKind::Linked,
                _ => PropKind::Text,
            };
            let def = PropDef {
                name: f.key.clone(),
                group: GENERAL_GROUP.into(),
                position: i32::MAX,
                kind,
                enum_values: Vec::new(),
                reference: None,
                description: None,
                persisted: scalar,
            };
            rows.push((GENERAL_GROUP.into(), i32::MAX, row_for(&def, element, &editable_or, linked_preview)));
        }
    }

    let mut groups: Vec<SheetGroup> = Vec::new();
    let rank = |key: &str| catalog.map(|c| c.group_rank(key)).unwrap_or(0);
    rows.sort_by(|a, b| (rank(&a.0), a.1).cmp(&(rank(&b.0), b.1)));
    for (group, _, row) in rows {
        match groups.last_mut() {
            Some(g) if g.key == group => g.rows.push(row),
            _ => groups.push(SheetGroup {
                label: if group == GENERAL_GROUP { String::new() } else { catalog.map(|c| c.group_label(&group)).unwrap_or_default() },
                key: group,
                rows: vec![row],
            }),
        }
    }

    let title_name = reference_label(&type_label, element).unwrap_or_else(|| name.clone());
    Ok(PropertySheet {
        name: title_name,
        type_label,
        path: path.to_string(),
        groups,
        read_only: read_only.map(str::to_string),
        modification: false,
        catalog_missing: entry.is_none(),
    })
}

fn row_for(
    def: &PropDef,
    element: &WireValue,
    editable_or: &dyn Fn(bool, &str) -> (bool, Option<String>),
    linked_preview: &dyn Fn(&str) -> Option<String>,
) -> SheetRow {
    let value = field(element, &def.name).cloned();
    let set = value.is_some();
    let typed = matches!(def.kind, PropKind::Bool | PropKind::Int | PropKind::Number)
        || matches!(value, Some(WireValue::Bool { .. }) | Some(WireValue::Int { .. }));
    let display = match (&value, def.kind) {
        (Some(v), PropKind::Linked) => {
            let reference = text_of(v).unwrap_or_default();
            linked_preview(&reference).unwrap_or(reference)
        }
        (Some(v), _) => display_of(v),
        (None, _) => String::new(),
    };
    let scalar_value = value.as_ref().map(|v| text_of(v).is_some()).unwrap_or(true);
    let would_edit = match def.kind {
        PropKind::List | PropKind::Object => false,
        PropKind::Linked => true,
        _ if !def.persisted || !scalar_value => false,
        _ => true,
    };
    let (editable, reason) = match def.kind {
        PropKind::List | PropKind::Object => editable_or(false, LIST_READ_ONLY),
        PropKind::Linked => editable_or(false, if set { "Open the linked file with the button." } else { LINKED_NEW }),
        _ if !def.persisted => editable_or(false, NOT_IN_SCHEMA),
        _ if !scalar_value => editable_or(false, LIST_READ_ONLY),
        _ => editable_or(true, ""),
    };
    SheetRow {
        name: def.name.clone(),
        kind: def.kind,
        value,
        display,
        set,
        enum_values: def.enum_values.clone(),
        reference: def.reference.clone(),
        description: def.description.clone(),
        editable,
        reason,
        typed,
        would_edit,
        new_reference: None,
    }
}

// ---------------------------------------------------------------------------------------------
// Navigator outline

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct NavNode {
    pub label: String,
    /// Path of the element (selects it into Properties); absent for folders and unset bindings.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// Icon hint: `object`, `folder`, `field`, `container`, `binding`, `consumer`, `provider`,
    /// `parameter`, `template`, `view`, `entity`, `function`.
    pub icon: String,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub dimmed: bool,
    /// The element comes from the object's file and carries the object's origin label.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub with_origin: bool,
    /// Technical name shown as tooltip when the label is a readable stand-in (view references).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tooltip: Option<String>,
    pub children: Vec<NavNode>,
}

fn nav(label: impl Into<String>, path: Option<String>, icon: &str, children: Vec<NavNode>) -> NavNode {
    NavNode { label: label.into(), path, icon: icon.into(), dimmed: false, with_origin: false, tooltip: None, children }
}

/// Designer-like name order: case-insensitive, `_` before letters (`ACTIVITY_ID` before
/// `ACTIVITYLINKID`, `OBJECT_TYPE` before `Objects`, as in the Navigator of screenshot 44).
pub fn nav_sort_key(name: &str) -> String {
    name.to_lowercase().replace('_', " ")
}

/// Named elements (with a `name` child) below a list container field, with their paths.
fn named_items(container: &WireValue, container_path: &NodePath) -> Vec<(String, String, NodePath, WireValue)> {
    let mut out = Vec::new();
    if let WireValue::Object { fields } = container {
        for f in fields {
            let items: Vec<(Option<usize>, &WireValue)> = match &f.value {
                WireValue::Array { items } => items.iter().enumerate().map(|(i, v)| (Some(i), v)).collect(),
                other => vec![(None, other)],
            };
            for (i, item) in items {
                let p = match i {
                    Some(i) => container_path.field(&f.key).index(i),
                    None => container_path.field(&f.key),
                };
                let name = field(item, "name").and_then(text_of).unwrap_or_else(|| f.key.clone());
                out.push((f.key.clone(), name, p, item.clone()));
            }
        }
    }
    out
}

pub fn navigator(model_type: &str, root: &WireValue, object_name: &str, js_source: Option<&str>) -> Vec<NavNode> {
    let root_path = NodePath::root();
    let mut top = nav(object_name, Some("$".into()), "object", Vec::new());
    top.with_origin = true;
    match model_type {
        "entity" => top.children = entity_outline(root),
        "neonContext" => {
            if let Some(entity) = field(root, "entity").and_then(text_of) {
                top.children.push(nav(entity, Some("entity".into()), "entity", Vec::new()));
            }
            if let Some(refs) = field(root, "references") {
                for (_, name, p, item) in named_items(refs, &root_path.field("references")) {
                    let label = field(&item, "view").and_then(text_of).unwrap_or(name);
                    top.children.push(nav(label, Some(p.to_string()), "view", Vec::new()));
                }
            }
        }
        "neonDashboard" => {
            // Original Designer: "Available Configs" (content not visible in the reference shot, left
            // empty) and "Dashlets" with one entry per dashlet.
            let dashlets = field(root, "defaultDashlets")
                .map(|c| named_items(c, &root_path.field("defaultDashlets")))
                .unwrap_or_default()
                .into_iter()
                .map(|(_, name, p, _)| nav(name, Some(p.to_string()), "template", Vec::new()))
                .collect();
            top.children.push(nav("Available Configs", None, "folder", Vec::new()));
            top.children.push(nav("Dashlets", None, "folder", dashlets));
        }
        "aliasDefinition" => top.children = alias_outline(root),
        "process" => {
            if let Some(src) = js_source {
                top.children = js_functions(src).into_iter().map(|f| nav(f, None, "function", Vec::new())).collect();
            }
        }
        _ => top.children = template_outline(root, &root_path),
    }
    vec![top]
}

/// Readable name of a reference element: the view it points at.
pub fn reference_label(tag: &str, element: &WireValue) -> Option<String> {
    if !tag.ends_with("Reference") {
        return None;
    }
    field(element, "view").and_then(text_of).filter(|v| !v.trim().is_empty())
}

/// Tables with their columns of a database alias (original Designer: table icon, key icon for the
/// primary key column).
fn alias_outline(root: &WireValue) -> Vec<NavNode> {
    let entities = field(root, "aliasDefinitionSub").and_then(|s| field(s, "aliasDefDb")).and_then(|d| field(d, "entityGroup")).and_then(|g| field(g, "entities"));
    let base = NodePath::root().field("aliasDefinitionSub").field("aliasDefDb").field("entityGroup").field("entities");
    let Some(entities) = entities else { return Vec::new() };
    named_items(entities, &base)
        .into_iter()
        .map(|(_, name, p, item)| {
            let columns = field(&item, "entityFields").map(|c| named_items(c, &p.field("entityFields"))).unwrap_or_default();
            let children = columns
                .into_iter()
                .map(|(_, col, cp, citem)| {
                    let pk = matches!(field(&citem, "primaryKey"), Some(WireValue::Bool { value: true }));
                    let mut node = nav(col, Some(cp.to_string()), if pk { "key" } else { "field" }, Vec::new());
                    node.with_origin = true;
                    node
                })
                .collect();
            let mut node = nav(name, Some(p.to_string()), "table", children);
            node.with_origin = true;
            node
        })
        .collect()
}

fn template_outline(element: &WireValue, path: &NodePath) -> Vec<NavNode> {
    let Some(children) = field(element, "children") else { return Vec::new() };
    named_items(children, &path.field("children"))
        .into_iter()
        .map(|(tag, name, p, item)| {
            let icon = if tag.contains("Reference") { "view" } else { "template" };
            // A view reference is named by a generated id; the referenced view is its readable name.
            let (label, tooltip) = match reference_label(&tag, &item) {
                Some(view) if view != name => (view, Some(name)),
                _ => (name, None),
            };
            let mut node = nav(label, Some(p.to_string()), icon, template_outline(&item, &p));
            node.with_origin = true;
            node.tooltip = tooltip;
            node
        })
        .collect()
}

fn entity_outline(root: &WireValue) -> Vec<NavNode> {
    let root_path = NodePath::root();
    let fields_container = field(root, "entityFields");
    let items = fields_container.map(|c| named_items(c, &root_path.field("entityFields"))).unwrap_or_default();

    let mut fields = Vec::new();
    let mut parameters = Vec::new();
    let mut providers = Vec::new();
    let mut consumers = Vec::new();
    let mut services = Vec::new();
    let mut field_names: Vec<String> = Vec::new();
    let mut consumer_names: Vec<String> = Vec::new();
    for (tag, name, p, item) in &items {
        let (bucket, icon) = if tag.starts_with("entityParameter") {
            (&mut parameters, "parameter")
        } else if tag.starts_with("entityProvider") {
            (&mut providers, "provider")
        } else if tag.starts_with("entityConsumer") {
            if tag == "entityConsumer" {
                consumer_names.push(name.clone());
            }
            (&mut consumers, "consumer")
        } else if tag.starts_with("entityServiceDefinition") {
            (&mut services, "service")
        } else {
            if tag == "entityField" {
                field_names.push(name.clone());
            }
            (&mut fields, "field")
        };
        let children = field(item, "children").map(|c| {
            named_items(c, &p.field("children"))
                .into_iter()
                .map(|(_, n, cp, _)| {
                    let mut c = nav(n, Some(cp.to_string()), "field", Vec::new());
                    c.with_origin = true;
                    c
                })
                .collect()
        });
        let mut node = nav(name.clone(), Some(p.to_string()), icon, children.unwrap_or_default());
        node.with_origin = true;
        bucket.push(node);
    }
    for list in [&mut fields, &mut parameters, &mut providers, &mut consumers, &mut services] {
        list.sort_by_key(|n| nav_sort_key(&n.label));
    }

    let mut containers = Vec::new();
    if let Some(rc) = field(root, "recordContainers") {
        for (_, name, p, item) in named_items(rc, &root_path.field("recordContainers")) {
            let mappings = field(&item, "recordFieldMappings")
                .map(|m| named_items(m, &p.field("recordFieldMappings")))
                .unwrap_or_default();
            let mut bindings: Vec<(String, &str)> = Vec::new();
            for f in &field_names {
                bindings.push((format!("{f}.displayValue"), "binding"));
                bindings.push((format!("{f}.value"), "binding"));
            }
            for c in &consumer_names {
                bindings.push((c.clone(), "consumer"));
            }
            bindings.sort_by_key(|(n, _)| nav_sort_key(n));
            let children = bindings
                .into_iter()
                .map(|(label, icon)| match mappings.iter().find(|(_, n, _, _)| *n == label) {
                    Some((_, _, mp, _)) => {
                        let mut b = nav(label, Some(mp.to_string()), icon, Vec::new());
                        b.with_origin = true;
                        b
                    }
                    None => {
                        // No mapping yet: selectable with default values, the first edit creates the mapping.
                        let virtual_path = format!("{p}{NEW_MARK}{label}");
                        let mut b = nav(label, Some(virtual_path), icon, Vec::new());
                        b.dimmed = true;
                        b
                    }
                })
                .collect();
            let mut node = nav(name, Some(p.to_string()), "container", children);
            node.with_origin = true;
            containers.push(node);
        }
    }

    vec![
        nav("RecordContainers", None, "folder", containers),
        nav("Fields", None, "folder", fields),
        nav("Parameters", None, "folder", parameters),
        nav("Providers", None, "folder", providers),
        nav("Consumers", None, "folder", consumers),
        nav("Services", None, "folder", services),
    ]
}

/// Function names declared in a JDito process (`function name(` and `name = function`).
pub fn js_functions(src: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let is_ident = |c: char| c.is_alphanumeric() || c == '_' || c == '$';
    for line in src.lines() {
        let t = line.trim_start();
        if t.starts_with("//") || t.starts_with('*') {
            continue;
        }
        let mut rest = t;
        while let Some(i) = rest.find("function") {
            let before_ok = rest[..i].chars().last().map(|c| !is_ident(c)).unwrap_or(true);
            let after = &rest[i + "function".len()..];
            if before_ok && after.starts_with(|c: char| c.is_whitespace()) {
                let name: String = after.trim_start().chars().take_while(|c| is_ident(*c)).collect();
                if !name.is_empty() && !out.contains(&name) {
                    out.push(name);
                } else if name.is_empty() {
                    // `name = function (` - take the assigned identifier.
                    let lhs = rest[..i].trim_end().trim_end_matches('=').trim_end().trim_end_matches(':').trim_end();
                    let ident: String = lhs.chars().rev().take_while(|c| is_ident(*c)).collect::<String>().chars().rev().collect();
                    if !ident.is_empty() && !out.contains(&ident) {
                        out.push(ident);
                    }
                }
            }
            rest = after;
        }
    }
    out
}
