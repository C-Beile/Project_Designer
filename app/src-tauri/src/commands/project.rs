//! Projekt: oeffnen, anlegen, offene Projekte, Zip, Probleme und Suche.

use super::blocking;
use super::settings::{settings_file, write_settings};
use project::settings;
use project::project_actor::ProjectActorHandle;
use project::tree::TreeNode;
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{Manager, State};

/// Ziel A.2 command 1: scans a project folder and returns its recognised object tree (currently
/// entity objects only, see `project::tree`). Named `open_project` per this agent's
/// briefing even though it does not (yet) return a single opened document - `designer-core`'s own
/// `open_project` operates on one `.aod` file, so the per-file open happens lazily on the first
/// `get_property_tree` call for a given tree leaf (see `project_actor.rs`).
///
/// P8 step 2: returns the one project root node of the merged Projects tree; scanning a project
/// with its ~130 modules takes a few hundred ms, so it runs off the UI thread.
#[tauri::command]
pub async fn open_project(path: String) -> Result<Vec<TreeNode>, String> {
    crate::commands::guard_async("open_project", async {
    // The scan only reads files, so it does not wait in the actor's queue behind property edits and several projects
    // are scanned side by side.
    blocking(move || {
        let started = std::time::Instant::now();
        let result = project::tree::scan_project_tree(&PathBuf::from(&path));
        let _ = app_base::crashlog::write_entry("PERF", &format!("open project {path}: tree scan {} ms", started.elapsed().as_millis()));
        result
    })
    .await?
}).await
}

/// P8 step 2: children of a lazily loaded tree node (module file trees, `others`).
#[tauri::command]
pub async fn list_tree_children(node_id: String, actor: State<'_, ProjectActorHandle>) -> Result<Vec<TreeNode>, String> {
    crate::commands::guard_async("list_tree_children", async {
    let actor = actor.inner().clone();
    blocking(move || actor.tree_children(node_id)).await?
}).await
}

/// P8 step 2: the projects to reopen at start - only folders that still exist (R41).
#[tauri::command(async)]
pub fn restore_open_projects(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    crate::commands::guard("restore_open_projects", || {
    let file = settings_file(&app)?;
    let mut stored = settings::load_settings(&file);
    let restorable = settings::restorable_open_projects(&stored);
    if restorable != stored.open_projects {
        stored.open_projects = restorable.clone();
        write_settings(&file, &stored)?;
    }
    Ok(restorable)
})
}

/// The icons the icon chooser offers (shipped with the app).
#[tauri::command(async)]
pub fn list_icons() -> Vec<project::icons::IconDto> {
    crate::commands::guard("list_icons", || {
    project::icons::bundled_icons()
})
}

/// File > Open Project adds, Close Project removes; returns the new list.
#[tauri::command(async)]
pub fn add_open_project(path: String, app: tauri::AppHandle) -> Result<Vec<String>, String> {
    crate::commands::guard("add_open_project", || {
    update_open_projects(&app, |list| {
        settings::add_open_project(list, &path);
    })
})
}

#[tauri::command(async)]
pub fn remove_open_project(path: String, app: tauri::AppHandle) -> Result<Vec<String>, String> {
    crate::commands::guard("remove_open_project", || {
    update_open_projects(&app, |list| settings::remove_open_project(list, &path))
})
}

pub fn update_open_projects(app: &tauri::AppHandle, change: impl FnOnce(&mut Vec<String>)) -> Result<Vec<String>, String> {
    let file = settings_file(app)?;
    let mut stored = settings::load_settings(&file);
    change(&mut stored.open_projects);
    write_settings(&file, &stored)?;
    Ok(stored.open_projects)
}

/// Find Usages / Safely Delete: where the project's own objects point to one object (read-only).
#[tauri::command]
pub async fn find_usages(project_root: String, object_type: String, name: String) -> Result<Vec<project::problems::UsageDto>, String> {
    crate::commands::guard_async("find_usages", async {
    blocking(move || project::problems::find_usages(&PathBuf::from(project_root), &object_type, &name))
        .await
}).await
}

/// Problems tab / error badges: read-only scan of every object of the project (parse errors with
/// line, validator findings, dangling references).
#[tauri::command]
pub async fn scan_problems(project_root: String) -> Result<Vec<project::problems::ProblemDto>, String> {
    crate::commands::guard_async("scan_problems", async {
    blocking(move || {
        let started = std::time::Instant::now();
        let list = project::problems::scan_project(&PathBuf::from(&project_root));
        let _ = app_base::crashlog::write_entry("PERF", &format!("problems scan {project_root}: {} ms, {} findings", started.elapsed().as_millis(), list.len()));
        list
    })
    .await
}).await
}

/// Last seen file fingerprint per project, for `project_changed`.
#[derive(Default)]
pub struct ProjectFingerprints(std::sync::Mutex<HashMap<String, u64>>);

/// True when files of the project were added, removed or edited since the previous call for the
/// same project (the first call only records the state).
#[tauri::command]
pub async fn project_changed(project_root: String, seen: State<'_, ProjectFingerprints>) -> Result<bool, String> {
    crate::commands::guard_async("project_changed", async {
    let root = PathBuf::from(&project_root);
    let now = blocking(move || project::watch::project_fingerprint(&root)).await?;
    let mut map = seen.0.lock().map_err(|_| "fingerprint state poisoned".to_string())?;
    Ok(map.insert(project_root, now).map(|before| before != now).unwrap_or(false))
}).await
}

/// Quick file search (double Ctrl): the file names of a project.
#[tauri::command]
pub async fn list_project_files(project_root: String) -> Vec<String> {
    crate::commands::guard_async("list_project_files", async {
    tauri::async_runtime::spawn_blocking(move || project::file_list::list_project_files(&PathBuf::from(project_root))).await.unwrap_or_default()
}).await
}

/// Ctrl+click on an import: the file the module name points to, or nothing.
#[tauri::command]
pub fn resolve_import(project_root: String, spec: String, from_file: String) -> Option<String> {
    crate::commands::guard("resolve_import", || {
    project::import_resolve::resolve_import(&PathBuf::from(project_root), &spec, &from_file)
})
}

/// Where the "recently opened project" hint (Ziel 3, nice-to-have) is persisted: one small JSON
/// file in the OS-appropriate per-user app data directory, written through
/// `platform::fs::atomic_write` for the same crash-safety guarantee the real project save path
/// gets (architecture.md §4) - not a bespoke `std::fs::write`.
pub fn recent_project_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("recent-project.json"))
}

/// P7 command 2: the last successfully opened project path, if any - purely informational, the
/// frontend only ever offers it as a "Recent: <path>" button, it is never auto-loaded (that
/// auto-load behaviour was the disproven root-cause hypothesis from the P7 bugfix round, see
/// `p7-bugfix-empty-project-root-notes.md`).
#[tauri::command(async)]
pub fn get_recent_project(app: tauri::AppHandle) -> Result<Option<String>, String> {
    crate::commands::guard("get_recent_project", || {
    let file = recent_project_file(&app)?;
    if !file.exists() {
        return Ok(None);
    }
    let bytes = std::fs::read(&file).map_err(|e| e.to_string())?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    Ok(value.get("path").and_then(|v| v.as_str()).map(|s| s.to_string()))
})
}

/// P7 command 3: records the just-opened project path as the new "recently opened" suggestion.
#[tauri::command(async)]
pub fn set_recent_project(path: String, app: tauri::AppHandle) -> Result<(), String> {
    crate::commands::guard("set_recent_project", || {
    let file = recent_project_file(&app)?;
    let mut paths = read_recent_paths(&file);
    paths.retain(|p| !p.eq_ignore_ascii_case(&path));
    paths.insert(0, path.clone());
    paths.truncate(MAX_RECENT_PROJECTS);
    let bytes = serde_json::to_vec_pretty(&serde_json::json!({ "path": path, "paths": paths })).map_err(|e| e.to_string())?;
    platform::fs::atomic_write(&file, &bytes).map_err(|e| e.to_string())
})
}

const MAX_RECENT_PROJECTS: usize = 12;

/// The recently opened projects, newest first; folders that no longer exist are left out. Files written by older
/// versions only know the single `path`.
fn read_recent_paths(file: &std::path::Path) -> Vec<String> {
    let Ok(bytes) = std::fs::read(file) else { return Vec::new() };
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) else { return Vec::new() };
    let mut paths: Vec<String> = value.get("paths").and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect()).unwrap_or_default();
    if paths.is_empty() {
        if let Some(single) = value.get("path").and_then(|v| v.as_str()) {
            paths.push(single.to_string());
        }
    }
    paths.retain(|p| std::path::Path::new(p).is_dir());
    paths
}

/// All recently opened projects for the "Open recent" list.
#[tauri::command(async)]
pub fn get_recent_projects(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    crate::commands::guard("get_recent_projects", || {
    let file = recent_project_file(&app)?;
    Ok(read_recent_paths(&file))
})
}

#[tauri::command(async)]
pub fn search_in_projects(roots: Vec<String>, query: String, options: project::content_search::SearchOptions) -> Result<project::content_search::SearchResult, String> {
    crate::commands::guard("search_in_projects", || {
        let roots: Vec<PathBuf> = roots.into_iter().map(PathBuf::from).collect();
        project::content_search::search(&roots, &query, &options)
    })
}

#[tauri::command(async)]
pub fn replace_in_projects(roots: Vec<String>, files: Vec<String>, query: String, options: project::content_search::SearchOptions, replacement: String) -> Result<project::content_search::ReplaceResult, String> {
    crate::commands::guard("replace_in_projects", || {
        let roots: Vec<PathBuf> = roots.into_iter().map(PathBuf::from).collect();
        let files: Vec<PathBuf> = files.into_iter().map(PathBuf::from).collect();
        project::content_search::replace(&roots, &files, &query, &options, &replacement)
    })
}

/// "Open Projects from Folder": the ADITO projects inside one folder (read-only, direct subfolders only).
#[tauri::command(async)]
pub fn find_projects_in_folder(folder: String) -> Result<Vec<project::discover::FoundProject>, String> {
    crate::commands::guard("find_projects_in_folder", || project::discover::find_projects(&PathBuf::from(folder)))
}

/// Export/Import Project: the data models of the project (read-only).
#[tauri::command(async)]
pub fn list_project_models(project_root: String) -> Vec<project::project_zip::ModelEntry> {
    crate::commands::guard("list_project_models", || {
    project::project_zip::list_models(&PathBuf::from(project_root))
})
}

/// Export Project: writes the chosen models into a new zip file; returns the number of files.
#[tauri::command]
pub async fn export_project_zip(project_root: String, models: Vec<(String, String)>, target: String) -> Result<usize, String> {
    crate::commands::guard_async("export_project_zip", async {
    blocking(move || project::project_zip::export_zip(&PathBuf::from(project_root), &models, &PathBuf::from(target)))
        .await?
}).await
}

/// Import Project: the models inside a zip file and which of them exist already (read-only).
#[tauri::command]
pub async fn inspect_project_zip(project_root: String, zip_path: String) -> Result<Vec<project::project_zip::ModelEntry>, String> {
    crate::commands::guard_async("inspect_project_zip", async {
    blocking(move || project::project_zip::inspect_zip(&PathBuf::from(project_root), &PathBuf::from(zip_path)))
        .await?
}).await
}

/// Import Project: unpacks the chosen models; existing ones only when listed in `overwrite`.
#[tauri::command]
pub async fn import_project_zip(project_root: String, zip_path: String, selected: Vec<(String, String)>, overwrite: Vec<(String, String)>) -> Result<project::project_zip::ImportOutcome, String> {
    crate::commands::guard_async("import_project_zip", async {
    blocking(move || project::project_zip::import_zip(&PathBuf::from(project_root), &PathBuf::from(zip_path), &selected, &overwrite))
        .await?
}).await
}

#[tauri::command]
pub async fn project_create_empty(location: String, name: String) -> Result<String, String> {
    crate::commands::guard_async("project_create_empty", async {
    blocking(move || project::project_create::create_empty_project(&location, &name).map(|p| p.to_string_lossy().into_owned()))
        .await?
}).await
}
