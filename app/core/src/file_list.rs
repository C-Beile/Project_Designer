//! File names of a project for the quick file search (double Ctrl). Names only: nothing is read.

use std::path::Path;

const SKIPPED_DIRS: [&str; 6] = ["node_modules", "dist", ".git", ".idea", ".vscode", ".aditoprj"];
const LIMIT: usize = 100_000;

fn walk(base: &Path, dir: &Path, out: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        if out.len() >= LIMIT {
            return;
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if path.is_dir() {
            if !SKIPPED_DIRS.contains(&name.as_str()) {
                walk(base, &path, out);
            }
        } else if let Ok(rel) = path.strip_prefix(base) {
            out.push(rel.to_string_lossy().replace('\\', "/"));
        }
    }
}

/// Relative paths (forward slashes) of all files of the project except dependencies and generated
/// folders, sorted.
pub fn list_project_files(root: &Path) -> Vec<String> {
    let mut out = Vec::new();
    walk(root, root, &mut out);
    out.sort_by_key(|p| p.to_ascii_lowercase());
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_project_files_and_skips_dependencies_and_output() {
        let root = std::env::temp_dir().join(format!("forge-filelist-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        for p in ["entity/A/A.aod", "process/B/process.js", "node_modules/m/x.js", "dist/entity/A/A.aod", ".git/config"] {
            let f = root.join(p);
            std::fs::create_dir_all(f.parent().unwrap()).unwrap();
            std::fs::write(f, "x").unwrap();
        }
        assert_eq!(list_project_files(&root), vec!["entity/A/A.aod".to_string(), "process/B/process.js".to_string()]);
    }
}
