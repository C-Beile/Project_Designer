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

const THEME_FILE_LIMIT: u64 = 2 * 1024 * 1024;

/// Reads a colour theme file the user picked anywhere on the computer (a VS Code theme). Only
/// `.json` and `.jsonc` files up to 2 MB are read, as text; nothing is written or executed.
pub fn read_theme_file(path: &Path) -> Result<String, String> {
    let ext = path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase());
    if !matches!(ext.as_deref(), Some("json") | Some("jsonc")) {
        return Err("Choose a .json theme file.".into());
    }
    let meta = std::fs::metadata(path).map_err(|e| format!("Cannot read the file: {e}"))?;
    if !meta.is_file() || meta.len() > THEME_FILE_LIMIT {
        return Err("The theme file must be a file smaller than 2 MB.".into());
    }
    let bytes = std::fs::read(path).map_err(|e| format!("Cannot read the file: {e}"))?;
    let text = String::from_utf8_lossy(&bytes).into_owned();
    Ok(text.strip_prefix('\u{feff}').map(str::to_string).unwrap_or(text))
}

#[cfg(test)]
mod theme_file_tests {
    use super::*;

    #[test]
    fn reads_json_and_refuses_other_files() {
        let dir = std::env::temp_dir().join(format!("forge-theme-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let ok = dir.join("t.json");
        std::fs::write(&ok, "\u{feff}{\"name\":\"x\"}").unwrap();
        assert_eq!(read_theme_file(&ok).unwrap(), "{\"name\":\"x\"}");
        let bad = dir.join("t.exe");
        std::fs::write(&bad, "x").unwrap();
        assert!(read_theme_file(&bad).is_err());
        assert!(read_theme_file(&dir.join("missing.json")).is_err());
    }
}
