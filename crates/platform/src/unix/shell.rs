//! "Reveal in Finder" and "open with default app" through the system `open` command on macOS
//! (`xdg-open` on other Unix systems, which only matters for development builds).

use crate::error::PlatformError;
use crate::shell::ShellIntegration;
use std::ffi::OsString;
use std::path::Path;

#[derive(Default)]
pub struct OpenShellIntegration;

impl OpenShellIntegration {
    pub fn new() -> Self {
        Self
    }
}

/// Program and arguments for revealing `path`; separated from the spawn so it can be tested.
pub fn reveal_command(path: &Path) -> (&'static str, Vec<OsString>) {
    if cfg!(target_os = "macos") {
        ("open", vec!["-R".into(), path.as_os_str().to_owned()])
    } else {
        let dir = path.parent().unwrap_or(path);
        ("xdg-open", vec![dir.as_os_str().to_owned()])
    }
}

pub fn open_command(path: &Path) -> (&'static str, Vec<OsString>) {
    (if cfg!(target_os = "macos") { "open" } else { "xdg-open" }, vec![path.as_os_str().to_owned()])
}

fn run(cmd: (&'static str, Vec<OsString>), path: &Path) -> Result<(), PlatformError> {
    crate::console::command(cmd.0).args(cmd.1).spawn().map(|_| ()).map_err(|source| PlatformError::Shell { path: path.to_path_buf(), source })
}

impl ShellIntegration for OpenShellIntegration {
    fn reveal_in_file_manager(&self, path: &Path) -> Result<(), PlatformError> {
        run(reveal_command(path), path)
    }

    fn open_with_default_app(&self, path: &Path) -> Result<(), PlatformError> {
        run(open_command(path), path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commands_use_the_system_opener() {
        let (prog, args) = open_command(Path::new("/tmp/a b.txt"));
        assert!(prog == "open" || prog == "xdg-open");
        assert_eq!(args, vec![OsString::from("/tmp/a b.txt")]);
        let (_, reveal) = reveal_command(Path::new("/tmp/a.txt"));
        assert!(!reveal.is_empty());
    }
}
