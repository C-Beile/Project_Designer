//! Verified server-command surface: what the shipped `ServerComm` module can name, not what
//! it says over the wire.

/// Server-side cache domain a [`RestServerCommand::ClearCache`] targets.
///
/// Verified from three concrete executor classes shipped in `ServerComm`'s
/// `control.rest` package: `ClearDataModelCacheRestServerCommandExecutor`,
/// `ClearSysDBCacheRestServerCommandExecutor`, `ClearReportCacheRestServerCommandExecutor`
/// (see `PROJECT/20_architecture/p3-server-comm-notes.md`, finding #1). No fourth
/// cache-clear class was observed in the shipped jar, so this enum is exhaustive for what
/// could be confirmed — a real server may expose more commands than the designer client
/// happens to use.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CacheDomain {
    /// Clears the cached data model definitions (`ClearDataModelCache...`).
    DataModel,
    /// Clears the cached system database contents (`ClearSysDBCache...`).
    SystemDatabase,
    /// Clears the cached report definitions (`ClearReportCache...`).
    Report,
}

/// A command sendable to the application server over the (unverified) `ServerComm` REST
/// channel.
///
/// Modeled after the `RestServerCommand`/`RestServerCommandExecutor` class pair found in
/// the shipped module — the command family and the cache-domain split are verified, the
/// actual HTTP method/path/body per command are not.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RestServerCommand {
    ClearCache(CacheDomain),
}
