//! P7 qa-integrator: full-corpus round-trip proof.
//!
//! Business goal: Chef-Prompt §7 point 3 requires that, over the WHOLE test corpus, opening
//! and saving an `.aod` file without an edit produces zero diff. This binary is the automated,
//! repeatable check for that claim, run against every real ADITO project available on this
//! machine (not just the Hermes/FZ_Juerlich subset most P3-P5 agents used).
//!
//! Read-only guarantee: this program only ever calls `std::fs::read` on files under the
//! corpus root. `aod_io::round_trip_check` parses and re-serializes purely in memory and
//! never touches disk itself. Nothing under the corpus root is written, renamed or deleted.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

struct ProjectResult {
    name: String,
    tested: usize,
    matched: usize,
    failures: Vec<(PathBuf, String)>,
}

fn is_excluded(path: &Path) -> bool {
    // node_modules/dist hold copies of, or transpiler output derived from, the same source
    // .aod files already covered under the project root - testing them again would double
    // count and (for dist/) is not even the right artifact type for this proof.
    path.components().any(|c| {
        let s = c.as_os_str().to_string_lossy();
        s == "node_modules" || s == "dist" || s == ".forge-incremental-cache" || s == "target"
    })
}

fn find_aod_files(root: &Path) -> Vec<PathBuf> {
    walkdir::WalkDir::new(root)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .map(|e| e.into_path())
        .filter(|p| {
            p.extension().map(|ext| ext == "aod").unwrap_or(false) && !is_excluded(p)
        })
        .collect()
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let corpus_root = args
        .get(1)
        .cloned()
        .unwrap_or_else(|| r"C:\Users\ClemensBeile\Desktop\GitRepos_ADITO".to_string());
    let corpus_root = PathBuf::from(corpus_root);

    let projects: Vec<PathBuf> = fs::read_dir(&corpus_root)
        .expect("cannot read corpus root")
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();

    let mut results = Vec::new();
    let started = Instant::now();

    for project_dir in &projects {
        let name = project_dir
            .file_name()
            .unwrap()
            .to_string_lossy()
            .to_string();
        let files = find_aod_files(project_dir);
        let mut matched = 0usize;
        let mut failures = Vec::new();

        for file in &files {
            match fs::read(file) {
                Ok(bytes) => match aod_io::round_trip_check(&bytes) {
                    Ok(()) => matched += 1,
                    Err(diag) => failures.push((file.clone(), diag)),
                },
                Err(e) => failures.push((file.clone(), format!("read error: {e}"))),
            }
        }

        results.push(ProjectResult {
            name,
            tested: files.len(),
            matched,
            failures,
        });
    }

    let elapsed = started.elapsed();
    let total_tested: usize = results.iter().map(|r| r.tested).sum();
    let total_matched: usize = results.iter().map(|r| r.matched).sum();

    println!("# P7 qa-integrator: full-corpus round-trip report");
    println!();
    println!("Corpus root: {}", corpus_root.display());
    println!("Elapsed: {:.2}s", elapsed.as_secs_f64());
    println!();
    println!("| Project | Tested | Matched | Mismatch |");
    println!("|---|---|---|---|");
    for r in &results {
        println!(
            "| {} | {} | {} | {} |",
            r.name,
            r.tested,
            r.matched,
            r.tested - r.matched
        );
    }
    println!();
    let rate = if total_tested > 0 {
        100.0 * total_matched as f64 / total_tested as f64
    } else {
        0.0
    };
    println!(
        "TOTAL: {} files tested across {} projects, {} matched, {} mismatched ({:.4}% match rate)",
        total_tested,
        results.len(),
        total_matched,
        total_tested - total_matched,
        rate
    );

    let any_failures = results.iter().any(|r| !r.failures.is_empty());
    if any_failures {
        println!();
        println!("## Mismatches (diagnosis)");
        for r in &results {
            for (path, diag) in &r.failures {
                println!("- [{}] {}: {}", r.name, path.display(), diag);
            }
        }
        std::process::exit(1);
    }
}
