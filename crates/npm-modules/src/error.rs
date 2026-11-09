//! Error types for `npm-modules`.

use std::path::PathBuf;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum ModuleGraphError {
    #[error("failed to read {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("failed to parse package.json at {path}: {source}")]
    Json {
        path: PathBuf,
        #[source]
        source: serde_json::Error,
    },

    #[error("invalid semver version {raw:?} in {path}: {source}")]
    InvalidVersion {
        path: PathBuf,
        raw: String,
        #[source]
        source: semver::Error,
    },

    #[error("invalid version range {raw:?} for {module} declared by {requester}: {source}")]
    InvalidRange {
        module: String,
        requester: String,
        raw: String,
        #[source]
        source: semver::Error,
    },

    /// A cycle in the `dependencies` graph. `cycle` lists the module names in traversal
    /// order, repeating the start at the end (`A -> B -> C -> A`).
    #[error("cyclic module dependency: {display}")]
    CyclicDependencies { cycle: Vec<String>, display: String },

    /// Two-or-more modules require mutually-incompatible version ranges of the same
    /// dependency (via `dependencies` and/or `peerDependencies`), the version actually
    /// installed in `node_modules` does not satisfy all of them, and no `overrides`
    /// entry on the project root forces a winner. Mirrors the previously UNVERIFIED
    /// `UnresolvedDiamondProblemException` from `transpiler.md` §2 — the override-present
    /// resolution path is now verified against real corpus data (Pichler); this variant
    /// covers the still-unverified failure case (no override available).
    #[error("unresolved diamond dependency: {display}")]
    UnresolvedDiamond {
        module: String,
        installed: String,
        conflicting: Vec<(String, String)>,
        display: String,
    },
}

impl ModuleGraphError {
    pub(crate) fn cyclic(cycle: Vec<String>) -> Self {
        let display = cycle.join(" -> ");
        Self::CyclicDependencies { cycle, display }
    }

    pub(crate) fn unresolved_diamond(
        module: String,
        installed: String,
        conflicting: Vec<(String, String)>,
    ) -> Self {
        let parts: Vec<String> = conflicting
            .iter()
            .map(|(requester, range)| format!("{requester} requires {range}"))
            .collect();
        let display = format!(
            "module {module} is installed at {installed}, which does not satisfy: {} \
             (no `overrides` entry on the project root pins {module})",
            parts.join(", ")
        );
        Self::UnresolvedDiamond {
            module,
            installed,
            conflicting,
            display,
        }
    }
}
