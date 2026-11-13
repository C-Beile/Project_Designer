//! Automatic backup before any write: the previous content of every file the app is about to
//! replace is copied to `<app data>/backups/<timestamp>/<original path>`. The hook is registered in
//! the platform layer's `atomic_write`, so every write path of the app is covered (object save,
//! linked JS files, modification patches) without each caller having to remember it.
//! Nothing is ever pruned automatically; the folder can be opened via Help > Open Backup Folder.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

static BACKUP_DIR: OnceLock<PathBuf> = OnceLock::new();
static LAST: Mutex<Option<HashMap<PathBuf, PathBuf>>> = Mutex::new(None);

const MAX_BACKUP_BYTES: u64 = 256 * 1024 * 1024;

pub fn set_backup_dir(dir: PathBuf) {
    let _ = BACKUP_DIR.set(dir);
}

#[must_use]
pub fn backup_dir() -> PathBuf {
    BACKUP_DIR.get().cloned().unwrap_or_else(|| std::env::temp_dir().join("dito-designer-backups"))
}

/// Registers the backup as the before-overwrite hook of every atomic write.
pub fn install() {
    platform::fs::set_before_overwrite_hook(backup_file);
}

fn flatten(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in path.components() {
        let s = c.as_os_str().to_string_lossy();
        let cleaned: String = s.chars().filter(|ch| !matches!(ch, ':' | '\\' | '/' | '?' | '*' | '"' | '<' | '>' | '|')).collect();
        if !cleaned.is_empty() {
            out.push(cleaned);
        }
    }
    out
}

/// Folders a transpile writes into the project folder (result and caches). The file watcher ignores them too.
pub const BUILD_FOLDERS: [&str; 6] = ["dist", "_own_engine_dist", "_forge_experimental_dist", "transpile-cache", "transpile-snapshot", ".forge-incremental-cache"];

/// Files the build writes (the `dist` result of a transpile and the folders of its cache) are made again by every run;
/// a copy of each of them would only slow the transpile down (thousands of files) and fill the backup folder.
fn is_build_output(path: &Path) -> bool {
    path.components().any(|c| BUILD_FOLDERS.iter().any(|f| c.as_os_str().eq_ignore_ascii_case(f)))
}

/// Copies `path` into the backup folder. Identical content to the previous backup of the same file is not stored twice.
pub fn backup_file(path: &Path) -> Result<(), String> {
    if is_build_output(path) {
        return Ok(());
    }
    let meta = std::fs::metadata(path).map_err(|e| format!("{}: {e}", path.display()))?;
    if meta.len() > MAX_BACKUP_BYTES {
        return Err(format!("{} is larger than {} MB, refusing to overwrite it without a backup", path.display(), MAX_BACKUP_BYTES / 1024 / 1024));
    }
    let bytes = std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let key = path.to_path_buf();
    if let Ok(guard) = LAST.lock() {
        if let Some(prev) = guard.as_ref().and_then(|m| m.get(&key)) {
            if std::fs::read(prev).map(|b| b == bytes).unwrap_or(false) {
                return Ok(());
            }
        }
    }
    let stamp = crate::crashlog::timestamp_utc().replace([' ', ':', '-'], "");
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.subsec_millis()).unwrap_or(0);
    let target = backup_dir().join(format!("{stamp}-{nanos:03}")).join(flatten(path));
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    }
    std::fs::write(&target, &bytes).map_err(|e| format!("{}: {e}", target.display()))?;
    if let Ok(mut guard) = LAST.lock() {
        guard.get_or_insert_with(HashMap::new).insert(key, target);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn files_of_the_build_output_are_not_backed_up() {
        assert!(is_build_output(Path::new("C:/p/SVB/dist/entity/A_entity/A_entity.aod")));
        assert!(is_build_output(Path::new("C:/data/transpile-cache/SVB/snapshot/x.aod")));
        assert!(!is_build_output(Path::new("C:/p/SVB/entity/A_entity/A_entity.aod")));
    }

    #[test]
    fn overwriting_a_file_through_atomic_write_keeps_the_previous_content() {
        let root = std::env::temp_dir().join(format!("forge-backup-{}", std::process::id()));
        set_backup_dir(root.join("backups"));
        install();
        let file = root.join("proj").join("entity").join("A_entity.aod");
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(&file, b"version one").unwrap();

        platform::fs::atomic_write(&file, b"version two").unwrap();
        platform::fs::atomic_write(&file, b"version three").unwrap();

        assert_eq!(std::fs::read(&file).unwrap(), b"version three");
        let mut saved: Vec<Vec<u8>> = Vec::new();
        let mut stack = vec![backup_dir()];
        while let Some(d) = stack.pop() {
            for e in std::fs::read_dir(&d).unwrap().flatten() {
                if e.path().is_dir() {
                    stack.push(e.path());
                } else if e.file_name() == "A_entity.aod" {
                    saved.push(std::fs::read(e.path()).unwrap());
                }
            }
        }
        saved.sort();
        assert_eq!(saved, vec![b"version one".to_vec(), b"version two".to_vec()]);
    }

    #[test]
    fn a_first_write_of_a_new_file_needs_no_backup() {
        let root = std::env::temp_dir().join(format!("forge-backup-new-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        install();
        platform::fs::atomic_write(&root.join("fresh.js"), b"x").unwrap();
        assert_eq!(std::fs::read(root.join("fresh.js")).unwrap(), b"x");
    }
}
