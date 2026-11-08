//! Objekt-Editor: Eigenschaften, Navigator, Modifikationen, Undo/Redo, Speichern, Quelltext.

use super::blocking;
use super::settings::settings_file;
use project::catalog::sheet::{NavNode, PropertySheet};
use project::catalog::CatalogCache;
use project::settings;
use project::project_actor::{DiagnosticDto, ProjectActorHandle, SourceDto, UndoRedoOutcome};
use project::wire::WireValue;
use std::path::PathBuf;
use tauri::{Manager, State};

/// Ziel A.2 command 2: the full current value tree for one object (`node_id` = the leaf id a
/// prior `open_project` tree returned). Opens the file on first access via `designer_core::open_project`.
#[tauri::command(async)]
pub fn get_property_tree(node_id: String, actor: State<ProjectActorHandle>) -> Result<WireValue, String> {
    crate::commands::guard("get_property_tree", || {
    actor.get_property_tree(node_id)
})
}

/// Ziel A.2 command 3: edits one scalar field through `designer_core::ProjectHandle::set_property`
/// and records the edit for `undo`/`redo`. `path` uses the dotted/indexed notation
/// `NodePath::Display` produces (see `project::wire`).
#[tauri::command(async)]
pub fn set_property(
    node_id: String,
    path: String,
    value: WireValue,
    actor: State<ProjectActorHandle>,
) -> Result<WireValue, String> {
    crate::commands::guard("set_property", || {
    actor.set_property(node_id, path, value)
})
}

/// P8 step 3: the Properties panel of one object or one element inside it (`path`, `$` = the
/// object). The property catalog is read from the configured (or detected) Designer
/// installation on first use, which takes about a second, hence off the UI thread.
#[tauri::command]
pub async fn get_property_sheet(node_id: String, path: String, app: tauri::AppHandle) -> Result<PropertySheet, String> {
    crate::commands::guard_async("get_property_sheet", async {
    blocking(move || {
        let catalog = current_catalog(&app);
        app.state::<ProjectActorHandle>().property_sheet(node_id, path, catalog)
    })
    .await?
}).await
}

pub fn current_catalog(app: &tauri::AppHandle) -> Option<std::sync::Arc<project::catalog::Catalog>> {
    let configured = settings_file(app).ok().and_then(|f| settings::load_settings(&f).designer_install_dir);
    let install_dir = configured.filter(|d| !d.trim().is_empty()).or_else(settings::detect_designer_install);
    let cache_dir = app.path().app_data_dir().ok();
    app.state::<CatalogCache>().get(install_dir, cache_dir.as_deref())
}

/// P8 step 5: the Navigator outline of one object.
#[tauri::command(async)]
pub fn get_navigator(node_id: String, actor: State<ProjectActorHandle>) -> Result<Vec<NavNode>, String> {
    crate::commands::guard("get_navigator", || {
    actor.navigator(node_id)
})
}

/// P8 step 3: writes one property from the Properties panel, including properties not yet in the
/// file and typed `v="..."` attributes; returns the new tree and undo/redo availability.
#[tauri::command(async)]
pub fn set_sheet_property(
    node_id: String,
    path: String,
    name: String,
    value: WireValue,
    typed: bool,
    actor: State<ProjectActorHandle>,
) -> Result<UndoRedoOutcome, String> {
    crate::commands::guard("set_sheet_property", || {
    actor.set_sheet_property(node_id, path, name, value, typed)
})
}

/// Clearing a value in the Properties panel removes the property from the file again.
#[tauri::command(async)]
pub fn remove_sheet_property(node_id: String, path: String, name: String, actor: State<ProjectActorHandle>) -> Result<UndoRedoOutcome, String> {
    crate::commands::guard("remove_sheet_property", || {
    actor.remove_sheet_property(node_id, path, name)
})
}

/// Set to Default of one property (module objects: deletes the project's modification instead).
#[tauri::command(async)]
pub fn reset_sheet_property(node_id: String, path: String, name: String, actor: State<ProjectActorHandle>) -> Result<project::project_actor::ResetOutcome, String> {
    crate::commands::guard("reset_sheet_property", || {
    actor.reset_property(node_id, path, name)
})
}

/// Set to Default of one element, e.g. a field mapping shown in the Navigator.
#[tauri::command(async)]
pub fn reset_sheet_element(node_id: String, path: String, actor: State<ProjectActorHandle>) -> Result<project::project_actor::ResetOutcome, String> {
    crate::commands::guard("reset_sheet_element", || {
    actor.reset_element(node_id, path)
})
}

/// Activates a grey Navigator entry: its definition is created without a property value.
#[tauri::command(async)]
pub fn activate_mapping(node_id: String, path: String, actor: State<ProjectActorHandle>) -> Result<project::project_actor::ActivateOutcome, String> {
    crate::commands::guard("activate_mapping", || {
    actor.activate_mapping(node_id, path)
})
}

/// "Create Modification": edits of this module object are from now on written as modifications.
#[tauri::command(async)]
pub fn enable_modification(node_id: String, project_root: String, actor: State<ProjectActorHandle>) -> Result<(), String> {
    crate::commands::guard("enable_modification", || {
    actor.enable_modification(node_id, PathBuf::from(project_root))
})
}

/// One property edit of a module object, written as MODIFY of the project (never a copy of the object).
#[tauri::command(async)]
pub fn set_modification_property(
    node_id: String,
    path: String,
    name: String,
    value: WireValue,
    typed: bool,
    kind: String,
    actor: State<ProjectActorHandle>,
) -> Result<project::modification_write::Outcome, String> {
    crate::commands::guard("set_modification_property", || {
    actor.set_modification_property(node_id, path, name, value, typed, kind)
})
}

/// Script edit of a module object: the script is stored in the modification folder.
#[tauri::command(async)]
pub fn set_modification_script(
    node_id: String,
    path: String,
    name: String,
    content: String,
    actor: State<ProjectActorHandle>,
) -> Result<project::modification_write::Outcome, String> {
    crate::commands::guard("set_modification_script", || {
    actor.set_modification_script(node_id, path, name, content)
})
}

/// Deletes a modification that became redundant; the UI asks the user first.
#[tauri::command(async)]
pub fn discard_modification(project_root: String, dir: String, actor: State<ProjectActorHandle>) -> Result<(), String> {
    crate::commands::guard("discard_modification", || {
    actor.discard_modification(PathBuf::from(project_root), dir)
})
}

/// Ziel A.6: runs the plugin registry's validators (built-ins plus this app's entity validators)
/// against the currently open object.
#[tauri::command(async)]
pub fn list_diagnostics(node_id: String, actor: State<ProjectActorHandle>) -> Result<Vec<DiagnosticDto>, String> {
    crate::commands::guard("list_diagnostics", || {
    actor.list_diagnostics(node_id)
})
}

/// Ziel A.5: undo/redo keyboard commands. Scoped to `node_id` (the currently active editor tab)
/// rather than global - see `project::history` module doc for the documented `designer-core`
/// API gap this design works around.
#[tauri::command(async)]
pub fn undo(node_id: String, actor: State<ProjectActorHandle>) -> Result<UndoRedoOutcome, String> {
    crate::commands::guard("undo", || {
    actor.undo(node_id)
})
}

#[tauri::command(async)]
pub fn redo(node_id: String, actor: State<ProjectActorHandle>) -> Result<UndoRedoOutcome, String> {
    crate::commands::guard("redo", || {
    actor.redo(node_id)
})
}

/// Ziel A.2 command 5: persistence, via `designer_core::ProjectHandle::save` -
/// `aod::document::serialize` -> `platform::fs::atomic_write` (architecture.md §4).
#[tauri::command(async)]
pub fn save(node_id: String, actor: State<ProjectActorHandle>) -> Result<(), String> {
    crate::commands::guard("save", || {
    actor.save(node_id)
})
}

/// Save although the file changed on disk meanwhile (the user confirmed; the disk version is backed up first).
#[tauri::command(async)]
pub fn save_overwrite(node_id: String, actor: State<ProjectActorHandle>) -> Result<(), String> {
    crate::commands::guard("save_overwrite", || {
    actor.save_overwrite(node_id)
})
}

/// Drops the in-memory copy of an object so the next read comes from disk (external change accepted).
#[tauri::command(async)]
pub fn reload_object(node_id: String, actor: State<ProjectActorHandle>) -> Result<(), String> {
    crate::commands::guard("reload_object", || {
    actor.reload(node_id)
})
}

/// Which of the given open objects changed on disk since they were read or saved.
#[tauri::command(async)]
pub fn external_changes(node_ids: Vec<String>, actor: State<ProjectActorHandle>) -> Result<Vec<String>, String> {
    crate::commands::guard("external_changes", || {
    actor.external_changes(node_ids)
})
}

/// P8 step 4: raw `.aod` text of an object for the Source tab (includes unsaved edits).
#[tauri::command(async)]
pub fn get_object_source(node_id: String, actor: State<ProjectActorHandle>) -> Result<SourceDto, String> {
    crate::commands::guard("get_object_source", || {
    actor.get_source(node_id)
})
}

/// P8 step 4: replaces the whole document with the Source tab's text; one undo step, saved by
/// the normal `save` command through the byte-exact `aod` path.
#[tauri::command(async)]
pub fn set_object_source(node_id: String, text: String, actor: State<ProjectActorHandle>) -> Result<UndoRedoOutcome, String> {
    crate::commands::guard("set_object_source", || {
    actor.set_source(node_id, text)
})
}

/// Code editor: the JDito type definitions of the project's node_modules (read-only).
#[tauri::command]
pub async fn read_jdito_types(project_root: String) -> Option<project::jdito_types::JditoTypes> {
    crate::commands::guard_async("read_jdito_types", async {
    tauri::async_runtime::spawn_blocking(move || project::jdito_types::read(&PathBuf::from(project_root))).await.ok().flatten()
}).await
}
