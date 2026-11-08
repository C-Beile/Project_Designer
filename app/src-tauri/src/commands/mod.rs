//! Tauri-Befehle, nach Feature gruppiert. Die Handler-Liste steht weiterhin in `lib.rs`.

pub mod dialogs;
pub mod editor;
pub mod files;
pub mod misc;
pub mod plugins;
pub mod project;
pub mod settings;
pub mod transpile;

/// Fuehrt blockierende Arbeit ausserhalb des UI-Threads aus; ein abgestuerzter Task wird zum Fehlertext.
pub(crate) async fn blocking<T, F>(f: F) -> Result<T, String>
where
    F: FnOnce() -> T + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())
}
