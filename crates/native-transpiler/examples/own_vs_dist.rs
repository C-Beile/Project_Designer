// Compares the own engine against the `dist` that the official transpiler already wrote into a
// SCRATCH COPY of a project (no reference run, the original Designer is not needed here). Prints the
// match rate per top-level folder and per file type, and the first differing files of each folder.
//
// Usage: cargo run --release --example own_vs_dist -p differential-harness -- <project_copy> <own_output_dir>

use differential_harness::{compare_trees, FileVerdict, IncrementalEngine, OwnEngine};
use std::collections::BTreeMap;
use std::env;
use std::path::PathBuf;
use std::time::Instant;

fn main() {
    let mut args = env::args().skip(1);
    let project = PathBuf::from(args.next().expect("usage: own_vs_dist <project_copy> <own_output_dir>"));
    let out = PathBuf::from(args.next().expect("usage: own_vs_dist <project_copy> <own_output_dir>"));
    let dist = project.join("dist");

    let started = Instant::now();
    if let Err(e) = IncrementalEngine.run(&project, &out) {
        eprintln!("own engine failed: {e}");
        std::process::exit(1);
    }
    println!("own engine: {:.1} s", started.elapsed().as_secs_f64());

    let report = compare_trees(&dist, &out).expect("comparison failed");
    println!("files: {} | match {} | mismatch {} | only official {} | only own {} | rate {:.2}%", report.total_files, report.matches, report.mismatches, report.only_in_reference, report.only_in_own, report.match_rate_percent());

    let mut by_folder: BTreeMap<String, [usize; 4]> = BTreeMap::new();
    let mut by_ext: BTreeMap<String, [usize; 4]> = BTreeMap::new();
    let mut samples: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for f in &report.files {
        let folder = f.relative_path.split('/').next().unwrap_or("").to_string();
        let ext = f.relative_path.rsplit('.').next().filter(|e| !e.contains('/')).unwrap_or("(none)").to_string();
        let idx = match f.verdict {
            FileVerdict::Match => 0,
            FileVerdict::Mismatch { .. } => 1,
            FileVerdict::OnlyInReference => 2,
            FileVerdict::OnlyInOwn => 3,
        };
        by_folder.entry(folder.clone()).or_default()[idx] += 1;
        by_ext.entry(ext).or_default()[idx] += 1;
        if idx != 0 {
            let list = samples.entry(folder).or_default();
            if list.len() < 4 {
                list.push(format!("{} {:?}", f.relative_path, f.verdict));
            }
        }
    }
    println!("\n== per folder: match / mismatch / only official / only own");
    for (k, v) in &by_folder {
        let total = v.iter().sum::<usize>();
        println!("{k:28} {:>6} {:>6} {:>6} {:>6}  ({:.1}%)", v[0], v[1], v[2], v[3], v[0] as f64 * 100.0 / total as f64);
    }
    println!("\n== per extension");
    for (k, v) in &by_ext {
        let total = v.iter().sum::<usize>();
        if total >= 20 {
            println!("{k:12} {:>6} {:>6} {:>6} {:>6}  ({:.1}%)", v[0], v[1], v[2], v[3], v[0] as f64 * 100.0 / total as f64);
        }
    }
    println!("\n== samples");
    for (k, v) in &samples {
        for s in v {
            println!("[{k}] {s}");
        }
    }
}
