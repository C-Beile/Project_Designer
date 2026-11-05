//! How far the built-in transpiler is: its output (`dist`) compared with the output of the official
//! transpiler for the same project. Only files of the reference count; a file counts as equal when
//! its bytes are equal.

use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

/// Folders and files that are bookkeeping of a transpiler run and not part of the result.
const SKIP_DIRS: &[&str] = &[".forge-incremental-cache"];
const SKIP_FILES: &[&str] = &["cache.txt", "cacheMods.txt"];

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DifferenceGroup {
    /// First folder of the files (`entity`, `process`, ...).
    pub folder: String,
    /// File type (`.aod`, `.js`, ...).
    pub kind: String,
    /// `missing`: the built-in output lacks the file. `different`: the file exists with other content.
    pub reason: String,
    pub count: usize,
    /// One affected file, relative to the project output.
    pub example: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct CompareReport {
    /// Files of the reference.
    pub total: usize,
    pub identical: usize,
    pub missing: usize,
    pub different: usize,
    /// Files only the built-in output has.
    pub own_only: usize,
    pub percent: f64,
    /// The largest groups of differences, biggest first.
    pub groups: Vec<DifferenceGroup>,
}

fn files_of(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            if path.is_dir() {
                if !SKIP_DIRS.contains(&name.as_str()) {
                    stack.push(path);
                }
            } else if !(dir == root && SKIP_FILES.contains(&name.as_str())) {
                out.push(path);
            }
        }
    }
    out
}

fn relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or_default()
}

pub fn compare_outputs(reference: &Path, own: &Path) -> Result<CompareReport, String> {
    if !reference.is_dir() {
        return Err("The reference folder was not found.".into());
    }
    if !own.is_dir() {
        return Err("The project has no transpiled output yet (dist). Transpile first.".into());
    }
    let mut total = 0;
    let mut identical = 0;
    let mut groups: BTreeMap<(String, String, String), (usize, String)> = BTreeMap::new();
    for path in files_of(reference) {
        let rel = relative(reference, &path);
        total += 1;
        let other = own.join(&rel);
        let reason = if !other.is_file() {
            "missing"
        } else if fs::read(&path).ok() == fs::read(&other).ok() {
            identical += 1;
            continue;
        } else {
            "different"
        };
        let folder = rel.split('/').next().unwrap_or("").to_string();
        let kind = Path::new(&rel).extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_else(|| rel.rsplit('/').next().unwrap_or("").to_string());
        let entry = groups.entry((folder, kind, reason.to_string())).or_insert((0, rel.clone()));
        entry.0 += 1;
    }
    let own_only = files_of(own).iter().filter(|p| !reference.join(relative(own, p)).is_file()).count();
    let mut rows: Vec<DifferenceGroup> = groups.into_iter().map(|((folder, kind, reason), (count, example))| DifferenceGroup { folder, kind, reason, count, example }).collect();
    rows.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.example.cmp(&b.example)));
    rows.truncate(15);
    let missing: usize = rows.iter().filter(|g| g.reason == "missing").map(|g| g.count).sum();
    let percent = if total == 0 { 100.0 } else { identical as f64 * 100.0 / total as f64 };
    Ok(CompareReport { total, identical, missing, different: total - identical, own_only, percent, groups: rows })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(root: &Path, rel: &str, text: &str) {
        let p = root.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, text).unwrap();
    }

    #[test]
    fn counts_identical_different_and_missing_files_of_the_reference() {
        let tmp = std::env::temp_dir().join(format!("forge-compare-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let (reference, own) = (tmp.join("ref"), tmp.join("own"));
        write(&reference, "entity/A/A.aod", "same");
        write(&reference, "entity/B/B.aod", "old");
        write(&reference, "process/C/process.js", "gone");
        write(&reference, "cache.txt", "ignored");
        write(&own, "entity/A/A.aod", "same");
        write(&own, "entity/B/B.aod", "new");
        write(&own, "extra/X.txt", "only here");
        let report = compare_outputs(&reference, &own).unwrap();
        assert_eq!((report.total, report.identical, report.different, report.missing, report.own_only), (3, 1, 2, 1, 1));
        assert!((report.percent - 33.333).abs() < 0.01);
        assert_eq!(report.groups.len(), 2);
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn a_missing_output_asks_for_a_transpile() {
        let tmp = std::env::temp_dir().join(format!("forge-compare-none-{}", std::process::id()));
        fs::create_dir_all(&tmp).unwrap();
        assert!(compare_outputs(&tmp, &tmp.join("nope")).unwrap_err().contains("Transpile first"));
        let _ = fs::remove_dir_all(&tmp);
    }
}
