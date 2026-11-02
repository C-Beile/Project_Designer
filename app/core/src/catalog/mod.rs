//! Property catalog: every property an ADITO object type can have, in the Designer's own order
//! and groups, with its description - read at runtime from the user's locally installed Designer
//! (Chef-Prompt §4.2: Forge ships no ADITO texts).
//!
//! Sources inside the installation:
//! - `datamodels-impl.jar`: the model XSDs (structure, value types, enum values) and the
//!   datamodel classes whose property-description fields carry `@EDITOR(sheetTabCategory,
//!   position, type)` and `@JsonSchemaElement(description)` annotations.
//! - `core.jar`: `STATICRESOURCE.properties`, the display texts of the property groups.
//!
//! The result is cached as JSON once per Designer installation (keyed by jar size + mtime).

pub mod classfile;
pub mod sheet;
pub mod xsd;

#[cfg(test)]
mod tests;

use classfile::{Annotation, ClassFile, ElementValue};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::io::Read;
use std::path::{Path, PathBuf};

pub const GENERAL_GROUP: &str = "GENERAL";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PropKind {
    Text,
    Bool,
    Int,
    Number,
    Enum,
    /// `%aditoprj%`-relative linked file (JDito process, documentation).
    Linked,
    /// Name of another model object (e.g. a context's `entity`).
    Reference,
    List,
    Object,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PropDef {
    pub name: String,
    pub group: String,
    pub position: i32,
    pub kind: PropKind,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub enum_values: Vec<String>,
    /// Model type a reference points to (`entity`, `neonView`, ...).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// The property is declared in the XSD, so the Designer persists it in the `.aod` file.
    pub persisted: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct TypeEntry {
    pub elements: Vec<(String, String)>,
    pub is_list: bool,
    /// Displayable properties in sheet order; empty when no datamodel class was found.
    pub props: Vec<PropDef>,
    pub has_metadata: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GroupDef {
    pub key: String,
    pub label: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Catalog {
    pub stamp: String,
    pub roots: BTreeMap<String, String>,
    pub types: BTreeMap<String, TypeEntry>,
    /// All property groups in the Designer's order (`SheetTabCategory` declaration order).
    pub groups: Vec<GroupDef>,
}

impl Catalog {
    pub fn type_at(&self, model_type: &str, tags: &[String]) -> Option<&TypeEntry> {
        let mut current = self.roots.get(model_type)?;
        for tag in tags {
            let entry = self.types.get(current)?;
            current = &entry.elements.iter().find(|(n, _)| n == tag)?.1;
        }
        self.types.get(current)
    }

    pub fn group_rank(&self, key: &str) -> usize {
        self.groups.iter().position(|g| g.key == key).unwrap_or(usize::MAX)
    }

    pub fn group_label(&self, key: &str) -> String {
        self.groups.iter().find(|g| g.key == key).map(|g| g.label.clone()).unwrap_or_else(|| title_case(key))
    }
}

const DATAMODELS_JAR: &str = "datamodels-impl.jar";
const CORE_JAR: &str = "core.jar";
const STATIC_RESOURCES: &str = "de/adito/aditoweb/core/multilanguage/STATICRESOURCE.properties";
const XSD_PREFIX: &str = "de/adito/aditoweb/system/mapper/xsd/aomodel-";
const CLASS_PREFIX: &str = "de/adito/aditoweb/system/crmcomponents/";
const SHEET_TAB_CATEGORY: &str = "SheetTabCategory";

/// Locates the two jars inside a Designer installation folder.
pub fn find_jars(install_dir: &Path) -> Option<(PathBuf, Option<PathBuf>)> {
    let lib = install_dir.join("lib");
    let mut datamodels = None;
    let mut core = None;
    let mut stack = vec![lib];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name == DATAMODELS_JAR && datamodels.is_none() {
                    datamodels = Some(path);
                } else if name == CORE_JAR && core.is_none() && path.to_string_lossy().contains("lwcore") {
                    core = Some(path);
                }
            }
        }
    }
    datamodels.map(|d| (d, core))
}

fn stamp_of(jar: &Path) -> String {
    let meta = std::fs::metadata(jar).ok();
    let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
    let mtime = meta
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for b in jar.to_string_lossy().as_bytes() {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{hash:016x}-{size}-{mtime}")
}

/// Loads the catalog for `install_dir`, from `cache_dir` when this installation was read before.
pub fn load_catalog(install_dir: &Path, cache_dir: Option<&Path>) -> Result<Catalog, String> {
    let (datamodels, core) =
        find_jars(install_dir).ok_or_else(|| format!("{DATAMODELS_JAR} not found below {}", install_dir.display()))?;
    let stamp = stamp_of(&datamodels);
    let cache_file = cache_dir.map(|d| d.join(format!("property-catalog-{stamp}.json")));
    if let Some(file) = &cache_file {
        if let Ok(text) = std::fs::read_to_string(file) {
            if let Ok(catalog) = serde_json::from_str::<Catalog>(&text) {
                return Ok(catalog);
            }
        }
    }
    let mut catalog = build_catalog(&datamodels, core.as_deref())?;
    catalog.stamp = stamp;
    if let (Some(file), Ok(json)) = (&cache_file, serde_json::to_string(&catalog)) {
        if let Some(parent) = file.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(file, json);
    }
    Ok(catalog)
}

fn read_zip_entries(jar: &Path, wanted: impl Fn(&str) -> bool) -> Result<Vec<(String, Vec<u8>)>, String> {
    let file = std::fs::File::open(jar).map_err(|e| format!("{}: {e}", jar.display()))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("{}: {e}", jar.display()))?;
    let mut out = Vec::new();
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        if !wanted(&name) {
            continue;
        }
        let mut bytes = Vec::with_capacity(entry.size() as usize);
        entry.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        out.push((name, bytes));
    }
    Ok(out)
}

pub fn build_catalog(datamodels_jar: &Path, core_jar: Option<&Path>) -> Result<Catalog, String> {
    let entries = read_zip_entries(datamodels_jar, |n| {
        (n.starts_with(XSD_PREFIX) && n.ends_with(".xsd")) || (n.starts_with(CLASS_PREFIX) && n.ends_with(".class"))
    })?;
    let mut schema = xsd::Schema::default();
    let mut classes: HashMap<String, ClassFile> = HashMap::new();
    for (name, bytes) in &entries {
        if name.ends_with(".xsd") {
            schema.add_xsd(&String::from_utf8_lossy(bytes))?;
        } else if let Ok(cf) = ClassFile::parse(bytes) {
            classes.insert(cf.this_class.clone(), cf);
        }
    }
    let resources = match core_jar {
        Some(jar) => read_zip_entries(jar, |n| n == STATIC_RESOURCES)?
            .into_iter()
            .next()
            .map(|(_, b)| parse_properties(&String::from_utf8_lossy(&b)))
            .unwrap_or_default(),
        None => HashMap::new(),
    };
    Ok(assemble(&schema, &classes, &resources))
}

/// Combines XSD structure, class annotations and group texts into the catalog. Separate from
/// the jar reading so it can be tested with hand-built inputs.
pub fn assemble(schema: &xsd::Schema, classes: &HashMap<String, ClassFile>, resources: &HashMap<String, String>) -> Catalog {
    let groups = sheet_groups(classes, resources);

    let mut by_simple: HashMap<String, Vec<&str>> = HashMap::new();
    for name in classes.keys() {
        let simple = name.rsplit('/').next().unwrap_or(name);
        if simple.contains('$') {
            continue;
        }
        by_simple.entry(simple.to_lowercase()).or_default().push(name.as_str());
    }
    for v in by_simple.values_mut() {
        v.sort();
    }
    let class_for_type = |xsd_type: &str| -> Option<&str> {
        let base = xsd_type.strip_suffix("Type").unwrap_or(xsd_type);
        by_simple.get(&format!("{}datamodel", base.to_lowercase())).and_then(|v| v.first().copied())
    };

    // Datamodel class -> model type, for reference targets (`@MajorReference(clazz=...)`).
    let mut model_type_of_class: HashMap<String, String> = HashMap::new();
    for (model_type, root_type) in &schema.roots {
        if let Some(c) = class_for_type(root_type) {
            model_type_of_class.insert(c.to_string(), model_type.clone());
        }
    }

    let mut types = BTreeMap::new();
    for (type_name, ct) in &schema.complex {
        let mut entry = TypeEntry { elements: ct.elements.clone(), is_list: ct.is_list, ..TypeEntry::default() };
        if let Some(class) = class_for_type(type_name) {
            let mut collected: Vec<(String, Vec<Annotation>)> = Vec::new();
            collect_property_fields(classes, class, &mut Vec::new(), &mut collected);
            let mut props = Vec::new();
            for (name, annotations) in collected {
                if let Some(def) = prop_def(&name, &annotations, ct, schema, &model_type_of_class) {
                    props.push(def);
                }
            }
            props.sort_by(|a, b| {
                let ra = groups.iter().position(|g| g.key == a.group).unwrap_or(usize::MAX);
                let rb = groups.iter().position(|g| g.key == b.group).unwrap_or(usize::MAX);
                (ra, a.position).cmp(&(rb, b.position))
            });
            entry.has_metadata = true;
            entry.props = props;
        }
        types.insert(type_name.clone(), entry);
    }
    Catalog { stamp: String::new(), roots: schema.roots.clone(), types, groups }
}

/// Property-description fields of `class` and everything it inherits; a field declared lower in
/// the hierarchy (the concrete model) wins over an inherited one of the same name.
fn collect_property_fields(
    classes: &HashMap<String, ClassFile>,
    class: &str,
    seen: &mut Vec<String>,
    out: &mut Vec<(String, Vec<Annotation>)>,
) {
    if seen.iter().any(|s| s == class) {
        return;
    }
    seen.push(class.to_string());
    let Some(cf) = classes.get(class) else { return };
    let parents: Vec<String> = cf.super_class.iter().cloned().chain(cf.interfaces.iter().cloned()).collect();
    for parent in parents {
        collect_property_fields(classes, &parent, seen, out);
    }
    for field in &cf.fields {
        if !field.descriptor.contains("IPropertyDescription") {
            continue;
        }
        if let Some(existing) = out.iter_mut().find(|(n, _)| *n == field.name) {
            existing.1 = field.annotations.clone();
        } else {
            out.push((field.name.clone(), field.annotations.clone()));
        }
    }
}

fn enum_constant(v: Option<&ElementValue>) -> Option<String> {
    match v? {
        ElementValue::Enum { constant, .. } => Some(constant.clone()),
        _ => None,
    }
}

fn int_value(v: Option<&ElementValue>) -> Option<i32> {
    match v? {
        ElementValue::Int(i) => Some(*i),
        _ => None,
    }
}

fn prop_def(
    name: &str,
    annotations: &[Annotation],
    ct: &xsd::ComplexType,
    schema: &xsd::Schema,
    model_type_of_class: &HashMap<String, String>,
) -> Option<PropDef> {
    let json = annotations.iter().find(|a| a.type_name == "JsonSchemaElement");
    let nested_editor = json.and_then(|j| match j.get("editor") {
        Some(ElementValue::Array(items)) => items.iter().find_map(|i| match i {
            ElementValue::Annotation(a) if a.type_name == "EDITOR" => Some(a.clone()),
            _ => None,
        }),
        Some(ElementValue::Annotation(a)) => Some(a.clone()),
        _ => None,
    });
    let editor = annotations.iter().find(|a| a.type_name == "EDITOR").cloned().or(nested_editor)?;
    let editor_type = enum_constant(editor.get("type")).unwrap_or_default();
    // Child collections (`references`, `children`, `entityFields`) are shown in the Navigator,
    // not as a row of the property sheet.
    if editor_type == "SIMPLE_LIST" || json.and_then(|j| j.get("childEntryPoint")).is_some() {
        return None;
    }
    let group = enum_constant(editor.get("sheetTabCategory")).unwrap_or_else(|| GENERAL_GROUP.to_string());
    let position = int_value(editor.get("position")).unwrap_or(0);
    let description = json.and_then(|j| match j.get("description") {
        Some(ElementValue::Str(s)) if !s.trim().is_empty() => Some(s.clone()),
        _ => None,
    });
    let reference = annotations.iter().find(|a| a.type_name == "MajorReference").and_then(|a| match a.get("clazz") {
        Some(ElementValue::Array(items)) => items.iter().find_map(|i| match i {
            ElementValue::Class(c) => model_type_of_class.get(c).cloned(),
            _ => None,
        }),
        Some(ElementValue::Class(c)) => model_type_of_class.get(c).cloned(),
        _ => None,
    });

    let xsd_type = ct.elements.iter().find(|(n, _)| n == name).map(|(_, t)| t.as_str());
    let mut enum_values = Vec::new();
    let kind = match xsd_type {
        Some("booleanType") => PropKind::Bool,
        Some("intType") | Some("longType") => PropKind::Int,
        Some("numberType") => PropKind::Number,
        Some(t) if schema.enums.contains_key(t) => {
            enum_values = schema.enums[t].clone();
            PropKind::Enum
        }
        Some(t) if schema.complex.get(t).map(|c| c.is_list).unwrap_or(false) => PropKind::List,
        Some(t) if schema.complex.contains_key(t) && t != "stringType" => PropKind::Object,
        _ if editor_type == "LINKED" => PropKind::Linked,
        _ if reference.is_some() => PropKind::Reference,
        _ => PropKind::Text,
    };
    Some(PropDef {
        name: name.to_string(),
        group,
        position,
        kind,
        enum_values,
        reference,
        description,
        persisted: xsd_type.is_some(),
    })
}

/// Property groups in declaration order with their display texts. The enum constant is paired
/// with its `EStaticResources` constant; that constant's resource key follows the Designer's
/// `legacy.<lower.case.with.dots>` convention in `STATICRESOURCE.properties`.
fn sheet_groups(classes: &HashMap<String, ClassFile>, resources: &HashMap<String, String>) -> Vec<GroupDef> {
    let Some(cf) = classes.values().find(|c| c.this_class.ends_with(&format!("/{SHEET_TAB_CATEGORY}"))) else {
        return vec![GroupDef { key: GENERAL_GROUP.into(), label: String::new() }];
    };
    let own = format!("L{};", cf.this_class);
    let keys: HashMap<String, String> = cf.enum_resource_keys("EStaticResources").into_iter().collect();
    cf.fields
        .iter()
        .filter(|f| f.descriptor == own)
        .map(|f| {
            let label = if f.name == GENERAL_GROUP {
                String::new()
            } else {
                keys.get(&f.name)
                    .and_then(|k| resources.get(&format!("legacy.{}", k.to_lowercase().replace('_', "."))))
                    .cloned()
                    .unwrap_or_else(|| title_case(&f.name))
            };
            GroupDef { key: f.name.clone(), label }
        })
        .collect()
}

pub fn title_case(key: &str) -> String {
    key.split('_')
        .filter(|w| !w.is_empty())
        .map(|w| {
            let lower = w.to_lowercase();
            let mut c = lower.chars();
            match c.next() {
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Java `.properties` reader: `key=value`, `#`/`!` comments, `\uXXXX` and backslash escapes,
/// trailing-backslash line continuation.
pub fn parse_properties(text: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let mut logical = String::new();
    for raw in text.lines() {
        let line = if logical.is_empty() { raw.trim_start() } else { raw.trim_start() };
        if logical.is_empty() && (line.is_empty() || line.starts_with('#') || line.starts_with('!')) {
            continue;
        }
        let trailing = line.chars().rev().take_while(|c| *c == '\\').count();
        if trailing % 2 == 1 {
            logical.push_str(&line[..line.len() - 1]);
            continue;
        }
        logical.push_str(line);
        let entry = std::mem::take(&mut logical);
        let sep = entry.find(['=', ':']).unwrap_or(entry.len());
        let key = unescape(entry[..sep].trim());
        let value = if sep < entry.len() { unescape(entry[sep + 1..].trim_start()) } else { String::new() };
        out.insert(key, value);
    }
    out
}

fn unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('u') => {
                let hex: String = chars.by_ref().take(4).collect();
                if let Some(ch) = u32::from_str_radix(&hex, 16).ok().and_then(char::from_u32) {
                    out.push(ch);
                }
            }
            Some('n') => out.push('\n'),
            Some('t') => out.push('\t'),
            Some(other) => out.push(other),
            None => {}
        }
    }
    out
}

/// The catalog currently in use, reloaded only when the Designer installation changes (Tools >
/// Options). An installation without a readable catalog is remembered as `None`, so the sheet
/// falls back to stored values without retrying on every selection.
#[derive(Default)]
pub struct CatalogCache {
    inner: std::sync::Mutex<Option<(String, Option<std::sync::Arc<Catalog>>)>>,
}

impl CatalogCache {
    pub fn get(&self, install_dir: Option<String>, cache_dir: Option<&Path>) -> Option<std::sync::Arc<Catalog>> {
        let dir = install_dir.filter(|d| !d.trim().is_empty())?;
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((cached_dir, catalog)) = guard.as_ref() {
            if *cached_dir == dir {
                return catalog.clone();
            }
        }
        let catalog = load_catalog(Path::new(&dir), cache_dir).ok().map(std::sync::Arc::new);
        *guard = Some((dir, catalog.clone()));
        catalog
    }
}
