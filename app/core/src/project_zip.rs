//! File > Export Project / Import Project (manual 4.1.2): selected data models of the project go
//! into one zip file and come back from a zip file into a project.
//!
//! Layout of the zip: `<type folder>/<Name>/<file>` with forward slashes, i.e. the project
//! layout itself, so the file can also be unpacked by hand. The layout of the original
//! Designer's export file is NOT verified; the import therefore also accepts one extra top-level
//! folder around that layout.
//!
//! Business rules: only the project's own objects are exported (never installed modules). An
//! import never deletes anything: models that already exist are skipped unless the user chose to
//! overwrite them, and overwriting replaces the files that are in the zip while files only the
//! old model has stay as they are.

use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

use crate::tree::OBJECT_FOLDERS;

const MAX_TOTAL_BYTES: u64 = 2 * 1024 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ModelEntry {
    pub folder: String,
    pub name: String,
    pub files: usize,
    /// Latest change of the model's files, seconds since 1970 (0 when unknown, e.g. inside a zip).
    pub modified_secs: u64,
    /// Import only: a model with this name already exists in the project.
    pub exists: bool,
}

fn known_folder(folder: &str) -> bool {
    OBJECT_FOLDERS.iter().any(|(f, _)| *f == folder)
        || crate::new_object::kinds().iter().any(|k| k.folder == folder)
        || matches!(folder, "userhelp")
}

fn safe_segment(s: &str) -> bool {
    !s.is_empty() && s != "." && s != ".." && !s.contains(['\\', ':', '/']) && !s.chars().any(|c| c.is_control())
}

fn files_below(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    let mut items: Vec<_> = entries.flatten().collect();
    items.sort_by_key(|e| e.file_name());
    for e in items {
        let p = e.path();
        if p.is_dir() {
            files_below(&p, out);
        } else if p.is_file() {
            out.push(p);
        }
    }
}

/// All data models of the project itself (not of its modules), ordered by type and name.
pub fn list_models(root: &Path) -> Vec<ModelEntry> {
    let mut out = Vec::new();
    let mut folders: Vec<String> = OBJECT_FOLDERS.iter().map(|(f, _)| f.to_string()).collect();
    folders.extend(crate::new_object::kinds().into_iter().map(|k| k.folder));
    folders.push("userhelp".into());
    folders.sort();
    folders.dedup();
    for folder in folders {
        let Ok(entries) = fs::read_dir(root.join(&folder)) else { continue };
        let mut dirs: Vec<_> = entries.flatten().filter(|e| e.path().is_dir()).collect();
        dirs.sort_by_key(|e| e.file_name());
        for d in dirs {
            let name = d.file_name().to_string_lossy().into_owned();
            if !d.path().join(format!("{name}.aod")).is_file() {
                continue;
            }
            let mut files = Vec::new();
            files_below(&d.path(), &mut files);
            let modified_secs = files
                .iter()
                .filter_map(|f| fs::metadata(f).ok()?.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .max()
                .unwrap_or(0);
            out.push(ModelEntry { folder: folder.clone(), name, files: files.len(), modified_secs, exists: false });
        }
    }
    out
}

/// Writes the chosen models into a new zip file. An existing target file is refused.
pub fn export_zip(root: &Path, models: &[(String, String)], target: &Path) -> Result<usize, String> {
    if models.is_empty() {
        return Err("Select at least one data model.".into());
    }
    if target.exists() {
        return Err("The target file already exists.".into());
    }
    let mut jobs: Vec<(String, PathBuf)> = Vec::new();
    for (folder, name) in models {
        if !known_folder(folder) || !safe_segment(name) {
            return Err(format!("{folder}/{name} is not a data model of the project."));
        }
        let dir = root.join(folder).join(name);
        if !dir.join(format!("{name}.aod")).is_file() {
            return Err(format!("{folder}/{name} does not exist in the project."));
        }
        let mut files = Vec::new();
        files_below(&dir, &mut files);
        for f in files {
            let rel = f.strip_prefix(root).map_err(|e| e.to_string())?;
            let entry = rel.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect::<Vec<_>>().join("/");
            jobs.push((entry, f));
        }
    }
    let write = || -> Result<usize, String> {
        let file = fs::File::create(target).map_err(|e| e.to_string())?;
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for (entry, path) in &jobs {
            zip.start_file(entry.as_str(), options).map_err(|e| e.to_string())?;
            let bytes = fs::read(path).map_err(|e| e.to_string())?;
            zip.write_all(&bytes).map_err(|e| e.to_string())?;
        }
        zip.finish().map_err(|e| e.to_string())?;
        Ok(jobs.len())
    };
    match write() {
        Ok(n) => Ok(n),
        Err(e) => {
            let _ = fs::remove_file(target);
            Err(e)
        }
    }
}

/// `(folder, name, relative file path)` of a zip entry in the project layout, if it is one.
fn entry_parts(raw: &str, strip: bool) -> Option<(String, String, String)> {
    if raw.ends_with('/') || raw.contains('\\') {
        return None;
    }
    let path = Path::new(raw);
    if path.is_absolute() || path.components().any(|c| !matches!(c, Component::Normal(_))) {
        return None;
    }
    let mut parts: Vec<&str> = raw.split('/').collect();
    if strip && !parts.is_empty() {
        parts.remove(0);
    }
    if parts.len() < 3 || !parts.iter().all(|p| safe_segment(p)) || !known_folder(parts[0]) {
        return None;
    }
    Some((parts[0].to_string(), parts[1].to_string(), parts[2..].join("/")))
}

fn read_index(zip_path: &Path) -> Result<(zip::ZipArchive<fs::File>, bool), String> {
    let file = fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let archive = zip::ZipArchive::new(file).map_err(|_| "This is not a valid zip file.".to_string())?;
    let names: Vec<String> = archive.file_names().filter(|n| !n.ends_with('/')).map(str::to_string).collect();
    let direct = names.iter().any(|n| entry_parts(n, false).is_some());
    let strip = !direct && names.iter().any(|n| entry_parts(n, true).is_some());
    Ok((archive, strip))
}

/// The models contained in the zip, with a flag for those that already exist in `root`.
pub fn inspect_zip(root: &Path, zip_path: &Path) -> Result<Vec<ModelEntry>, String> {
    let (archive, strip) = read_index(zip_path)?;
    let mut counts: BTreeMap<(String, String), usize> = BTreeMap::new();
    for name in archive.file_names() {
        if let Some((f, n, _)) = entry_parts(name, strip) {
            *counts.entry((f, n)).or_default() += 1;
        }
    }
    if counts.is_empty() {
        return Err("The zip file contains no data models.".into());
    }
    Ok(counts
        .into_iter()
        .map(|((folder, name), files)| {
            let exists = root.join(&folder).join(&name).exists();
            ModelEntry { folder, name, files, modified_secs: 0, exists }
        })
        .collect())
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct ImportOutcome {
    pub imported: Vec<String>,
    pub skipped: Vec<String>,
}

/// Imports the chosen models. Existing models are only touched when listed in `overwrite`.
pub fn import_zip(root: &Path, zip_path: &Path, selected: &[(String, String)], overwrite: &[(String, String)]) -> Result<ImportOutcome, String> {
    let (mut archive, strip) = read_index(zip_path)?;
    let mut total = 0u64;
    let mut outcome = ImportOutcome::default();
    let mut plan: Vec<(usize, PathBuf)> = Vec::new();
    let mut seen: Vec<(String, String)> = Vec::new();
    for i in 0..archive.len() {
        let entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let Some((folder, name, rel)) = entry_parts(entry.name(), strip) else { continue };
        let key = (folder.clone(), name.clone());
        if !selected.contains(&key) {
            continue;
        }
        let exists = root.join(&folder).join(&name).exists();
        if exists && !overwrite.contains(&key) {
            if !seen.contains(&key) {
                outcome.skipped.push(format!("{folder}/{name}"));
                seen.push(key);
            }
            continue;
        }
        total += entry.size();
        if total > MAX_TOTAL_BYTES {
            return Err("The zip file is too large to import.".into());
        }
        if !seen.contains(&key) {
            outcome.imported.push(format!("{folder}/{name}"));
            seen.push(key);
        }
        plan.push((i, root.join(&folder).join(&name).join(rel)));
    }
    let mut written: Vec<PathBuf> = Vec::new();
    for (index, target) in plan {
        let mut entry = archive.by_index(index).map_err(|e| e.to_string())?;
        let mut data = Vec::new();
        entry.read_to_end(&mut data).map_err(|e| e.to_string())?;
        let result = (|| -> Result<(), String> {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::write(&target, &data).map_err(|e| e.to_string())
        })();
        if let Err(e) = result {
            return Err(format!("Import stopped at {}: {e}. Files written so far: {}.", target.display(), written.len()));
        }
        written.push(target);
    }
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("forge-zip-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn model(root: &Path, folder: &str, name: &str, content: &str) {
        let dir = root.join(folder).join(name);
        fs::create_dir_all(dir.join("sub")).unwrap();
        fs::write(dir.join(format!("{name}.aod")), content).unwrap();
        fs::write(dir.join("sub").join("a.js"), "var a;").unwrap();
    }

    #[test]
    fn export_then_import_restores_the_models_byte_for_byte() {
        let src = scratch("src");
        model(&src, "entity", "A_entity", "<entity>\r\n</entity>\r\n");
        model(&src, "neonView", "B_view", "<neonView>\r\n</neonView>\r\n");
        let listed = list_models(&src);
        assert_eq!(listed.len(), 2);
        let zip_path = scratch("out").join("export.zip");
        let n = export_zip(&src, &[("entity".into(), "A_entity".into())], &zip_path).unwrap();
        assert_eq!(n, 2);

        let dst = scratch("dst");
        let found = inspect_zip(&dst, &zip_path).unwrap();
        assert_eq!(found, vec![ModelEntry { folder: "entity".into(), name: "A_entity".into(), files: 2, modified_secs: 0, exists: false }]);
        let out = import_zip(&dst, &zip_path, &[("entity".into(), "A_entity".into())], &[]).unwrap();
        assert_eq!(out.imported, vec!["entity/A_entity"]);
        assert_eq!(fs::read(dst.join("entity/A_entity/A_entity.aod")).unwrap(), b"<entity>\r\n</entity>\r\n");
        assert_eq!(fs::read(dst.join("entity/A_entity/sub/a.js")).unwrap(), b"var a;");
        assert!(!dst.join("neonView").exists());
    }

    #[test]
    fn existing_models_are_kept_unless_overwrite_is_chosen_and_nothing_is_deleted() {
        let src = scratch("src2");
        model(&src, "entity", "A_entity", "NEW");
        let zip_path = scratch("out2").join("e.zip");
        export_zip(&src, &[("entity".into(), "A_entity".into())], &zip_path).unwrap();

        let dst = scratch("dst2");
        model(&dst, "entity", "A_entity", "OLD");
        fs::write(dst.join("entity/A_entity/only_old.js"), "x").unwrap();
        let key = ("entity".to_string(), "A_entity".to_string());
        assert!(inspect_zip(&dst, &zip_path).unwrap()[0].exists);

        let out = import_zip(&dst, &zip_path, &[key.clone()], &[]).unwrap();
        assert_eq!(out.skipped, vec!["entity/A_entity"]);
        assert_eq!(fs::read_to_string(dst.join("entity/A_entity/A_entity.aod")).unwrap(), "OLD");

        let out = import_zip(&dst, &zip_path, &[key.clone()], &[key]).unwrap();
        assert_eq!(out.imported, vec!["entity/A_entity"]);
        assert_eq!(fs::read_to_string(dst.join("entity/A_entity/A_entity.aod")).unwrap(), "NEW");
        assert!(dst.join("entity/A_entity/only_old.js").exists());
    }

    #[test]
    fn hostile_entries_are_ignored_and_a_wrapping_folder_is_accepted() {
        let dir = scratch("hostile");
        let zip_path = dir.join("h.zip");
        {
            let mut z = zip::ZipWriter::new(fs::File::create(&zip_path).unwrap());
            let o = zip::write::SimpleFileOptions::default();
            for name in ["entity/../../evil.txt", "entity/X_entity/../../evil2.txt", "unknown/X/X.aod", "wrap/entity/W_entity/W_entity.aod"] {
                z.start_file(name, o).unwrap();
                z.write_all(b"x").unwrap();
            }
            z.finish().unwrap();
        }
        let dst = scratch("dst3");
        let found = inspect_zip(&dst, &zip_path).unwrap();
        assert_eq!(found.len(), 1, "{found:?}");
        assert_eq!(found[0].name, "W_entity");
        import_zip(&dst, &zip_path, &[("entity".into(), "W_entity".into())], &[]).unwrap();
        assert!(dst.join("entity/W_entity/W_entity.aod").exists());
        assert!(!dst.parent().unwrap().join("evil.txt").exists());
    }

    #[test]
    fn export_refuses_missing_models_and_existing_targets() {
        let src = scratch("src4");
        let zip_path = scratch("out4").join("x.zip");
        assert!(export_zip(&src, &[("entity".into(), "Nope".into())], &zip_path).is_err());
        assert!(export_zip(&src, &[("entity".into(), "..".into())], &zip_path).is_err());
        assert!(export_zip(&src, &[], &zip_path).is_err());
        assert!(!zip_path.exists());
    }
}
