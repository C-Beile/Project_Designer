//! `forge transpile` - a thin wrapper around forge_core::transpiler's real
//! `NbexecTranspilerRunner` (the verified `nbexec64.exe --projecthome ...` invocation). Every
//! decision (exit-code interpretation, log-line classification) is forge_core::transpiler's, not
//! this file's - this subcommand only wires arguments in and prints events/outcome out.

use clap::Args;
use forge_core::transpiler::{
    EventSink, NbexecTranspilerRunner, TranspileEvent, TranspilerConfig, TranspilerRunner,
};
use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;

#[derive(Args)]
pub struct TranspileArgs {
    /// Root directory of the ADITO project to transpile (passed through as --projecthome).
    #[arg(long)]
    project: PathBuf,

    /// Root of the ADITO Designer installation providing nbexec64.exe.
    #[arg(long)]
    install_dir: PathBuf,

    /// Scratch userdir/cachedir for this run. Must never be the interactive Designer's own
    /// userdir (that one is locked by the running Designer's own profile).
    #[arg(long)]
    user_dir: PathBuf,

    /// Seconds to wait before the watchdog kills a hung TranspilerCLI process.
    #[arg(long, default_value_t = 300)]
    timeout_secs: u64,
}

pub fn run(args: TranspileArgs) -> ExitCode {
    let config = TranspilerConfig::new(args.install_dir, args.user_dir)
        .with_timeout(Duration::from_secs(args.timeout_secs));
    let runner = NbexecTranspilerRunner::new(config);

    let sink: EventSink = Arc::new(|event| {
        if let TranspileEvent::Log { line, .. } = &event {
            println!("{line}");
        }
    });

    match runner.run(&args.project, sink) {
        Ok(outcome) => {
            if outcome.is_success() {
                println!("transpile succeeded (exit code {:?})", outcome.exit_code);
                ExitCode::SUCCESS
            } else {
                eprintln!("transpile failed: {:?} (exit code {:?})", outcome.outcome, outcome.exit_code);
                ExitCode::FAILURE
            }
        }
        Err(err) => {
            eprintln!("transpile could not be started: {err}");
            ExitCode::FAILURE
        }
    }
}
