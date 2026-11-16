// Misst Entdecken und Overlay auf einem Projekt (kalt/warm). Kein Schreiben.
//
// Usage: cargo run --release --example overlay_probe -p dito-transpiler -- <projekt>

use dito_transpiler::{BuildConfig, Builder, CancelToken};
use std::env;

fn main() {
    let project = env::args().nth(1).expect("usage: overlay_probe <project>");
    for run in 1..=3 {
        let result = Builder::new(BuildConfig::new(&project)).build(&CancelToken::new()).expect("build failed");
        let s = &result.stats;
        println!(
            "run {run}: modules {} | overlay files {} | ignored {} | discover {:?} | overlay {:?} | total {:?} | notes {}",
            s.modules, s.overlay_files, s.ignored_files, s.discover_time, s.overlay_time, s.total_time, result.diagnostics.len()
        );
    }
}
