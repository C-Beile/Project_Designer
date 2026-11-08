//! Native Datei-Dialoge.

use platform::{FileDialog, FileFilter, OpenFileOptions, PickFolderOptions};

/// P7 (project-open-dialog) command 1: shows the real native Windows folder picker via
/// `platform::FileDialog` (the trait P3 already built and trait-shape-tested but never wired to
/// a Tauri command - see `p3-platform-notes.md`). Returns `None` on cancel, which the frontend
/// treats as "nothing changed", not an error.
#[tauri::command]
pub fn pick_project_folder(title: Option<String>) -> Option<String> {
    let title = title.filter(|t| !t.trim().is_empty()).unwrap_or_else(|| "Open Forge project".to_string());
    platform_file_dialog()
        .pick_folder(PickFolderOptions { title: Some(title), starting_dir: None })
        .map(|path| path.to_string_lossy().into_owned())
}

pub fn platform_file_dialog() -> platform::native::RfdFileDialog {
    platform::native::RfdFileDialog::new()
}

/// Services tab: native file picker for the two export files and the SSH key; `None` on cancel.
#[tauri::command]
pub fn pick_file(title: Option<String>, label: String, extensions: Vec<String>) -> Option<String> {
    platform_file_dialog()
        .open_file(OpenFileOptions {
            title,
            starting_dir: None,
            filters: if extensions.is_empty() { Vec::new() } else { vec![FileFilter { label, extensions }] },
        })
        .map(|path| path.to_string_lossy().into_owned())
}

/// Native "save as" dialog for the export file; `None` on cancel.
#[tauri::command]
pub fn pick_save_file(title: Option<String>, default_name: String, label: String, extensions: Vec<String>) -> Option<String> {
    platform_file_dialog()
        .save_file(platform::SaveFileOptions {
            title,
            starting_dir: None,
            default_file_name: Some(default_name),
            filters: vec![FileFilter { label, extensions }],
        })
        .map(|path| path.to_string_lossy().into_owned())
}
