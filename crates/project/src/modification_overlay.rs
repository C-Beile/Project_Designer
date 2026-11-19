use crate::wire::WireValue;
use aod::tree::path::NodePath;
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::fs::{self, File};
use std::hash::{Hash, Hasher};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime};

#[derive(Clone)]
struct Target {
    model_type: String,
    model_name: String,
    file: PathBuf,
}

struct Listed {
    at: Instant,
    generation: u64,
    targets: Vec<Target>,
}

struct Merged {
    generation: u64,
    base: u64,
    files: Vec<(PathBuf, u64, Option<SystemTime>)>,
    root: Arc<WireValue>,
}

type ListCache = OnceLock<Mutex<HashMap<PathBuf, Listed>>>;

const MODULE_LIFETIME: Duration = Duration::from_secs(300);
const PROJECT_LIFETIME: Duration = Duration::from_secs(5);

static GENERATION: AtomicU64 = AtomicU64::new(0);
static MODULES: ListCache = OnceLock::new();
static PROJECTS: ListCache = OnceLock::new();
static MERGED: OnceLock<Mutex<HashMap<PathBuf, Merged>>> = OnceLock::new();

pub fn warm(project_root: PathBuf) {
    std::thread::spawn(move || {
        let _ = modification_files(&project_root, "", "");
    });
}

pub fn bump() {
    GENERATION.fetch_add(1, Ordering::SeqCst);
}

pub fn project_root_of_module_object(object_file: &Path) -> Option<PathBuf> {
    let mut root = PathBuf::new();
    for part in object_file.components() {
        if part.as_os_str() == "node_modules" {
            return (!root.as_os_str().is_empty()).then_some(root);
        }
        root.push(part);
    }
    None
}

fn tag_text(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let start = xml.find(&open)? + open.len();
    let end = xml[start..].find(&format!("</{tag}>"))? + start;
    Some(xml[start..end].trim().to_string())
}

fn target_of(file: &Path) -> Option<Target> {
    let mut head = vec![0u8; 4096];
    let read = File::open(file).ok()?.read(&mut head).ok()?;
    let text = String::from_utf8_lossy(&head[..read]);
    Some(Target { model_type: tag_text(&text, "modelType")?, model_name: tag_text(&text, "modelName")?, file: file.to_path_buf() })
}

fn scan_all(modification_dirs: &[PathBuf]) -> Vec<Target> {
    let mut files: Vec<PathBuf> = Vec::new();
    for dir in modification_dirs {
        let Ok(entries) = fs::read_dir(dir) else { continue };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            files.push(dir.join(&name).join(format!("{name}.aod")));
        }
    }
    app_base::parallel::parallel_map(&files, app_base::parallel::io_threads(), |f| target_of(f)).into_iter().flatten().collect()
}

fn package_dirs(node_modules: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Ok(entries) = fs::read_dir(node_modules) else { return out };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('@') {
            if let Ok(inner) = fs::read_dir(entry.path()) {
                out.extend(inner.flatten().map(|e| e.path()));
            }
        } else if !name.starts_with('.') {
            out.push(entry.path());
        }
    }
    out
}

fn listed(cache: &'static ListCache, root: &Path, lifetime: Duration, scan: impl FnOnce() -> Vec<Target>) -> Vec<Target> {
    let cache = cache.get_or_init(|| Mutex::new(HashMap::new()));
    let generation = GENERATION.load(Ordering::SeqCst);
    let hit = cache.lock().ok().and_then(|c| c.get(root).filter(|l| l.generation == generation && l.at.elapsed() < lifetime).map(|l| l.targets.clone()));
    if let Some(hit) = hit {
        return hit;
    }
    let targets = scan();
    if let Ok(mut c) = cache.lock() {
        c.insert(root.to_path_buf(), Listed { at: Instant::now(), generation, targets: targets.clone() });
    }
    targets
}

pub fn modification_files(project_root: &Path, model_type: &str, model_name: &str) -> Vec<(PathBuf, bool)> {
    let modules = listed(&MODULES, project_root, MODULE_LIFETIME, || {
        let dirs: Vec<PathBuf> = package_dirs(&project_root.join("node_modules")).iter().map(|p| p.join("modification")).collect();
        scan_all(&dirs)
    });
    let own = listed(&PROJECTS, project_root, PROJECT_LIFETIME, || scan_all(&[project_root.join("modification")]));
    let pick = |targets: Vec<Target>, project: bool| -> Vec<(PathBuf, bool)> {
        targets.into_iter().filter(|t| t.model_type == model_type && t.model_name == model_name).map(|t| (t.file, project)).collect()
    };
    let mut out = pick(modules, false);
    out.extend(pick(own, true));
    out
}

fn hash_of(bytes: &[u8]) -> u64 {
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    hasher.finish()
}

fn signature(files: &[(PathBuf, bool)]) -> Vec<(PathBuf, u64, Option<SystemTime>)> {
    files
        .iter()
        .map(|(f, _)| {
            let meta = fs::metadata(f).ok();
            (f.clone(), meta.as_ref().map(|m| m.len()).unwrap_or(0), meta.and_then(|m| m.modified().ok()))
        })
        .collect()
}

pub fn merged_root(object_file: &Path, base_bytes: &[u8], model_type: &str, model_name: &str) -> Option<Arc<WireValue>> {
    let project_root = project_root_of_module_object(object_file)?;
    let files = modification_files(&project_root, model_type, model_name);
    if files.is_empty() {
        return None;
    }
    let cache = MERGED.get_or_init(|| Mutex::new(HashMap::new()));
    let generation = GENERATION.load(Ordering::SeqCst);
    let base = hash_of(base_bytes);
    let files_signature = signature(&files);
    let hit = cache.lock().ok().and_then(|c| c.get(object_file).filter(|m| m.generation == generation && m.base == base && m.files == files_signature).map(|m| m.root.clone()));
    if let Some(hit) = hit {
        return Some(hit);
    }
    let bytes = native_transpiler::own_engine::merge_modifications_into_bytes(base_bytes, &files).ok()?;
    let handle = designer_core::open_project_bytes(object_file.to_path_buf(), &bytes).ok()?;
    let root = Arc::new(WireValue::from_core(handle.value_at(&NodePath::root())?));
    if let Ok(mut c) = cache.lock() {
        c.insert(object_file.to_path_buf(), Merged { generation, base, files: files_signature, root: root.clone() });
    }
    Some(root)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn modification(target: &str) -> String {
        format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\r\n<modification>\r\n  <name>x</name>\r\n  <changeType>INSERT</changeType>\r\n  <modelType>entity</modelType>\r\n  <modelName>{target}</modelName>\r\n  <path>{target}/entityFields</path>\r\n</modification>")
    }

    fn put(dir: &Path, name: &str, target: &str) {
        let folder = dir.join(name);
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join(format!("{name}.aod")), modification(target)).unwrap();
    }

    #[test]
    fn finds_the_project_root_above_node_modules() {
        assert_eq!(project_root_of_module_object(Path::new("/p/node_modules/@a/b/entity/X_entity/X_entity.aod")), Some(PathBuf::from("/p")));
        assert_eq!(project_root_of_module_object(Path::new("/p/entity/X_entity/X_entity.aod")), None);
    }

    #[test]
    fn picks_modifications_of_modules_and_project_by_the_object_they_target() {
        let root = std::env::temp_dir().join(format!("forge-overlay-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        put(&root.join("node_modules/@a/b/modification"), "from-module", "X_entity");
        put(&root.join("node_modules/@a/b/modification"), "other-object", "Y_entity");
        put(&root.join("node_modules/plain/modification"), "from-plain", "X_entity");
        put(&root.join("modification"), "from-project", "X_entity");
        let mut found: Vec<(String, bool)> = modification_files(&root, "entity", "X_entity").into_iter().map(|(f, p)| (f.file_stem().unwrap().to_string_lossy().into_owned(), p)).collect();
        found.sort();
        assert_eq!(found, vec![("from-module".to_string(), false), ("from-plain".to_string(), false), ("from-project".to_string(), true)]);
        assert!(modification_files(&root, "entity", "Z_entity").is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_new_modification_is_seen_after_bump() {
        let root = std::env::temp_dir().join(format!("forge-overlay-bump-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        put(&root.join("modification"), "first", "X_entity");
        assert_eq!(modification_files(&root, "entity", "X_entity").len(), 1);
        put(&root.join("modification"), "second", "X_entity");
        bump();
        assert_eq!(modification_files(&root, "entity", "X_entity").len(), 2);
        let _ = fs::remove_dir_all(&root);
    }
}
