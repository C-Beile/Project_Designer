//! macOS and Linux implementations of the `platform` traits. The file dialog, the file watcher
//! and the process spawner are the same code as on Windows (they only use portable APIs; the
//! OS-specific part of the spawner lives in `process::kill_process_tree`), so those modules are
//! included from the `windows` folder instead of being copied.

#[path = "../windows/dialog.rs"]
pub mod dialog;
pub mod credentials;
pub mod node;
#[path = "../windows/process.rs"]
pub mod process;
pub mod shell;
#[path = "../windows/watcher.rs"]
pub mod watcher;

pub use credentials::KeychainCredentialStore as NativeCredentialStore;
pub use dialog::RfdFileDialog;
pub use node::PathNodeResolver;
pub use process::CommandProcessSpawner;
pub use shell::OpenShellIntegration as NativeShellIntegration;
pub use watcher::NotifyFileWatcher;
