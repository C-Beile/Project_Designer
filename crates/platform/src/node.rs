// Node/npm resolution per project (ADR-0001: sidecar Node, version-selectable). This round
// only needs to find a locally installed Node - a bundled sidecar is P7 packaging scope, not
// this integration round (see platform.md agent brief). `project_home` is still threaded
// through the trait signature even though this implementation ignores it, so a later
// version-selecting implementation (per-project .nvmrc/package.json "engines" lookup) does not
// need a trait/signature change - only NodeResolver::resolve's body would change.

use crate::error::PlatformError;
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct NodeInstallation {
    pub node_path: PathBuf,
    pub npm_path: Option<PathBuf>,
    pub version: String,
}

pub trait NodeResolver: Send + Sync {
    fn resolve(&self, project_home: &Path) -> Result<NodeInstallation, PlatformError>;
}
