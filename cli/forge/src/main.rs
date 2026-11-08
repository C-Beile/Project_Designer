//! `forge` - the thin, UI-free command-line shell over `designer-core` (architecture.md §1: "duenne
//! CLI: transpile, validate, deploy - laeuft in CI ohne GUI"). Every subcommand below does
//! nothing but parse arguments, call exactly one `designer-core` entry point, and format the result
//! for the console. No business logic lives here - the grounding rule from architecture.md §1
//! ("jede fachliche Logik liegt in designer-core, niemals in der CLI selbst") applies to every file
//! in this crate.

use clap::{Parser, Subcommand};
use std::process::ExitCode;

mod commands;

#[derive(Parser)]
#[command(
    name = "designer-cli",
    version,
    about = "Headless CLI for the ADITO Forge Designer core (transpile, validate, deploy)"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Runs the official TranspilerCLI against a project (designer_core::transpiler).
    Transpile(commands::transpile::TranspileArgs),
    /// Runs every registered plugin-api validator against a project (designer_core::plugin_api).
    Validate(commands::validate::ValidateArgs),
    /// Deploys a project to a running ADITO server (nicht verfuegbar).
    Deploy(commands::deploy::DeployArgs),
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    match cli.command {
        Command::Transpile(args) => commands::transpile::run(args),
        Command::Validate(args) => commands::validate::run(args),
        Command::Deploy(args) => commands::deploy::run(args),
    }
}
