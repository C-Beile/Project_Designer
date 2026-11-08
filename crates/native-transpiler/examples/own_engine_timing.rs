// perf-guard (P7) measurement helper: times the own Rust transpiler engine (IncrementalEngine)
// alone, without running the reference (official) transpiler in the same process - the
// DifferentialHarness always runs both back-to-back, which would make an own-engine-only
// duration impossible to isolate externally. This example calls the same `OwnEngine::run` entry
// point the harness uses, wrapped in a timer, nothing else changed.
//
// project_home MUST be a scratch copy (this stage writes a manifest + snapshot cache into
// project_home, see incremental_stage.rs) - never point this at GitRepos_ADITO.
//
// Usage: cargo run --release --example own_engine_timing -p native-transpiler -- <project_home> <output_dir>

use native_transpiler::{IncrementalEngine, OwnEngine};
use std::env;
use std::path::PathBuf;
use std::time::Instant;

fn main() {
    let mut args = env::args().skip(1);
    let project_home = PathBuf::from(args.next().expect("usage: own_engine_timing <project_home> <output_dir>"));
    let output_dir = PathBuf::from(args.next().expect("usage: own_engine_timing <project_home> <output_dir>"));

    let engine = IncrementalEngine;
    let start = Instant::now();
    let result = engine.run(&project_home, &output_dir);
    let elapsed = start.elapsed();

    match result {
        Ok(()) => println!(
            "own engine ({}) OK: elapsed = {:.3} s ({} ms)",
            engine.name(),
            elapsed.as_secs_f64(),
            elapsed.as_millis()
        ),
        Err(e) => {
            println!("own engine FAILED after {:.3} s: {e}", elapsed.as_secs_f64());
            std::process::exit(1);
        }
    }
}
