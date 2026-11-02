//! Local data of the Designer (manual chapter 12): Vendira's own data folder and, read-only, the
//! per-version folders the original ADITO Designer keeps under `%APPDATA%\.aditodesigner`. The
//! scan never changes or deletes anything; cleaning up old version folders stays a manual step.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct EntryDto {
    pub name: String,
    pub is_dir: bool,
    pub size_bytes: u64,
    pub modified_unix: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct VersionDirDto {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub modified_unix: Option<i64>,
    pub days_unused: Option<u64>,
    /// Not used for longer than the threshold: the Janitor would offer it for removal.
    pub outdated: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct LocalDataInfo {
    pub app_version: String,
    pub exe_dir: String,
    pub os: String,
    pub arch: String,
    pub forge_data_dir: String,
    pub forge_settings_file: String,
    pub forge_entries: Vec<EntryDto>,
    pub designer_roaming_dir: Option<String>,
    pub designer_roaming_exists: bool,
    pub designer_versions: Vec<VersionDirDto>,
    pub designer_install: Option<String>,
}

fn unix(t: SystemTime) -> i64 {
    t.duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

fn modified(path: &Path) -> Option<i64> {
    std::fs::metadata(path).and_then(|m| m.modified()).ok().map(unix)
}

/// Size of a folder, with a cap on visited files so a huge cache folder cannot stall the UI.
pub fn dir_size(path: &Path) -> u64 {
    let mut total = 0u64;
    let mut visited = 0usize;
    let mut stack = vec![path.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for e in entries.flatten() {
            visited += 1;
            if visited > 50_000 {
                return total;
            }
            match e.metadata() {
                Ok(m) if m.is_dir() => stack.push(e.path()),
                Ok(m) => total += m.len(),
                Err(_) => {}
            }
        }
    }
    total
}

pub fn scan_entries(dir: &Path) -> Vec<EntryDto> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut out: Vec<EntryDto> = entries
        .flatten()
        .map(|e| {
            let path = e.path();
            let is_dir = path.is_dir();
            EntryDto {
                name: e.file_name().to_string_lossy().into_owned(),
                is_dir,
                size_bytes: if is_dir { dir_size(&path) } else { e.metadata().map(|m| m.len()).unwrap_or(0) },
                modified_unix: modified(&path),
            }
        })
        .collect();
    out.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    out
}

/// Version folders (`<roaming>/<version>`); "last use" is the newer of the folder and its
/// `.lastModified` marker, as the cache data of a started Designer touches the marker.
pub fn scan_version_dirs(roaming: &Path, threshold_days: u64, now_unix: i64) -> Vec<VersionDirDto> {
    let Ok(entries) = std::fs::read_dir(roaming) else { return Vec::new() };
    let mut out: Vec<VersionDirDto> = entries
        .flatten()
        .filter(|e| e.path().is_dir())
        .map(|e| {
            let path = e.path();
            let last = [modified(&path), modified(&path.join(".lastModified"))].into_iter().flatten().max();
            let days = last.map(|t| ((now_unix - t).max(0) / 86_400) as u64);
            VersionDirDto {
                name: e.file_name().to_string_lossy().into_owned(),
                path: path.to_string_lossy().into_owned(),
                size_bytes: dir_size(&path),
                modified_unix: last,
                days_unused: days,
                outdated: days.is_some_and(|d| d > threshold_days),
            }
        })
        .collect();
    out.sort_by(|a, b| b.name.cmp(&a.name));
    out
}

pub fn roaming_designer_dir() -> Option<PathBuf> {
    let candidates = crate::official_transpiler_setup::profiles_root_candidates();
    candidates.iter().find(|c| c.is_dir()).or(candidates.first()).cloned()
}

pub fn inspect(app_version: &str, forge_data_dir: &Path, settings_file: &Path, threshold_days: u64, designer_install: Option<String>) -> LocalDataInfo {
    let roaming = roaming_designer_dir();
    let now = unix(SystemTime::now());
    LocalDataInfo {
        app_version: app_version.to_string(),
        exe_dir: std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_string_lossy().into_owned())).unwrap_or_default(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        forge_data_dir: forge_data_dir.to_string_lossy().into_owned(),
        forge_settings_file: settings_file.to_string_lossy().into_owned(),
        forge_entries: scan_entries(forge_data_dir),
        designer_roaming_exists: roaming.as_ref().is_some_and(|r| r.is_dir()),
        designer_versions: roaming.as_ref().map(|r| scan_version_dirs(r, threshold_days, now)).unwrap_or_default(),
        designer_roaming_dir: roaming.map(|r| r.to_string_lossy().into_owned()),
        designer_install,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("forge-localdata-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn lists_folders_first_with_sizes() {
        let dir = temp("entries");
        std::fs::create_dir_all(dir.join("cache")).unwrap();
        std::fs::write(dir.join("cache").join("a.bin"), vec![0u8; 100]).unwrap();
        std::fs::write(dir.join("settings.json"), b"{}").unwrap();
        let entries = scan_entries(&dir);
        assert_eq!(entries[0].name, "cache");
        assert!(entries[0].is_dir);
        assert_eq!(entries[0].size_bytes, 100);
        assert_eq!(entries[1].name, "settings.json");
        assert_eq!(entries[1].size_bytes, 2);
    }

    #[test]
    fn version_folders_older_than_the_threshold_are_marked_outdated_but_never_touched() {
        let roaming = temp("roaming");
        std::fs::create_dir_all(roaming.join("2020")).unwrap();
        std::fs::create_dir_all(roaming.join("2023.0.2")).unwrap();
        let now = unix(SystemTime::now());
        let in_60_days = now + 60 * 86_400;
        let list = scan_version_dirs(&roaming, 30, in_60_days);
        assert_eq!(list.iter().map(|v| v.name.as_str()).collect::<Vec<_>>(), vec!["2023.0.2", "2020"]);
        assert!(list.iter().all(|v| v.outdated));
        let fresh = scan_version_dirs(&roaming, 30, now);
        assert!(fresh.iter().all(|v| !v.outdated));
        assert!(roaming.join("2020").is_dir(), "the scan must not delete anything");
    }

    #[test]
    fn a_missing_folder_gives_empty_lists() {
        let gone = std::env::temp_dir().join("forge-localdata-does-not-exist-xyz");
        assert!(scan_entries(&gone).is_empty());
        assert!(scan_version_dirs(&gone, 30, 0).is_empty());
    }
}
