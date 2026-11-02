//! `server-comm`: connection and deploy-command surface between the Forge designer core
//! and a running ADITO application server.
//!
//! # Scope note
//! Unlike the other P3 crates, no ready-made specification existed for `ServerComm` /
//! `DesignerTunnel` going into this crate — the chief prompt only named them as modules.
//! This crate therefore started with a read-only research pass over the shipped
//! installation's module metadata (CLI option processors, class/package names,
//! `Bundle.properties` message keys — never decompiled bytecode) before any code was
//! written. The full research trail lives in
//! `PROJECT/20_architecture/p3-server-comm-notes.md`; every doc comment below that claims
//! something is "verified" points back to a specific finding there.
//!
//! The trait shape mirrors what the shipped `DeployCLI` module exposes end to end (project
//! home, server config, credentials, options in; a pass/partial-fail/fail outcome out),
//! because that CLI is the one place the whole flow could be observed concretely, the same
//! way `official-transpiler-invocation.md` did for the transpiler CLI. The actual wire
//! protocol underneath (REST paths, payload shapes, TLS/session details) was not
//! recoverable from metadata alone and is left as deliberate `todo!()` stubs rather than
//! invented behavior.

pub mod commands;
pub mod connection;

pub use commands::{CacheDomain, RestServerCommand};
pub use connection::{
    Credentials, DeployOptions, DeployOutcome, DeployProgress, ServerCommError,
    ServerConnection, ServerEndpoint,
};
