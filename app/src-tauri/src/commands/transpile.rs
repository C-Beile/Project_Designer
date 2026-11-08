//! Transpile, npm und Build-Abbruch.

use super::blocking;
use project::actions::dispatch_action;
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::Manager;

/// Ziel A.2 command 4: generic action dispatch by id (architecture.md §2 `Action` extension
/// point). See `project::actions` doc for why this honestly reports "not registered" this
/// round.
///
/// Runs off the UI thread: a transpile takes minutes and must not freeze the window. Forge's
/// own data folder is passed along so the official transpiler gets Forge's private profile
/// there instead of any developer folder (RISKS.md R43).
#[tauri::command]
pub async fn execute_action(
    action_id: String,
    target_path: String,
    mut params: HashMap<String, String>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    crate::commands::guard_async("execute_action", async {
    if !params.contains_key("forge_data_dir") {
        if let Ok(dir) = app.path().app_data_dir() {
            params.insert("forge_data_dir".to_string(), dir.to_string_lossy().into_owned());
        }
    }
    let is_transpile = action_id == "transpile";
    if is_transpile {
        use tauri::Emitter;
        let handle = app.clone();
        project::transpile_action::set_progress_reporter(Some(std::sync::Arc::new(move |percent: u8, stage: &str| {
            let _ = handle.emit("forge://transpile-progress", serde_json::json!({ "percent": percent, "stage": stage }));
        })));
    }
    let result = blocking(move || dispatch_action(&action_id, target_path, params))
        .await?;
    if is_transpile {
        project::transpile_action::set_progress_reporter(None);
    }
    result
}).await
}

/// NodeJS menu: runs one npm command in the project folder; each output line is sent as the event
/// `forge://npm-output` while it is produced. `confirmed` must be true for login and publish.
#[tauri::command]
pub async fn npm_run(project_root: String, action: String, confirmed: bool, app: tauri::AppHandle) -> Result<i32, String> {
    crate::commands::guard_async("npm_run", async {
    blocking(move || {
        use tauri::Emitter;
        let sink = app.clone();
        let name = action.clone();
        project::file_ops::run_npm(&PathBuf::from(project_root), &action, confirmed, &move |is_error, line| {
            let _ = sink.emit("forge://npm-output", serde_json::json!({ "action": name, "line": line, "error": is_error }));
        })
    })
    .await?
}).await
}

/// Ends the running official transpiler (the UI asks first). False when no build is running.
#[tauri::command(async)]
pub fn cancel_build() -> bool {
    crate::commands::guard("cancel_build", || {
    project::transpile_action::cancel_build()
})
}

#[tauri::command]
pub async fn transpile_compare(
    registry: tauri::State<'_, std::sync::Arc<plugin_api::TranspilerRegistry>>,
    reference: String,
    project_root: String,
) -> Result<project::transpile_compare::CompareReport, String> {
    crate::commands::guard_async("transpile_compare", async {
    if registry.get(project::transpile_action::OFFICIAL_ID).is_none() {
        return Err("Der offizielle Transpiler ist nicht installiert".into());
    }
    blocking(move || project::transpile_compare::compare_outputs(&PathBuf::from(reference), &PathBuf::from(project_root).join("dist")))
        .await?
}).await
}
