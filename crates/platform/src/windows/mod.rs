//! Windows implementations of every `platform` trait (architecture.md §8: "Implementierungen
//! liegen unter `platform::windows` (P3, vollständig) ..."). `fs::atomic_write` has no
//! Windows-specific variant here because `std::fs::rename` is already atomic-with-overwrite on
//! Windows (MoveFileExW/MOVEFILE_REPLACE_EXISTING under the hood) - see `crate::fs`.

pub mod credentials;
pub mod dialog;
pub mod node;
pub mod process;
pub mod shell;
pub mod watcher;

pub use credentials::WindowsCredentialStore;
pub use dialog::RfdFileDialog;
pub use node::PathNodeResolver;
pub use process::CommandProcessSpawner;
pub use shell::ExplorerShellIntegration;
pub use watcher::NotifyFileWatcher;

pub use credentials::WindowsCredentialStore as NativeCredentialStore;
pub use shell::ExplorerShellIntegration as NativeShellIntegration;
