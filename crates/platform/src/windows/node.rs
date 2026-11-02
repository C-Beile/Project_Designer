// Finds a locally installed Node.js (P2 groundwork confirmed one is present on this machine at
// C:\Program Files\nodejs\node.exe). ADR-0001's version-selectable sidecar Node is P7
// packaging scope - this implementation intentionally ignores `project_home` version
// constraints for now (see module doc in ../node.rs) and just finds *a* working Node.

use crate::error::PlatformError;
use crate::node::{NodeInstallation, NodeResolver};
use std::path::{Path, PathBuf};

#[derive(Default)]
pub struct PathNodeResolver;

impl PathNodeResolver {
    pub fn new() -> Self {
        Self
    }

    /// Search order: PATH first (respects whatever a developer/CI has active), then the
    /// well-known default installer location as a fallback for a machine where `node` was
    /// installed but the shell that launched Forge does not have an up-to-date PATH (a real
    /// case on Windows, where PATH changes only take effect in new shells).
    fn candidate_node_paths() -> Vec<PathBuf> {
        let mut candidates = Vec::new();
        if let Some(paths) = std::env::var_os("PATH") {
            for dir in std::env::split_paths(&paths) {
                candidates.push(dir.join("node.exe"));
            }
        }
        candidates.push(PathBuf::from(r"C:\Program Files\nodejs\node.exe"));
        candidates
    }
}

impl NodeResolver for PathNodeResolver {
    fn resolve(&self, _project_home: &Path) -> Result<NodeInstallation, PlatformError> {
        let node_path = Self::candidate_node_paths()
            .into_iter()
            .find(|candidate| candidate.is_file())
            .ok_or(PlatformError::NodeNotFound)?;

        let version = query_version(&node_path)?;
        let npm_path = node_path.with_file_name("npm.cmd");
        let npm_path = if npm_path.is_file() { Some(npm_path) } else { None };

        Ok(NodeInstallation { node_path, npm_path, version })
    }
}

fn query_version(node_path: &Path) -> Result<String, PlatformError> {
    let output = crate::console::command(node_path)
        .arg("--version")
        .output()
        .map_err(|source| PlatformError::Spawn { program: node_path.display().to_string(), source })?;
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_node_installation_present_on_this_development_machine() {
        let resolver = PathNodeResolver::new();
        let installation = resolver.resolve(Path::new(r"C:\anything")).unwrap();

        assert!(installation.node_path.is_file(), "node_path = {:?}", installation.node_path);
        assert!(
            installation.version.starts_with('v'),
            "expected a 'vX.Y.Z' style version string, got {:?}",
            installation.version
        );
    }
}
