//! Real operating-system windows for floating panels and dialogs: one central place that opens a
//! window with its own title bar, remembers nothing itself (the main window stores geometry per
//! project), hands a payload to the new window, brings the result back as an event and keeps the
//! main window locked while a modal dialog is open.
//!
//! Naming: a floating panel is the window `float-<view>`, a dialog is `dialog-<name>`, an editor
//! moved out of the main window is `editor-<name>`; all open the same `index.html` with
//! `?window=<kind>&name=<name>`, the frontend decides what to draw.
//! Closing a window by its own close button reports `result: null` (cancel) together with the last
//! geometry; `window_result` reports a real result and closes the window without a cancel event.
//! On Windows the new window is owned by the main window (stays above it, leaves the taskbar
//! clutter, minimises with it); other platforms open it as an independent window for now.

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

#[derive(Debug, Deserialize)]
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
}

fn parse_hex_color(s: &str) -> Option<tauri::window::Color> {
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
pub async fn window_open(app: AppHandle, payloads: State<'_, WindowPayloads>, modals: State<'_, ModalWindows>, req: OpenRequest) -> Result<(), String> {
    crate::commands::guard_async("window_open", async {
    let label = label_of(&req.kind, &req.name)?;
    if let Some(existing) = app.get_webview_window(&label) {
        existing.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    if let Some(payload) = req.payload {
        payloads.0.lock().map_err(|_| "window payloads poisoned".to_string())?.insert(label.clone(), payload);
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
        .focused(true);
    if let Some(color) = req.background.as_deref().and_then(parse_hex_color) {
        builder = builder.background_color(color);
    }
    // Drag and drop inside the page (tabs, tree entries, view fields) needs the webview's own
    // handling; the Windows file-drop interception would swallow it.
    #[cfg(windows)]
    {
        builder = builder.disable_drag_drop_handler();
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
    // Notausgang: zeigt sich die Seite nicht von selbst (Fehler im Frontend), erscheint das Fenster nach 3 s trotzdem.
    {
        let late = window.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(3));
            let _ = late.show();
        });
    }
    if req.modal {
        if let Some(main) = app.get_webview_window("main") {
            main.set_enabled(false).map_err(|e| e.to_string())?;
            modals.0.lock().map_err(|_| "modal list poisoned".to_string())?.push(label.clone());
        }
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}).await
}

/// Das Fenster zeigt sich, sobald seine Seite fertig gezeichnet ist.
#[tauri::command]
pub fn window_show(window: tauri::WebviewWindow) -> Result<(), String> {
    crate::commands::guard("window_show", || {
        window.show().map_err(|e| e.to_string())?;
        let _ = window.set_focus();
        Ok(())
    })
}

/// The payload the window was opened with (read once by the new window).
#[tauri::command]
pub fn window_payload(payloads: State<'_, WindowPayloads>, kind: String, name: String) -> Result<Option<String>, String> {
    crate::commands::guard("window_payload", || {
    let label = label_of(&kind, &name)?;
    Ok(payloads.0.lock().map_err(|_| "window payloads poisoned".to_string())?.remove(&label))
})
}

/// A dialog window reports its result and closes.
#[tauri::command]
pub fn window_result(app: AppHandle, kind: String, name: String, result: Option<String>) -> Result<(), String> {
    crate::commands::guard("window_result", || {
    let label = label_of(&kind, &name)?;
    let geometry = app.get_webview_window(&label).and_then(|w| geometry_of(&w.as_ref().window()));
    app.emit("forge://window-result", WindowResult { kind, name, result, geometry }).map_err(|e| e.to_string())?;
    if let Some(w) = app.get_webview_window(&label) {
        w.destroy().map_err(|e| e.to_string())?;
    }
    Ok(())
})
}

/// The main window closes a floating panel again (docking it); no cancel event is sent.
#[tauri::command]
pub fn window_close(app: AppHandle, kind: String, name: String) -> Result<(), String> {
    crate::commands::guard("window_close", || {
    let label = label_of(&kind, &name)?;
    if let Some(w) = app.get_webview_window(&label) {
        w.destroy().map_err(|e| e.to_string())?;
    }
    Ok(())
})
}

/// Switches the "ask before closing" behaviour of one window on or off. `kind` is `main`,
/// `float`, `dialog` or `editor`.
#[tauri::command]
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
    match event {
        WindowEvent::CloseRequested { api, .. } => {
            if guarded {
                api.prevent_close();
                let _ = app.emit("forge://close-requested", serde_json::json!({ "kind": kind, "name": name }));
                return;
            }
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
