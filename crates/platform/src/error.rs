// One shared error type for every platform subsystem. A per-trait error enum was considered
// (mirroring transpiler::TranspilerError), but the seven interfaces here are thin OS wrappers
// with overlapping failure shapes (spawn/IO/not-found) - a single enum keeps designer-core's
// error handling code from having to match on seven near-identical types for what is, from a
// caller's perspective, "the platform layer failed, here is why".

#[derive(Debug, thiserror::Error)]
pub enum PlatformError {
    #[error("failed to spawn process {program}: {source}")]
    Spawn { program: String, #[source] source: std::io::Error },

    #[error("failed to wait for spawned process: {0}")]
    Wait(#[source] std::io::Error),

    #[error("failed to capture a stdout/stderr handle from a spawned process")]
    MissingStdioHandle,

    #[error("program not found: {0}")]
    ProgramNotFound(std::path::PathBuf),

    #[error("atomic write to {path} failed: {source}")]
    AtomicWrite { path: std::path::PathBuf, #[source] source: std::io::Error },

    #[error("failed to start watching {path}: {source}")]
    Watch { path: std::path::PathBuf, #[source] source: std::io::Error },

    #[error("no local Node.js installation found on PATH or common install locations")]
    NodeNotFound,

    #[error("credential store operation on target '{target}' failed: {detail}")]
    Credential { target: String, detail: String },

    #[error("shell integration operation on {path} failed: {source}")]
    Shell { path: std::path::PathBuf, #[source] source: std::io::Error },

    #[error("this operation is not yet implemented on this platform: {0}")]
    NotImplemented(&'static str),

    #[error("git {operation} failed: {detail}")]
    Git { operation: String, detail: String },
}
