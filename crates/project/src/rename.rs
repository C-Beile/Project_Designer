//! Rename of an entity, view or entity webservice with the update of every reference to it.
//!
//! Business rules: the preview (`plan`) lists each place that will change and, separately, places
//! that mention the old name but are not understood as references (script code, other files).
//! Those are only reported, never changed. `apply` recomputes the plan, changes the referencing
//! elements byte-exactly (only the text between the tags is replaced), renames the object folder
//! and its model file, and restores the original files when a write fails. Objects of installed
//! modules are never touched, neither as the renamed object nor as a referencing object.

use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::problems::{scan_usages, scan_usages_in, UsageDto, UsageJob};
use crate::tree_ops::{locate_object, rewrite_for_copy};

const RENAMABLE: &[&str] = &["entity", "neonView", "entityWebservice"];

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct TextHit {
    pub file: String,
    pub line: u32,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RenamePlan {
    pub object: String,
    pub new_name: String,
    pub object_type: String,
    /// References that will be updated.
    pub changes: Vec<UsageDto>,
    /// Mentions of the old name that are not updated.
    pub hits: Vec<TextHit>,
}

fn is_word_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

fn find_words(text: &str, word: &str) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    let bytes = text.as_bytes();
    let mut from = 0;
    while let Some(pos) = text[from..].find(word) {
        let start = from + pos;
        let end = start + word.len();
        let before_ok = start == 0 || !is_word_char(bytes[start - 1]);
        let after_ok = end >= bytes.len() || !is_word_char(bytes[end]);
        if before_ok && after_ok {
            out.push((start, end));
        }
        from = end;
    }
    out
}

fn skip_dir(name: &str) -> bool {
    matches!(name, "node_modules" | "dist" | ".git" | ".aditoprj" | ".claude" | ".liquibase" | "modification" | "data")
}

fn collect_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let p = e.path();
        let name = e.file_name().to_string_lossy().into_owned();
        if p.is_dir() {
            if !skip_dir(&name) {
                collect_files(&p, out);
            }
        } else if matches!(p.extension().and_then(|x| x.to_str()), Some("js" | "aod")) {
            out.push(p);
        }
    }
}

fn check(root: &Path, aod: &Path, new_name: &str) -> Result<crate::tree_ops::ObjectLocation, String> {
    let normalized = aod.to_string_lossy().replace('\\', "/").to_lowercase();
    if normalized.contains("/node_modules/") {
        return Err("Objects of modules are read-only and cannot be renamed.".into());
    }
    let loc = locate_object(aod)?;
    if !RENAMABLE.contains(&loc.type_folder.as_str()) {
        return Err("Rename with reference update is available for entities, views and entity webservices.".into());
    }
    if loc.name == new_name {
        return Err("The new name equals the old name.".into());
    }
    crate::object_names::validate_name(root, &loc.type_folder, new_name)?;
    Ok(loc)
}

/// What the project index knows: the object files that may point to the renamed object and all project files.
/// The candidates are parsed fresh for the byte ranges, so a stale index cannot corrupt a file.
pub struct IndexHints {
    pub candidates: Vec<UsageJob>,
    pub files: Vec<PathBuf>,
}

fn usages_for(root: &Path, loc: &crate::tree_ops::ObjectLocation, hints: Option<&IndexHints>) -> Vec<(UsageDto, Option<crate::problems::UsageSpan>)> {
    match hints {
        Some(h) => scan_usages_in(&h.candidates, &loc.type_folder, &loc.name),
        None => scan_usages(root, &loc.type_folder, &loc.name),
    }
}

/// `.js` and `.aod` files the text search looks into, from the index file list (same filter as the folder walk).
fn files_from_index(root: &Path, files: &[PathBuf]) -> Vec<PathBuf> {
    let skip = |p: &Path| p.strip_prefix(root).unwrap_or(p).components().any(|c| c.as_os_str().to_str().is_some_and(skip_dir));
    files.iter().filter(|p| matches!(p.extension().and_then(|x| x.to_str()), Some("js" | "aod")) && !skip(p)).cloned().collect()
}

/// Everything a rename of `aod` to `new_name` would change; writes nothing.
pub fn plan(root: &Path, aod: &Path, new_name: &str) -> Result<RenamePlan, String> {
    plan_with(root, aod, new_name, None)
}

/// Like `plan`, with the candidates and the file list from the index.
pub fn plan_with(root: &Path, aod: &Path, new_name: &str, hints: Option<&IndexHints>) -> Result<RenamePlan, String> {
    let loc = check(root, aod, new_name)?;
    let usages = usages_for(root, &loc, hints);
    let changes: Vec<UsageDto> = usages.iter().map(|(u, _)| u.clone()).collect();

    let mut covered: BTreeMap<PathBuf, Vec<(usize, usize)>> = BTreeMap::new();
    for (_, span) in &usages {
        if let Some((f, s, e)) = span {
            covered.entry(f.clone()).or_default().push((*s, *e));
        }
    }
    let own = aod.to_path_buf();
    let mut files = Vec::new();
    match hints {
        Some(h) => files = files_from_index(root, &h.files),
        None => collect_files(root, &mut files),
    }
    files.sort();
    let mut hits = Vec::new();
    for f in files {
        if f == own {
            continue;
        }
        let Ok(text) = fs::read_to_string(&f) else { continue };
        let spans = covered.get(&f);
        for (start, _) in find_words(&text, &loc.name) {
            if spans.is_some_and(|v| v.iter().any(|(s, e)| start >= *s && start < *e)) {
                continue;
            }
            let line_no = text[..start].matches('\n').count() as u32 + 1;
            let line = text.lines().nth(line_no as usize - 1).unwrap_or("").trim();
            hits.push(TextHit { file: f.to_string_lossy().into_owned(), line: line_no, text: line.chars().take(160).collect() });
            if hits.len() >= 200 {
                break;
            }
        }
        if hits.len() >= 200 {
            break;
        }
    }
    Ok(RenamePlan { object: loc.name, new_name: new_name.into(), object_type: loc.type_folder, changes, hits })
}

fn replace_in_span(bytes: &[u8], start: usize, end: usize, old: &str, new: &str) -> Result<Vec<u8>, String> {
    let slice = String::from_utf8_lossy(&bytes[start..end]).into_owned();
    let needle = format!(">{old}<");
    if slice.matches(&needle).count() != 1 {
        return Err(format!("The reference to {old} could not be located exactly; nothing was changed."));
    }
    let patched = slice.replacen(&needle, &format!(">{new}<"), 1);
    let mut out = bytes[..start].to_vec();
    out.extend_from_slice(patched.as_bytes());
    out.extend_from_slice(&bytes[end..]);
    Ok(out)
}

/// Performs the rename; returns the new model file. All-or-nothing for the reference files.
pub fn apply(root: &Path, aod: &Path, new_name: &str) -> Result<PathBuf, String> {
    apply_with(root, aod, new_name, None)
}

/// Like `apply`, with the candidates from the index.
pub fn apply_with(root: &Path, aod: &Path, new_name: &str, hints: Option<&IndexHints>) -> Result<PathBuf, String> {
    let loc = check(root, aod, new_name)?;
    let usages = usages_for(root, &loc, hints);

    let mut by_file: BTreeMap<PathBuf, Vec<(usize, usize)>> = BTreeMap::new();
    for (_, span) in &usages {
        let (f, s, e) = span.clone().ok_or("A reference could not be located; nothing was changed.")?;
        by_file.entry(f).or_default().push((s, e));
    }
    let mut originals: BTreeMap<PathBuf, Vec<u8>> = BTreeMap::new();
    let mut updated: BTreeMap<PathBuf, Vec<u8>> = BTreeMap::new();
    for (file, mut spans) in by_file {
        let original = fs::read(&file).map_err(|e| e.to_string())?;
        let mut bytes = original.clone();
        spans.sort_by(|a, b| b.0.cmp(&a.0));
        for (s, e) in spans {
            bytes = replace_in_span(&bytes, s, e, &loc.name, new_name)?;
        }
        originals.insert(file.clone(), original);
        updated.insert(file, bytes);
    }

    let own_bytes = match updated.get(aod) {
        Some(b) => b.clone(),
        None => fs::read(aod).map_err(|e| e.to_string())?,
    };
    let own_text = String::from_utf8(own_bytes).map_err(|_| "The object file is not UTF-8 text.".to_string())?;
    let own_new = rewrite_for_copy(&own_text, &loc.type_folder, &loc.name, new_name)?;
    if !originals.contains_key(aod) {
        originals.insert(aod.to_path_buf(), fs::read(aod).map_err(|e| e.to_string())?);
    }
    updated.insert(aod.to_path_buf(), own_new.into_bytes());

    let restore = |originals: &BTreeMap<PathBuf, Vec<u8>>| {
        for (f, b) in originals {
            let _ = fs::write(f, b);
        }
    };
    for (file, bytes) in &updated {
        if let Err(e) = fs::write(file, bytes) {
            restore(&originals);
            return Err(format!("Rename failed, files restored: {e}"));
        }
        platform::fs::note_own_change(file);
    }
    let new_dir = loc.dir.with_file_name(new_name);
    if let Err(e) = fs::rename(&loc.dir, &new_dir) {
        restore(&originals);
        return Err(format!("The object folder could not be renamed, files restored: {e}"));
    }
    let moved = new_dir.join(format!("{}.aod", loc.name));
    let target = new_dir.join(format!("{new_name}.aod"));
    if let Err(e) = fs::rename(&moved, &target) {
        let _ = fs::rename(&new_dir, &loc.dir);
        restore(&originals);
        return Err(format!("The model file could not be renamed, files restored: {e}"));
    }
    platform::fs::note_own_change(&loc.dir);
    platform::fs::note_own_change(&new_dir);
    platform::fs::note_own_change(&target);
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("forge-rename-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn put(root: &Path, folder: &str, name: &str, text: &str) -> PathBuf {
        let dir = root.join(folder).join(name);
        fs::create_dir_all(&dir).unwrap();
        let f = dir.join(format!("{name}.aod"));
        fs::write(&f, text).unwrap();
        f
    }

    fn project(tag: &str) -> (PathBuf, PathBuf) {
        let root = scratch(tag);
        let ent = put(&root, "entity", "Car_entity", "<entity>\r\n  <name>Car_entity</name>\r\n  <v>%aditoprj%/entity/Car_entity/x.js</v>\r\n</entity>\r\n");
        fs::write(root.join("entity").join("Car_entity").join("x.js"), "var a;").unwrap();
        put(&root, "neonContext", "Car", "<neonContext>\r\n  <name>Car</name>\r\n  <entity>Car_entity</entity>\r\n</neonContext>\r\n");
        let script = root.join("process").join("lib");
        fs::create_dir_all(&script).unwrap();
        fs::write(script.join("process.js"), "var e = \"Car_entity\";\nvar f = \"Car_entity2\";\n").unwrap();
        (root, ent)
    }

    #[test]
    fn the_preview_lists_references_and_script_mentions_without_writing() {
        let (root, ent) = project("the_pr");
        let before = fs::read(root.join("neonContext/Car/Car.aod")).unwrap();
        let plan = plan(&root, &ent, "Auto_entity").unwrap();
        assert_eq!(plan.changes.len(), 1);
        assert_eq!(plan.changes[0].object, "Car");
        assert_eq!(plan.hits.len(), 1, "{:?}", plan.hits);
        assert_eq!(plan.hits[0].line, 1);
        assert_eq!(fs::read(root.join("neonContext/Car/Car.aod")).unwrap(), before);
        assert!(ent.exists());
    }

    #[test]
    fn apply_updates_references_name_and_folder_and_keeps_everything_else() {
        let (root, ent) = project("apply_");
        let new_aod = apply(&root, &ent, "Auto_entity").unwrap();
        assert_eq!(new_aod, root.join("entity/Auto_entity/Auto_entity.aod"));
        assert!(!root.join("entity/Car_entity").exists());
        assert!(root.join("entity/Auto_entity/x.js").exists());
        let own = fs::read_to_string(&new_aod).unwrap();
        assert!(own.contains("<name>Auto_entity</name>") && own.contains("/entity/Auto_entity/x.js"));
        assert_eq!(
            fs::read_to_string(root.join("neonContext/Car/Car.aod")).unwrap(),
            "<neonContext>\r\n  <name>Car</name>\r\n  <entity>Auto_entity</entity>\r\n</neonContext>\r\n"
        );
        assert_eq!(fs::read_to_string(root.join("process/lib/process.js")).unwrap(), "var e = \"Car_entity\";\nvar f = \"Car_entity2\";\n");
    }

    #[test]
    fn invalid_and_unsupported_renames_change_nothing() {
        let (root, ent) = project("invali");
        assert!(plan(&root, &ent, "Car_entity").unwrap_err().contains("equals"));
        assert!(plan(&root, &ent, "bad name").is_err());
        put(&root, "entity", "Taken_entity", "<entity>\r\n  <name>Taken_entity</name>\r\n</entity>\r\n");
        assert!(apply(&root, &ent, "Taken_entity").unwrap_err().contains("already exists"));
        let ctx = root.join("neonContext/Car/Car.aod");
        assert!(plan(&root, &ctx, "Other").unwrap_err().contains("entities, views"));
        assert!(ent.exists());
    }

    #[test]
    fn module_objects_are_refused() {
        let root = scratch("mod");
        let f = put(&root.join("node_modules").join("@aditosoftware").join("m"), "entity", "M_entity", "<entity>\r\n  <name>M_entity</name>\r\n</entity>\r\n");
        assert!(apply(&root, &f, "X_entity").unwrap_err().contains("read-only"));
        assert!(f.exists());
    }

    #[test]
    fn a_view_rename_updates_context_and_nested_view_references() {
        let root = scratch("view");
        let v = put(&root, "neonView", "Main_view", "<neonView>\r\n  <name>Main_view</name>\r\n</neonView>\r\n");
        put(&root, "neonContext", "C", "<neonContext>\r\n  <name>C</name>\r\n  <mainView>Main_view</mainView>\r\n  <editView>Main_view</editView>\r\n</neonContext>\r\n");
        let plan = plan(&root, &v, "Home_view").unwrap();
        assert_eq!(plan.changes.len(), 2, "{:?}", plan.changes);
        assert!(plan.hits.is_empty(), "{:?}", plan.hits);
        apply(&root, &v, "Home_view").unwrap();
        let ctx = fs::read_to_string(root.join("neonContext/C/C.aod")).unwrap();
        assert!(ctx.contains("<editView>Home_view</editView>"));
    }
}
