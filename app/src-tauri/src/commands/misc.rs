//! Updates und Hilfs-Befehle (Logs, Backups, lokale Adressen).

use super::blocking;
use super::settings::settings_file;
use project::settings;
use tauri::Manager;

/// Update access token of the private release repository; it is baked in at build time from the
/// CI secret and is never part of the source tree.
pub const UPDATE_TOKEN: Option<&str> = option_env!("DITO_UPDATE_TOKEN");

#[derive(serde::Serialize)]
pub struct UpdateInfo {
    version: String,
    notes: Option<String>,
    date: Option<String>,
}

pub fn private_repo_updater(app: &tauri::AppHandle) -> Result<tauri_plugin_updater::Updater, String> {
    use tauri_plugin_updater::UpdaterExt;
    let token = UPDATE_TOKEN
        .filter(|t| !t.is_empty())
        .ok_or_else(|| "This build has no access to the update repository.".to_string())?;
    app.updater_builder()
        .header("Authorization", format!("Bearer {token}"))
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())
}

/// Help > Check for Updates: asks the private release repository whether a newer version exists.
#[tauri::command]
pub async fn check_for_update(app: tauri::AppHandle) -> Result<Option<UpdateInfo>, String> {
    crate::commands::guard_async("check_for_update", async {
    let update = private_repo_updater(&app)?.check().await.map_err(|e| e.to_string())?;
    Ok(update.map(|u| UpdateInfo { version: u.version.clone(), notes: u.body.clone(), date: u.date.map(|d| d.to_string()) }))
}).await
}

/// Downloads and installs the newer version after the user confirmed, then restarts the app.
#[tauri::command]
pub async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    crate::commands::guard_async("install_update", async {
    let update = private_repo_updater(&app)?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No newer version is available.".to_string())?;
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    app.restart()
}).await
}

/// Help > Local Data and the Janitor list: Dito Designer's own data folder plus, read-only, the version
/// folders of the original Designer. Nothing is changed or deleted.
#[tauri::command]
pub async fn local_data_info(threshold_days: u32, app: tauri::AppHandle) -> Result<project::local_data::LocalDataInfo, String> {
    crate::commands::guard_async("local_data_info", async {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let settings = settings_file(&app)?;
    let version = app.package_info().version.to_string();
    blocking(move || {
        project::local_data::inspect(&version, &data_dir, &settings, u64::from(threshold_days), settings::detect_designer_install())
    })
    .await
}).await
}

/// Opens a folder of the app (logs, backups) in the file manager.
pub fn open_in_file_manager(dir: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    #[cfg(windows)]
    let program = "explorer";
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(all(not(windows), not(target_os = "macos")))]
    let program = "xdg-open";
    platform::console::command(program).arg(dir).spawn().map(|_| ()).map_err(|e| format!("cannot open {}: {e}", dir.display()))
}

/// "Open in browser" of the tunnel manager: only an address of this computer (127.0.0.1 or
/// localhost with a port) is opened in the default browser.
#[tauri::command(async)]
pub fn open_local_url(url: String) -> Result<(), String> {
    crate::commands::guard("open_local_url", || {
    let rest = url.strip_prefix("http://").or_else(|| url.strip_prefix("https://")).ok_or("Only http and https addresses can be opened.")?;
    let host_port = rest.split('/').next().unwrap_or("");
    let (host, port) = host_port.rsplit_once(':').ok_or("The address needs a port.")?;
    if !(host == "127.0.0.1" || host == "localhost") || port.parse::<u16>().is_err() {
        return Err("Only addresses of this computer can be opened.".into());
    }
    if rest.chars().any(|c| c.is_whitespace() || matches!(c, '"' | '<' | '>' | '`' | '^' | '&' | '|')) {
        return Err("The address contains characters that are not allowed.".into());
    }
    #[cfg(windows)]
    let program = "explorer";
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(all(not(windows), not(target_os = "macos")))]
    let program = "xdg-open";
    platform::console::command(program).arg(&url).spawn().map(|_| ()).map_err(|e| format!("cannot open {url}: {e}"))
})
}

#[tauri::command(async)]
pub fn open_log_folder() -> Result<String, String> {
    crate::commands::guard("open_log_folder", || {
    let dir = app_base::crashlog::log_dir();
    open_in_file_manager(&dir)?;
    Ok(dir.to_string_lossy().into_owned())
})
}

#[tauri::command(async)]
pub fn open_backup_folder() -> Result<String, String> {
    crate::commands::guard("open_backup_folder", || {
    let dir = app_base::backup::backup_dir();
    open_in_file_manager(&dir)?;
    Ok(dir.to_string_lossy().into_owned())
})
}

/// Writes an error that happened in the frontend (render crash, unhandled promise) to the log file.
#[tauri::command(async)]
pub fn log_client_error(message: String) -> Option<String> {
    crate::commands::guard("log_client_error", || {
    app_base::crashlog::write_entry("UI-ERROR", &message).map(|p| p.to_string_lossy().into_owned())
})
}

/// Die UI meldet ihre Zeitzone (Minuten östlich von UTC), damit Einträge der Log-Datei und des IDE Logs in Ortszeit stehen.
#[tauri::command]
pub fn set_log_timezone(offset_minutes: i32) {
    crate::commands::guard("set_log_timezone", || {
    app_base::crashlog::set_utc_offset_minutes(offset_minutes);
})
}
