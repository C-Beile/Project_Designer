//! Benutzereinstellungen und Pfad der Einstellungsdatei.

use super::blocking;
use project::settings::{self, ForgeSettings};
use std::path::PathBuf;
use tauri::Manager;

pub fn write_settings(file: &std::path::Path, settings: &ForgeSettings) -> Result<(), String> {
    settings::save_settings(file, settings)
}

/// Die eine Konfigurationsdatei `designer.conf` im App-Datenordner. Gibt es sie noch nicht, werden die alten
/// Dateien (`settings.json`, `recent-project.json`) einmal übernommen.
pub fn settings_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    settings::import_legacy(&dir);
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

/// Die ganze Konfiguration (`designer.conf`) als JSON; die Oberfläche lädt sie beim Start einmal.
#[tauri::command(async)]
pub fn config_get(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    crate::commands::guard("config_get", || {
        Ok(app_base::config::table_to_json(&app_base::config::load(&settings_file(&app)?)))
    })
}

/// Ersetzt einen Abschnitt der Konfiguration (Pfad `["appearance", "theme"]`, `["popups", "git"]` ...). `null` oder ein leerer Wert löscht
/// ihn. Alle Fenster erfahren die Änderung über das Ereignis `forge://config-changed`.
#[tauri::command(async)]
pub fn config_set(path: Vec<String>, value: serde_json::Value, app: tauri::AppHandle) -> Result<(), String> {
    crate::commands::guard("config_set", || {
        use tauri::Emitter;
        let file = settings_file(&app)?;
        // Die Fenster bekommen den bereinigten Wert (Schrägstriche, ohne null) und übernehmen ihn.
        let stored = app_base::config::update(&file, |table| {
            app_base::config::set_path(table, &path, &value);
            app_base::config::get_path(table, &path)
        })?;
        let _ = app.emit("forge://config-changed", serde_json::json!({ "path": path, "value": stored }));
        Ok(())
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
