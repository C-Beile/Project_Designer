// perf-guard (P7) measurement helper: times how long the actor's project-tree scan takes
// against a real project, read-only. This is the backend half of "project open time" - the
// chef-prompt DoD criterion talks about opening a project inside the running app, which would
// need a full WebView UI-automation harness to time end-to-end; that was judged too risky/
// expensive to build for one measurement (see perf-guard-report.md), so this example gives an
// honest, clearly-labelled partial answer instead: pure backend scan_tree latency.
//
// Usage: cargo run --release --example scan_tree_timing -p project -- <project_root>
// Read-only: `scan_tree` never writes into the scanned project (verified by inspection of
// tree.rs/project_actor.rs before this example was pointed at a real GitRepos_ADITO project).

use project::project_actor::ProjectActorHandle;
use std::env;
use std::path::PathBuf;
use std::time::Instant;

fn main() {
    let project_root = env::args().nth(1).expect("usage: scan_tree_timing <project_root>");
    let path = PathBuf::from(project_root);

    let actor = ProjectActorHandle::spawn();

    let start = Instant::now();
    let result = actor.scan_tree(path.clone());
    let elapsed = start.elapsed();

    match result {
        Ok(nodes) => {
            if let Some(out) = env::args().nth(2) {
                std::fs::write(out, serde_json::to_string(&nodes).unwrap()).unwrap();
            }
            println!(
                "scan_tree OK: {} top-level nodes, elapsed = {:.3} s ({} ms)",
                nodes.len(),
                elapsed.as_secs_f64(),
                elapsed.as_millis()
            );
        }
        Err(e) => {
            println!("scan_tree FAILED after {:.3} s: {e}", elapsed.as_secs_f64());
            std::process::exit(1);
        }
    }
}
