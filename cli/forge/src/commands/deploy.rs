//! `forge deploy` - honest placeholder. `forge_core::server_comm`'s `deploy`/`poll_progress`/
//! `send_command` are `todo!()` (RISKS.md R15: the ADITO server's deploy wire protocol - concrete
//! endpoints/paths/payloads/status mechanism - is only partially reverse-engineered; only the
//! verified `DeployCLI` option set and the transport shape are known). Calling into those methods
//! would panic rather than fail gracefully, so this subcommand reports the gap instead of
//! simulating a deploy.

use clap::Args;
use std::path::PathBuf;
use std::process::ExitCode;

#[derive(Args)]
pub struct DeployArgs {
    /// Root directory of the ADITO project that would be deployed.
    #[arg(long)]
    project: PathBuf,

    /// Server alias/config name that would be targeted (accepted for forward compatibility with
    /// the real implementation's future CLI surface; unused until R15 is resolved).
    #[arg(long)]
    server_config: Option<String>,
}

pub fn run(args: DeployArgs) -> ExitCode {
    let _ = args.server_config;
    eprintln!(
        "forge deploy: not yet implemented, see RISKS.md R15 (server-comm's deploy wire protocol \
         is only partially verified - deploy()/poll_progress()/send_command() are still todo!() \
         in forge_core::server_comm). Project was: {}",
        args.project.display()
    );
    ExitCode::from(2)
}
