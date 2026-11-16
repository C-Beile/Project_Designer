//! Real operating-system windows for floating panels and dialogs: one central place that opens a
//! window with its own title bar, hands a payload to the new window, brings the result back as an event and keeps the
//! main window locked while a modal dialog is open.
//!
//! Naming: a floating panel is the window `float-<view>`, a dialog is `dialog-<name>`, an editor
//! moved out of the main window is `editor-<name>`; all open the same `index.html` with
//! `?window=<kind>&name=<name>`, the frontend decides what to draw.
//! Closing a window by its own close button reports `result: null` (cancel) together with the last
//! geometry; `window_result` reports a real result and closes the window without a cancel event.
//! On Windows the new window is owned by the main window (stays above it, leaves the taskbar
//! clutter, minimises with it); other platforms open it as an independent window for now.
//! Dialog windows remember their position and size in `designer.conf` (`[popups.<name>]`, see `window_state.rs`);
//! the geometry of floating panels and editor windows per project is kept by the frontend (`[windows]`).

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder, Window, WindowEvent};

use app_base::window_labels::{label_of, parse_label};

#[derive(Default)]
pub struct WindowPayloads(Mutex<HashMap<String, String>>);

#[derive(Default)]
pub struct ModalWindows(Mutex<Vec<String>>);

/// Labels of windows whose close button must first ask the frontend (unsaved changes). A window
/// that is not in the set closes at once, so a broken frontend can never trap a window.
#[derive(Default)]
pub struct CloseGuards(Mutex<HashSet<String>>);

#[derive(Debug, Deserialize, specta::Type)]
pub struct OpenRequest {
    /// `float`, `dialog` or `editor`.
    pub kind: String,
    pub name: String,
    pub title: String,
    pub width: f64,
    pub height: f64,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub modal: bool,
    pub resizable: Option<bool>,
    /// Text handed to the new window (JSON written by the caller).
    pub payload: Option<String>,
    /// Hintergrundfarbe `#rrggbb`, damit das neue Fenster nicht weiß aufblitzt, bevor die Seite lädt.
    pub background: Option<String>,
    /// Höchstzahl gleichzeitiger Popups (`float` und `dialog`) laut `app/config/limits.toml`; darüber meldet `window_open` `window-limit`.
    pub max_popups: Option<u32>,
    /// Höchstzahl gleichzeitiger Editor-Fenster (`max-editor-windows`); darüber meldet `window_open` `window-limit`.
    pub max_editors: Option<u32>,
}

/// Wann `window_open` je Fenster begann (nur für die Zeitmessung im Log).
static OPEN_STARTED: std::sync::LazyLock<std::sync::Mutex<std::collections::HashMap<String, std::time::Instant>>> = std::sync::LazyLock::new(Default::default);

pub fn parse_hex_color(s: &str) -> Option<tauri::window::Color> {
    let h = s.trim().strip_prefix('#')?;
    if h.len() != 6 {
        return None;
    }
    let v = u32::from_str_radix(h, 16).ok()?;
    Some(tauri::window::Color(((v >> 16) & 0xff) as u8, ((v >> 8) & 0xff) as u8, (v & 0xff) as u8, 255))
}

#[derive(Debug, Clone, Serialize)]
pub struct Geometry {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct WindowResult {
    pub kind: String,
    pub name: String,
    pub result: Option<String>,
    pub geometry: Option<Geometry>,
}

fn geometry_of(window: &Window) -> Option<Geometry> {
    let scale = window.scale_factor().ok()?;
    let pos = window.outer_position().ok()?;
    let size = window.inner_size().ok()?;
    Some(Geometry { x: f64::from(pos.x) / scale, y: f64::from(pos.y) / scale, w: f64::from(size.width) / scale, h: f64::from(size.height) / scale })
}

#[tauri::command]
#[specta::specta]
pub async fn window_open(app: AppHandle, _payloads: State<'_, WindowPayloads>, modals: State<'_, ModalWindows>, req: OpenRequest) -> Result<(), String> {
    crate::commands::guard_async("window_open", async {
    let label = label_of(&req.kind, &req.name)?;
    if let Some(existing) = app.get_webview_window(&label) {
        existing.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let (limit, is_editor) = if req.kind == "editor" { (req.max_editors, true) } else { (req.max_popups, false) };
    if let Some(max) = limit {
        let open = app.webview_windows().keys().filter(|l| parse_label(l).is_some_and(|(kind, _)| (kind == "editor") == is_editor)).count();
        if open >= max as usize {
            return Err("window-limit".to_string());
        }
    }
    // Die Nutzlast reist mit der Seite (`window.__PAYLOAD__`), kein zweiter Weg über `window_payload` nötig.
    let payload_js = serde_json::to_string(&req.payload).map_err(|e| e.to_string())?;
    let opened = std::time::Instant::now();
    if let Ok(mut m) = OPEN_STARTED.lock() {
        m.insert(label.clone(), opened);
    }
    let url = WebviewUrl::App(format!("index.html?window={}&name={}", req.kind, req.name).into());
    let mut builder = WebviewWindowBuilder::new(&app, &label, url)
        .title(&req.title)
        .inner_size(req.width.max(240.0), req.height.max(120.0))
        .min_inner_size(240.0, 120.0)
        .resizable(req.resizable.unwrap_or(true))
        .decorations(true)
        // Das Fenster startet unsichtbar und zeigt sich selbst (`window_show`), sobald die Seite gezeichnet ist.
        .visible(false)
        .focused(true)
        .initialization_script(format!("{}window.__PAYLOAD__={payload_js};", crate::window_state::boot_script()));
    let fallback_bg = crate::window_state::boot_theme().1;
    if let Some(color) = req.background.as_deref().and_then(parse_hex_color).or_else(|| parse_hex_color(&fallback_bg)) {
        builder = builder.background_color(color);
    }
    // Drag and drop inside the page (tabs, tree entries, view fields) needs the webview's own
    // handling; the Windows file-drop interception would swallow it.
    #[cfg(windows)]
    {
        builder = builder.disable_drag_drop_handler();
        if let Ok(dir) = crate::data_dir::webview_dir(&app) {
            builder = builder.data_directory(dir);
        }
    }
    if let (Some(x), Some(y)) = (req.x, req.y) {
        builder = builder.position(x, y);
    }
    // Windows: the child is an owned window (stays above the main window, closes with it). macOS:
    // a child window of the main window. Not verified on a Mac (see PROJECT/MACOS_PORT.md).
    #[cfg(windows)]
    if let Some(main) = app.get_webview_window("main") {
        builder = builder.owner(&main).map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    if let Some(main) = app.get_webview_window("main") {
        builder = builder.parent(&main).map_err(|e| e.to_string())?;
    }
    let window = builder.build().map_err(|e| e.to_string())?;
    let _ = app_base::crashlog::write_entry("PERF", &format!("window {label}: created in {} ms", opened.elapsed().as_millis()));
    // Gemerkte Stelle (und Größe, wenn das Fenster veränderbar ist), solange es noch unsichtbar ist.
    if req.kind == "dialog" {
        crate::window_state::restore(&window, &format!("popups.{}", req.name), req.resizable.unwrap_or(true));
    }
    // Notausgang: zeigt sich die Seite nicht von selbst (Fehler im Frontend), erscheint das Fenster nach 3 s trotzdem.
    // Nur wenn es noch nicht gezeigt wurde: ein spätes `show()` würde sonst ein längst sichtbares Fenster wieder nach vorn holen.
    {
        let late = window.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(3));
            let pending = OPEN_STARTED.lock().ok().and_then(|mut m| m.remove(late.label())).is_some();
            if pending {
                reveal(&late);
            }
        });
    }
    // Modal: Das Hauptfenster wird erst gesperrt, wenn das Popup sichtbar ist (`reveal`). Wäre es schon beim Öffnen gesperrt,
    // gäbe Windows den Fokus an irgendein anderes Fenster ab und würde es nach vorn holen.
    if req.modal && app.get_webview_window("main").is_some() {
        modals.0.lock().map_err(|_| "modal list poisoned".to_string())?.push(label.clone());
    }
    Ok(())
}).await
}

/// Zeigt das Fenster, gibt ihm den Fokus und sperrt bei einem modalen Popup das Hauptfenster.
fn reveal(window: &tauri::WebviewWindow) {
    let _ = window.show();
    let _ = window.set_focus();
    let app = window.app_handle();
    let modal = app.try_state::<ModalWindows>().is_some_and(|m| m.0.lock().is_ok_and(|list| list.iter().any(|l| l == window.label())));
    if modal {
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.set_enabled(false);
        }
    }
}

/// Das Fenster zeigt sich, sobald seine Seite fertig gezeichnet ist.
#[tauri::command]
#[specta::specta]
pub fn window_show(window: tauri::WebviewWindow, timings: Option<String>) -> Result<(), String> {
    crate::commands::guard("window_show", || {
        reveal(&window);
        // Messung: Zeit seit `window_open` und die Marken der Seite (ms seit Navigationsbeginn der Seite).
        let since_open = OPEN_STARTED.lock().ok().and_then(|mut m| m.remove(window.label())).map(|t| t.elapsed().as_millis());
        if let Some(ms) = since_open {
            let _ = app_base::crashlog::write_entry("PERF", &format!("window {}: shown {ms} ms after open; page marks: {}", window.label(), timings.as_deref().unwrap_or("-")));
        }
        Ok(())
    })
}

/// The payload the window was opened with (read once by the new window).
#[tauri::command]
#[specta::specta]
pub fn window_payload(payloads: State<'_, WindowPayloads>, kind: String, name: String) -> Result<Option<String>, String> {
    crate::commands::guard("window_payload", || {
    let label = label_of(&kind, &name)?;
    Ok(payloads.0.lock().map_err(|_| "window payloads poisoned".to_string())?.remove(&label))
})
}

/// A dialog window reports its result and closes.
#[tauri::command]
#[specta::specta]
pub fn window_result(app: AppHandle, kind: String, name: String, result: Option<String>) -> Result<(), String> {
    crate::commands::guard("window_result", || {
    let label = label_of(&kind, &name)?;
    let geometry = app.get_webview_window(&label).and_then(|w| geometry_of(&w.as_ref().window()));
    app.emit("forge://window-result", WindowResult { kind, name, result, geometry }).map_err(|e| e.to_string())?;
    if let Some(w) = app.get_webview_window(&label) {
        release_modal(&app, &label);
        w.destroy().map_err(|e| e.to_string())?;
    }
    Ok(())
})
}

/// The main window closes a floating panel again (docking it); no cancel event is sent.
#[tauri::command]
#[specta::specta]
pub fn window_close(app: AppHandle, kind: String, name: String) -> Result<(), String> {
    crate::commands::guard("window_close", || {
    let label = label_of(&kind, &name)?;
    if let Some(w) = app.get_webview_window(&label) {
        release_modal(&app, &label);
        w.destroy().map_err(|e| e.to_string())?;
    }
    Ok(())
})
}

/// Gibt das Hauptfenster frei, BEVOR ein modales Popup verschwindet. Ist das Hauptfenster beim Schließen noch gesperrt,
/// aktiviert Windows kurz irgendein anderes Fenster (es blitzt durch), bevor der Fokus zurückkommt.
fn release_modal(app: &AppHandle, label: &str) {
    let Some(modals) = app.try_state::<ModalWindows>() else { return };
    let Ok(mut list) = modals.0.lock() else { return };
    let was_modal = list.iter().any(|l| l == label);
    list.retain(|l| l != label);
    if was_modal && list.is_empty() {
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.set_enabled(true);
            let _ = main.set_focus();
        }
    }
}

/// Switches the "ask before closing" behaviour of one window on or off. `kind` is `main`,
/// `float`, `dialog` or `editor`.
#[tauri::command]
#[specta::specta]
pub fn window_close_guard(guards: State<'_, CloseGuards>, kind: String, name: String, on: bool) -> Result<(), String> {
    crate::commands::guard("window_close_guard", || {
    let label = if kind == "main" { "main".to_string() } else { label_of(&kind, &name)? };
    let mut set = guards.0.lock().map_err(|_| "close guards poisoned".to_string())?;
    if on {
        set.insert(label);
    } else {
        set.remove(&label);
    }
    Ok(())
})
}

/// Ends the application after the frontend has asked about unsaved changes.
#[tauri::command]
#[specta::specta]
pub fn app_exit(app: AppHandle, guards: State<'_, CloseGuards>) -> Result<(), String> {
    crate::commands::guard("app_exit", || {
    guards.0.lock().map_err(|_| "close guards poisoned".to_string())?.clear();
    for w in other_windows(&app) {
        let _ = w.destroy();
    }
    if let Some(main) = app.get_webview_window("main") {
        main.destroy().map_err(|e| e.to_string())?;
    }
    app.exit(0);
    Ok(())
})
}

/// Whether a screen point (logical pixels, as the webview reports them) lies inside the main
/// window; used to dock an editor window that was dragged back onto the Designer.
#[tauri::command]
#[specta::specta]
pub fn main_window_contains(app: AppHandle, x: f64, y: f64) -> Result<bool, String> {
    crate::commands::guard("main_window_contains", || {
    let Some(main) = app.get_webview_window("main") else { return Ok(false) };
    let window = main.as_ref().window();
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let (left, top) = (f64::from(pos.x) / scale, f64::from(pos.y) / scale);
    let (right, bottom) = (left + f64::from(size.width) / scale, top + f64::from(size.height) / scale);
    Ok(x >= left && x <= right && y >= top && y <= bottom)
})
}

fn other_windows(app: &AppHandle) -> Vec<tauri::WebviewWindow> {
    app.webview_windows().into_iter().filter(|(l, _)| parse_label(l).is_some()).map(|(_, w)| w).collect()
}

/// Window events: geometry of floating panels, cancel on close, unlocking the main window after a
/// modal dialog, and closing every child window when the main window closes.
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    let app = window.app_handle();
    let label = window.label();
    let guarded = app.try_state::<CloseGuards>().and_then(|g| g.0.lock().ok().map(|set| set.contains(label))).unwrap_or(false);
    if label == "main" {
        match event {
            WindowEvent::Moved(_) | WindowEvent::Resized(_) => crate::window_state::track(window, "window", false),
            WindowEvent::CloseRequested { .. } => crate::window_state::track(window, "window", true),
            _ => {}
        }
        if let WindowEvent::CloseRequested { api, .. } = event {
            if guarded {
                api.prevent_close();
                let _ = app.emit("forge://close-requested", serde_json::json!({ "kind": "main", "name": "" }));
                return;
            }
            for w in other_windows(app) {
                let _ = w.destroy();
            }
        }
        return;
    }
    let Some((kind, name)) = parse_label(label) else { return };
    // Dialog-Fenster merken ihre Stelle und Größe, damit sie beim nächsten Mal dort erscheinen, wohin sie geschoben wurden.
    if kind == "dialog" {
        match event {
            WindowEvent::Moved(_) | WindowEvent::Resized(_) => crate::window_state::track(window, &format!("popups.{name}"), false),
            WindowEvent::CloseRequested { .. } => crate::window_state::track(window, &format!("popups.{name}"), true),
            _ => {}
        }
    }
    match event {
        WindowEvent::CloseRequested { api, .. } => {
            if guarded {
                api.prevent_close();
                let _ = app.emit("forge://close-requested", serde_json::json!({ "kind": kind, "name": name }));
                return;
            }
            release_modal(app, label);
            let _ = app.emit("forge://window-result", WindowResult { kind: kind.to_string(), name: name.to_string(), result: None, geometry: geometry_of(window) });
        }
        WindowEvent::Moved(_) | WindowEvent::Resized(_) if kind == "float" || kind == "editor" => {
            if let Some(g) = geometry_of(window) {
                let _ = app.emit("forge://window-geometry", serde_json::json!({ "kind": kind, "name": name, "geometry": g }));
            }
        }
        WindowEvent::Destroyed => {
            if let Some(guards) = app.try_state::<CloseGuards>() {
                if let Ok(mut set) = guards.0.lock() {
                    set.remove(label);
                }
            }
            if let Some(modals) = app.try_state::<ModalWindows>() {
                if let Ok(mut list) = modals.0.lock() {
                    list.retain(|l| l != label);
                    if list.is_empty() {
                        if let Some(main) = app.get_webview_window("main") {
                            let _ = main.set_enabled(true);
                            let _ = main.set_focus();
                        }
                    }
                }
            }
        }
        _ => {}
    }
}
