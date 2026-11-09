//! `forge deploy` - nicht verfuegbar. Das Deploy-Protokoll zum ADITO-Server ist nicht umgesetzt,
//! der Befehl meldet das nur und tut nichts.

use clap::Args;
use std::path::PathBuf;
use std::process::ExitCode;

#[derive(Args)]
pub struct DeployArgs {
    /// Root directory of the ADITO project that would be deployed.
    #[arg(long)]
    project: PathBuf,

    /// Server alias/config name that would be targeted (accepted for forward compatibility with
    /// the real implementation's future CLI surface; currently unused).
    #[arg(long)]
    server_config: Option<String>,
}

pub fn run(args: DeployArgs) -> ExitCode {
    let _ = args.server_config;
    eprintln!("forge deploy: nicht verfuegbar. Project was: {}", args.project.display());
    ExitCode::from(2)
}
