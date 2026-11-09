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
    if !matches!(ext.as_deref(), Some("json") | Some("jsonc") | Some("tmtheme") | Some("plist")) {
        return Err("Choose a .json or .tmTheme theme file.".into());
    }
    let meta = std::fs::metadata(path).map_err(|e| format!("Cannot read the file: {e}"))?;
    if !meta.is_file() || meta.len() > THEME_FILE_LIMIT {
        return Err("The theme file must be a file smaller than 2 MB.".into());
    }
    let bytes = std::fs::read(path).map_err(|e| format!("Cannot read the file: {e}"))?;
    let text = String::from_utf8_lossy(&bytes).into_owned();
    Ok(text.strip_prefix('\u{feff}').map(str::to_string).unwrap_or(text))
}

/// One text file of a theme package: its path inside the package (forward slashes) and its text.
#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
pub struct ThemePackFile {
    pub name: String,
    pub text: String,
}

const THEME_PACK_FILES: usize = 400;
const THEME_PACK_TOTAL: usize = 24 * 1024 * 1024;

fn is_theme_text_file(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".json") || lower.ends_with(".jsonc") || lower.ends_with(".tmtheme") || lower.ends_with(".plist")
}

fn clean_text(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes).into_owned();
    text.strip_prefix('\u{feff}').map(str::to_string).unwrap_or(text)
}

fn collect_pack_dir(base: &Path, dir: &Path, depth: usize, out: &mut Vec<ThemePackFile>, total: &mut usize) {
    if depth > 5 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        if out.len() >= THEME_PACK_FILES {
            return;
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if path.is_dir() {
            if !SKIPPED_DIRS.contains(&name.as_str()) {
                collect_pack_dir(base, &path, depth + 1, out, total);
            }
        } else if is_theme_text_file(&name) {
            let Ok(meta) = entry.metadata() else { continue };
            if meta.len() > THEME_FILE_LIMIT || *total + meta.len() as usize > THEME_PACK_TOTAL {
                continue;
            }
            let Ok(bytes) = std::fs::read(&path) else { continue };
            *total += bytes.len();
            if let Ok(rel) = path.strip_prefix(base) {
                out.push(ThemePackFile { name: rel.to_string_lossy().replace('\\', "/"), text: clean_text(&bytes) });
            }
        }
    }
}

/// Reads what a colour theme can consist of, from anywhere on the computer: a single `.json`/`.jsonc` theme file, an
/// extension package (`.vsix` or `.zip`) or the folder of an extension. All `.json`/`.jsonc` files of the package come
/// back as text (the caller finds the themes through the `package.json` and resolves `include`s); nothing is written or
/// executed.
pub fn read_theme_pack(path: &Path) -> Result<Vec<ThemePackFile>, String> {
    if path.is_dir() {
        let mut out = Vec::new();
        let mut total = 0;
        collect_pack_dir(path, path, 0, &mut out, &mut total);
        return if out.is_empty() { Err("The folder holds no theme files (.json or .tmTheme).".into()) } else { Ok(out) };
    }
    let ext = path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase());
    match ext.as_deref() {
        Some("json") | Some("jsonc") | Some("tmtheme") | Some("plist") => {
            let text = read_theme_file(path)?;
            let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "theme.json".into());
            Ok(vec![ThemePackFile { name, text }])
        }
        Some("vsix") | Some("zip") => {
            let file = std::fs::File::open(path).map_err(|e| format!("Cannot read the file: {e}"))?;
            let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("The file is not a valid extension package: {e}"))?;
            let mut out = Vec::new();
            let mut total = 0usize;
            for i in 0..zip.len() {
                if out.len() >= THEME_PACK_FILES {
                    break;
                }
                let Ok(mut entry) = zip.by_index(i) else { continue };
                let name = entry.name().replace('\\', "/");
                if entry.is_dir() || !is_theme_text_file(&name) || name.contains("..") || entry.size() > THEME_FILE_LIMIT {
                    continue;
                }
                let mut bytes = Vec::new();
                if std::io::Read::read_to_end(&mut entry, &mut bytes).is_err() {
                    continue;
                }
                total += bytes.len();
                if total > THEME_PACK_TOTAL {
                    break;
                }
                out.push(ThemePackFile { name, text: clean_text(&bytes) });
            }
            if out.is_empty() { Err("The package holds no theme files (.json or .tmTheme).".into()) } else { Ok(out) }
        }
        _ => Err("Choose a .json or .tmTheme theme file, a .vsix extension package or the folder of an extension.".into()),
    }
}

#[cfg(test)]
mod theme_pack_tests {
    use super::*;

    #[test]
    fn reads_a_folder_and_a_vsix_and_refuses_other_files() {
        let dir = std::env::temp_dir().join(format!("forge-theme-pack-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("ext/themes")).unwrap();
        std::fs::write(dir.join("ext/package.json"), "{\"name\":\"x\"}").unwrap();
        std::fs::write(dir.join("ext/themes/a-color-theme.json"), "{\"colors\":{}}").unwrap();
        std::fs::write(dir.join("ext/readme.md"), "x").unwrap();
        let mut names: Vec<String> = read_theme_pack(&dir.join("ext")).unwrap().into_iter().map(|f| f.name).collect();
        names.sort();
        assert_eq!(names, vec!["package.json", "themes/a-color-theme.json"]);

        let vsix = dir.join("t.vsix");
        {
            let mut zip = zip::ZipWriter::new(std::fs::File::create(&vsix).unwrap());
            let options = zip::write::SimpleFileOptions::default();
            zip.start_file("extension/package.json", options).unwrap();
            std::io::Write::write_all(&mut zip, b"{}").unwrap();
            zip.start_file("extension/themes/t.json", options).unwrap();
            std::io::Write::write_all(&mut zip, b"{\"colors\":{}}").unwrap();
            zip.start_file("extension/icon.png", options).unwrap();
            std::io::Write::write_all(&mut zip, b"png").unwrap();
            zip.finish().unwrap();
        }
        let files = read_theme_pack(&vsix).unwrap();
        assert_eq!(files.iter().map(|f| f.name.as_str()).collect::<Vec<_>>(), vec!["extension/package.json", "extension/themes/t.json"]);

        let bad = dir.join("t.exe");
        std::fs::write(&bad, "x").unwrap();
        assert!(read_theme_pack(&bad).is_err());
    }
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
