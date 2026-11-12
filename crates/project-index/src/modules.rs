//! Stand der installierten npm-Module: welche Objekte sie bringen und wann sie sich geändert haben.
//! Gleiche Menge wie der alte Problem-Scan (alle Ordner in `node_modules`, `@scope/*` aufgelöst,
//! Ordner mit Punkt am Anfang ausgelassen).

use crate::layout::SCANNED_FOLDERS;
use crate::model::ModuleState;
use platform::fs::file_stamp;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// Object folders whose module objects can be a reference target (or an alias).
const MODULE_FOLDERS: &[&str] = &["entity", "neonView", "entityWebservice", "aliasDefinition"];

pub fn module_package_dirs(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(root.join("node_modules")) else { return out };
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

/// The stamps of the files that tell npm changed something.
pub fn module_stamps(root: &Path) -> ModuleState {
    ModuleState {
        package_json: file_stamp(&root.join("package.json")),
        package_lock: file_stamp(&root.join("package-lock.json")),
        hidden_lock: file_stamp(&root.join("node_modules").join(".package-lock.json")),
        ..ModuleState::default()
    }
}

/// Complete scan of the modules.
pub fn scan_modules(root: &Path) -> ModuleState {
    let mut state = module_stamps(root);
    let packages = module_package_dirs(root);
    for folder in MODULE_FOLDERS {
        let folder: &'static str = SCANNED_FOLDERS.iter().copied().find(|f| f == folder).unwrap_or("entity");
        let mut names = HashSet::new();
        for pkg in &packages {
            names_in(&pkg.join(folder), &mut names);
        }
        state.names_by_folder.insert(folder, names);
    }
    // Aliases of modules: entities name them by their short `targetAliasName`.
    for pkg in &packages {
        let Ok(entries) = std::fs::read_dir(pkg.join("aliasDefinition")) else { continue };
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            let file = e.path().join(format!("{name}.aod"));
            let Ok(bytes) = std::fs::read(&file) else { continue };
            let Ok(handle) = designer_core::open_project_bytes(file, &bytes) else { continue };
            if let Some(short) = handle.value_at(&aod::tree::path::NodePath::root()).and_then(aod::references::target_alias_name) {
                state.alias_targets.insert(short, name);
            }
        }
    }
    state
}

/// True when the stamps differ (npm ran).
pub fn stamps_differ(a: &ModuleState, b: &ModuleState) -> bool {
    a.package_json != b.package_json || a.package_lock != b.package_lock || a.hidden_lock != b.hidden_lock
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_objects_of_scoped_and_plain_packages_but_not_dot_folders() {
        let root = std::env::temp_dir().join(format!("forge-pi-modules-{}", std::process::id()));
        std::fs::create_dir_all(root.join("node_modules/@scope/mod/entity/Scoped_entity")).unwrap();
        std::fs::create_dir_all(root.join("node_modules/plain/neonView/Plain_view")).unwrap();
        std::fs::create_dir_all(root.join("node_modules/.cache/entity/Hidden_entity")).unwrap();
        let s = scan_modules(&root);
        assert!(s.names_by_folder["entity"].contains("Scoped_entity"));
        assert!(s.names_by_folder["neonView"].contains("Plain_view"));
        assert!(!s.names_by_folder["entity"].contains("Hidden_entity"));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn module_aliases_are_known_by_their_short_name() {
        let root = std::env::temp_dir().join(format!("forge-pi-modalias-{}", std::process::id()));
        let dir = root.join("node_modules/@s/m/aliasDefinition/Data_ModAlias");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("Data_ModAlias.aod"), "<aliasDefinition><name>Data_ModAlias</name><aliasDefDb><targetAliasName>ModShort</targetAliasName></aliasDefDb></aliasDefinition>").unwrap();
        let s = scan_modules(&root);
        assert_eq!(s.alias_targets.get("ModShort").map(String::as_str), Some("Data_ModAlias"));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn stamps_change_when_the_lock_file_changes() {
        let root = std::env::temp_dir().join(format!("forge-pi-modstamp-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let a = module_stamps(&root);
        std::fs::write(root.join("package-lock.json"), "{}").unwrap();
        assert!(stamps_differ(&a, &module_stamps(&root)));
        std::fs::remove_dir_all(&root).ok();
    }
}
