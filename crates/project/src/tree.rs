//! Project tree (LAYOUT_SPEC §4.2/§4.4-§4.6, P8 step 2): builds the Projects tree of the original
//! Designer for one project - root node, the sixteen type folders in the Designer's fixed order,
//! the project's root files and "External Libraries".
//!
//! The Designer shows the *merged* model: objects of the project and of every resolved module
//! (`node_modules`, resolved with `npm-modules` like the transpiler pipeline does) appear side by
//! side, module objects carry their origin `@scope/name:version`, and a project object with the
//! same name hides the module's (the same "project root wins" rule the transpiler applies, see
//! `native-transpiler/src/own_engine/modification_engine_stage.rs`). Contexts are the main
//! structure: their entity and all referenced views hang below them, including view references
//! other packages add through `modification/` files.
//!
//! Reading is deliberately a slim tag reader over the few elements the tree needs (`<entity>`,
//! `<neonViewReference>`, `<variants>`, `<publishAsWebservice>`, the modification envelope);
//! nothing here ever writes, and everything under `node_modules` is reported read-only.

use app_base::fs_guard::is_under_node_modules;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::path::{Path, PathBuf};

/// Object families the editors/validators dispatch on (`object_type_for_leaf_path`). Kept as is
/// from the earlier rounds: the folder names were verified against the real corpus there
/// (aod-format.md §2/§3, p4-editor-*-notes.md).
pub const OBJECT_FOLDERS: &[(&str, &str)] = &[
    ("entity", "entity"),
    ("neonView", "neonView"),
    ("neonContext", "neonContext"),
    ("neonDashboard", "neonDashboard"),
    ("aliasDefinition", "aliasDefinition"),
    ("language", "language"),
    ("system", "system"),
    ("preferences", "preferences"),
    ("application", "application"),
    ("entityWebservice", "entityWebservice"),
    ("report", "report"),
];

/// The Designer's type folders in its fixed order (Screenshot 41) with the on-disk folders whose
/// objects they show. `test` has no known disk folder (no corpus project has one) and is always
/// shown empty. `service` also lists `entityWebservice` objects: whether the Designer shows them
/// there is NOT verified yet (open point, see p8-step2-tree-notes.md).
pub const TREE_FOLDERS: &[(&str, &[&str])] = &[
    ("system", &["system"]),
    ("preferences", &["preferences"]),
    ("application", &["application"]),
    ("context", &["neonContext"]),
    ("notificationtype", &["neonNotificationType"]),
    ("entity", &["entity"]),
    ("dashboard", &["neonDashboard"]),
    ("renderer", &["rendererDefinition"]),
    ("process", &["process"]),
    ("test", &[]),
    ("service", &["serviceDefinition", "entityWebservice"]),
    ("report", &["report"]),
    ("language", &["language"]),
    ("role", &["role"]),
    ("alias", &["aliasDefinition"]),
    ("others", &[]),
];

/// Every disk folder holding model objects; `neonView` has no folder of its own in the tree
/// (views hang below their contexts) but must be indexed to resolve those references.
const SCANNED_FOLDERS: &[&str] = &[
    "system",
    "preferences",
    "application",
    "neonContext",
    "neonNotificationType",
    "entity",
    "neonDashboard",
    "rendererDefinition",
    "process",
    "serviceDefinition",
    "entityWebservice",
    "report",
    "language",
    "role",
    "aliasDefinition",
    "neonView",
];

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeKind {
    Project,
    #[default]
    Folder,
    Object,
    File,
    Dir,
    Libraries,
    Module,
}

fn is_false(b: &bool) -> bool {
    !*b
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct TreeNode {
    /// For model objects and files the absolute file path (what `get_property_tree`/`save` take);
    /// synthetic `project:`/`folder:`/`dir:`/`libraries:`/`missing:` ids otherwise. The same object
    /// can appear twice (e.g. an entity in `entity` and below its context), so the id is not a
    /// unique row key - the frontend derives row keys from the parent chain.
    pub id: String,
    pub label: String,
    pub object_type: Option<String>,
    /// No expander: no children and nothing to load lazily.
    pub is_leaf: bool,
    pub children: Vec<TreeNode>,
    pub kind: NodeKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
    /// Packages whose modifications change this module object (LAYOUT_SPEC §4.5).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub overrides: Vec<String>,
    #[serde(skip_serializing_if = "is_false")]
    pub read_only: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub dimmed: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub bold: bool,
    /// Children are fetched on expand via `list_tree_children` (file trees can be huge).
    #[serde(skip_serializing_if = "is_false")]
    pub lazy: bool,
    /// Project root of a module project (`adito.type` is `module` in its package.json).
    #[serde(skip_serializing_if = "is_false")]
    pub module_project: bool,
    /// Type folder key (`context`, `entity`, ...) for the folder colour.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder: Option<String>,
    /// `iconId` of the object (`NEON:IMPORT`, `VAADIN:PRINT`), shown instead of the type symbol.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub type_label: Option<String>,
    /// Display path (forward slashes) for project roots and External Libraries modules.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

impl TreeNode {
    fn folder(id: String, label: &str, folder: &str, children: Vec<TreeNode>) -> TreeNode {
        let empty = children.is_empty();
        TreeNode {
            id,
            label: label.to_string(),
            is_leaf: empty,
            dimmed: empty,
            children,
            kind: NodeKind::Folder,
            folder: Some(folder.to_string()),
            ..TreeNode::default()
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Packages (project + resolved modules)

struct Package {
    dir: PathBuf,
    /// `name:version` from `package.json`; shown as origin for modules and in override chains.
    coordinate: String,
    short_name: String,
    is_project: bool,
}

#[derive(Default)]
struct PackageScan {
    objects: Vec<(&'static str, String, PathBuf)>,
    contexts: HashMap<String, ContextInfo>,
    entity_icons: HashMap<String, String>,
    process_groups: HashMap<String, &'static str>,
    modifications: Vec<Modification>,
    /// Project-only: system folders without their `.aod` (shown dimmed, see `system_nodes`).
    incomplete_systems: Vec<(String, PathBuf)>,
}

#[derive(Clone, Default, Serialize, Deserialize)]
struct ContextInfo {
    entity: Option<String>,
    #[serde(default)]
    icon: Option<String>,
    /// Names of the `<webserviceReference>`s in file order.
    #[serde(default)]
    webservices: Vec<(String, String)>,
    /// `(reference name, view name)` in file order.
    views: Vec<(String, String)>,
}

#[derive(Serialize, Deserialize)]
struct Modification {
    position: i64,
    change: String,
    model_type: String,
    model_name: String,
    path: String,
    /// For an INSERT of a `neonViewReference`: `(reference name, view name)`.
    view_reference: Option<(String, String)>,
    /// For an INSERT of a `<webserviceReference>`: `(reference name, webservice name)`.
    #[serde(default)]
    webservice_reference: Option<(String, String)>,
}

fn forward(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn coordinate_of(def: &npm_modules::ModuleDefinition) -> String {
    format!("{}:{}", def.name, def.version)
}

fn short_name(name: &str) -> String {
    name.rsplit('/').next().unwrap_or(name).to_string()
}

/// The project plus every module the module graph reaches. A project without a readable
/// `package.json` (or with an unresolvable graph) still shows its own objects.
fn collect_packages(project_root: &Path) -> Vec<Package> {
    let folder_name = project_root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let project_coordinate = npm_modules::model::parse_package_json(&project_root.join("package.json"))
        .map(|def| coordinate_of(&def))
        .unwrap_or_else(|_| folder_name.clone());
    let mut packages = vec![Package {
        dir: project_root.to_path_buf(),
        coordinate: project_coordinate,
        short_name: folder_name,
        is_project: true,
    }];
    if let Ok(graph) = npm_modules::resolve_lenient(project_root) {
        for def in graph.modules.values() {
            packages.push(Package {
                dir: def.path.clone(),
                coordinate: coordinate_of(def),
                short_name: short_name(&def.name),
                is_project: false,
            });
        }
    }
    packages
}

// ---------------------------------------------------------------------------------------------
// Slim tag reader

fn tag_text<'a>(xml: &'a str, tag: &str) -> Option<&'a str> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = xml.find(&open)? + open.len();
    let end = xml[start..].find(&close)? + start;
    Some(xml[start..end].trim())
}

fn blocks<'a>(xml: &'a str, tag: &str) -> Vec<&'a str> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let mut out = Vec::new();
    let mut rest = xml;
    while let Some(s) = rest.find(&open) {
        let after = &rest[s + open.len()..];
        let Some(e) = after.find(&close) else { break };
        out.push(&after[..e]);
        rest = &after[e + close.len()..];
    }
    out
}

fn view_references(xml: &str) -> Vec<(String, String)> {
    blocks(xml, "neonViewReference")
        .into_iter()
        .filter_map(|b| Some((tag_text(b, "name").unwrap_or("").to_string(), tag_text(b, "view")?.to_string())))
        .collect()
}

fn webservice_references(xml: &str) -> Vec<(String, String)> {
    blocks(xml, "webserviceReference")
        .into_iter()
        .filter_map(|b| Some((tag_text(b, "name").unwrap_or("").to_string(), tag_text(b, "webservice")?.to_string())))
        .collect()
}

/// The object's own icon: a top-level `<icon>` or `<iconId>` (the first one in the file, before any nested element).
fn top_level_icon(xml: &str) -> Option<String> {
    for line in xml.lines() {
        let line = line.trim();
        for tag in ["icon", "iconId"] {
            if let Some(rest) = line.strip_prefix(&format!("<{tag}>")) {
                if let Some(end) = rest.find(&format!("</{tag}>")) {
                    return Some(rest[..end].trim().to_string()).filter(|v| !v.is_empty());
                }
            }
        }
        if line.starts_with("<references>") || line.starts_with("<entityProvider>") || line.starts_with("<entityFields>") || line.starts_with("<entityField") {
            break;
        }
    }
    None
}

fn head_of_file(path: &Path) -> Option<String> {
    use std::io::Read;
    let mut buf = vec![0u8; 3072];
    let n = fs::File::open(path).ok()?.read(&mut buf).ok()?;
    Some(String::from_utf8_lossy(&buf[..n]).into_owned())
}

fn parse_context(xml: &str) -> ContextInfo {
    let references = tag_text(xml, "references").unwrap_or("");
    ContextInfo {
        entity: tag_text(xml, "entity").map(str::to_string),
        icon: top_level_icon(xml),
        views: view_references(references),
        webservices: webservice_references(references),
    }
}

/// Process subfolder (Screenshot 38). Derived from the corpus (p8-step2-tree-notes.md): a process
/// published as webservice sits in `webservices` even when its variant is EXECUTABLE (seen for
/// `digitalSigningMemberStatusChange_rest`); otherwise the first `<variants>` element decides.
/// `internal` for processes without variants and `workflows` for WORKFLOW are inferred, not seen.
fn process_group(xml: &str) -> &'static str {
    if xml.contains("<publishAsWebservice v=\"true\"") {
        return "webservices";
    }
    let first = tag_text(xml, "variants").and_then(|v| tag_text(v, "element"));
    match first {
        Some("EXECUTABLE") => "executables",
        Some("LIBRARY") => "libraries",
        Some("WORKFLOW") => "workflows",
        _ => "internal",
    }
}

pub const PROCESS_GROUPS: &[&str] = &["executables", "internal", "libraries", "webservices", "workflows"];

fn parse_modification(xml: &str) -> Option<Modification> {
    let position = xml
        .find("<position v=\"")
        .and_then(|i| {
            let rest = &xml[i + 13..];
            rest[..rest.find('"')?].parse::<i64>().ok()
        })
        .unwrap_or(0);
    Some(Modification {
        position,
        change: tag_text(xml, "changeType")?.to_string(),
        model_type: tag_text(xml, "modelType")?.to_string(),
        model_name: tag_text(xml, "modelName")?.to_string(),
        path: tag_text(xml, "path")?.to_string(),
        view_reference: view_references(xml).into_iter().next(),
        webservice_reference: webservice_references(xml).into_iter().next(),
    })
}

fn sub_dirs(dir: &Path) -> Vec<(String, PathBuf)> {
    let Ok(entries) = fs::read_dir(dir) else { return Vec::new() };
    entries
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .filter_map(|e| Some((e.file_name().to_str()?.to_string(), e.path())))
        .collect()
}

/// What one object folder of a package yields; the file reads of different objects are independent.
enum ObjectRead {
    /// The folder has no `.aod` of its own.
    Missing(String, PathBuf),
    Found { name: String, aod: PathBuf, context: Option<ContextInfo>, icon: Option<String>, group: Option<&'static str> },
}

/// Scans one package. `threads` is how many threads may read its files: the project itself is one big package and
/// uses many, the installed modules are already spread over threads by the caller and read their files one by one.
fn scan_package(pkg: &Package, threads: usize) -> PackageScan {
    let mut scan = PackageScan::default();
    for folder in SCANNED_FOLDERS {
        let dirs = sub_dirs(&pkg.dir.join(folder));
        let reads = crate::parallel::parallel_map(&dirs, threads, |(name, dir)| {
            let aod = dir.join(format!("{name}.aod"));
            if !aod.is_file() {
                return ObjectRead::Missing(name.clone(), dir.clone());
            }
            let (mut context, mut icon, mut group) = (None, None, None);
            match *folder {
                "neonContext" => context = fs::read_to_string(&aod).ok().map(|xml| parse_context(&xml)),
                "entity" => icon = head_of_file(&aod).as_deref().and_then(top_level_icon),
                "process" => group = fs::read_to_string(&aod).ok().map(|xml| process_group(&xml)),
                _ => {}
            }
            ObjectRead::Found { name: name.clone(), aod, context, icon, group }
        });
        for read in reads {
            match read {
                ObjectRead::Missing(name, dir) => {
                    if pkg.is_project && *folder == "system" {
                        scan.incomplete_systems.push((name, dir));
                    }
                }
                ObjectRead::Found { name, aod, context, icon, group } => {
                    if let Some(c) = context {
                        scan.contexts.insert(name.clone(), c);
                    }
                    if let Some(i) = icon {
                        scan.entity_icons.insert(name.clone(), i);
                    }
                    if let Some(g) = group {
                        scan.process_groups.insert(name.clone(), g);
                    }
                    scan.objects.push((folder, name, aod));
                }
            }
        }
    }
    let modification_files: Vec<PathBuf> = sub_dirs(&pkg.dir.join("modification"))
        .into_iter()
        .filter_map(|(_, dir)| fs::read_dir(&dir).ok())
        .flat_map(|entries| entries.flatten().map(|f| f.path()).filter(|p| p.extension().and_then(|e| e.to_str()) == Some("aod")).collect::<Vec<_>>())
        .collect();
    let parsed = crate::parallel::parallel_map(&modification_files, threads, |p| fs::read_to_string(p).ok().as_deref().and_then(parse_modification));
    scan.modifications.extend(parsed.into_iter().flatten());
    scan
}

// ---------------------------------------------------------------------------------------------
// Persistent module scan cache
//
// Opening a project reads thousands of small files out of its installed modules. Installed modules
// never change in place (a different version is a different folder state), so their scan result is
// remembered on disk and only re-read when the module's folder stamps differ. The project's own
// objects and linked (symlinked) modules are always read fresh.

const SCAN_CACHE_FORMAT: u32 = 2;

#[derive(Serialize, Deserialize)]
struct StoredScan {
    objects: Vec<(String, String, String)>,
    contexts: HashMap<String, ContextInfo>,
    #[serde(default)]
    entity_icons: HashMap<String, String>,
    process_groups: HashMap<String, String>,
    modifications: Vec<Modification>,
}

#[derive(Serialize, Deserialize)]
struct CacheEntry {
    key: String,
    scan: StoredScan,
}

#[derive(Serialize, Deserialize, Default)]
struct ScanCacheFile {
    format: u32,
    entries: HashMap<String, CacheEntry>,
}

fn store_scan(scan: &PackageScan) -> StoredScan {
    StoredScan {
        objects: scan.objects.iter().map(|(f, n, p)| ((*f).to_string(), n.clone(), p.to_string_lossy().into_owned())).collect(),
        contexts: scan.contexts.clone(),
        entity_icons: scan.entity_icons.clone(),
        process_groups: scan.process_groups.iter().map(|(k, v)| (k.clone(), (*v).to_string())).collect(),
        modifications: scan
            .modifications
            .iter()
            .map(|m| Modification {
                position: m.position,
                change: m.change.clone(),
                model_type: m.model_type.clone(),
                model_name: m.model_name.clone(),
                path: m.path.clone(),
                view_reference: m.view_reference.clone(),
                webservice_reference: m.webservice_reference.clone(),
            })
            .collect(),
    }
}

/// None when the stored data names a folder or process group this build does not know.
fn restore_scan(stored: &StoredScan) -> Option<PackageScan> {
    let mut scan = PackageScan::default();
    for (folder, name, aod) in &stored.objects {
        let folder = SCANNED_FOLDERS.iter().find(|f| *f == folder)?;
        scan.objects.push((folder, name.clone(), PathBuf::from(aod)));
    }
    scan.contexts = stored.contexts.clone();
    scan.entity_icons = stored.entity_icons.clone();
    for (name, group) in &stored.process_groups {
        let group = PROCESS_GROUPS.iter().find(|g| *g == group)?;
        scan.process_groups.insert(name.clone(), group);
    }
    for m in &stored.modifications {
        scan.modifications.push(Modification {
            position: m.position,
            change: m.change.clone(),
            model_type: m.model_type.clone(),
            model_name: m.model_name.clone(),
            path: m.path.clone(),
            view_reference: m.view_reference.clone(),
            webservice_reference: m.webservice_reference.clone(),
        });
    }
    Some(scan)
}

fn scan_cache_dir() -> Option<PathBuf> {
    if std::env::var_os("FORGE_TREE_CACHE").is_some_and(|v| v == "off") {
        return None;
    }
    if let Some(dir) = std::env::var_os("FORGE_TREE_CACHE_DIR") {
        return Some(PathBuf::from(dir));
    }
    let base = std::env::var_os("LOCALAPPDATA").or_else(|| std::env::var_os("XDG_CACHE_HOME")).map(PathBuf::from).or_else(|| {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".cache"))
    })?;
    Some(base.join("DitoDesigner").join("tree-cache"))
}

fn stable_hash(text: &str) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for b in text.bytes() {
        hash ^= u64::from(b);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    hash
}

fn scan_cache_file(project_root: &Path) -> Option<PathBuf> {
    let key = forward(project_root).to_lowercase();
    Some(scan_cache_dir()?.join(format!("scan-{:016x}.json", stable_hash(&key))))
}

fn load_scan_cache(file: &Path) -> ScanCacheFile {
    fs::read(file)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<ScanCacheFile>(&bytes).ok())
        .filter(|c| c.format == SCAN_CACHE_FORMAT)
        .unwrap_or_default()
}

fn save_scan_cache(file: &Path, cache: &ScanCacheFile) {
    let Some(dir) = file.parent() else { return };
    if fs::create_dir_all(dir).is_err() {
        return;
    }
    let Ok(bytes) = serde_json::to_vec(cache) else { return };
    let tmp = file.with_extension("json.tmp");
    if fs::write(&tmp, bytes).is_ok() && fs::rename(&tmp, file).is_err() {
        let _ = fs::remove_file(&tmp);
    }
}

fn stamp(path: &Path) -> String {
    match fs::metadata(path) {
        Ok(md) => {
            let nanos = md
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            format!("{}:{nanos}", md.len())
        }
        Err(_) => "-".to_string(),
    }
}

/// Fingerprint of an installed module; None for anything that must always be read fresh.
fn package_key(pkg: &Package) -> Option<String> {
    if pkg.is_project || !is_under_node_modules(&pkg.dir) {
        return None;
    }
    let link = fs::symlink_metadata(&pkg.dir).ok()?;
    if link.file_type().is_symlink() {
        return None;
    }
    let mut key = format!("{}|{}", pkg.coordinate, stamp(&pkg.dir.join("package.json")));
    for folder in SCANNED_FOLDERS {
        key.push('|');
        key.push_str(&stamp(&pkg.dir.join(folder)));
    }
    key.push('|');
    key.push_str(&stamp(&pkg.dir.join("modification")));
    Some(key)
}

/// Scans all packages in parallel - Pichler has ~130 modules and several thousand files to touch.
/// Installed modules whose fingerprint matches the persisted cache are not read again.
fn scan_packages(project_root: &Path, packages: &[Package]) -> Vec<PackageScan> {
    let cache_file = scan_cache_file(project_root);
    let cached = cache_file.as_deref().map(load_scan_cache).unwrap_or_default();
    let threads = crate::parallel::io_threads();
    let cached_ref = &cached;
    let results: Vec<(PackageScan, Option<(String, String, StoredScan)>)> = crate::parallel::parallel_map(packages, threads, |pkg| {
        let dir_key = forward(&pkg.dir);
        let key = package_key(pkg);
        if let (Some(key), Some(entry)) = (&key, cached_ref.entries.get(&dir_key)) {
            if &entry.key == key {
                if let Some(scan) = restore_scan(&entry.scan) {
                    return (scan, None);
                }
            }
        }
        // The project is one big package: its files are read by many threads. A module is one of many packages.
        let scan = scan_package(pkg, if pkg.is_project { threads } else { 1 });
        let fresh = key.map(|k| (dir_key, k, store_scan(&scan)));
        (scan, fresh)
    });

    let mut scans = Vec::with_capacity(results.len());
    let mut fresh_entries = Vec::new();
    for (scan, fresh) in results {
        scans.push(scan);
        if let Some(entry) = fresh {
            fresh_entries.push(entry);
        }
    }
    if let Some(file) = cache_file {
        if !fresh_entries.is_empty() {
            let mut next = ScanCacheFile { format: SCAN_CACHE_FORMAT, entries: HashMap::new() };
            let current: BTreeSet<String> = packages.iter().map(|p| forward(&p.dir)).collect();
            for (dir, entry) in cached.entries {
                if current.contains(&dir) {
                    next.entries.insert(dir, entry);
                }
            }
            for (dir, key, scan) in fresh_entries {
                next.entries.insert(dir, CacheEntry { key, scan });
            }
            save_scan_cache(&file, &next);
        }
    }
    scans
}

// ---------------------------------------------------------------------------------------------
// Merge

struct ObjRef {
    aod: PathBuf,
    pkg: usize,
}

struct Model<'a> {
    packages: &'a [Package],
    objects: HashMap<&'static str, BTreeMap<String, ObjRef>>,
    /// `(modelType, modelName)` -> packages whose modifications target it.
    modified_by: HashMap<(String, String), BTreeSet<usize>>,
}

fn sort_key(label: &str) -> (String, String) {
    (label.to_lowercase(), label.to_string())
}

fn sort_nodes(nodes: &mut [TreeNode]) {
    nodes.sort_by_cached_key(|n| sort_key(&n.label));
}

impl Model<'_> {
    fn object_node(&self, disk_folder: &str, name: &str, object_type: &str) -> TreeNode {
        let Some(obj) = self.objects.get(disk_folder).and_then(|m| m.get(name)) else {
            // A reference to an object no package provides - shown, but dimmed and not openable.
            return TreeNode {
                id: format!("missing:{disk_folder}/{name}"),
                label: name.to_string(),
                object_type: Some(object_type.to_string()),
                is_leaf: true,
                kind: NodeKind::Object,
                dimmed: true,
                ..TreeNode::default()
            };
        };
        let pkg = &self.packages[obj.pkg];
        let (origin, overrides) = if pkg.is_project {
            (None, Vec::new())
        } else {
            let mut chain: Vec<usize> = self
                .modified_by
                .get(&(disk_folder.to_string(), name.to_string()))
                .map(|s| s.iter().copied().filter(|p| *p != obj.pkg).collect())
                .unwrap_or_default();
            // Assumed order of the chain: modules first, the project last (the order the
            // transpiler applies modifications in) - not verified against the Designer.
            chain.sort_by_key(|p| (self.packages[*p].is_project, *p));
            // The Designer shows only the package that changed the object last (Clemens,
            // 2026-10-12: Address_entity -> "(@3hills-IT/easescreen:1.6.5-RC1)").
            (Some(pkg.coordinate.clone()), chain.last().map(|p| self.packages[*p].coordinate.clone()).into_iter().collect())
        };
        let mut node = TreeNode {
            id: obj.aod.to_string_lossy().into_owned(),
            label: name.to_string(),
            object_type: Some(object_type.to_string()),
            is_leaf: true,
            kind: NodeKind::Object,
            read_only: !pkg.is_project,
            origin,
            overrides,
            ..TreeNode::default()
        };
        // Liquibase changelogs of a database alias live in `<package>/.liquibase/<alias>/` and are
        // shown below the alias, like in the original Designer (manual 14.5.2).
        if disk_folder == "aliasDefinition" {
            if let Ok(children) = list_dir(&pkg.dir.join(".liquibase").join(name)) {
                if !children.is_empty() {
                    node.is_leaf = false;
                    node.children = children;
                }
            }
        }
        node
    }

    fn names(&self, disk_folder: &str) -> Vec<String> {
        self.objects.get(disk_folder).map(|m| m.keys().cloned().collect()).unwrap_or_default()
    }
}

/// All `<neonViewReference>`s of a context after applying the modifications of every package:
/// modules first, then the project, each by `<position>` (the transpiler's order). Duplicates are
/// kept on purpose - the Designer lists a view twice when a module inserts a reference the
/// context already has (Screenshot 25, `ActivityUniversalFileProcessorFilter_view`).
fn effective_context_views(base: &ContextInfo, context: &str, mods: &[(bool, &Modification)]) -> Vec<(String, String)> {
    let mut refs = base.views.clone();
    let references_path = format!("{context}/references");
    for (_, m) in mods {
        if m.model_type != "neonContext" || m.model_name != context {
            continue;
        }
        match m.change.as_str() {
            "INSERT" if m.path == references_path => {
                if let Some(r) = &m.view_reference {
                    refs.push(r.clone());
                }
            }
            "DELETE" => {
                if let Some(ref_name) = m.path.strip_prefix(&format!("{references_path}/")) {
                    refs.retain(|(n, _)| n != ref_name);
                }
            }
            _ => {}
        }
    }
    refs
}

/// The `<webserviceReference>`s of a context after the modifications of every package, like the views.
fn effective_context_webservices(base: &ContextInfo, context: &str, mods: &[(bool, &Modification)]) -> Vec<(String, String)> {
    let mut refs = base.webservices.clone();
    let references_path = format!("{context}/references");
    for (_, m) in mods {
        if m.model_type != "neonContext" || m.model_name != context {
            continue;
        }
        match m.change.as_str() {
            "INSERT" if m.path == references_path => {
                if let Some(r) = &m.webservice_reference {
                    refs.push(r.clone());
                }
            }
            "DELETE" => {
                if let Some(ref_name) = m.path.strip_prefix(&format!("{references_path}/")) {
                    refs.retain(|(n, _)| n != ref_name);
                }
            }
            _ => {}
        }
    }
    refs
}

// ---------------------------------------------------------------------------------------------
// Default system (bold in the system folder)

/// The Designer keeps the default system per project in its own user profile, not in the project:
/// `%APPDATA%/.aditodesigner/<version>/config/Preferences/de/adito/designer/netbeans/
/// DesignerBase.properties`, key `file:/<project path>/project.systemConfig.name` (Pichler -> qs_bg,
/// matching Screenshot 41). Read only; the most recently written profile wins.
pub fn designer_preference_files() -> Vec<PathBuf> {
    let base = app_base::designer_paths::default_profiles_root();
    let mut files: Vec<(std::time::SystemTime, PathBuf)> = sub_dirs(&base)
        .into_iter()
        .map(|(_, d)| d.join("config/Preferences/de/adito/designer/netbeans/DesignerBase.properties"))
        .filter_map(|f| Some((fs::metadata(&f).ok()?.modified().ok()?, f)))
        .collect();
    files.sort_by(|a, b| b.0.cmp(&a.0));
    files.into_iter().map(|(_, f)| f).collect()
}

fn unescape_properties(s: &str) -> String {
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
            Some(other) => out.push(other),
            None => {}
        }
    }
    out
}

fn normalized_key_path(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_lowercase()
}

pub fn default_system_from_properties(content: &str, project_root: &Path) -> Option<String> {
    let wanted = format!("file:/{}/project.systemconfig.name", normalized_key_path(&forward(project_root)));
    content.lines().find_map(|line| {
        let line = line.trim();
        if line.starts_with('#') {
            return None;
        }
        let split = line.char_indices().find(|(i, c)| *c == '=' && (*i == 0 || line.as_bytes()[i - 1] != b'\\'))?.0;
        let key = unescape_properties(&line[..split]);
        (normalized_key_path(&key) == wanted).then(|| unescape_properties(&line[split + 1..]).trim().to_string())
    })
}

fn default_system(project_root: &Path, preference_files: &[PathBuf]) -> Option<String> {
    preference_files
        .iter()
        .filter_map(|f| fs::read(f).ok())
        .find_map(|b| default_system_from_properties(&String::from_utf8_lossy(&b), project_root))
}

// ---------------------------------------------------------------------------------------------
// Files

/// Folders of a project that the Designer never shows as such (Screenshot 41/26): every root folder
/// is either one of the type folders or hidden (`node_modules`, `dist`, `.git`, `.aditoprj`,
/// `data`, `docs`, `modification`, `scripts`, `.liquibase`, `.claude`, ...).
fn root_files(project_root: &Path) -> Vec<TreeNode> {
    let Ok(entries) = fs::read_dir(project_root) else { return Vec::new() };
    let mut files: Vec<TreeNode> = entries
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .map(|e| file_node(&e.path(), false))
        .collect();
    sort_files(&mut files);
    files
}

/// Name first, extension second (`package.json` before `package-lock.json`, Screenshot 41),
/// case-insensitive.
fn file_sort_key(name: &str) -> (String, String) {
    let lower = name.to_lowercase();
    match lower.rfind('.') {
        Some(i) if i > 0 => (lower[..i].to_string(), lower[i..].to_string()),
        _ => (lower, String::new()),
    }
}

fn sort_files(nodes: &mut [TreeNode]) {
    nodes.sort_by_cached_key(|n| file_sort_key(&n.label));
}

fn file_node(path: &Path, read_only: bool) -> TreeNode {
    TreeNode {
        id: path.to_string_lossy().into_owned(),
        label: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        is_leaf: true,
        kind: NodeKind::File,
        read_only,
        ..TreeNode::default()
    }
}

fn dir_has_entries(dir: &Path) -> bool {
    fs::read_dir(dir).map(|mut e| e.next().is_some()).unwrap_or(false)
}

/// One level of a plain file tree: folders first, then files.
pub fn list_dir(dir: &Path) -> Result<Vec<TreeNode>, String> {
    let read_only = is_under_node_modules(dir);
    let entries = fs::read_dir(dir).map_err(|e| format!("failed to read '{}': {e}", dir.display()))?;
    let mut dirs = Vec::new();
    let mut files = Vec::new();
    for e in entries.flatten() {
        let path = e.path();
        if e.file_type().is_ok_and(|t| t.is_dir()) {
            let has = dir_has_entries(&path);
            dirs.push(TreeNode {
                id: format!("dir:{}", path.to_string_lossy()),
                label: e.file_name().to_string_lossy().into_owned(),
                is_leaf: !has,
                lazy: has,
                kind: NodeKind::Dir,
                read_only,
                ..TreeNode::default()
            });
        } else {
            files.push(file_node(&path, read_only));
        }
    }
    sort_nodes(&mut dirs);
    sort_files(&mut files);
    dirs.extend(files);
    Ok(dirs)
}

/// Children of a lazily loaded node (`dir:<path>` ids: folders of `others`; `module:<path>` ids: an installed module,
/// shown like a project).
pub fn list_tree_children(node_id: &str) -> Result<Vec<TreeNode>, String> {
    if let Some(path) = node_id.strip_prefix("module:") {
        return Ok(module_children(Path::new(path)));
    }
    let path = node_id.strip_prefix("dir:").ok_or_else(|| format!("node '{node_id}' has no lazily loaded children"))?;
    list_dir(Path::new(path))
}

/// What an installed module shows below its name in External Libraries: the same type folders as a project (context,
/// entity, process ...) with the objects the module brings, then its files of the top level.
fn module_children(dir: &Path) -> Vec<TreeNode> {
    let folder_name = dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let coordinate = npm_modules::model::parse_package_json(&dir.join("package.json")).map(|d| coordinate_of(&d)).unwrap_or_else(|_| folder_name.clone());
    let pkg = Package { dir: dir.to_path_buf(), coordinate, short_name: folder_name, is_project: false };
    let scan = scan_package(&pkg, crate::parallel::io_threads());
    let mut nodes = module_folder_nodes(&pkg, &scan);
    nodes.extend(root_files(dir).into_iter().map(|mut n| {
        n.read_only = true;
        n
    }));
    nodes
}

/// The type folders of one module, built with the same code as the folders of a project.
fn module_folder_nodes(pkg: &Package, scan: &PackageScan) -> Vec<TreeNode> {
    let packages = std::slice::from_ref(pkg);
    let mut model = Model { packages, objects: HashMap::new(), modified_by: HashMap::new() };
    for (folder, name, aod) in &scan.objects {
        model.objects.entry(*folder).or_default().insert(name.clone(), ObjRef { aod: aod.clone(), pkg: 0 });
    }
    let mods: Vec<(bool, &Modification)> = scan.modifications.iter().map(|m| (false, m)).collect();
    let root_id = forward(&pkg.dir);
    let mut children = Vec::new();
    for (label, disk_folders) in TREE_FOLDERS {
        let id = format!("folder:{root_id}|{label}");
        let node = match *label {
            "context" => TreeNode::folder(id, label, label, context_nodes(&model, &scan.contexts, &scan.entity_icons, &mods)),
            "process" => TreeNode::folder(id.clone(), label, label, process_nodes(&model, &scan.process_groups, &id)),
            "others" => TreeNode::folder(id, label, label, others_nodes(packages)),
            _ => {
                let mut nodes: Vec<TreeNode> = disk_folders
                    .iter()
                    .flat_map(|f| model.names(f).into_iter().map(move |n| (*f, n)))
                    .map(|(f, n)| {
                        let mut node = model.object_node(f, &n, f);
                        if f == "entity" {
                            node.icon = scan.entity_icons.get(&n).cloned();
                        }
                        node
                    })
                    .collect();
                sort_nodes(&mut nodes);
                TreeNode::folder(id, label, label, nodes)
            }
        };
        children.push(node);
    }
    // Only the folders the module really brings: an installed module has few of the type folders of a project.
    children.retain(|c| !c.children.is_empty());
    for folder in &mut children {
        folder.read_only = true;
    }
    children
}

// ---------------------------------------------------------------------------------------------
// Tree assembly

/// Scans one project and returns its root node (one element, so a caller can treat a project list
/// as a forest). Errors only on an unusable root path.
pub fn scan_project_tree(project_root: &Path) -> Result<Vec<TreeNode>, String> {
    scan_project_tree_with(project_root, &designer_preference_files())
}

pub fn scan_project_tree_with(project_root: &Path, preference_files: &[PathBuf]) -> Result<Vec<TreeNode>, String> {
    // An empty path means "no project chosen yet", never a scan attempt (R41 lesson).
    if project_root.as_os_str().is_empty() {
        return Err("no project folder selected".to_string());
    }
    if !project_root.is_dir() {
        return Err(format!("project root '{}' is not a directory", project_root.display()));
    }

    let packages = collect_packages(project_root);
    let module_project = npm_modules::model::parse_package_json(&project_root.join("package.json")).map(|d| d.adito_type == npm_modules::AditoType::Module).unwrap_or(false);
    let scans = scan_packages(project_root, &packages);

    let mut model = Model { packages: &packages, objects: HashMap::new(), modified_by: HashMap::new() };
    let mut contexts: HashMap<String, ContextInfo> = HashMap::new();
    let mut entity_icons: HashMap<String, String> = HashMap::new();
    let mut process_groups: HashMap<String, &'static str> = HashMap::new();
    // Packages are in project-first order, so `or_insert` lets the project win name clashes.
    for (pkg_index, scan) in scans.iter().enumerate() {
        for (folder, name, aod) in &scan.objects {
            let entry = model.objects.entry(*folder).or_default();
            if !entry.contains_key(name) {
                entry.insert(name.clone(), ObjRef { aod: aod.clone(), pkg: pkg_index });
                if *folder == "neonContext" {
                    if let Some(c) = scan.contexts.get(name) {
                        contexts.insert(name.clone(), c.clone());
                    }
                }
                if *folder == "entity" {
                    if let Some(i) = scan.entity_icons.get(name) {
                        entity_icons.insert(name.clone(), i.clone());
                    }
                }
                if *folder == "process" {
                    if let Some(g) = scan.process_groups.get(name) {
                        process_groups.insert(name.clone(), g);
                    }
                }
            }
        }
        for m in &scan.modifications {
            model.modified_by.entry((m.model_type.clone(), m.model_name.clone())).or_default().insert(pkg_index);
        }
    }

    let mut ordered_mods: Vec<(bool, &Modification)> = scans
        .iter()
        .enumerate()
        .flat_map(|(i, s)| { let is_project = packages[i].is_project; s.modifications.iter().map(move |m| (is_project, m)) })
        .collect();
    ordered_mods.sort_by_key(|(is_project, m)| (*is_project, m.position));

    let root_id = forward(project_root);
    let mut children = Vec::new();
    for (label, disk_folders) in TREE_FOLDERS {
        let id = format!("folder:{root_id}|{label}");
        let node = match *label {
            "system" => {
                let mut nodes = system_nodes(&model, &scans[0], project_root, preference_files);
                // A module project is not built or deployed itself: its system folder is shown greyed out.
                for n in &mut nodes {
                    n.dimmed |= module_project;
                }
                let mut folder = TreeNode::folder(id, label, label, nodes);
                folder.dimmed |= module_project;
                folder
            }
            "context" => TreeNode::folder(id, label, label, context_nodes(&model, &contexts, &entity_icons, &ordered_mods)),
            "process" => TreeNode::folder(id.clone(), label, label, process_nodes(&model, &process_groups, &id)),
            "others" => TreeNode::folder(id, label, label, others_nodes(&packages)),
            _ => {
                let mut nodes: Vec<TreeNode> = disk_folders
                    .iter()
                    .flat_map(|f| model.names(f).into_iter().map(move |n| (*f, n)))
                    .map(|(f, n)| {
                        let mut node = model.object_node(f, &n, f);
                        if f == "entity" {
                            node.icon = entity_icons.get(&n).cloned();
                        }
                        node
                    })
                    .collect();
                sort_nodes(&mut nodes);
                TreeNode::folder(id, label, label, nodes)
            }
        };
        children.push(node);
    }
    children.extend(root_files(project_root));
    children.push(external_libraries(&packages, &scans, &root_id));

    Ok(vec![TreeNode {
        id: format!("project:{root_id}"),
        label: packages[0].short_name.clone(),
        is_leaf: false,
        children,
        kind: NodeKind::Project,
        bold: true,
        module_project,
        type_label: project_name(&model),
        path: Some(root_id),
        ..TreeNode::default()
    }])
}

/// The bracket text behind the project name is the project property "Name" (Screenshot 50), stored
/// as `<projectName>` in the project preferences (Pichler: "ADITO xRM", Hermes: "hermes xRM2026").
fn project_name(model: &Model) -> Option<String> {
    let obj = model.objects.get("preferences")?.get("_____PREFERENCES_PROJECT")?;
    let xml = fs::read_to_string(&obj.aod).ok()?;
    tag_text(&xml, "projectName").filter(|s| !s.is_empty()).map(str::to_string)
}

fn system_nodes(model: &Model, project_scan: &PackageScan, project_root: &Path, preference_files: &[PathBuf]) -> Vec<TreeNode> {
    let default = default_system(project_root, preference_files);
    let mut nodes: Vec<TreeNode> = model.names("system").iter().map(|n| model.object_node("system", n, "system")).collect();
    // A system folder without its `.aod` cannot be used - shown dimmed like the Designer's
    // unavailable systems. Whether that is the Designer's actual criterion is not verified.
    for (name, dir) in &project_scan.incomplete_systems {
        nodes.push(TreeNode {
            id: format!("missing:{}", dir.to_string_lossy()),
            label: name.clone(),
            object_type: Some("system".into()),
            is_leaf: true,
            kind: NodeKind::Object,
            dimmed: true,
            ..TreeNode::default()
        });
    }
    for n in &mut nodes {
        n.bold = default.as_deref() == Some(n.label.as_str());
    }
    sort_nodes(&mut nodes);
    nodes
}

fn context_nodes(model: &Model, contexts: &HashMap<String, ContextInfo>, entity_icons: &HashMap<String, String>, mods: &[(bool, &Modification)]) -> Vec<TreeNode> {
    let mut nodes: Vec<TreeNode> = model
        .names("neonContext")
        .iter()
        .map(|name| {
            let mut node = model.object_node("neonContext", name, "neonContext");
            let info = contexts.get(name).cloned().unwrap_or_default();
            let mut views: Vec<TreeNode> = effective_context_views(&info, name, mods)
                .into_iter()
                .map(|(_, view)| model.object_node("neonView", &view, "neonView"))
                .collect();
            sort_nodes(&mut views);
            node.icon = info.icon.clone();
            let mut children = Vec::new();
            if let Some(entity) = &info.entity {
                let mut entity_node = model.object_node("entity", entity, "entity");
                entity_node.icon = entity_icons.get(entity).cloned();
                children.push(entity_node);
            }
            children.extend(views);
            children.extend(
                effective_context_webservices(&info, name, mods)
                    .into_iter()
                    .map(|(_, ws)| model.object_node("entityWebservice", &ws, "entityWebservice")),
            );
            // Entity, views and webservices are listed together in one alphabetical order (Designer, Screenshot 2026-11-06).
            sort_nodes(&mut children);
            node.is_leaf = children.is_empty();
            node.children = children;
            node
        })
        .collect();
    sort_nodes(&mut nodes);
    nodes
}

fn process_nodes(model: &Model, groups: &HashMap<String, &'static str>, parent_id: &str) -> Vec<TreeNode> {
    let mut by_group: BTreeMap<&str, Vec<TreeNode>> = BTreeMap::new();
    for name in model.names("process") {
        let group = groups.get(&name).copied().unwrap_or("internal");
        by_group.entry(group).or_default().push(model.object_node("process", &name, "process"));
    }
    PROCESS_GROUPS
        .iter()
        .filter_map(|g| {
            let mut nodes = by_group.remove(g)?;
            sort_nodes(&mut nodes);
            let mut folder = TreeNode::folder(format!("{parent_id}|{g}"), g, "plain", nodes);
            folder.dimmed = false;
            Some(folder)
        })
        .collect()
}

/// `others` merges the `others/` folders of the project and of every module (each Pichler module
/// ships one, the project's own is empty there although the Designer shows `others` expandable) -
/// an assumption about the Designer's content, the screenshots only show the folder collapsed.
/// Module entries carry their origin; a project entry of the same name hides the module's.
fn others_nodes(packages: &[Package]) -> Vec<TreeNode> {
    let mut by_name: BTreeMap<String, TreeNode> = BTreeMap::new();
    for pkg in packages {
        let Ok(mut entries) = list_dir(&pkg.dir.join("others")) else { continue };
        for node in &mut entries {
            if !pkg.is_project {
                node.origin = Some(pkg.coordinate.clone());
            }
        }
        for node in entries {
            by_name.entry(node.label.clone()).or_insert(node);
        }
    }
    let (mut dirs, mut files): (Vec<TreeNode>, Vec<TreeNode>) = by_name.into_values().partition(|n| n.kind == NodeKind::Dir);
    sort_nodes(&mut dirs);
    sort_files(&mut files);
    dirs.extend(files);
    dirs
}

/// External Libraries (§4.6): one node per resolved module that actually is an ADITO module
/// (adito.type "module" or carrying model objects/modifications), name bold without scope,
/// absolute path dimmed; its file tree loads lazily.
fn external_libraries(packages: &[Package], scans: &[PackageScan], root_id: &str) -> TreeNode {
    let mut modules: Vec<TreeNode> = packages
        .iter()
        .zip(scans)
        .skip(1)
        .filter(|(p, s)| {
            !s.objects.is_empty()
                || !s.modifications.is_empty()
                || npm_modules::model::parse_package_json(&p.dir.join("package.json"))
                    .is_ok_and(|d| d.adito_type == npm_modules::AditoType::Module)
        })
        .map(|(p, _)| TreeNode {
            id: format!("module:{}", p.dir.to_string_lossy()),
            label: p.short_name.clone(),
            is_leaf: false,
            kind: NodeKind::Module,
            bold: true,
            lazy: true,
            read_only: true,
            origin: Some(p.coordinate.clone()),
            path: Some(forward(&p.dir)),
            ..TreeNode::default()
        })
        .collect();
    sort_nodes(&mut modules);
    TreeNode {
        id: format!("libraries:{root_id}"),
        label: "External Libraries".into(),
        is_leaf: modules.is_empty(),
        children: modules,
        kind: NodeKind::Libraries,
        ..TreeNode::default()
    }
}

// ---------------------------------------------------------------------------------------------
// Leaf helpers used by the project actor

/// Resolves a leaf node id back to its file path, validating it actually points at a real file -
/// the guard against a stale/forged node id reaching `designer_core::open_project`.
pub fn resolve_leaf_path(node_id: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(node_id);
    if !path.is_file() {
        return Err(format!("node id '{node_id}' does not resolve to a real file"));
    }
    Ok(path)
}

/// Determines the `object_type` for an already-resolved leaf path by walking up its ancestor
/// directories and matching `OBJECT_FOLDERS` - used by `project_actor.rs::ensure_open` to pick the
/// validator family.
pub fn object_type_for_leaf_path(path: &Path) -> Option<&'static str> {
    for ancestor in path.ancestors() {
        let Some(name) = ancestor.file_name().and_then(|n| n.to_str()) else { continue };
        if let Some((_, object_type)) = OBJECT_FOLDERS.iter().find(|(folder_name, _)| *folder_name == name) {
            return Some(object_type);
        }
    }
    None
}

#[cfg(test)]
#[path = "tree_tests.rs"]
mod tests;
