// Native file/folder dialogs. Returns `Option<PathBuf>` rather than `Result` - the only
// "failure" mode a caller cares about is "the user cancelled", which is not an error; a dialog
// that truly cannot be shown (no display, headless CI) is out of scope for an interactive
// desktop app and is left to panic/log at the call site rather than modelled as a typed error.

use std::path::PathBuf;

#[derive(Clone, Debug, Default)]
pub struct FileFilter {
    pub label: String,
    pub extensions: Vec<String>,
}

#[derive(Clone, Debug, Default)]
pub struct OpenFileOptions {
    pub title: Option<String>,
    pub starting_dir: Option<PathBuf>,
    pub filters: Vec<FileFilter>,
}

#[derive(Clone, Debug, Default)]
pub struct SaveFileOptions {
    pub title: Option<String>,
    pub starting_dir: Option<PathBuf>,
    pub default_file_name: Option<String>,
    pub filters: Vec<FileFilter>,
}

#[derive(Clone, Debug, Default)]
pub struct PickFolderOptions {
    pub title: Option<String>,
    pub starting_dir: Option<PathBuf>,
}

pub trait FileDialog: Send + Sync {
    fn open_file(&self, options: OpenFileOptions) -> Option<PathBuf>;
    fn save_file(&self, options: SaveFileOptions) -> Option<PathBuf>;
    fn pick_folder(&self, options: PickFolderOptions) -> Option<PathBuf>;
    /// Several folders at once; a dialog without multi-select returns the one folder it offers.
    fn pick_folders(&self, options: PickFolderOptions) -> Vec<PathBuf> {
        self.pick_folder(options).into_iter().collect()
    }
}
