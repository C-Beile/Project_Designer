// Error surface for one native-transpiler run. Kept separate from `adito_transpiler::TranspilerError`
// (the reference run's own error type) so a caller can tell "the harness itself could not run"
// apart from "the reference transpiler run failed" - the latter is a valid, reportable outcome
// (e.g. exit 150), not a harness defect.

use std::path::PathBuf;

#[derive(Debug, thiserror::Error)]
pub enum HarnessError {
    #[error("project home does not exist or is not a directory: {0}")]
    ProjectHomeNotFound(PathBuf),

    #[error("reference transpiler wrapper failed to start: {0}")]
    ReferenceSetup(#[from] adito_transpiler::TranspilerError),

    #[error("own engine failed: {0}")]
    OwnEngine(String),

    #[error("failed to walk directory {path}: {source}")]
    Walk { path: PathBuf, source: std::io::Error },

    #[error("failed to read file {path}: {source}")]
    ReadFile { path: PathBuf, source: std::io::Error },

    #[error("failed to write report to {path}: {source}")]
    WriteReport { path: PathBuf, source: std::io::Error },
}
