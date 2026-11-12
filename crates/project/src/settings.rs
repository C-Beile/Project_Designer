//! Forge's own user settings (Tools > Options). Kept deliberately tiny: today only the folder of
//! the installed ADITO Designer, which the official transpiler needs and which cannot always be
//! discovered automatically (RISKS.md R43). The file lives in Forge's own app data folder, never
//! in the Designer's profile.
//!
//! Reading is forgiving on purpose: a missing or damaged settings file must never block the app
//! from starting, it simply means "nothing configured yet". Writing goes through the caller
//! (`app/src-tauri`), which uses `platform::fs::atomic_write` like every other persisted file.

use app_base::config;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::Path;
use toml::Table;

/// Name der Konfigurationsdatei `designer.conf` (TOML, siehe `app_base::config`). `ForgeSettings` sind nur
/// die Abschnitte `[general]`, `[ssh]` und `[projects]`; alle anderen Abschnitte der Datei bleiben beim
/// Speichern erhalten.
pub const SETTINGS_FILE_NAME: &str = config::CONFIG_FILE_NAME;

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

fn text_at(table: &Table, path: &str) -> Option<String> {
    config::get_section(table, path).and_then(|v| v.as_str()).map(str::to_string)
}

fn list_at(table: &Table, path: &str) -> Vec<String> {
    config::get_section(table, path)
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
        .unwrap_or_default()
}

/// Die Einstellungen des Backends aus der Konfiguration.
#[must_use]
pub fn settings_from(table: &Table) -> ForgeSettings {
    ForgeSettings {
        designer_install_dir: text_at(table, "general.designer_install_dir"),
        open_projects: list_at(table, "projects.open"),
        ssh_key_path: text_at(table, "ssh.key_path"),
        ssh_accept_new_host_keys: config::get_section(table, "ssh.accept_new_host_keys").and_then(toml::Value::as_bool),
    }
    .normalized()
}

/// Schreibt die Einstellungen des Backends in die Konfiguration; leere Werte fehlen danach einfach.
pub fn apply_settings(table: &mut Table, settings: &ForgeSettings) {
    let s = settings.clone().normalized();
    config::set_section(table, "general.designer_install_dir", &json!(s.designer_install_dir));
    config::set_section(table, "projects.open", &json!(s.open_projects));
    config::set_section(table, "ssh.key_path", &json!(s.ssh_key_path));
    config::set_section(table, "ssh.accept_new_host_keys", &json!(s.ssh_accept_new_host_keys));
}

/// Settings stored at `file`, or the defaults when the file does not exist or cannot be read.
#[must_use]
pub fn load_settings(file: &Path) -> ForgeSettings {
    settings_from(&config::load(file))
}

/// Speichert die Einstellungen des Backends; alle anderen Abschnitte der Datei bleiben unverändert.
pub fn save_settings(file: &Path, settings: &ForgeSettings) -> Result<(), String> {
    config::update(file, |table| apply_settings(table, settings))
}

/// Die zuletzt geöffneten Projekte, neueste zuerst (`[projects] recent`).
#[must_use]
pub fn recent_projects(file: &Path) -> Vec<String> {
    list_at(&config::load(file), "projects.recent")
}

pub fn save_recent_projects(file: &Path, recent: &[String]) -> Result<(), String> {
    config::update(file, |table| config::set_section(table, "projects.recent", &json!(recent)))
}

/// Einmalige Übernahme der alten Dateien (`settings.json`, `recent-project.json`), wenn es noch keine
/// `designer.conf` gibt. Die alten Dateien bleiben liegen.
pub fn import_legacy(data_dir: &Path) {
    let file = data_dir.join(SETTINGS_FILE_NAME);
    if file.exists() {
        return;
    }
    let mut table = Table::new();
    let mut found = false;
    if let Ok(bytes) = std::fs::read(data_dir.join("settings.json")) {
        if let Ok(old) = serde_json::from_slice::<ForgeSettings>(&bytes) {
            apply_settings(&mut table, &old);
            found = true;
        }
    }
    if let Ok(bytes) = std::fs::read(data_dir.join("recent-project.json")) {
        if let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) {
            let mut paths: Vec<String> = value
                .get("paths")
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
                .unwrap_or_default();
            if paths.is_empty() {
                paths.extend(value.get("path").and_then(|v| v.as_str()).map(str::to_string));
            }
            config::set_section(&mut table, "projects.recent", &json!(paths));
            found = true;
        }
    }
    if found {
        let _ = config::save(&file, &table);
    }
}

/// Die Designer-Installation, die Forge ohne explizite Wahl benutzen wuerde.
#[must_use]
pub fn detect_designer_install() -> Option<String> {
    app_base::designer_paths::detect_designer_install()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_file(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("forge-settings-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.join(SETTINGS_FILE_NAME)
    }

    #[test]
    fn round_trip_keeps_the_values_and_writes_one_section_per_kind_with_slashes() {
        let file = temp_file("roundtrip");
        let s = ForgeSettings {
            designer_install_dir: Some("C:\\ADITO\\ADITOdesigner_2025.2.3".into()),
            open_projects: vec!["C:\\a".into()],
            ssh_key_path: Some("C:/keys/new.ppk".into()),
            ssh_accept_new_host_keys: Some(true),
        };
        save_settings(&file, &s).unwrap();
        let text = std::fs::read_to_string(&file).unwrap();
        let loaded = load_settings(&file);
        let _ = std::fs::remove_dir_all(file.parent().unwrap());
        assert!(text.contains("[general]") && text.contains("[ssh]") && text.contains("[projects]"), "{text}");
        assert!(!text.contains('\\'), "paths use slashes: {text}");
        assert_eq!(loaded.designer_install_dir.as_deref(), Some("C:/ADITO/ADITOdesigner_2025.2.3"));
        assert_eq!(loaded.open_projects, vec!["C:/a".to_string()]);
        assert_eq!((loaded.ssh_key_path.as_deref(), loaded.ssh_accept_new_host_keys), (Some("C:/keys/new.ppk"), Some(true)));
    }

    #[test]
    fn empty_values_are_not_stored_at_all() {
        let file = temp_file("empty");
        save_settings(&file, &ForgeSettings { designer_install_dir: Some("   ".into()), ..Default::default() }).unwrap();
        let text = std::fs::read_to_string(&file).unwrap();
        let _ = std::fs::remove_dir_all(file.parent().unwrap());
        assert!(!text.contains("designer_install_dir") && !text.contains("[ssh]") && !text.contains("null"), "{text}");
    }

    #[test]
    fn saving_settings_keeps_the_other_sections() {
        let file = temp_file("keep");
        let mut table = Table::new();
        config::set_section(&mut table, "window", &json!({ "x": 5, "y": 6 }));
        config::save(&file, &table).unwrap();
        save_settings(&file, &ForgeSettings { ssh_key_path: Some("C:/k".into()), ..Default::default() }).unwrap();
        let after = config::load(&file);
        let _ = std::fs::remove_dir_all(file.parent().unwrap());
        assert!(config::get_section(&after, "window").is_some() && config::get_section(&after, "ssh.key_path").is_some());
    }

    #[test]
    fn missing_or_damaged_file_yields_defaults() {
        let file = temp_file("damaged");
        assert_eq!(load_settings(&file), ForgeSettings::default());
        std::fs::write(&file, "{not toml").unwrap();
        let loaded = load_settings(&file);
        let _ = std::fs::remove_dir_all(file.parent().unwrap());
        assert_eq!(loaded, ForgeSettings::default());
    }

    #[test]
    fn the_old_json_files_are_imported_once_when_there_is_no_conf_yet() {
        let file = temp_file("legacy");
        let dir = file.parent().unwrap().to_path_buf();
        std::fs::write(dir.join("settings.json"), r#"{"designer_install_dir":"D:\\x","open_projects":["C:\\p"],"ssh_key_path":null}"#).unwrap();
        std::fs::write(dir.join("recent-project.json"), r#"{"path":"C:\\p","paths":["C:\\p","C:\\q"]}"#).unwrap();
        import_legacy(&dir);
        let (settings, recent) = (load_settings(&file), recent_projects(&file));
        // Eine vorhandene designer.conf wird nicht noch einmal überschrieben.
        std::fs::write(dir.join("settings.json"), r#"{"designer_install_dir":"E:\\y"}"#).unwrap();
        import_legacy(&dir);
        let again = load_settings(&file);
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(settings.designer_install_dir.as_deref(), Some("D:/x"));
        assert_eq!(settings.open_projects, vec!["C:/p".to_string()]);
        assert_eq!(recent, vec!["C:/p".to_string(), "C:/q".to_string()]);
        assert_eq!(again.designer_install_dir.as_deref(), Some("D:/x"));
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
}
