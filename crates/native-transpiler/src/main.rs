// CLI entry point: `cargo run -p native-transpiler -- --project <scratch-project-copy> [...]`
// Thin by design (architecture.md's designer-core pattern) - all logic lives in the library part
// of this crate, this file only wires argv to it and prints/writes the result.

use clap::Parser;
use native_transpiler::{write_report, DifferentialHarness, IncrementalEngine, OwnEngine, RunReport};
use std::path::PathBuf;
use std::time::Duration;
use adito_transpiler::TranspilerConfig;

/// Runs the reference (official) transpiler and the pluggable own-engine against the same
/// project copy and byte-compares their `dist/` output. See PROJECT/20_architecture/
/// p5-native-transpiler-notes.md for the full manual-run guide.
#[derive(Parser, Debug)]
#[command(name = "native-transpiler")]
struct Cli {
    /// Path to a SCRATCH COPY of the ADITO project to test. Must never point into
    /// GitRepos_ADITO - the reference transpiler writes a dist/ folder into this path, which
    /// counts as writing into a read-only project if pointed at an original.
    #[arg(long)]
    project: PathBuf,

    /// Root of the ADITO Designer installation (holds nbexec64.exe etc.). Defaults to the
    /// installation used by every P2/P3 spike and the transpiler crate's own real-subprocess
    /// tests.
    #[arg(long, default_value = r"C:\Users\ClemensBeile\Desktop\ADITO_Designer\Adito_designer\ADITODesigner2026.0.4")]
    install_dir: PathBuf,

    /// Scratch userdir/cachedir for the reference transpiler run. Must already carry the
    /// de.adito.aditoweb.nbm.nodejs plugin seed (see transpiler crate's real_transpiler.rs).
    #[arg(long, default_value = r"C:\Users\ClemensBeile\Desktop\ADITO_Designer\_scratch\p3-transpiler-wrapper\userdir")]
    user_dir: PathBuf,

    /// Where the own engine's output tree is written for comparison. Defaults to a sibling of
    /// the project copy so it is easy to find and never collides with the project's own dist/.
    #[arg(long)]
    own_output_dir: Option<PathBuf>,

    /// Where to write the Markdown report. Defaults next to the project copy.
    #[arg(long)]
    report: Option<PathBuf>,

    /// Cap on how many deviation rows the report lists in full.
    #[arg(long, default_value_t = 50)]
    max_listed_diffs: usize,

    /// Seconds to wait for the reference transpiler before the watchdog kills it. Raise this
    /// for large corpus projects (e.g. Hermes) - the crate default (300s) was observed to be
    /// too tight for a full-project run, see p5-native-transpiler-notes.md.
    #[arg(long, default_value_t = 300)]
    timeout_secs: u64,
}

fn main() -> std::process::ExitCode {
    let cli = Cli::parse();

    let own_output_dir = cli.own_output_dir.clone().unwrap_or_else(|| cli.project.join("_own_engine_dist"));
    // Real-corpus regression found while measuring the `incremental` stage's actual cache-hit
    // rate against Hermes: a default report path INSIDE `project_home` gets rewritten by every
    // single CLI invocation, and `IncrementalEngine`'s manifest walk has no way to know about
    // this harness-CLI-specific artifact (only `own_output_dir`/its own cache dir/the reference
    // `dist/` are excluded, see incremental_stage.rs). Without this, two CLI runs in a row never
    // produce a cache hit even with zero real source changes - a self-inflicted, perpetual
    // cache-miss loop. Defaulting the report to a SIBLING of the project directory (not inside
    // it) avoids the problem at the source instead of teaching the engine about one more
    // CLI-specific filename. `--report` still lets a caller point back inside project_home if
    // they explicitly want that (at their own risk of the same self-invalidation).
    let default_report_name = format!(
        "{}-differential-report.md",
        cli.project.file_name().and_then(|n| n.to_str()).unwrap_or("project")
    );
    let report_path = cli.report.clone().unwrap_or_else(|| match cli.project.parent() {
        Some(parent) => parent.join(&default_report_name),
        None => PathBuf::from(&default_report_name),
    });

    let config = TranspilerConfig::new(cli.install_dir, cli.user_dir).with_timeout(Duration::from_secs(cli.timeout_secs));
    let harness = DifferentialHarness::new(config);
    // Letzte Stage (P5 incremental) - resolver + copy-phase + modification-application (alle
    // unverändert wiederverwendet) plus ein Manifest-Cache für das ganze Projekt (transpiler.md §6;
    // eigenes Design, kein echtes .aditoprj-Cache-Format im Korpus zum Prüfen). Ein Cache-TREFFER
    // nimmt einen Snapshot statt den Ablauf neu zu starten, ein Cache-MISS läuft wie bisher. See
    // PROJECT/20_architecture/p5-incremental-notes.md for the real measured rate.
    let own_engine = IncrementalEngine;

    println!("Running reference transpiler + {} against {} ...", own_engine.name(), cli.project.display());

    match harness.run(&cli.project, &own_engine, &own_output_dir) {
        Ok(result) => {
            let run_report = RunReport {
                project_home: &cli.project,
                reference_dir: &result.reference_dir,
                own_dir: &result.own_dir,
                own_engine_name: own_engine.name(),
                reference_exit_code: result.reference_exit_code,
                comparison: &result.comparison,
                max_listed_diffs: cli.max_listed_diffs,
            };
            if let Err(e) = write_report(&run_report, &report_path) {
                eprintln!("Report generation succeeded in memory but writing to disk failed: {e}");
                return std::process::ExitCode::FAILURE;
            }

            println!(
                "Match rate: {:.2}% ({} / {} files). Report: {}",
                result.comparison.match_rate_percent(),
                result.comparison.matches,
                result.comparison.total_files,
                report_path.display()
            );

            if result.comparison.is_perfect_match() {
                std::process::ExitCode::SUCCESS
            } else {
                // Non-zero exit on a non-perfect match is deliberate: this lets a future CI
                // step gate the engine switch purely on this process's exit code, matching the
                // chef prompt §2.4 "zero deviations" rule without any extra parsing.
                std::process::ExitCode::FAILURE
            }
        }
        Err(e) => {
            eprintln!("Harness run failed: {e}");
            std::process::ExitCode::FAILURE
        }
    }
}
