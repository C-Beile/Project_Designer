//! Der Datenordner der App: `DitoDesigner` im lokalen Datenordner des Benutzers (Windows `%LOCALAPPDATA%\DitoDesigner`),
//! wie beim AditoHub. Dort liegen `designer.conf`, `logs`, `backups`, `themes` und der Katalog-Cache.
//! Vorher nutzte die App den Tauri-Ordner `de.threehillsit.dito-designer`; dessen Inhalt wird einmal übernommen,
//! wenn der neue Ordner noch fehlt. Danach ist der alte Ordner weg.

use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

pub const DATA_DIR_NAME: &str = "DitoDesigner";

pub fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().local_data_dir().map_err(|e| e.to_string())?.join(DATA_DIR_NAME);
    if !dir.exists() {
        if let Ok(old) = app.path().app_data_dir() {
            if old.is_dir() {
                // Erst verschieben (gleiches Laufwerk, schnell), sonst kopieren und den alten Ordner löschen.
                // Schlägt alles fehl, startet die App mit leeren Einstellungen.
                if fs::rename(&old, &dir).is_err() && copy_dir(&old, &dir).is_ok() {
                    let _ = fs::remove_dir_all(&old);
                }
            }
        }
    }
    Ok(dir)
}

/// Speicher der WebView (WebView2): ebenfalls im Datenordner, damit nichts in einem zweiten Ordner liegt.
pub fn webview_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("webview"))
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}
