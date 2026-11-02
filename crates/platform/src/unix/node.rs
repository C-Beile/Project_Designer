//! Finds a locally installed Node.js on macOS/Linux. A GUI app started from Finder does not
//! inherit the shell PATH, so the usual install locations (Homebrew on Apple Silicon and Intel,
//! the nodejs.org installer, system paths) are searched in addition to PATH. The npm launcher is
//! plain `npm` here; there is no `.cmd` wrapper as on Windows.

use crate::error::PlatformError;
use crate::node::{NodeInstallation, NodeResolver};
use std::path::{Path, PathBuf};

#[derive(Default)]
pub struct PathNodeResolver;

impl PathNodeResolver {
    pub fn new() -> Self {
        Self
    }

    fn candidate_dirs() -> Vec<PathBuf> {
        let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
        for fixed in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
            dirs.push(PathBuf::from(fixed));
        }
        dirs
    }
}

impl NodeResolver for PathNodeResolver {
    fn resolve(&self, _project_home: &Path) -> Result<NodeInstallation, PlatformError> {
        let dirs = Self::candidate_dirs();
        let node_path = dirs.iter().map(|d| d.join("node")).find(|c| c.is_file()).ok_or(PlatformError::NodeNotFound)?;
        let npm_path = dirs.iter().map(|d| d.join("npm")).find(|c| c.is_file());
        let version = crate::console::command(&node_path)
            .arg("--version")
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .map_err(|source| PlatformError::Spawn { program: node_path.display().to_string(), source })?;
        Ok(NodeInstallation { node_path, npm_path, version })
    }
}
