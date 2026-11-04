//! Times the Team/Commit dialog's data load on a real project: `git_overview_timing <project>`.

use forge_app_core::git_actions::overview;
use std::path::PathBuf;
use std::time::Instant;

fn main() {
    let project = PathBuf::from(std::env::args().nth(1).expect("usage: git_overview_timing <project>"));
    for round in 1..=2 {
        let start = Instant::now();
        match overview(&project) {
            Ok(o) => println!("round {round}: {} ms, {} files, {} branches, {} commits", start.elapsed().as_millis(), o.files.len(), o.branches.len(), o.commits.len()),
            Err(e) => println!("round {round}: failed after {} ms: {e}", start.elapsed().as_millis()),
        }
    }
}
