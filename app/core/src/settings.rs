//! Forge's own user settings (Tools > Options). Kept deliberately tiny: today only the folder of
//! the installed ADITO Designer, which the official transpiler needs and which cannot always be
//! discovered automatically (RISKS.md R43). The file lives in Forge's own app data folder, never
//! in the Designer's profile.
//!
//! Reading is forgiving on purpose: a missing or damaged settings file must never block the app
//! from starting, it simply means "nothing configured yet". Writing goes through the caller
//! (`app/src-tauri`), which uses `platform::fs::atomic_write` like every other persisted file.

use serde::{Deserialize, Serialize};
use std::path::Path;

pub const SETTINGS_FILE_NAME: &str = "settings.json";

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ForgeSettings {
    /// Folder of the installed ADITO Designer chosen by the user. `None` means "discover it
    /// automatically at transpile time".
    #[serde(default)]
    pub designer_install_dir: Option<String>,
    /// Projects open in the Projects tree, restored at the next start (LAYOUT_SPEC §4.2).
    #[serde(default)]
    pub open_projects: Vec<String>,
    /// Path (only the path, never key content or passphrase) of the SSH key for tunnels.
    #[serde(default)]
    pub ssh_key_path: Option<String>,
    /// macOS/Linux only: trust an unknown SSH host key on the first connect
    /// (`StrictHostKeyChecking=accept-new`). Off unless the user switches it on in Tools > Options.
    #[serde(default)]
    pub ssh_accept_new_host_keys: Option<bool>,
}

impl ForgeSettings {
    /// A blank folder entry counts as "not configured", so clearing the field in the dialog
    /// falls back to automatic discovery instead of passing an empty path to the transpiler.
    #[must_use]
    pub fn normalized(mut self) -> Self {
        self.designer_install_dir = self
            .designer_install_dir
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        self.ssh_key_path = self.ssh_key_path.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
        self
    }
}

fn same_project(a: &str, b: &str) -> bool {
    let norm = |s: &str| {
        let slashed = s.trim().replace('\\', "/").trim_end_matches('/').to_string();
        if cfg!(windows) { slashed.to_lowercase() } else { slashed }
    };
    norm(a) == norm(b)
}

/// Adds a project to the open list; opening the same folder again (other slashes, trailing slash,
/// other case on Windows) does not add it twice.
pub fn add_open_project(list: &mut Vec<String>, path: &str) -> bool {
    let path = path.trim();
    if path.is_empty() || list.iter().any(|p| same_project(p, path)) {
        return false;
    }
    list.push(path.to_string());
    true
}

pub fn remove_open_project(list: &mut Vec<String>, path: &str) {
    list.retain(|p| !same_project(p, path));
}

/// The stored projects that can be reopened: blank or vanished folders are dropped, so a stale
/// entry never reaches the scanner (R41).
#[must_use]
pub fn restorable_open_projects(settings: &ForgeSettings) -> Vec<String> {
    let mut out = Vec::new();
    for p in &settings.open_projects {
        if !p.trim().is_empty() && Path::new(p.trim()).is_dir() {
            add_open_project(&mut out, p);
        }
    }
    out
}

/// Parses stored settings; unreadable content yields the defaults rather than an error.
#[must_use]
pub fn parse_settings(bytes: &[u8]) -> ForgeSettings {
    serde_json::from_slice::<ForgeSettings>(bytes).map(ForgeSettings::normalized).unwrap_or_default()
}

pub fn serialize_settings(settings: &ForgeSettings) -> Result<Vec<u8>, String> {
    serde_json::to_vec_pretty(&settings.clone().normalized()).map_err(|e| e.to_string())
}

/// Settings stored at `file`, or the defaults when the file does not exist or cannot be read.
#[must_use]
pub fn load_settings(file: &Path) -> ForgeSettings {
    std::fs::read(file).map(|b| parse_settings(&b)).unwrap_or_default()
}

/// The Designer installation Forge would use without an explicit choice, shown in the Options
/// dialog so the user can see what automatic discovery found.
#[must_use]
pub fn detect_designer_install() -> Option<String> {
    crate::official_transpiler_setup::discover_install_dir(&crate::official_transpiler_setup::default_search_roots())
        .map(|p| p.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_keeps_the_chosen_install_dir() {
        let s = ForgeSettings { designer_install_dir: Some("C:/ADITO/ADITOdesigner_2025.2.3".into()), open_projects: vec!["C:/a".into()], ssh_key_path: Some("C:/keys/new.ppk".into()), ssh_accept_new_host_keys: Some(true) };
        let bytes = serialize_settings(&s).unwrap();
        assert_eq!(parse_settings(&bytes), s);
    }

    #[test]
    fn damaged_or_empty_content_falls_back_to_defaults() {
        assert_eq!(parse_settings(b"{not json"), ForgeSettings::default());
        assert_eq!(parse_settings(b""), ForgeSettings::default());
        assert_eq!(parse_settings(b"{}"), ForgeSettings::default());
    }

    #[test]
    fn blank_install_dir_means_not_configured() {
        let bytes = serialize_settings(&ForgeSettings { designer_install_dir: Some("   ".into()), ..Default::default() }).unwrap();
        assert_eq!(parse_settings(&bytes).designer_install_dir, None);
    }

    #[test]
    fn unknown_fields_from_newer_versions_do_not_lose_known_ones() {
        let s = parse_settings(br#"{"designer_install_dir":"D:/x","future":1}"#);
        assert_eq!(s.designer_install_dir.as_deref(), Some("D:/x"));
    }

    #[test]
    fn missing_file_yields_defaults() {
        let file = std::env::temp_dir().join("forge-settings-test-does-not-exist").join(SETTINGS_FILE_NAME);
        assert_eq!(load_settings(&file), ForgeSettings::default());
    }

    #[test]
    fn open_projects_are_not_added_twice_and_can_be_removed() {
        let mut list = Vec::new();
        assert!(add_open_project(&mut list, "C:\\Repos\\Pichler"));
        assert!(!add_open_project(&mut list, "c:/repos/pichler/"));
        assert!(!add_open_project(&mut list, "  "));
        assert!(add_open_project(&mut list, "C:/Repos/Hermes"));
        remove_open_project(&mut list, "C:/Repos/Pichler");
        assert_eq!(list, vec!["C:/Repos/Hermes".to_string()]);
    }

    #[test]
    fn only_existing_folders_are_restored() {
        let existing = std::env::temp_dir().to_string_lossy().into_owned();
        let s = ForgeSettings {
            open_projects: vec![existing.clone(), String::new(), "Z:/gone/project".into(), existing.clone()],
            ..Default::default()
        };
        assert_eq!(restorable_open_projects(&s), vec![existing]);
    }

    #[test]
    fn settings_without_open_projects_still_load() {
        assert!(parse_settings(br#"{"designer_install_dir":"D:/x"}"#).open_projects.is_empty());
    }
}
