// Setup/spawn failures that happen before the TranspilerCLI process ever produces an exit
// code. Distinct from `exit_code::FailureReason`, which classifies a *result the process
// itself reported* - this type is for the wrapper's own plumbing failing (bad paths, spawn
// errors), so a caller can tell "the transpiler ran and failed" apart from "the transpiler
// never ran".

use std::path::PathBuf;

#[derive(Debug, thiserror::Error)]
pub enum TranspilerError {
    #[error("project_home does not exist or is not a directory: {0}")]
    ProjectHomeNotFound(PathBuf),

    #[error("Designer launcher (nbexec64.exe on Windows, nbexec on macOS) not found: {0}")]
    LauncherNotFound(PathBuf),

    #[error("failed to spawn TranspilerCLI process: {0}")]
    Spawn(#[source] std::io::Error),

    #[error("failed to wait for TranspilerCLI process: {0}")]
    Wait(#[source] std::io::Error),

    #[error("failed to lock the transpiler userdir for exclusive use: {0}")]
    UserdirLock(#[source] std::io::Error),

    #[error("failed to capture a stdout/stderr handle from the TranspilerCLI process")]
    MissingStdioHandle,
}
