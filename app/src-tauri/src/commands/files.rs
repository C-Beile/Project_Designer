//! Dateien und Objekte im Projektbaum (kopieren, umbenennen, neu, Refactoring).

use super::blocking;
use project::{linked_file, tree_ops};
use project_index::IndexRegistry;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;

/// Reads a colour theme file (.json) chosen in the Options window.
#[tauri::command]
pub async fn read_theme_file(path: String) -> Result<String, String> {
    crate::commands::guard_async("read_theme_file", async {
    blocking(move || project::file_list::read_theme_file(&PathBuf::from(path))).await?
}).await
}

/// A colour theme package (`.vsix`, `.zip`, an extension folder or a single `.json` file): its theme files as text.
#[tauri::command]
pub async fn read_theme_pack(path: String) -> Result<Vec<project::file_list::ThemePackFile>, String> {
    crate::commands::guard_async("read_theme_pack", async {
    blocking(move || project::file_list::read_theme_pack(&PathBuf::from(path))).await?
}).await
}

/// Ziel B.3: read a `%aditoprj%`-relative linked file (e.g. an `entityField.valueProcess`
/// target) for the JDito/Monaco code field.
#[tauri::command(async)]
pub fn read_linked_file(project_root: String, reference: String) -> Result<String, String> {
    crate::commands::guard("read_linked_file", || {
    linked_file::read_linked_file(&PathBuf::from(project_root), &reference)
})
}

#[tauri::command(async)]
pub fn write_linked_file(project_root: String, reference: String, content: String) -> Result<(), String> {
    crate::commands::guard("write_linked_file", || {
    linked_file::write_linked_file(&PathBuf::from(project_root), &reference, &content)
})
}

/// Tree context menu: copies an object under a new name into dest_root (a project root);
/// returns the new object file. Refuses anything but the standard object layout.
#[tauri::command(async)]
pub fn copy_object(source: String, dest_root: String, new_name: String) -> Result<String, String> {
    crate::commands::guard("copy_object", || {
    tree_ops::copy_object(&PathBuf::from(source), &PathBuf::from(dest_root), &new_name).map(|p| p.to_string_lossy().into_owned())
})
}

/// Tree context menu: deletes the folder of one object; the UI calls this only after the user
/// confirmed the object by name.
#[tauri::command(async)]
pub fn delete_object(source: String) -> Result<(), String> {
    crate::commands::guard("delete_object", || {
    tree_ops::delete_object(&PathBuf::from(source))
})
}

/// Properties of a file in the Projects tree: name, extension, size, modification time, path.
#[tauri::command(async)]
pub fn file_info(path: String) -> Result<project::file_ops::FileInfo, String> {
    crate::commands::guard("file_info", || {
    project::file_ops::file_info(&PathBuf::from(path))
})
}

/// Copy / cut and paste of a file into a folder of the project; the new path.
#[tauri::command(async)]
pub fn file_paste(project_root: String, source: String, dest_dir: String, cut: bool) -> Result<String, String> {
    crate::commands::guard("file_paste", || {
    let (root, src, dest) = (PathBuf::from(project_root), PathBuf::from(source), PathBuf::from(dest_dir));
    let target = if cut { project::file_ops::move_file(&root, &src, &dest) } else { project::file_ops::copy_file(&root, &src, &dest) }?;
    Ok(target.to_string_lossy().into_owned())
})
}

#[tauri::command(async)]
pub fn file_rename(project_root: String, path: String, new_name: String) -> Result<String, String> {
    crate::commands::guard("file_rename", || {
    project::file_ops::rename_file(&PathBuf::from(project_root), &PathBuf::from(path), &new_name).map(|p| p.to_string_lossy().into_owned())
})
}

/// Deletes a file after the user confirmed; a copy goes to the backup folder first.
#[tauri::command(async)]
pub fn file_delete(project_root: String, path: String) -> Result<(), String> {
    crate::commands::guard("file_delete", || {
    project::file_ops::delete_file(&PathBuf::from(project_root), &PathBuf::from(path))
})
}

/// "Open in System": opens the file with the program the operating system registered for it.
#[tauri::command(async)]
pub fn open_in_system(path: String) -> Result<(), String> {
    crate::commands::guard("open_in_system", || {
    let path = PathBuf::from(path);
    if !path.exists() {
        return Err(format!("{} does not exist.", path.display()));
    }
    use platform::shell::ShellIntegration;
    platform::native::NativeShellIntegration::new().open_with_default_app(&path).map_err(|e| e.to_string())
})
}

/// File > New: the object types of the "New" dialog, creatable ones first marked as enabled.
#[tauri::command(async)]
pub fn new_object_kinds() -> Vec<project::new_object::NewObjectKind> {
    crate::commands::guard("new_object_kinds", || {
    project::new_object::kinds()
})
}

/// File > New: checks the name against the project (read-only). `None` means the name is free.
#[tauri::command(async)]
pub fn validate_new_name(project_root: String, folder: String, name: String) -> Option<String> {
    crate::commands::guard("validate_new_name", || {
    project::new_object::validate_name(&PathBuf::from(project_root), &folder, &name).err()
})
}

/// File > New: creates one object after the user confirmed the dialog; returns its model file.
#[tauri::command(async)]
pub fn create_object(project_root: String, folder: String, name: String, title: Option<String>, reference: Option<String>) -> Result<String, String> {
    crate::commands::guard("create_object", || {
    project::new_object::create_object(&PathBuf::from(project_root), &folder, &name, title.as_deref(), reference.as_deref()).map(|p| p.to_string_lossy().into_owned())
})
}

/// Rename preview: every reference that would change and every mention that would not (read-only).
#[tauri::command]
pub async fn rename_plan(project_root: String, source: String, new_name: String, registry: State<'_, Arc<IndexRegistry>>) -> Result<project::rename::RenamePlan, String> {
    let registry = registry.inner().clone();
    crate::commands::guard_async("rename_plan", async {
    blocking(move || {
        let (root, source) = (PathBuf::from(project_root), PathBuf::from(source));
        let hints = super::index::rename_hints(&registry, &root, &source);
        project::rename::plan_with(&root, &source, &new_name, hints.as_ref())
    })
        .await?
}).await
}

/// Rename: runs only after the user confirmed the preview ("Do Refactoring"); returns the new model file.
#[tauri::command]
pub async fn rename_object(project_root: String, source: String, new_name: String, registry: State<'_, Arc<IndexRegistry>>) -> Result<String, String> {
    let registry = registry.inner().clone();
    crate::commands::guard_async("rename_object", async {
    blocking(move || {
        let (root, source) = (PathBuf::from(project_root), PathBuf::from(source));
        let hints = super::index::rename_hints(&registry, &root, &source);
        project::rename::apply_with(&root, &source, &new_name, hints.as_ref()).map(|p| p.to_string_lossy().into_owned())
    })
        .await?
}).await
}
