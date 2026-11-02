// "Show in Explorer" / "open with default app", both implemented as a plain child-process
// spawn (explorer.exe /select, and the shell's own `start` verb) rather than COM
// (ShellExecuteEx) - simpler, and consistent with how this crate already spawns processes
// elsewhere (see windows::process). Fire-and-forget: both operations hand off to Explorer and
// do not wait for whatever application it opens.

use crate::error::PlatformError;
use crate::shell::ShellIntegration;
use std::path::Path;

#[derive(Default)]
pub struct ExplorerShellIntegration;

impl ExplorerShellIntegration {
    pub fn new() -> Self {
        Self
    }
}

impl ShellIntegration for ExplorerShellIntegration {
    fn reveal_in_file_manager(&self, path: &Path) -> Result<(), PlatformError> {
        // explorer.exe returns a non-zero/odd exit code even on a successful /select - its exit
        // code is not a reliable success signal (long-documented Explorer quirk), so only the
        // spawn itself is treated as fallible here.
        crate::console::command("explorer")
            .arg("/select,")
            .arg(path)
            .spawn()
            .map_err(|source| PlatformError::Shell { path: path.to_path_buf(), source })?;
        Ok(())
    }

    fn open_with_default_app(&self, path: &Path) -> Result<(), PlatformError> {
        // `cmd /c start "" "<path>"` - the empty "" is the window-title argument `start`
        // otherwise mistakes for the path itself when the path contains quotes.
        crate::console::command("cmd")
            .arg("/C")
            .arg("start")
            .arg("")
            .arg(path)
            .spawn()
            .map_err(|source| PlatformError::Shell { path: path.to_path_buf(), source })?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Both methods here pop a real, visible Explorer/default-app window - the same category of
    // "not sensibly testable in a non-interactive agent session" the platform.md brief calls
    // out for CredentialStore/FileDialog/ShellIntegration. Running them for real in `cargo test`
    // would spawn windows on whatever desktop the suite happens to run on, which is disruptive
    // rather than a meaningful assertion. This is a trait-shape/compile test instead, honestly
    // documenting the gap rather than faking coverage.
    #[test]
    fn implements_the_shell_integration_trait_object_shape() {
        fn assert_is_shell_integration<T: ShellIntegration>() {}
        assert_is_shell_integration::<ExplorerShellIntegration>();

        let _shell: Box<dyn ShellIntegration> = Box::new(ExplorerShellIntegration::new());
    }
}
