// "Show in Explorer"/"open with default app" style OS shell integration.

use crate::error::PlatformError;
use std::path::Path;

pub trait ShellIntegration: Send + Sync {
    /// Opens the OS file manager with `path` selected (Explorer today, Finder once
    /// `platform::macos` stops being a stub).
    fn reveal_in_file_manager(&self, path: &Path) -> Result<(), PlatformError>;

    /// Opens `path` with the OS-registered default handler for its file type.
    fn open_with_default_app(&self, path: &Path) -> Result<(), PlatformError>;
}
