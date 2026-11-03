//! Finds the file behind an `import ... from "Name"` of a JDito script, for Ctrl+click in the code
//! editor. A bare name is a process of the project (`process/<Name>/process.js`) or of one of the
//! installed modules (`node_modules/<package>/process/<Name>/process.js`, also below an `@scope`);
//! a relative path is resolved from the importing file. Reads the folder structure only.

use std::path::{Path, PathBuf};

fn existing(candidates: impl IntoIterator<Item = PathBuf>) -> Option<PathBuf> {
    candidates.into_iter().find(|p| p.is_file())
}

fn normalize(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/").replace("/./", "/")
}

fn is_plain_name(spec: &str) -> bool {
    !spec.is_empty() && !spec.contains("..") && !spec.contains('\\') && !spec.starts_with('/') && spec.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | '@' | '/'))
}

/// Process file of `name` in the installed modules; project-owned copies are checked before.
fn in_modules(project_root: &Path, name: &str) -> Option<PathBuf> {
    let modules = project_root.join("node_modules");
    let mut packages: Vec<PathBuf> = Vec::new();
    for entry in std::fs::read_dir(&modules).ok()?.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let dir_name = entry.file_name().to_string_lossy().into_owned();
        if dir_name.starts_with('@') {
            if let Ok(inner) = std::fs::read_dir(&path) {
                packages.extend(inner.flatten().map(|e| e.path()).filter(|p| p.is_dir()));
            }
        } else {
            packages.push(path);
        }
    }
    packages.sort();
    existing(packages.into_iter().map(|p| p.join("process").join(name).join("process.js")))
}

/// Absolute path (forward slashes) of the file an import points to, or `None` when it is not a
/// project file (for example `@aditosoftware/jdito-types`).
pub fn resolve_import(project_root: &Path, spec: &str, from_file: &str) -> Option<String> {
    let spec = spec.trim();
    if spec.starts_with('.') {
        let base = Path::new(from_file).parent()?;
        let target = base.join(spec);
        let found = existing([target.clone(), target.with_extension("js"), target.join("index.js"), target.join("process.js")]);
        return found.map(|p| normalize(&p));
    }
    if spec.starts_with('@') || !is_plain_name(spec) {
        return None;
    }
    let own = project_root.join("process").join(spec).join("process.js");
    existing([own]).or_else(|| in_modules(project_root, spec)).map(|p| normalize(&p))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("forge-import-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(path: &Path) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, "export function A() {}").unwrap();
    }

    #[test]
    fn project_process_wins_over_a_module_copy() {
        let root = scratch("own");
        write(&root.join("process/Contact_lib/process.js"));
        write(&root.join("node_modules/@aditosoftware/contact/process/Contact_lib/process.js"));
        let found = resolve_import(&root, "Contact_lib", "").unwrap();
        assert!(found.ends_with("process/Contact_lib/process.js") && !found.contains("node_modules"));
    }

    #[test]
    fn finds_a_process_of_a_scoped_module() {
        let root = scratch("module");
        write(&root.join("node_modules/@aditosoftware/contact/process/Address_lib/process.js"));
        let found = resolve_import(&root, "Address_lib", "").unwrap();
        assert!(found.ends_with("contact/process/Address_lib/process.js"));
    }

    #[test]
    fn leaves_packages_and_unknown_names_alone() {
        let root = scratch("none");
        assert!(resolve_import(&root, "@aditosoftware/jdito-types", "").is_none());
        assert!(resolve_import(&root, "Missing_lib", "").is_none());
        assert!(resolve_import(&root, "../etc/passwd", "").is_none());
    }

    #[test]
    fn resolves_a_relative_import_from_the_importing_file() {
        let root = scratch("rel");
        write(&root.join("process/A/helper.js"));
        let from = root.join("process/A/process.js");
        let found = resolve_import(&root, "./helper", &from.to_string_lossy()).unwrap();
        assert!(found.ends_with("process/A/helper.js"));
    }
}
