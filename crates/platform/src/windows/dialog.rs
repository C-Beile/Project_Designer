// Native Windows file/folder dialogs via `rfd` (thin wrapper around the Win32 Common Item
// Dialog API) - the "etablierte Rust-Bibliothek" option the agent brief allows in place of
// hand-written COM boilerplate, and one that already ships a macOS backend too (useful once
// platform::macos stops being a stub, without a FileDialog trait/API change).

use crate::dialog::{FileDialog, OpenFileOptions, PickFolderOptions, SaveFileOptions};
use std::path::PathBuf;

#[derive(Default)]
pub struct RfdFileDialog;

impl RfdFileDialog {
    pub fn new() -> Self {
        Self
    }
}

fn apply_filters(mut dialog: rfd::FileDialog, filters: &[crate::dialog::FileFilter]) -> rfd::FileDialog {
    for filter in filters {
        let extensions: Vec<&str> = filter.extensions.iter().map(String::as_str).collect();
        dialog = dialog.add_filter(&filter.label, &extensions);
    }
    dialog
}

impl FileDialog for RfdFileDialog {
    fn open_file(&self, options: OpenFileOptions) -> Option<PathBuf> {
        let mut dialog = rfd::FileDialog::new();
        if let Some(title) = &options.title {
            dialog = dialog.set_title(title);
        }
        if let Some(dir) = &options.starting_dir {
            dialog = dialog.set_directory(dir);
        }
        dialog = apply_filters(dialog, &options.filters);
        dialog.pick_file()
    }

    fn save_file(&self, options: SaveFileOptions) -> Option<PathBuf> {
        let mut dialog = rfd::FileDialog::new();
        if let Some(title) = &options.title {
            dialog = dialog.set_title(title);
        }
        if let Some(dir) = &options.starting_dir {
            dialog = dialog.set_directory(dir);
        }
        if let Some(name) = &options.default_file_name {
            dialog = dialog.set_file_name(name);
        }
        dialog = apply_filters(dialog, &options.filters);
        dialog.save_file()
    }

    fn pick_folder(&self, options: PickFolderOptions) -> Option<PathBuf> {
        let mut dialog = rfd::FileDialog::new();
        if let Some(title) = &options.title {
            dialog = dialog.set_title(title);
        }
        if let Some(dir) = &options.starting_dir {
            dialog = dialog.set_directory(dir);
        }
        dialog.pick_folder()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Opening a real native dialog blocks on user interaction, which is not meaningfully
    // testable in a non-interactive agent session (the platform.md brief explicitly calls this
    // out for FileDialog/CredentialStore/ShellIntegration). This test instead proves the trait
    // shape compiles and that an `RfdFileDialog` is a valid `dyn FileDialog` - i.e. the
    // interface forge-core would depend on is sound, without actually opening a window.
    #[test]
    fn implements_the_file_dialog_trait_object_shape() {
        fn assert_is_file_dialog<T: FileDialog>() {}
        assert_is_file_dialog::<RfdFileDialog>();

        let _dialog: Box<dyn FileDialog> = Box::new(RfdFileDialog::new());
    }
}
