//! Forge app shell - Tauri 2 adapter layer only (architecture.md §1 "Grundregel"). Every command
//! here is a thin wrapper: parse Tauri's IPC arguments, call into `forge_app_core` (which itself
//! only ever calls `forge-core`, never touches `.aod` parsing/patching logic directly), return
//! the result. All actual project/editor logic lives in the `forge-app-core` crate - deliberately
//! kept out of this crate so it never links `tauri`/`wry`/`webview2-com` (see that crate's `lib.rs`
//! doc for why: a GNU-toolchain test-binary DLL issue on this machine, not a code defect).
//!
//! No editor-specific logic lives in a command: `set_property`/`get_property_tree`/etc. know
//! nothing about "entity" vs. any future object type (architecture.md §6) - the entity-specific
//! pieces (validators) are registered inside `forge_app_core::project_actor`, not here.

pub mod lsp_bridge;
pub mod os_windows;

use forge_app_core::actions::dispatch_action;
use forge_app_core::catalog::sheet::{NavNode, PropertySheet};
use forge_app_core::catalog::CatalogCache;
use forge_app_core::db_session::{DbManager, DbStatus, SchemaTable, SqlResult};
use forge_app_core::git_actions::{self, GitOutput, GitOverview};
use forge_app_core::git_scm::{self, CommitFile, DiffContent, DiffSide, Gutter, ScmOverview};
use forge_app_core::linked_file;
use forge_app_core::tree_ops;
use forge_app_core::settings::{self, ForgeSettings};
use forge_app_core::project_actor::{DiagnosticDto, ProjectActorHandle, SourceDto, UndoRedoOutcome};
use forge_app_core::tree::TreeNode;
use forge_app_core::wire::WireValue;
use lsp_bridge::LspProcess;
use platform::{CommandGitOperations, FileDialog, FileFilter, GitCommit, GitOperations, OpenFileOptions, PickFolderOptions};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{Manager, State};

/// Ziel A.2 command 1: scans a project folder and returns its recognised object tree (currently
/// entity objects only, see `forge_app_core::tree`). Named `open_project` per this agent's
/// briefing even though it does not (yet) return a single opened document - `forge-core`'s own
/// `open_project` operates on one `.aod` file, so the per-file open happens lazily on the first
/// `get_property_tree` call for a given tree leaf (see `project_actor.rs`).
///
/// P8 step 2: returns the one project root node of the merged Projects tree; scanning a project
/// with its ~130 modules takes a few hundred ms, so it runs off the UI thread.
#[tauri::command]
async fn open_project(path: String, actor: State<'_, ProjectActorHandle>) -> Result<Vec<TreeNode>, String> {
    let actor = actor.inner().clone();
    tauri::async_runtime::spawn_blocking(move || actor.scan_tree(PathBuf::from(path))).await.map_err(|e| e.to_string())?
}

/// P8 step 2: children of a lazily loaded tree node (module file trees, `others`).
#[tauri::command]
async fn list_tree_children(node_id: String, actor: State<'_, ProjectActorHandle>) -> Result<Vec<TreeNode>, String> {
    let actor = actor.inner().clone();
    tauri::async_runtime::spawn_blocking(move || actor.tree_children(node_id)).await.map_err(|e| e.to_string())?
}

/// P8 step 2: the projects to reopen at start - only folders that still exist (R41).
#[tauri::command(async)]
fn restore_open_projects(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let file = settings_file(&app)?;
    let mut stored = settings::load_settings(&file);
    let restorable = settings::restorable_open_projects(&stored);
    if restorable != stored.open_projects {
        stored.open_projects = restorable.clone();
        write_settings(&file, &stored)?;
    }
    Ok(restorable)
}

/// File > Open Project adds, Close Project removes; returns the new list.
#[tauri::command(async)]
fn add_open_project(path: String, app: tauri::AppHandle) -> Result<Vec<String>, String> {
    update_open_projects(&app, |list| {
        settings::add_open_project(list, &path);
    })
}

#[tauri::command(async)]
fn remove_open_project(path: String, app: tauri::AppHandle) -> Result<Vec<String>, String> {
    update_open_projects(&app, |list| settings::remove_open_project(list, &path))
}

fn update_open_projects(app: &tauri::AppHandle, change: impl FnOnce(&mut Vec<String>)) -> Result<Vec<String>, String> {
    let file = settings_file(app)?;
    let mut stored = settings::load_settings(&file);
    change(&mut stored.open_projects);
    write_settings(&file, &stored)?;
    Ok(stored.open_projects)
}

fn write_settings(file: &std::path::Path, settings: &ForgeSettings) -> Result<(), String> {
    let bytes = settings::serialize_settings(settings)?;
    platform::fs::atomic_write(file, &bytes).map_err(|e| e.to_string())
}

/// Ziel A.2 command 2: the full current value tree for one object (`node_id` = the leaf id a
/// prior `open_project` tree returned). Opens the file on first access via `forge_core::open_project`.
#[tauri::command(async)]
fn get_property_tree(node_id: String, actor: State<ProjectActorHandle>) -> Result<WireValue, String> {
    actor.get_property_tree(node_id)
}

/// Ziel A.2 command 3: edits one scalar field through `forge_core::ProjectHandle::set_property`
/// and records the edit for `undo`/`redo`. `path` uses the dotted/indexed notation
/// `NodePath::Display` produces (see `forge_app_core::wire`).
#[tauri::command(async)]
fn set_property(
    node_id: String,
    path: String,
    value: WireValue,
    actor: State<ProjectActorHandle>,
) -> Result<WireValue, String> {
    actor.set_property(node_id, path, value)
}

/// P8 step 3: the Properties panel of one object or one element inside it (`path`, `$` = the
/// object). The property catalog is read from the configured (or detected) Designer
/// installation on first use, which takes about a second, hence off the UI thread.
#[tauri::command]
async fn get_property_sheet(node_id: String, path: String, app: tauri::AppHandle) -> Result<PropertySheet, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let catalog = current_catalog(&app);
        app.state::<ProjectActorHandle>().property_sheet(node_id, path, catalog)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn current_catalog(app: &tauri::AppHandle) -> Option<std::sync::Arc<forge_app_core::catalog::Catalog>> {
    let configured = settings_file(app).ok().and_then(|f| settings::load_settings(&f).designer_install_dir);
    let install_dir = configured.filter(|d| !d.trim().is_empty()).or_else(settings::detect_designer_install);
    let cache_dir = app.path().app_data_dir().ok();
    app.state::<CatalogCache>().get(install_dir, cache_dir.as_deref())
}

/// P8 step 5: the Navigator outline of one object.
#[tauri::command(async)]
fn get_navigator(node_id: String, actor: State<ProjectActorHandle>) -> Result<Vec<NavNode>, String> {
    actor.navigator(node_id)
}

/// P8 step 3: writes one property from the Properties panel, including properties not yet in the
/// file and typed `v="..."` attributes; returns the new tree and undo/redo availability.
#[tauri::command(async)]
fn set_sheet_property(
    node_id: String,
    path: String,
    name: String,
    value: WireValue,
    typed: bool,
    actor: State<ProjectActorHandle>,
) -> Result<UndoRedoOutcome, String> {
    actor.set_sheet_property(node_id, path, name, value, typed)
}

/// Find Usages / Safely Delete: where the project's own objects point to one object (read-only).
#[tauri::command]
async fn find_usages(project_root: String, object_type: String, name: String) -> Result<Vec<forge_app_core::problems::UsageDto>, String> {
    tauri::async_runtime::spawn_blocking(move || forge_app_core::problems::find_usages(&PathBuf::from(project_root), &object_type, &name))
        .await
        .map_err(|e| e.to_string())
}

/// Update access token of the private release repository; it is baked in at build time from the
/// CI secret and is never part of the source tree.
const UPDATE_TOKEN: Option<&str> = option_env!("VENDIRA_UPDATE_TOKEN");

#[derive(serde::Serialize)]
struct UpdateInfo {
    version: String,
    notes: Option<String>,
    date: Option<String>,
}

fn private_repo_updater(app: &tauri::AppHandle) -> Result<tauri_plugin_updater::Updater, String> {
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
async fn check_for_update(app: tauri::AppHandle) -> Result<Option<UpdateInfo>, String> {
    let update = private_repo_updater(&app)?.check().await.map_err(|e| e.to_string())?;
    Ok(update.map(|u| UpdateInfo { version: u.version.clone(), notes: u.body.clone(), date: u.date.map(|d| d.to_string()) }))
}

/// Downloads and installs the newer version after the user confirmed, then restarts the app.
#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    let update = private_repo_updater(&app)?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No newer version is available.".to_string())?;
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    app.restart()
}

/// Help > Local Data and the Janitor list: Dito Designer's own data folder plus, read-only, the version
/// folders of the original Designer. Nothing is changed or deleted.
#[tauri::command]
async fn local_data_info(threshold_days: u32, app: tauri::AppHandle) -> Result<forge_app_core::local_data::LocalDataInfo, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let settings = settings_file(&app)?;
    let version = app.package_info().version.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        forge_app_core::local_data::inspect(&version, &data_dir, &settings, u64::from(threshold_days), settings::detect_designer_install())
    })
    .await
    .map_err(|e| e.to_string())
}

/// Problems tab / error badges: read-only scan of every object of the project (parse errors with
/// line, validator findings, dangling references).
#[tauri::command]
async fn scan_problems(project_root: String) -> Result<Vec<forge_app_core::problems::ProblemDto>, String> {
    tauri::async_runtime::spawn_blocking(move || forge_app_core::problems::scan_project(&PathBuf::from(project_root)))
        .await
        .map_err(|e| e.to_string())
}

/// Clearing a value in the Properties panel removes the property from the file again.
#[tauri::command(async)]
fn remove_sheet_property(node_id: String, path: String, name: String, actor: State<ProjectActorHandle>) -> Result<UndoRedoOutcome, String> {
    actor.remove_sheet_property(node_id, path, name)
}

/// Set to Default of one property (module objects: deletes the project's modification instead).
#[tauri::command(async)]
fn reset_sheet_property(node_id: String, path: String, name: String, actor: State<ProjectActorHandle>) -> Result<forge_app_core::project_actor::ResetOutcome, String> {
    actor.reset_property(node_id, path, name)
}

/// Set to Default of one element, e.g. a field mapping shown in the Navigator.
#[tauri::command(async)]
fn reset_sheet_element(node_id: String, path: String, actor: State<ProjectActorHandle>) -> Result<forge_app_core::project_actor::ResetOutcome, String> {
    actor.reset_element(node_id, path)
}

/// Activates a grey Navigator entry: its definition is created without a property value.
#[tauri::command(async)]
fn activate_mapping(node_id: String, path: String, actor: State<ProjectActorHandle>) -> Result<forge_app_core::project_actor::ActivateOutcome, String> {
    actor.activate_mapping(node_id, path)
}

/// "Create Modification": edits of this module object are from now on written as modifications.
#[tauri::command(async)]
fn enable_modification(node_id: String, project_root: String, actor: State<ProjectActorHandle>) -> Result<(), String> {
    actor.enable_modification(node_id, PathBuf::from(project_root))
}

/// One property edit of a module object, written as MODIFY of the project (never a copy of the object).
#[tauri::command(async)]
fn set_modification_property(
    node_id: String,
    path: String,
    name: String,
    value: WireValue,
    typed: bool,
    kind: String,
    actor: State<ProjectActorHandle>,
) -> Result<forge_app_core::modification_write::Outcome, String> {
    actor.set_modification_property(node_id, path, name, value, typed, kind)
}

/// Script edit of a module object: the script is stored in the modification folder.
#[tauri::command(async)]
fn set_modification_script(
    node_id: String,
    path: String,
    name: String,
    content: String,
    actor: State<ProjectActorHandle>,
) -> Result<forge_app_core::modification_write::Outcome, String> {
    actor.set_modification_script(node_id, path, name, content)
}

/// Deletes a modification that became redundant; the UI asks the user first.
#[tauri::command(async)]
fn discard_modification(project_root: String, dir: String, actor: State<ProjectActorHandle>) -> Result<(), String> {
    actor.discard_modification(PathBuf::from(project_root), dir)
}

/// Ziel A.6: runs the plugin registry's validators (built-ins plus this app's entity validators)
/// against the currently open object.
#[tauri::command(async)]
fn list_diagnostics(node_id: String, actor: State<ProjectActorHandle>) -> Result<Vec<DiagnosticDto>, String> {
    actor.list_diagnostics(node_id)
}

/// Ziel A.2 command 4: generic action dispatch by id (architecture.md §2 `Action` extension
/// point). See `forge_app_core::actions` doc for why this honestly reports "not registered" this
/// round.
///
/// Runs off the UI thread: a transpile takes minutes and must not freeze the window. Forge's
/// own data folder is passed along so the official transpiler gets Forge's private profile
/// there instead of any developer folder (RISKS.md R43).
#[tauri::command]
async fn execute_action(
    action_id: String,
    target_path: String,
    mut params: HashMap<String, String>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    if !params.contains_key("forge_data_dir") {
        if let Ok(dir) = app.path().app_data_dir() {
            params.insert("forge_data_dir".to_string(), dir.to_string_lossy().into_owned());
        }
    }
    tauri::async_runtime::spawn_blocking(move || dispatch_action(&action_id, target_path, params))
        .await
        .map_err(|e| e.to_string())?
}

/// Ziel A.5: undo/redo keyboard commands. Scoped to `node_id` (the currently active editor tab)
/// rather than global - see `forge_app_core::history` module doc for the documented `forge-core`
/// API gap this design works around.
#[tauri::command(async)]
fn undo(node_id: String, actor: State<ProjectActorHandle>) -> Result<UndoRedoOutcome, String> {
    actor.undo(node_id)
}

#[tauri::command(async)]
fn redo(node_id: String, actor: State<ProjectActorHandle>) -> Result<UndoRedoOutcome, String> {
    actor.redo(node_id)
}

/// Ziel A.2 command 5: persistence, via `forge_core::ProjectHandle::save` -
/// `aod_io::serialize` -> `platform::fs::atomic_write` (architecture.md §4).
#[tauri::command(async)]
fn save(node_id: String, actor: State<ProjectActorHandle>) -> Result<(), String> {
    actor.save(node_id)
}

/// Save although the file changed on disk meanwhile (the user confirmed; the disk version is backed up first).
#[tauri::command(async)]
fn save_overwrite(node_id: String, actor: State<ProjectActorHandle>) -> Result<(), String> {
    actor.save_overwrite(node_id)
}

/// Drops the in-memory copy of an object so the next read comes from disk (external change accepted).
#[tauri::command(async)]
fn reload_object(node_id: String, actor: State<ProjectActorHandle>) -> Result<(), String> {
    actor.reload(node_id)
}

/// Which of the given open objects changed on disk since they were read or saved.
#[tauri::command(async)]
fn external_changes(node_ids: Vec<String>, actor: State<ProjectActorHandle>) -> Result<Vec<String>, String> {
    actor.external_changes(node_ids)
}

/// Last seen file fingerprint per project, for `project_changed`.
#[derive(Default)]
struct ProjectFingerprints(std::sync::Mutex<HashMap<String, u64>>);

/// True when files of the project were added, removed or edited since the previous call for the
/// same project (the first call only records the state).
#[tauri::command]
async fn project_changed(project_root: String, seen: State<'_, ProjectFingerprints>) -> Result<bool, String> {
    let root = PathBuf::from(&project_root);
    let now = tauri::async_runtime::spawn_blocking(move || forge_app_core::watch::project_fingerprint(&root)).await.map_err(|e| e.to_string())?;
    let mut map = seen.0.lock().map_err(|_| "fingerprint state poisoned".to_string())?;
    Ok(map.insert(project_root, now).map(|before| before != now).unwrap_or(false))
}

/// Opens a folder of the app (logs, backups) in the file manager.
fn open_in_file_manager(dir: &std::path::Path) -> Result<(), String> {
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
fn open_local_url(url: String) -> Result<(), String> {
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
}

#[tauri::command(async)]
fn open_log_folder() -> Result<String, String> {
    let dir = forge_app_core::crashlog::log_dir();
    open_in_file_manager(&dir)?;
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command(async)]
fn open_backup_folder() -> Result<String, String> {
    let dir = forge_app_core::backup::backup_dir();
    open_in_file_manager(&dir)?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Writes an error that happened in the frontend (render crash, unhandled promise) to the log file.
#[tauri::command(async)]
fn log_client_error(message: String) -> Option<String> {
    forge_app_core::crashlog::write_entry("UI-ERROR", &message).map(|p| p.to_string_lossy().into_owned())
}

/// Takes over a tunnel or server config chosen in the file dialog: copies it into the project
/// (`others/cloud`) and returns the path to store in the system.
#[tauri::command]
fn import_config_file(project_root: String, source: String) -> Result<String, String> {
    forge_app_core::system_config::import_config_file(&PathBuf::from(project_root), &PathBuf::from(source))
}

/// Reads a colour theme file (.json) chosen in the Options window.
#[tauri::command]
async fn read_theme_file(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || forge_app_core::file_list::read_theme_file(&PathBuf::from(path))).await.map_err(|e| e.to_string())?
}

/// Quick file search (double Ctrl): the file names of a project.
#[tauri::command]
async fn list_project_files(project_root: String) -> Vec<String> {
    tauri::async_runtime::spawn_blocking(move || forge_app_core::file_list::list_project_files(&PathBuf::from(project_root))).await.unwrap_or_default()
}

/// Ctrl+click on an import: the file the module name points to, or nothing.
#[tauri::command]
fn resolve_import(project_root: String, spec: String, from_file: String) -> Option<String> {
    forge_app_core::import_resolve::resolve_import(&PathBuf::from(project_root), &spec, &from_file)
}

/// Ziel B.3: read a `%aditoprj%`-relative linked file (e.g. an `entityField.valueProcess`
/// target) for the JDito/Monaco code field.
#[tauri::command(async)]
fn read_linked_file(project_root: String, reference: String) -> Result<String, String> {
    linked_file::read_linked_file(&PathBuf::from(project_root), &reference)
}

/// System editor: alias configs of the system's server config; secrets are never returned.
#[tauri::command(async)]
fn read_alias_configs(project_root: String, reference: String) -> Result<Vec<forge_app_core::system_config::AliasConfigDto>, String> {
    forge_app_core::system_config::read_alias_configs(&PathBuf::from(project_root), &reference)
}

/// Tunnel config editor: the tunnel list of the system's tunnel config.
#[tauri::command(async)]
fn read_tunnel_config(project_root: String, reference: String) -> Result<Vec<forge_app_core::system_config::TunnelRowDto>, String> {
    forge_app_core::system_config::read_tunnel_rows(&PathBuf::from(project_root), &reference)
}

/// Tunnel config editor: adds one tunnel to the tunnel config file (only that entry changes).
#[tauri::command(async)]
fn add_tunnel_row(project_root: String, reference: String, row: forge_app_core::system_config::TunnelRowDto) -> Result<Vec<forge_app_core::system_config::TunnelRowDto>, String> {
    forge_app_core::system_config::add_tunnel_row(&PathBuf::from(project_root), &reference, &row)
}

/// Tunnel config editor: removes the tunnel at `index` of the list from the tunnel config file.
#[tauri::command(async)]
fn delete_tunnel_row(project_root: String, reference: String, index: usize) -> Result<Vec<forge_app_core::system_config::TunnelRowDto>, String> {
    forge_app_core::system_config::delete_tunnel_row(&PathBuf::from(project_root), &reference, index)
}

#[tauri::command(async)]
fn write_linked_file(project_root: String, reference: String, content: String) -> Result<(), String> {
    linked_file::write_linked_file(&PathBuf::from(project_root), &reference, &content)
}

/// P7 (project-open-dialog) command 1: shows the real native Windows folder picker via
/// `platform::FileDialog` (the trait P3 already built and trait-shape-tested but never wired to
/// a Tauri command - see `p3-platform-notes.md`). Returns `None` on cancel, which the frontend
/// treats as "nothing changed", not an error.
#[tauri::command]
fn pick_project_folder(title: Option<String>) -> Option<String> {
    let title = title.filter(|t| !t.trim().is_empty()).unwrap_or_else(|| "Open Forge project".to_string());
    platform_file_dialog()
        .pick_folder(PickFolderOptions { title: Some(title), starting_dir: None })
        .map(|path| path.to_string_lossy().into_owned())
}

fn platform_file_dialog() -> platform::native::RfdFileDialog {
    platform::native::RfdFileDialog::new()
}

/// Where the "recently opened project" hint (Ziel 3, nice-to-have) is persisted: one small JSON
/// file in the OS-appropriate per-user app data directory, written through
/// `platform::fs::atomic_write` for the same crash-safety guarantee the real project save path
/// gets (architecture.md §4) - not a bespoke `std::fs::write`.
fn recent_project_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("recent-project.json"))
}

/// P7 command 2: the last successfully opened project path, if any - purely informational, the
/// frontend only ever offers it as a "Recent: <path>" button, it is never auto-loaded (that
/// auto-load behaviour was the disproven root-cause hypothesis from the P7 bugfix round, see
/// `p7-bugfix-empty-project-root-notes.md`).
#[tauri::command(async)]
fn get_recent_project(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let file = recent_project_file(&app)?;
    if !file.exists() {
        return Ok(None);
    }
    let bytes = std::fs::read(&file).map_err(|e| e.to_string())?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    Ok(value.get("path").and_then(|v| v.as_str()).map(|s| s.to_string()))
}

/// P7 command 3: records the just-opened project path as the new "recently opened" suggestion.
#[tauri::command(async)]
fn set_recent_project(path: String, app: tauri::AppHandle) -> Result<(), String> {
    let file = recent_project_file(&app)?;
    let bytes = serde_json::to_vec_pretty(&serde_json::json!({ "path": path })).map_err(|e| e.to_string())?;
    platform::fs::atomic_write(&file, &bytes).map_err(|e| e.to_string())
}

fn settings_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(settings::SETTINGS_FILE_NAME))
}

/// P8 Tools > Options: Forge's own user settings (see `forge_app_core::settings`).
#[tauri::command(async)]
fn get_settings(app: tauri::AppHandle) -> Result<ForgeSettings, String> {
    Ok(settings::load_settings(&settings_file(&app)?))
}

#[tauri::command(async)]
fn set_settings(mut settings: ForgeSettings, app: tauri::AppHandle) -> Result<(), String> {
    // The open-project list is owned by add/remove_open_project; the Options dialog never
    // carries it, so it must not wipe it.
    let file = settings_file(&app)?;
    settings.open_projects = settings::load_settings(&file).open_projects;
    forge_app_core::tunnel_client::set_accept_new_host_keys(settings.ssh_accept_new_host_keys.unwrap_or(false));
    write_settings(&file, &settings)
}

/// P8 Tools > Options: the Designer installation automatic discovery would pick, shown next to
/// the user's own choice. Scans a few folders, so it runs off the UI thread.
#[tauri::command]
async fn detect_designer_install() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(settings::detect_designer_install).await.map_err(|e| e.to_string())
}

/// P8 status bar: the checked-out branch of the open project. `None` when the folder is no Git
/// repository or `git` is unavailable - the status bar then simply shows nothing.
#[tauri::command]
async fn get_current_branch(project_root: String) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        CommandGitOperations::new()
            .list_branches(&PathBuf::from(project_root))
            .ok()?
            .into_iter()
            .find(|b| b.is_current)
            .map(|b| b.name)
    })
    .await
    .ok()
    .flatten()
}

/// P8 step 4: raw `.aod` text of an object for the Source tab (includes unsaved edits).
#[tauri::command(async)]
fn get_object_source(node_id: String, actor: State<ProjectActorHandle>) -> Result<SourceDto, String> {
    actor.get_source(node_id)
}

/// P8 step 4: replaces the whole document with the Source tab's text; one undo step, saved by
/// the normal `save` command through the byte-exact `aod-io` path.
#[tauri::command(async)]
fn set_object_source(node_id: String, text: String, actor: State<ProjectActorHandle>) -> Result<UndoRedoOutcome, String> {
    actor.set_source(node_id, text)
}

/// Git history of one file for the History tab. `in_repo` is false outside a repository (or
/// without `git`), which the UI shows as a calm hint, not as an error.
#[derive(serde::Serialize)]
struct FileHistory {
    in_repo: bool,
    commits: Vec<GitCommit>,
}

const FILE_HISTORY_LIMIT: usize = 200;

/// Read-only: only `git log` is ever run here.
#[tauri::command]
async fn get_file_history(path: String) -> FileHistory {
    tauri::async_runtime::spawn_blocking(move || {
        let file = PathBuf::from(path);
        let Some(dir) = file.parent() else { return FileHistory { in_repo: false, commits: Vec::new() } };
        match CommandGitOperations::new().file_log(dir, &file, FILE_HISTORY_LIMIT) {
            Ok(commits) => FileHistory { in_repo: true, commits },
            Err(_) => FileHistory { in_repo: false, commits: Vec::new() },
        }
    })
    .await
    .unwrap_or(FileHistory { in_repo: false, commits: Vec::new() })
}

/// Services tab: native file picker for the two export files and the SSH key; `None` on cancel.
#[tauri::command]
fn pick_file(title: Option<String>, label: String, extensions: Vec<String>) -> Option<String> {
    platform_file_dialog()
        .open_file(OpenFileOptions {
            title,
            starting_dir: None,
            filters: if extensions.is_empty() { Vec::new() } else { vec![FileFilter { label, extensions }] },
        })
        .map(|path| path.to_string_lossy().into_owned())
}

/// Services tab: opens tunnel and system-DB connection from the two chosen export files. The
/// credentials are read here, kept in memory only and never returned to the UI.
#[tauri::command]
async fn db_connect(
    tunnel_config: String,
    server_config: String,
    key_file: Option<String>,
    tunnel_password: Option<String>,
    system: Option<String>,
    db: State<'_, std::sync::Arc<DbManager>>,
) -> Result<DbStatus, String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let key = key_file.filter(|k| !k.trim().is_empty()).map(PathBuf::from);
        let password = tunnel_password.filter(|p| !p.is_empty());
        let auth = match (&password, &key) {
            (Some(p), _) => forge_app_core::db_session::TunnelAuth::Basic { password: p },
            (None, k) => forge_app_core::db_session::TunnelAuth::Key(k.as_deref()),
        };
        db.connect_system(system.as_deref().unwrap_or(""), &PathBuf::from(tunnel_config), &PathBuf::from(server_config), &auth)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Users tab of the system editor (ASYS_USERS, credential columns removed in the backend).
#[tauri::command]
async fn system_users(db: State<'_, std::sync::Arc<DbManager>>) -> Result<forge_app_core::system_db::TableDump, String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || forge_app_core::system_db::read_users(&db)).await.map_err(|e| e.to_string())?
}

/// Properties of one user of the Users tab (secret properties without value).
#[tauri::command]
async fn system_user_properties(db: State<'_, std::sync::Arc<DbManager>>, user: String) -> Result<Vec<forge_app_core::system_db::UserProperty>, String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || forge_app_core::system_db::read_user_properties(&db, &user)).await.map_err(|e| e.to_string())?
}

/// Writes one user property into the system database. Refused unless the user confirmed in the UI.
#[tauri::command]
async fn system_user_set_property(db: State<'_, std::sync::Arc<DbManager>>, id: String, value: String, confirmed: bool) -> Result<(), String> {
    if !confirmed {
        return Err("Changing a user needs your confirmation.".into());
    }
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || forge_app_core::system_db::update_user_property(&db, &id, &value)).await.map_err(|e| e.to_string())?
}

/// Alias config list of the system editor (ASYS_ALIASCONFIG rows of the given server ids).
#[tauri::command]
async fn system_alias_list(db: State<'_, std::sync::Arc<DbManager>>, server_ids: Vec<String>) -> Result<Vec<forge_app_core::system_config::AliasConfigDto>, String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || forge_app_core::system_db::read_system_alias_list(&db, &server_ids)).await.map_err(|e| e.to_string())?
}

#[derive(serde::Serialize)]
struct SystemTunnelState {
    /// A forward to the database host of this system's alias is open.
    db_tunnel_up: bool,
    /// host:port the database tunnel points to (None: the tunnel config has no such entry).
    target: Option<String>,
    /// Why the state could not be determined (config files missing or unreadable).
    problem: Option<String>,
}

/// Is the tunnel to this system's database open? Looks up the tunnel entry that leads to the
/// database host of the system alias in the server config and asks the tunnel manager.
#[tauri::command(async)]
fn system_tunnel_state(project_root: String, tunnel_ref: String, server_ref: String, db: State<'_, std::sync::Arc<DbManager>>) -> SystemTunnelState {
    use forge_app_core::db_session::{find_db_tunnel, parse_system_alias, parse_tunnels};
    let root = PathBuf::from(project_root);
    let result = (|| -> Result<(bool, Option<String>), String> {
        let tunnel_path = forge_app_core::system_config::resolve_config_path(&root, &tunnel_ref)?;
        let server_path = forge_app_core::system_config::resolve_config_path(&root, &server_ref)?;
        let alias = parse_system_alias(&std::fs::read_to_string(&server_path).map_err(|e| e.to_string())?)?;
        let tunnels = parse_tunnels(&std::fs::read_to_string(&tunnel_path).map_err(|e| e.to_string())?)?;
        Ok(match find_db_tunnel(&tunnels, &alias) {
            Some(t) => (db.tunnels.local_port(&t.target_host, t.target_port).is_some(), Some(format!("{}:{}", t.target_host, t.target_port))),
            None => (false, None),
        })
    })();
    match result {
        Ok((up, target)) => SystemTunnelState { db_tunnel_up: up, target, problem: None },
        Err(e) => SystemTunnelState { db_tunnel_up: false, target: None, problem: Some(e) },
    }
}

/// Server ids a system name and its server config file point to.
#[tauri::command]
fn system_server_ids(config_reference: String, system_name: String) -> Vec<String> {
    forge_app_core::system_config::server_id_candidates(&config_reference, &system_name)
}

#[tauri::command]
async fn system_alias_configs(db: State<'_, std::sync::Arc<DbManager>>) -> Result<forge_app_core::system_db::AliasConfigTable, String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || forge_app_core::system_db::read_alias_configs(&db)).await.map_err(|e| e.to_string())?
}

/// Deploy dry run: reads only.
#[tauri::command]
async fn deploy_plan(
    project_root: String,
    force: bool,
    mapping: Option<forge_app_core::system_db::DeployMapping>,
    db: State<'_, std::sync::Arc<DbManager>>,
) -> Result<forge_app_core::system_db::DeployPlan, String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || forge_app_core::system_db::plan(&db, &PathBuf::from(project_root), force, mapping))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn deploy_show_changes(
    project_root: String,
    key: String,
    mapping: Option<forge_app_core::system_db::DeployMapping>,
    db: State<'_, std::sync::Arc<DbManager>>,
) -> Result<forge_app_core::system_db::ChangeView, String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || forge_app_core::system_db::show_changes(&db, &PathBuf::from(project_root), &key, mapping))
        .await
        .map_err(|e| e.to_string())?
}

/// Deploy overview: last deploy of the system and what changed in the project since. Reads only.
#[tauri::command]
async fn deploy_overview(project_root: String, db: State<'_, std::sync::Arc<DbManager>>) -> Result<forge_app_core::system_db::DeployOverview, String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || forge_app_core::system_db::deploy_overview(&db, &PathBuf::from(project_root)))
        .await
        .map_err(|e| e.to_string())?
}

/// The only write path of the deploy; `confirmed` is true only after the user clicked the
/// confirmation in the deploy dialog.
#[tauri::command]
async fn deploy_execute(
    project_root: String,
    keys: Vec<String>,
    force: bool,
    mapping: Option<forge_app_core::system_db::DeployMapping>,
    confirmed: bool,
    db: State<'_, std::sync::Arc<DbManager>>,
) -> Result<forge_app_core::system_db::DeployOutcome, String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || forge_app_core::system_db::execute(&db, &PathBuf::from(project_root), &keys, force, mapping, confirmed))
        .await
        .map_err(|e| e.to_string())?
}

/// Tunnel config editor: opens the forward of one row. Key file or password stay in memory only.
#[tauri::command]
async fn tunnel_connect(
    row: forge_app_core::tunnels::TunnelRequest,
    key_file: Option<String>,
    tunnel_password: Option<String>,
    db: State<'_, std::sync::Arc<DbManager>>,
) -> Result<forge_app_core::tunnels::ForwardStatus, String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let key = key_file.filter(|k| !k.trim().is_empty()).map(PathBuf::from);
        let password = tunnel_password.filter(|p| !p.is_empty());
        let auth = match (&password, &key) {
            (Some(p), _) => forge_app_core::db_session::TunnelAuth::Basic { password: p },
            (None, k) => forge_app_core::db_session::TunnelAuth::Key(k.as_deref()),
        };
        let entry: forge_app_core::db_session::TunnelEntry = row.into();
        let target = format!("{}:{}", entry.target_host, entry.target_port);
        let result = db.tunnels.connect(&entry, &auth);
        if let Err(e) = &result {
            let _ = forge_app_core::crashlog::write_entry("TUNNEL", &format!("forward to {target} failed: {e}"));
        }
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command(async)]
fn tunnel_disconnect(target_host: String, target_port: u16, db: State<'_, std::sync::Arc<DbManager>>) {
    db.tunnels.disconnect(&target_host, target_port);
}

#[tauri::command(async)]
fn tunnel_disconnect_all(db: State<'_, std::sync::Arc<DbManager>>) {
    db.tunnels.disconnect_all();
}

#[tauri::command(async)]
fn tunnel_list(db: State<'_, std::sync::Arc<DbManager>>) -> Vec<forge_app_core::tunnels::ForwardStatus> {
    db.tunnels.list()
}
#[tauri::command(async)]
fn db_disconnect(system: Option<String>, db: State<'_, std::sync::Arc<DbManager>>) {
    match system {
        Some(s) => db.disconnect_system(&s),
        None => db.disconnect(),
    }
}

#[tauri::command(async)]
fn db_status(system: Option<String>, db: State<'_, std::sync::Arc<DbManager>>) -> DbStatus {
    match system {
        Some(s) => db.status_for(&s),
        None => db.status(),
    }
}

#[derive(serde::Serialize)]
struct SystemDbStatus {
    system: String,
    status: DbStatus,
    active: bool,
}

/// Every system with an open database session; the active one answers queries and deploys.
#[tauri::command(async)]
fn db_systems(db: State<'_, std::sync::Arc<DbManager>>) -> Vec<SystemDbStatus> {
    let active = db.active_system();
    db.statuses().into_iter().map(|(system, status)| SystemDbStatus { active: active.as_deref() == Some(system.as_str()), system, status }).collect()
}

/// Makes the session of one system the active one (false: that system has no session).
/// Database browser: read-only session to another database alias of a system. The connection data
/// come from the system database of `system` at this moment and stay in memory.
#[tauri::command]
async fn db_connect_alias(system: String, alias: String, tunnel_config: String, server_ids: Vec<String>, db: State<'_, std::sync::Arc<DbManager>>) -> Result<DbStatus, String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        if !db.activate(&system) {
            return Err("Open the database session of the system first.".to_string());
        }
        let conn = forge_app_core::system_db::read_alias_db(&db, &alias, &server_ids)?;
        db.connect_alias(&format!("{system}|alias:{alias}"), &PathBuf::from(tunnel_config), &conn)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(serde::Serialize)]
struct LiquibaseTarget {
    system: String,
    host: String,
    database: String,
}

/// System key to work on: the given one or the active session, without the `|alias:` suffix of an
/// alias browser session.
fn liquibase_system(system: Option<String>, db: &DbManager) -> Result<String, String> {
    let key = system.or_else(|| db.active_system()).unwrap_or_default();
    let key = key.split("|alias:").next().unwrap_or("").to_string();
    if key.is_empty() || !db.activate(&key) {
        return Err("Connect a system first (Services > Connect); Liquibase needs the open session of a system.".to_string());
    }
    Ok(key)
}

/// Where a Liquibase update of this alias would go; shown in the confirmation before anything runs.
#[tauri::command]
async fn liquibase_target(system: Option<String>, alias: String, db: State<'_, std::sync::Arc<DbManager>>) -> Result<LiquibaseTarget, String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let system = liquibase_system(system, &db)?;
        let conn = forge_app_core::system_db::read_alias_db(&db, &alias, &[])?;
        Ok(LiquibaseTarget { system, host: conn.host, database: conn.database })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Liquibase > Update of a database alias: runs the changelogs of `.liquibase/<alias>` against the
/// alias database of the system. Only called after the user confirmed the target.
#[tauri::command]
async fn liquibase_update(app: tauri::AppHandle, system: Option<String>, alias: String, project_root: String, db: State<'_, std::sync::Arc<DbManager>>) -> Result<String, String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Emitter;
        let system = liquibase_system(system, &db)?;
        let dir = forge_app_core::liquibase::changelog_dir(&PathBuf::from(&project_root), &alias)?;
        let conn = forge_app_core::system_db::read_alias_db(&db, &alias, &[])?;
        let port = db.forward_port_for(&conn.host, conn.port).ok_or_else(|| format!("Open the tunnel to {}:{} first (Services).", conn.host, conn.port))?;
        let configured = settings_file(&app).ok().and_then(|f| settings::load_settings(&f).designer_install_dir);
        let install = configured.filter(|d| !d.trim().is_empty()).or_else(settings::detect_designer_install).ok_or("The Designer installation was not found. Choose it in Tools > Options.")?;
        let appdata = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_default();
        let install = PathBuf::from(install);
        let toolchain = forge_app_core::liquibase::discover_toolchain(&install, &forge_app_core::liquibase::designer_userdirs(&install, &appdata))?;
        let target = forge_app_core::liquibase::JdbcTarget { url: forge_app_core::liquibase::jdbc_url(port, &conn.database), user: conn.user.clone(), password: conn.password.clone() };
        let emit = |error: bool, line: &str| {
            let _ = app.emit("forge://build-output", serde_json::json!({ "line": line, "error": error }));
        };
        emit(false, &format!("Liquibase update of {alias} on system {system} (database {})", conn.database));
        forge_app_core::liquibase::run_update(&toolchain, &dir, &target, &emit)?;
        emit(false, "Liquibase update finished.");
        Ok("Liquibase update finished.".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command(async)]
fn db_cancel_connect(db: State<'_, std::sync::Arc<DbManager>>) {
    db.cancel_connect();
}

#[tauri::command(async)]
fn db_activate(system: String, db: State<'_, std::sync::Arc<DbManager>>) -> bool {
    db.activate(&system)
}

/// `allow_write` is only true after the user switched writing on and confirmed the statement.
#[tauri::command]
async fn db_query(sql: String, allow_write: bool, db: State<'_, std::sync::Arc<DbManager>>) -> Result<SqlResult, String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || db.query(&sql, allow_write)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn db_schema(db: State<'_, std::sync::Arc<DbManager>>) -> Result<Vec<SchemaTable>, String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || db.schema()).await.map_err(|e| e.to_string())?
}

/// Tree context menu: copies an object under a new name into dest_root (a project root);
/// returns the new object file. Refuses anything but the standard object layout.
#[tauri::command(async)]
fn copy_object(source: String, dest_root: String, new_name: String) -> Result<String, String> {
    tree_ops::copy_object(&PathBuf::from(source), &PathBuf::from(dest_root), &new_name).map(|p| p.to_string_lossy().into_owned())
}

/// Tree context menu: deletes the folder of one object; the UI calls this only after the user
/// confirmed the object by name.
#[tauri::command(async)]
fn delete_object(source: String) -> Result<(), String> {
    tree_ops::delete_object(&PathBuf::from(source))
}

/// Properties of a file in the Projects tree: name, extension, size, modification time, path.
#[tauri::command(async)]
fn file_info(path: String) -> Result<forge_app_core::file_ops::FileInfo, String> {
    forge_app_core::file_ops::file_info(&PathBuf::from(path))
}

/// Copy / cut and paste of a file into a folder of the project; the new path.
#[tauri::command(async)]
fn file_paste(project_root: String, source: String, dest_dir: String, cut: bool) -> Result<String, String> {
    let (root, src, dest) = (PathBuf::from(project_root), PathBuf::from(source), PathBuf::from(dest_dir));
    let target = if cut { forge_app_core::file_ops::move_file(&root, &src, &dest) } else { forge_app_core::file_ops::copy_file(&root, &src, &dest) }?;
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command(async)]
fn file_rename(project_root: String, path: String, new_name: String) -> Result<String, String> {
    forge_app_core::file_ops::rename_file(&PathBuf::from(project_root), &PathBuf::from(path), &new_name).map(|p| p.to_string_lossy().into_owned())
}

/// Deletes a file after the user confirmed; a copy goes to the backup folder first.
#[tauri::command(async)]
fn file_delete(project_root: String, path: String) -> Result<(), String> {
    forge_app_core::file_ops::delete_file(&PathBuf::from(project_root), &PathBuf::from(path))
}

/// "Open in System": opens the file with the program the operating system registered for it.
#[tauri::command(async)]
fn open_in_system(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !path.exists() {
        return Err(format!("{} does not exist.", path.display()));
    }
    use platform::shell::ShellIntegration;
    platform::native::NativeShellIntegration::new().open_with_default_app(&path).map_err(|e| e.to_string())
}

/// NodeJS menu: runs one npm command in the project folder; each output line is sent as the event
/// `forge://npm-output` while it is produced. `confirmed` must be true for login and publish.
#[tauri::command]
async fn npm_run(project_root: String, action: String, confirmed: bool, app: tauri::AppHandle) -> Result<i32, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Emitter;
        let sink = app.clone();
        let name = action.clone();
        forge_app_core::file_ops::run_npm(&PathBuf::from(project_root), &action, confirmed, &move |is_error, line| {
            let _ = sink.emit("forge://npm-output", serde_json::json!({ "action": name, "line": line, "error": is_error }));
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Ends the running official transpiler (the UI asks first). False when no build is running.
#[tauri::command(async)]
fn cancel_build() -> bool {
    forge_app_core::transpile_action::cancel_build()
}

/// File > New: the object types of the "New" dialog, creatable ones first marked as enabled.
#[tauri::command(async)]
fn new_object_kinds() -> Vec<forge_app_core::new_object::NewObjectKind> {
    forge_app_core::new_object::kinds()
}

/// File > New: checks the name against the project (read-only). `None` means the name is free.
#[tauri::command(async)]
fn validate_new_name(project_root: String, folder: String, name: String) -> Option<String> {
    forge_app_core::new_object::validate_name(&PathBuf::from(project_root), &folder, &name).err()
}

/// File > New: creates one object after the user confirmed the dialog; returns its model file.
#[tauri::command(async)]
fn create_object(project_root: String, folder: String, name: String, title: Option<String>, reference: Option<String>) -> Result<String, String> {
    forge_app_core::new_object::create_object(&PathBuf::from(project_root), &folder, &name, title.as_deref(), reference.as_deref()).map(|p| p.to_string_lossy().into_owned())
}

/// Rename preview: every reference that would change and every mention that would not (read-only).
#[tauri::command]
async fn rename_plan(project_root: String, source: String, new_name: String) -> Result<forge_app_core::rename::RenamePlan, String> {
    tauri::async_runtime::spawn_blocking(move || forge_app_core::rename::plan(&PathBuf::from(project_root), &PathBuf::from(source), &new_name))
        .await
        .map_err(|e| e.to_string())?
}

/// Rename: runs only after the user confirmed the preview ("Do Refactoring"); returns the new model file.
#[tauri::command]
async fn rename_object(project_root: String, source: String, new_name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || forge_app_core::rename::apply(&PathBuf::from(project_root), &PathBuf::from(source), &new_name).map(|p| p.to_string_lossy().into_owned()))
        .await
        .map_err(|e| e.to_string())?
}

/// Export/Import Project: the data models of the project (read-only).
#[tauri::command(async)]
fn list_project_models(project_root: String) -> Vec<forge_app_core::project_zip::ModelEntry> {
    forge_app_core::project_zip::list_models(&PathBuf::from(project_root))
}

/// Export Project: writes the chosen models into a new zip file; returns the number of files.
#[tauri::command]
async fn export_project_zip(project_root: String, models: Vec<(String, String)>, target: String) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || forge_app_core::project_zip::export_zip(&PathBuf::from(project_root), &models, &PathBuf::from(target)))
        .await
        .map_err(|e| e.to_string())?
}

/// Import Project: the models inside a zip file and which of them exist already (read-only).
#[tauri::command]
async fn inspect_project_zip(project_root: String, zip_path: String) -> Result<Vec<forge_app_core::project_zip::ModelEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || forge_app_core::project_zip::inspect_zip(&PathBuf::from(project_root), &PathBuf::from(zip_path)))
        .await
        .map_err(|e| e.to_string())?
}

/// Import Project: unpacks the chosen models; existing ones only when listed in `overwrite`.
#[tauri::command]
async fn import_project_zip(project_root: String, zip_path: String, selected: Vec<(String, String)>, overwrite: Vec<(String, String)>) -> Result<forge_app_core::project_zip::ImportOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || forge_app_core::project_zip::import_zip(&PathBuf::from(project_root), &PathBuf::from(zip_path), &selected, &overwrite))
        .await
        .map_err(|e| e.to_string())?
}

/// Native "save as" dialog for the export file; `None` on cancel.
#[tauri::command]
fn pick_save_file(title: Option<String>, default_name: String, label: String, extensions: Vec<String>) -> Option<String> {
    platform_file_dialog()
        .save_file(platform::SaveFileOptions {
            title,
            starting_dir: None,
            default_file_name: Some(default_name),
            filters: vec![FileFilter { label, extensions }],
        })
        .map(|path| path.to_string_lossy().into_owned())
}

/// Code editor: the JDito type definitions of the project's node_modules (read-only).
#[tauri::command]
async fn read_jdito_types(project_root: String) -> Option<forge_app_core::jdito_types::JditoTypes> {
    tauri::async_runtime::spawn_blocking(move || forge_app_core::jdito_types::read(&PathBuf::from(project_root))).await.ok().flatten()
}

/// Team menu: status, branches and history of the project's repository (read-only).
#[tauri::command]
async fn git_overview(project_root: String) -> Result<GitOverview, String> {
    tauri::async_runtime::spawn_blocking(move || git_actions::overview(&PathBuf::from(project_root))).await.map_err(|e| e.to_string())?
}

/// The next four run only from an explicit confirming click in the Team dialog.
#[tauri::command]
async fn git_commit(project_root: String, message: String, paths: Vec<String>) -> Result<GitOutput, String> {
    tauri::async_runtime::spawn_blocking(move || git_actions::commit(&PathBuf::from(project_root), &message, &paths))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn git_unpushed(project_root: String) -> Result<Vec<GitCommit>, String> {
    tauri::async_runtime::spawn_blocking(move || git_actions::unpushed(&PathBuf::from(project_root))).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn git_incoming(project_root: String) -> Result<Vec<GitCommit>, String> {
    tauri::async_runtime::spawn_blocking(move || git_actions::incoming(&PathBuf::from(project_root))).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn git_push_to(project_root: String, hash: String) -> Result<GitOutput, String> {
    tauri::async_runtime::spawn_blocking(move || git_actions::push_up_to(&PathBuf::from(project_root), &hash)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn git_pull(project_root: String) -> Result<GitOutput, String> {
    tauri::async_runtime::spawn_blocking(move || git_actions::pull(&PathBuf::from(project_root))).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn git_push(project_root: String) -> Result<GitOutput, String> {
    tauri::async_runtime::spawn_blocking(move || git_actions::push(&PathBuf::from(project_root))).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn git_checkout(project_root: String, branch: String) -> Result<GitOutput, String> {
    tauri::async_runtime::spawn_blocking(move || git_actions::checkout(&PathBuf::from(project_root), &branch))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn git_create_branch(project_root: String, name: String, start: Option<String>) -> Result<GitOutput, String> {
    tauri::async_runtime::spawn_blocking(move || git_actions::create_branch(&PathBuf::from(project_root), &name, start.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}


/// Source Control panel. Reads run on their own; every writing command below runs only from one
/// click in the panel.
#[tauri::command]
async fn scm_status(project_root: String) -> Result<ScmOverview, String> {
    tauri::async_runtime::spawn_blocking(move || git_scm::status(&PathBuf::from(project_root))).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn scm_stage(project_root: String, paths: Vec<String>) -> Result<GitOutput, String> {
    tauri::async_runtime::spawn_blocking(move || git_scm::stage(&PathBuf::from(project_root), &paths)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn scm_stage_all(project_root: String) -> Result<GitOutput, String> {
    tauri::async_runtime::spawn_blocking(move || git_scm::stage_all(&PathBuf::from(project_root))).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn scm_unstage(project_root: String, paths: Vec<String>) -> Result<GitOutput, String> {
    tauri::async_runtime::spawn_blocking(move || git_scm::unstage(&PathBuf::from(project_root), &paths)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn scm_discard(project_root: String, paths: Vec<String>) -> Result<GitOutput, String> {
    tauri::async_runtime::spawn_blocking(move || git_scm::discard(&PathBuf::from(project_root), &paths)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn scm_commit(project_root: String, message: String) -> Result<GitOutput, String> {
    tauri::async_runtime::spawn_blocking(move || git_scm::commit_staged(&PathBuf::from(project_root), &message)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn scm_sync(project_root: String) -> Result<GitOutput, String> {
    tauri::async_runtime::spawn_blocking(move || git_scm::sync(&PathBuf::from(project_root))).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn scm_history(project_root: String, limit: usize) -> Result<Vec<platform::GitCommit>, String> {
    tauri::async_runtime::spawn_blocking(move || git_scm::history(&PathBuf::from(project_root), limit.clamp(1, 500))).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn scm_commit_files(project_root: String, hash: String) -> Result<Vec<CommitFile>, String> {
    tauri::async_runtime::spawn_blocking(move || git_scm::commit_files(&PathBuf::from(project_root), &hash)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn scm_diff(project_root: String, path: String, side: String, hash: Option<String>) -> Result<DiffContent, String> {
    let side = match (side.as_str(), hash) {
        ("unstaged", _) => DiffSide::Unstaged,
        ("staged", _) => DiffSide::Staged,
        ("commit", Some(h)) => DiffSide::Commit(h),
        _ => return Err("Unknown diff side.".into()),
    };
    tauri::async_runtime::spawn_blocking(move || git_scm::diff_sides(&PathBuf::from(project_root), &path, &side)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn scm_gutter(project_root: String, file: String) -> Result<Gutter, String> {
    tauri::async_runtime::spawn_blocking(move || git_scm::gutter(&PathBuf::from(project_root), &PathBuf::from(file))).await.map_err(|e| e.to_string())?
}

/// The macOS menu bar: the app menu (About, Preferences, Hide, Quit) and an Edit menu. Without an
/// Edit menu the web view of a macOS app cannot copy and paste text at all. Undo and Redo are
/// left out on purpose: the native items would swallow Cmd+Z / Cmd+Shift+Z before the app's own
/// undo for the project could see the key. "Preferences" is forwarded to the window as the
/// event `forge://native-menu` (payload `preferences`), which opens Tools > Options.
/// Compiled on every platform so a Windows `cargo check` proves the API calls; only a Mac shows it.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn build_native_menu(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
    let preferences = MenuItemBuilder::with_id("preferences", "Preferences...").accelerator("CmdOrCtrl+,").build(app)?;
    let app_menu = SubmenuBuilder::new(app, "Dito Designer")
        .about(None)
        .separator()
        .item(&preferences)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;
    let edit_menu = SubmenuBuilder::new(app, "Edit").cut().copy().paste().select_all().build()?;
    let window_menu = SubmenuBuilder::new(app, "Window").minimize().maximize().separator().close_window().build()?;
    let menu = MenuBuilder::new(app).items(&[&app_menu, &edit_menu, &window_menu]).build()?;
    app.set_menu(menu)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(ProjectActorHandle::spawn())
        .manage(os_windows::WindowPayloads::default())
        .manage(os_windows::ModalWindows::default())
        .manage(os_windows::CloseGuards::default())
        .on_window_event(os_windows::on_window_event)
        .on_menu_event(|app, event| {
            use tauri::Emitter;
            let _ = app.emit("forge://native-menu", event.id().0.clone());
        })
        .manage(LspProcess::default())
        .manage(CatalogCache::default())
        .manage(std::sync::Arc::new(DbManager::default()))
        .manage(ProjectFingerprints::default())
        .setup(|app| {
            // Logs and backups live in the app data folder; the panic hook and the backup hook are
            // installed before anything else can fail. Panics reach the window as an event.
            if let Ok(settings_path) = settings_file(app.handle()) {
                forge_app_core::tunnel_client::set_accept_new_host_keys(settings::load_settings(&settings_path).ssh_accept_new_host_keys.unwrap_or(false));
            }
            #[cfg(target_os = "macos")]
            build_native_menu(app.handle())?;
            if let Ok(dir) = app.path().app_data_dir() {
                forge_app_core::crashlog::set_log_dir(dir.join("logs"));
                forge_app_core::crashlog::set_app_version(&app.package_info().version.to_string());
                forge_app_core::backup::set_backup_dir(dir.join("backups"));
            }
            forge_app_core::backup::install();
            let build_handle = app.handle().clone();
            forge_app_core::transpile_action::set_build_log_sink(std::sync::Arc::new(move |is_error, line| {
                use tauri::Emitter;
                let _ = build_handle.emit("forge://build-output", serde_json::json!({ "line": line, "error": is_error }));
            }));
            let progress_handle = app.handle().clone();
            app.state::<std::sync::Arc<DbManager>>().set_progress_sink(std::sync::Arc::new(move |system, phase, finished| {
                use tauri::Emitter;
                if finished && phase.starts_with("Failed") {
                    let _ = forge_app_core::crashlog::write_entry("TUNNEL", &format!("{system}: {phase}"));
                }
                let _ = progress_handle.emit("forge://tunnel-progress", serde_json::json!({ "system": system, "phase": phase, "finished": finished }));
            }));
            let handle = app.handle().clone();
            forge_app_core::crashlog::set_panic_notifier(move |message, file| {
                use tauri::Emitter;
                let _ = handle.emit("forge://panic", serde_json::json!({ "message": message, "log": file.to_string_lossy() }));
            });
            forge_app_core::crashlog::install_panic_hook();
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            check_for_update,
            install_update,
            open_project,
            list_tree_children,
            restore_open_projects,
            add_open_project,
            remove_open_project,
            get_property_tree,
            set_property,
            list_diagnostics,
            execute_action,
            undo,
            redo,
            save,
            save_overwrite,
            reload_object,
            external_changes,
            project_changed,
            open_log_folder,
            open_backup_folder,
            log_client_error,
            read_linked_file,
            resolve_import,
            list_project_files,
            read_theme_file,
            system_user_properties,
            system_user_set_property,
            import_config_file,
            open_local_url,
            write_linked_file,
            pick_project_folder,
            get_recent_project,
            set_recent_project,
            get_settings,
            set_settings,
            detect_designer_install,
            get_current_branch,
            get_property_sheet,
            get_navigator,
            set_sheet_property,
            remove_sheet_property,
            reset_sheet_property,
            reset_sheet_element,
            file_info,
            file_paste,
            file_rename,
            file_delete,
            open_in_system,
            cancel_build,
            system_tunnel_state,
            npm_run,
            activate_mapping,
            scan_problems,
            local_data_info,
            find_usages,
            enable_modification,
            set_modification_property,
            set_modification_script,
            discard_modification,
            get_object_source,
            set_object_source,
            get_file_history,
            pick_file,
            copy_object,
            delete_object,
            new_object_kinds,
            validate_new_name,
            create_object,
            rename_plan,
            rename_object,
            list_project_models,
            export_project_zip,
            inspect_project_zip,
            import_project_zip,
            pick_save_file,
            read_jdito_types,
            db_connect,
            read_alias_configs,
            read_tunnel_config,
            add_tunnel_row,
            delete_tunnel_row,
            db_disconnect,
        tunnel_connect,
        tunnel_disconnect,
        tunnel_disconnect_all,
        tunnel_list,
            system_users,
            system_alias_configs,
            system_alias_list,
            system_server_ids,
            deploy_overview,
            deploy_plan,
            deploy_show_changes,
            deploy_execute,
            db_status,
            db_systems,
            db_activate,
            db_cancel_connect,
            db_connect_alias,
            liquibase_target,
            liquibase_update,
            db_query,
            db_schema,
            git_overview,
            git_commit,
            git_unpushed,
            git_incoming,
            git_push_to,
            git_pull,
            git_push,
            git_checkout,
            git_create_branch,
            os_windows::window_open,
            os_windows::window_payload,
            os_windows::window_result,
            os_windows::window_close,
            os_windows::window_close_guard,
            os_windows::app_exit,
            os_windows::main_window_contains,
            scm_status,
            scm_stage,
            scm_stage_all,
            scm_unstage,
            scm_discard,
            scm_commit,
            scm_sync,
            scm_history,
            scm_commit_files,
            scm_diff,
            scm_gutter,
            lsp_bridge::start_lsp,
            lsp_bridge::send_lsp_message,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
