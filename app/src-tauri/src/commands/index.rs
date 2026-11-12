//! Index: Stand abfragen, mit der Platte abgleichen, neu aufbauen. Der Index ist Kern (kein Plugin),
//! darum eigene Befehle statt `plugin_call`.

use project_index::{IndexRegistry, IndexStatus, VerifyOutcome};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;

/// Current state of the index of a project (after a window reload the UI asks for it). `None` = no index.
#[tauri::command(async)]
pub fn index_status(project_root: String, registry: State<'_, Arc<IndexRegistry>>) -> Option<IndexStatus> {
    crate::commands::guard("index_status", || registry.get(&PathBuf::from(project_root)).map(|h| h.status()))
}

/// Compares the project with the disk (stat only). Changes come back as the event `forge://project-changed`.
#[tauri::command]
pub async fn index_verify(project_root: String, registry: State<'_, Arc<IndexRegistry>>) -> Result<VerifyOutcome, String> {
    let registry = registry.inner().clone();
    crate::commands::guard_async("index_verify", async {
        super::blocking(move || match registry.get(&PathBuf::from(project_root)) {
            Some(h) => h.verify(),
            None => Ok(VerifyOutcome { changed: 0, duration_ms: 0 }),
        })
        .await?
    })
    .await
}

/// Throws the index away and builds it again.
#[tauri::command(async)]
pub fn index_rebuild(project_root: String, registry: State<'_, Arc<IndexRegistry>>) -> Result<(), String> {
    crate::commands::guard("index_rebuild", || {
        registry.rebuild(&PathBuf::from(project_root));
        Ok(())
    })
}

/// Debug menu: writes everything the index holds as JSON into the log folder and returns the file path.
#[tauri::command]
pub async fn index_dump(project_root: String, registry: State<'_, Arc<IndexRegistry>>) -> Result<String, String> {
    let registry = registry.inner().clone();
    crate::commands::guard_async("index_dump", async {
        super::blocking(move || {
            let handle = registry.get(&PathBuf::from(project_root)).ok_or("There is no index for this project")?;
            let json = handle.read(|i| i.dump_json()).ok_or("The index is not ready yet")?;
            let text = serde_json::to_string_pretty(&json).map_err(|e| e.to_string())?;
            let dir = app_base::crashlog::log_dir();
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            let file = dir.join("index-dump.json");
            std::fs::write(&file, text).map_err(|e| e.to_string())?;
            Ok::<String, String>(file.to_string_lossy().into_owned())
        })
        .await?
    })
    .await
}

/// For Rename: the object files that may point to the object (from the index) and the project file list.
/// The index is compared with the disk first. `None` while the index is not ready: the old full scan answers.
pub fn rename_hints(registry: &IndexRegistry, root: &std::path::Path, aod: &std::path::Path) -> Option<project::rename::IndexHints> {
    let handle = registry.get(root)?;
    let loc = project::tree_ops::locate_object(aod).ok()?;
    handle.verify().ok()?;
    handle.read(|i| {
        let mut seen = std::collections::HashSet::new();
        let candidates = i
            .usages(&loc.type_folder, &loc.name)
            .into_iter()
            .filter(|u| seen.insert(u.node_id.clone()))
            .map(|u| (u.object_type, u.object, PathBuf::from(u.node_id)))
            .collect();
        project::rename::IndexHints { candidates, files: i.files().map(|f| f.path.clone()).collect() }
    })
}
