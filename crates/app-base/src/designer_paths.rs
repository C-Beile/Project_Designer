//! Pfade und Erkennung der ADITO-Designer-Installation und ihrer Benutzerprofile (`%APPDATA%/.aditodesigner`).
//! Reine Pfadfunktionen ohne Prozessstart; genutzt von Transpiler-Setup, Einstellungen, Baum, Liquibase.

use std::path::{Path, PathBuf};

use crate::layout;

/// True if `dir` looks like a Designer installation the CLI can be launched from (on macOS also
/// the `.app` bundle itself; the launcher location there is an unverified assumption).
pub fn is_designer_install(dir: &Path) -> bool {
    layout::designer_root(dir).is_some()
}

/// The Designer version encoded in an installation folder name, e.g. `ADITODesigner2026.0.4`
/// or `ADITODesigner_2023.2.6` -> `2026.0.4` / `2023.2.6`.
pub fn version_from_install_dir(install_dir: &Path) -> Option<String> {
    let name = install_dir.file_name()?.to_string_lossy().to_string();
    let start = name.find(|c: char| c.is_ascii_digit())?;
    let version: String = name[start..].chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
    if version.is_empty() {
        None
    } else {
        Some(version.trim_end_matches('.').to_string())
    }
}

pub(crate) fn version_key(version: &str) -> Vec<u64> {
    version.split('.').map(|p| p.parse::<u64>().unwrap_or(0)).collect()
}

/// Folders where a Designer installation is commonly found. The ADITO installer's own default
/// location is not verified; the user can always pick the folder explicitly in Tools > Options.
pub fn default_search_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if !cfg!(windows) {
        roots.push(PathBuf::from("/Applications"));
        if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
            roots.push(home.join("Applications"));
            roots.push(home.join("ADITO"));
            roots.push(home.join("Desktop"));
        }
    }
    for var in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
        if let Ok(v) = std::env::var(var) {
            let base = PathBuf::from(v);
            roots.push(if var == "LOCALAPPDATA" { base.join("Programs") } else { base.clone() });
            roots.push(base.join("ADITO"));
        }
    }
    if let Ok(home) = std::env::var("USERPROFILE") {
        let home = PathBuf::from(home);
        roots.push(home.join("ADITO"));
        roots.push(home.join("Desktop"));
        roots.push(home.join("Desktop").join("ADITO_Designer").join("Adito_designer"));
    }
    roots
}

/// Newest Designer installation found directly inside one of `roots`.
pub fn discover_install_dir(roots: &[PathBuf]) -> Option<PathBuf> {
    let mut found: Vec<(Vec<u64>, PathBuf)> = Vec::new();
    for root in roots {
        let Ok(entries) = std::fs::read_dir(root) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            let name: String = entry.file_name().to_string_lossy().to_lowercase().chars().filter(|c| *c != ' ' && *c != '_').collect();
            if name.starts_with("aditodesigner") && is_designer_install(&path) {
                let key = version_from_install_dir(&path).map(|v| version_key(&v)).unwrap_or_default();
                found.push((key, path));
            }
        }
    }
    found.sort();
    found.pop().map(|(_, p)| p)
}

/// The user's real Designer profile matching `version` under `profiles_root`
/// (`%APPDATA%\.aditodesigner`): exact folder name first, otherwise the newest profile whose
/// version shares major and minor with the installation.
pub fn matching_designer_profile(profiles_root: &Path, version: &str) -> Option<PathBuf> {
    let exact = profiles_root.join(version);
    if exact.is_dir() {
        return Some(exact);
    }
    let wanted = version_key(version);
    let mut candidates: Vec<(Vec<u64>, PathBuf)> = std::fs::read_dir(profiles_root)
        .ok()?
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            let key = version_key(&name);
            (key.len() >= 2 && wanted.len() >= 2 && key[0] == wanted[0] && key[1] == wanted[1]).then(|| (key, e.path()))
        })
        .collect();
    candidates.sort();
    candidates.pop().map(|(_, p)| p)
}

/// Folders that may hold the real Designer profiles, most likely first. Windows is verified
/// (`%APPDATA%\.aditodesigner`); the macOS entries are an ASSUMPTION (UNBELEGT): the NetBeans
/// based Designer probably keeps its profile in the home folder or in Application Support.
pub fn profiles_root_candidates() -> Vec<PathBuf> {
    if cfg!(windows) {
        return std::env::var_os("APPDATA").map(|a| vec![PathBuf::from(a).join(".aditodesigner")]).unwrap_or_default();
    }
    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else { return Vec::new() };
    vec![home.join(".aditodesigner"), home.join("Library").join("Application Support").join(".aditodesigner"), home.join("Library").join("Application Support").join("aditodesigner")]
}

/// The first existing candidate of [`profiles_root_candidates`], otherwise the first one.
pub fn default_profiles_root() -> PathBuf {
    let candidates = profiles_root_candidates();
    candidates.iter().find(|c| c.is_dir()).or(candidates.first()).cloned().unwrap_or_else(|| PathBuf::from(".aditodesigner"))
}

/// User directories of the original Designer (`%APPDATA%/.aditodesigner/<version>`), the one that
/// belongs to the installation first, then the others newest first.
pub fn designer_userdirs(install_dir: &Path, appdata: &Path) -> Vec<PathBuf> {
    let base = appdata.join(".aditodesigner");
    let version = install_dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default().trim_start_matches("ADITODesigner").trim_start_matches('_').to_string();
    let mut found: Vec<PathBuf> = std::fs::read_dir(&base).map(|rd| rd.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect()).unwrap_or_default();
    found.sort_by(|a, b| b.file_name().cmp(&a.file_name()));
    if let Some(i) = found.iter().position(|p| p.file_name().map(|n| n.to_string_lossy() == version.as_str()).unwrap_or(false)) {
        let own = found.remove(i);
        found.insert(0, own);
    }
    found
}

/// The Designer installation Forge would use without an explicit choice, shown in the Options
/// dialog so the user can see what automatic discovery found.
#[must_use]
pub fn detect_designer_install() -> Option<String> {
    discover_install_dir(&default_search_roots())
        .map(|p| p.to_string_lossy().into_owned())
}
