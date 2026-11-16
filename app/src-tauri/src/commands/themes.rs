//! Themes des Nutzers: `*.theme.toml` im Ordner `themes` des App-Datenordners.

use serde::Serialize;
use std::path::PathBuf;

const SUFFIX: &str = ".theme.toml";
const MAX_FILE_BYTES: u64 = 256 * 1024;

#[derive(Serialize, specta::Type)]
pub struct UserTheme {
    pub file: String,
    pub text: String,
}

fn themes_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = crate::data_dir::app_data_dir(app)?.join("themes");
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    Ok(dir)
}

/// Nur kleine Buchstaben, Ziffern und `-` vor `.theme.toml`: kein Pfad, kein Rückgriff auf andere Ordner.
fn is_valid_file_name(file: &str) -> bool {
    match file.strip_suffix(SUFFIX) {
        Some(stem) => !stem.is_empty() && stem.len() <= 60 && stem.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'),
        None => false,
    }
}

fn checked_path(app: &tauri::AppHandle, file: &str) -> Result<PathBuf, String> {
    if !is_valid_file_name(file) {
        return Err(format!("Ungültiger Theme-Dateiname '{file}'. Erlaubt: kleine Buchstaben, Ziffern und - vor {SUFFIX}"));
    }
    Ok(themes_dir(app)?.join(file))
}

/// Alle Theme-Dateien des Nutzers mit ihrem Text, nach Dateiname sortiert. Zu große oder unlesbare Dateien fehlen.
#[tauri::command(async)]
#[specta::specta]
pub fn user_themes_list(app: tauri::AppHandle) -> Result<Vec<UserTheme>, String> {
    crate::commands::guard("user_themes_list", || {
        let mut themes = Vec::new();
        for entry in std::fs::read_dir(themes_dir(&app)?).map_err(|e| e.to_string())?.flatten() {
            let file = entry.file_name().to_string_lossy().into_owned();
            if !is_valid_file_name(&file) || entry.metadata().map(|m| m.len() > MAX_FILE_BYTES).unwrap_or(true) {
                continue;
            }
            if let Ok(text) = std::fs::read_to_string(entry.path()) {
                themes.push(UserTheme { file, text });
            }
        }
        themes.sort_by(|a, b| a.file.cmp(&b.file));
        Ok(themes)
    })
}

#[tauri::command(async)]
#[specta::specta]
pub fn user_theme_write(file: String, text: String, app: tauri::AppHandle) -> Result<(), String> {
    crate::commands::guard("user_theme_write", || {
        if text.len() as u64 > MAX_FILE_BYTES {
            return Err("Das Theme ist zu groß.".to_string());
        }
        platform::fs::atomic_write(&checked_path(&app, &file)?, text.as_bytes()).map_err(|e| e.to_string())
    })
}

#[tauri::command(async)]
#[specta::specta]
pub fn user_theme_delete(file: String, app: tauri::AppHandle) -> Result<(), String> {
    crate::commands::guard("user_theme_delete", || {
        let path = checked_path(&app, &file)?;
        match std::fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(format!("{}: {e}", path.display())),
        }
    })
}

#[tauri::command(async)]
#[specta::specta]
pub fn user_themes_open_folder(app: tauri::AppHandle) -> Result<String, String> {
    crate::commands::guard("user_themes_open_folder", || {
        let dir = themes_dir(&app)?;
        super::misc::open_in_file_manager(&dir)?;
        Ok(dir.to_string_lossy().into_owned())
    })
}

#[cfg(test)]
mod tests {
    use super::is_valid_file_name;

    #[test]
    fn accepts_plain_theme_names() {
        assert!(is_valid_file_name("lion.theme.toml"));
        assert!(is_valid_file_name("my-theme-2.theme.toml"));
    }

    #[test]
    fn rejects_paths_and_odd_names() {
        for bad in ["", ".theme.toml", "../x.theme.toml", "a/b.theme.toml", "a\\b.theme.toml", "Upper.theme.toml", "x.toml", "x.theme.toml.exe", "a b.theme.toml"] {
            assert!(!is_valid_file_name(bad), "{bad}");
        }
    }
}
