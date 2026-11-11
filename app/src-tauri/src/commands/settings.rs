//! Benutzereinstellungen und Pfad der Einstellungsdatei.

use super::blocking;
use project::settings::{self, ForgeSettings};
use std::path::PathBuf;
use tauri::Manager;

pub fn write_settings(file: &std::path::Path, settings: &ForgeSettings) -> Result<(), String> {
    let bytes = settings::serialize_settings(settings)?;
    platform::fs::atomic_write(file, &bytes).map_err(|e| e.to_string())
}

pub fn settings_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(settings::SETTINGS_FILE_NAME))
}

/// P8 Tools > Options: Forge's own user settings (see `project::settings`).
#[tauri::command(async)]
pub fn get_settings(app: tauri::AppHandle) -> Result<ForgeSettings, String> {
    crate::commands::guard("get_settings", || {
    Ok(settings::load_settings(&settings_file(&app)?))
})
}

#[tauri::command(async)]
pub fn set_settings(mut settings: ForgeSettings, app: tauri::AppHandle) -> Result<(), String> {
    crate::commands::guard("set_settings", || {
    // The open-project list is owned by add/remove_open_project; the Options dialog never
    // carries it, so it must not wipe it.
    let file = settings_file(&app)?;
    settings.open_projects = settings::load_settings(&file).open_projects;
    #[cfg(feature = "ssh-tunnel")]
    ::ssh_tunnel::tunnel_client::set_accept_new_host_keys(settings.ssh_accept_new_host_keys.unwrap_or(false));
    write_settings(&file, &settings)
})
}

/// P8 Tools > Options: the Designer installation automatic discovery would pick, shown next to
/// the user's own choice. Scans a few folders, so it runs off the UI thread.
#[tauri::command]
pub async fn detect_designer_install() -> Result<Option<String>, String> {
    crate::commands::guard_async("detect_designer_install", async {
    blocking(settings::detect_designer_install).await
}).await
}
