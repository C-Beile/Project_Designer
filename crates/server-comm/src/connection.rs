//! The `ServerConnection` trait and its supporting types.
//!
//! See the crate-level docs and `PROJECT/20_architecture/p3-server-comm-notes.md` for the
//! research this shape is based on.

use std::path::{Path, PathBuf};

/// Host/port pair the designer connects to for deploy and command traffic.
///
/// Field shape verified from the shipped `DeployCLI` module's option processor
/// (`--host`, `--port` are both required arguments on the CLI, see notes finding #2).
/// The wire protocol spoken over this endpoint (REST paths, payload schemas) was not
/// verified — no endpoint URL or request/response body was recoverable from metadata alone.
///
/// P7 update: against a real dev server, an HTTP(S) service was confirmed live and
/// reachable at this kind of endpoint (through the `DesignerTunnel` SSH forward) — a plain
/// `GET /` got a real HTTP response (session-gated redirect on the web-client port, a named
/// status page on a management-service port). This confirms the transport family, not the
/// designer-specific REST contract. See
/// `PROJECT/20_architecture/p7-server-comm-verify-notes.md`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerEndpoint {
    pub host: String,
    pub port: u16,
}

/// Authentication the designer presents to the application server.
///
/// The shipped `ServerComm` module ships a `DesignerBasicCredentialProvider` class and
/// depends on `org.netbeans.modules.keyring` (NetBeans' credential store) plus
/// `de.adito.nbm.wrappers.lwhttpclient` (an HTTP client wrapper) — together these point at
/// HTTP Basic authentication with credentials cached in the platform keyring, not at a
/// custom token scheme (notes finding #1). Session/TLS details beyond that were not
/// verified.
///
/// P7 update: a live system-DB alias's `user`/`password` pair (from a real
/// `serverconfig_system.xml`) was confirmed to authenticate successfully against a real
/// MariaDB instance reached through the `DesignerTunnel` SSH forward — so this shape (a
/// plain user/password pair, no token) is confirmed correct for at least the DB connection
/// this crate's `Credentials` type would also carry for HTTP auth. The HTTP Basic-auth part
/// specifically (as opposed to the DB connection) was not itself exercised. See
/// `PROJECT/20_architecture/p7-server-comm-verify-notes.md`.
#[derive(Clone, PartialEq, Eq)]
pub struct Credentials {
    pub user: String,
    pub password: String,
}

impl std::fmt::Debug for Credentials {
    // Business rule: credentials must never leak into logs or debug output, even though
    // nothing about their transport is verified yet.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Credentials")
            .field("user", &self.user)
            .field("password", &"<redacted>")
            .finish()
    }
}

/// Options accepted by a deploy run.
///
/// Every field mirrors a verified `DeployCLI` command-line option (see
/// `META-INF/generated-layer.xml` inside `de-adito-deploy-cli-DeployCLI.jar`, notes finding
/// #2). Field names were adapted to Rust conventions; the concepts are 1:1 with the shipped
/// options, not invented.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DeployOptions {
    /// `--force` / `-f`: deploy even where the interactive confirmation dialog would
    /// normally require the user to review changes first.
    pub force: bool,
    /// `--upgrade` / `-u`: allow a database upgrade as part of the deploy.
    pub upgrade: bool,
    /// `--userhelp`: include user-help content in the deploy.
    pub include_user_help: bool,
    /// `--signerLicense`: license value the CLI passes through as a required argument;
    /// its purpose beyond "some signer/licensing check the server performs" is not
    /// verified.
    pub signer_license: Option<String>,
    /// `--deploySources`: explicit subset of sources to deploy; empty means "full
    /// project", matching the CLI's `additionalArguments` option type.
    pub deploy_sources: Vec<PathBuf>,
}

/// Result of a completed deploy run.
///
/// Variants and the `failed_models` payload are taken directly from the shipped
/// `DeployCLI` message keys `LBL_DeploySuccessful` / `LBL_DeployPartlyFailed` /
/// `LBL_DeployFailed` / `LBL_FailedModels={0}` (notes finding #2) — this is one of the few
/// places where even the *shape* of a result, not just an argument list, could be verified.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeployOutcome {
    Successful,
    PartlyFailed { failed_models: Vec<String> },
    Failed,
}

/// Progress of an in-flight deploy.
///
/// Modeled as discrete counted steps rather than a byte/percentage stream because the
/// shipped interactive `Deploy` module reports progress that way (`ConfirmDeployDialog` /
/// `DeployWorker` message key `LBL_ChangesApplied={0}/{1} changes applied.`, notes finding
/// #3). Whether progress is pushed (streaming) or must be polled was not verified — this
/// crate assumes polling until proven otherwise.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DeployProgress {
    pub applied: u32,
    pub total: u32,
    pub message: Option<String>,
}

/// Errors a `ServerConnection` can report.
///
/// The first four variants map directly to verified `DeployCLI` / `Deploy` message keys
/// (`LBL_ExeptionProjectHome`, `LBL_ExeptionServerConfig`, `LBL_FailedToLoadServerconfig`,
/// `LBL_DatabaseNotReachable` / `LBL_NoDeployTargetWasFound` — notes findings #2 and #3).
/// `NotConnected` is this crate's own addition for the Rust-side state machine and is not
/// itself backed by a shipped message key.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ServerCommError {
    #[error("project home is not set")]
    ProjectHomeNotSet,
    #[error("server config is not set")]
    ServerConfigNotSet,
    #[error("failed to load server config")]
    ServerConfigLoadFailed,
    #[error("deploy target is not reachable")]
    TargetUnreachable,
    #[error("not connected to a server")]
    NotConnected,
}

/// Abstraction over a live connection to one ADITO application server instance.
///
/// This trait stays close to the CLI surface `DeployCLI` exposes, because that is the only
/// end-to-end verified contract available (project home + target config + credentials in,
/// a pass/partial-fail/fail outcome out). Everything *below* the trait boundary — actual
/// REST calls, response parsing, the SSH tunnel layer `DesignerTunnel` owns — is left
/// unimplemented (`todo!()`) until a real deploy attempt against a test server can confirm
/// it. See `PROJECT/20_architecture/p3-server-comm-notes.md` and the matching `RISKS.md`
/// entry for the recommended next step.
pub trait ServerConnection {
    /// Opens a session against `endpoint`, authenticating with `credentials`.
    ///
    /// Verified: `ServerComm` depends on an HTTP client wrapper and on NetBeans' keyring
    /// module, consistent with "open an authenticated HTTP(S) session and cache the
    /// credential". Not verified: TLS handling specifics, session lifetime/keep-alive
    /// behavior.
    fn connect(
        &mut self,
        endpoint: ServerEndpoint,
        credentials: Credentials,
    ) -> Result<(), ServerCommError>;

    /// Ends the current session.
    ///
    /// Mirrors the shipped `CloseControl` class, whose sole verified job — from its name
    /// and its placement next to `ServerControl`/`AbstractControl` — is to release/close a
    /// server connection. Its actual close semantics (graceful vs. abrupt, timeout) are not
    /// verified.
    fn disconnect(&mut self) -> Result<(), ServerCommError>;

    /// Triggers a deploy of `project_home` against `server_config` with `options`.
    ///
    /// Signature shape is the strongest-evidence part of this trait: it mirrors the
    /// verified, required `DeployCLI` arguments `--projecthome`/`--serverconfig`, plus the
    /// optional ones folded into [`DeployOptions`]. The actual request/response wire format
    /// is not verified.
    fn deploy(
        &mut self,
        project_home: &Path,
        server_config: &Path,
        options: DeployOptions,
    ) -> Result<DeployOutcome, ServerCommError> {
        let _ = (project_home, server_config, options);
        todo!(
            "deploy wire protocol not verified — see PROJECT/20_architecture/p3-server-comm-notes.md"
        )
    }

    /// Polls deploy/command progress.
    ///
    /// The shipped `Deploy` module drives a very similar flow interactively (`DeployWorker`,
    /// `DeployRunner`, `ConfirmDeployDialog` reporting counts like "{0}/{1} changes
    /// applied"), which is why progress is modeled as discrete counted steps rather than a
    /// percentage stream. Not verified: whether progress is pushed (streaming) or must be
    /// polled like this method assumes.
    fn poll_progress(&mut self) -> Result<DeployProgress, ServerCommError> {
        todo!("progress delivery mechanism (push vs. poll) not verified")
    }

    /// Sends one of the verified server-side cache-invalidation commands.
    ///
    /// `ClearDataModelCacheRestServerCommandExecutor`, `ClearSysDBCacheRestServerCommandExecutor`
    /// and `ClearReportCacheRestServerCommandExecutor` are real, named classes in the shipped
    /// `ServerComm` module (notes finding #1) — the command *names* are verified, their
    /// actual REST call shape (method, path, body) is not.
    fn send_command(&mut self, command: crate::RestServerCommand) -> Result<(), ServerCommError> {
        let _ = command;
        todo!("REST payload for server commands not verified")
    }
}
