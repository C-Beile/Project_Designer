//! Merkt Lage, Größe und Bildschirm des Hauptfensters (`[window]`) und der Dialog-Fenster (`[popups.<name>]`)
//! in `designer.conf` und stellt sie beim nächsten Öffnen wieder her. Die Regeln (passt es noch auf einen
//! angeschlossenen Bildschirm?) stehen testbar in `app_base::window_state`; hier ist nur der Tauri-Teil.
//!
//! Gespeichert wird kurz verzögert nach dem letzten Verschieben oder Ändern der Größe und sofort beim
//! Schließen, damit bei jedem Beenden die letzte Lage steht.

use app_base::window_state::{self as ws, Saved, Screen};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::{Manager, PhysicalPosition, PhysicalSize, WebviewWindow, Window};

static FILE: OnceLock<PathBuf> = OnceLock::new();
static PENDING: Mutex<Option<HashMap<String, Saved>>> = Mutex::new(None);
static SCHEDULED: AtomicBool = AtomicBool::new(false);

/// Legt die Konfigurationsdatei fest und holt das Hauptfenster an seine gemerkte Stelle. Das Hauptfenster
/// startet unsichtbar (`visible: false` in `tauri.conf.json`) und wird hier gezeigt, damit es nie an der
/// falschen Stelle aufblitzt. Das Zeigen hängt nicht vom Frontend ab.
pub fn init_main(app: &tauri::AppHandle) {
    if let Ok(file) = crate::commands::settings::settings_file(app) {
        let _ = FILE.set(file);
    }
    if let Some(window) = app.get_webview_window("main") {
        restore(&window, "window", true);
        let _ = window.show();
    }
}

fn screens(window: &WebviewWindow) -> Vec<Screen> {
    window
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| Screen { name: m.name().map(|n| app_base::config::slash_path(n)), x: m.position().x, y: m.position().y, width: m.size().width, height: m.size().height })
        .collect()
}

/// Setzt Lage (und, wenn `with_size`, Größe und Maximierung) aus dem Abschnitt `section`. Ohne gültigen
/// Eintrag oder wenn der Bildschirm nicht mehr da ist, bleibt das Fenster an seiner Standardstelle.
pub fn restore(window: &WebviewWindow, section: &str, with_size: bool) {
    let Some(file) = FILE.get() else { return };
    let conf = app_base::config::load(file);
    let Some(saved) = app_base::config::get_section(&conf, section).map(app_base::config::to_json).and_then(|j| ws::from_json(&j)) else { return };
    if let Some((x, y, width, height)) = ws::fit(&saved, &screens(window)) {
        if with_size {
            let _ = window.set_size(PhysicalSize::new(width, height));
        }
        let _ = window.set_position(PhysicalPosition::new(x, y));
        if with_size && saved.maximized {
            let _ = window.maximize();
        }
    }
}

fn capture(window: &Window) -> Option<Saved> {
    // Minimiert meldet Windows eine Position weit außerhalb; die ist nichts zum Merken.
    if window.is_minimized().unwrap_or(false) {
        return None;
    }
    let position = window.outer_position().ok()?;
    let size = window.inner_size().ok()?;
    let monitor = window.current_monitor().ok().flatten().and_then(|m| m.name().cloned());
    Some(Saved { x: position.x, y: position.y, width: size.width, height: size.height, monitor, maximized: window.is_maximized().unwrap_or(false) })
}

/// Hält die aktuelle Lage von `window` für `section` fest: verzögert gespeichert, bei `now` sofort.
pub fn track(window: &Window, section: &str, now: bool) {
    let Some(saved) = capture(window) else { return };
    if let Ok(mut pending) = PENDING.lock() {
        pending.get_or_insert_with(HashMap::new).insert(section.to_string(), saved);
    }
    if now {
        flush();
    } else if !SCHEDULED.swap(true, Ordering::SeqCst) {
        std::thread::spawn(|| {
            std::thread::sleep(std::time::Duration::from_millis(600));
            SCHEDULED.store(false, Ordering::SeqCst);
            flush();
        });
    }
}

fn flush() {
    let Some(file) = FILE.get() else { return };
    let items: Vec<(String, Saved)> = PENDING.lock().ok().and_then(|mut p| p.take()).map(|m| m.into_iter().collect()).unwrap_or_default();
    if items.is_empty() {
        return;
    }
    let _ = app_base::config::update(file, |table| {
        for (section, mut saved) in items {
            if saved.maximized {
                // Ein maximiertes Fenster behält seine letzte normale Lage (und Bildschirm); nur das Kennzeichen kommt dazu.
                if let Some(previous) = app_base::config::get_section(table, &section).map(app_base::config::to_json).and_then(|j| ws::from_json(&j)) {
                    saved = Saved { maximized: true, ..previous };
                }
            }
            app_base::config::set_section(table, &section, &ws::to_json(&saved));
        }
    });
}
