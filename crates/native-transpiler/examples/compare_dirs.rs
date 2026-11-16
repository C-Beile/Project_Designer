// Compares two finished output folders byte for byte (no engine run).
//
// Usage: cargo run --release --example compare_dirs -p native-transpiler -- <reference_dir> <other_dir> [<skip_top_level_name>...]
// Prints the match rate per top-level folder and the first differing files of each folder.

use native_transpiler::{compare_trees, FileVerdict};
use std::collections::BTreeMap;
use std::env;
use std::path::PathBuf;

fn main() {
    let mut args = env::args().skip(1);
    let reference = PathBuf::from(args.next().expect("usage: compare_dirs <reference_dir> <other_dir> [skip...]"));
    let other = PathBuf::from(args.next().expect("usage: compare_dirs <reference_dir> <other_dir> [skip...]"));
    let skip: Vec<String> = args.collect();

    let report = compare_trees(&reference, &other).expect("comparison failed");
    let mut by_folder: BTreeMap<String, [usize; 4]> = BTreeMap::new();
    let mut samples: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for f in &report.files {
        let folder = f.relative_path.split('/').next().unwrap_or("").to_string();
        if skip.contains(&folder) {
            continue;
        }
        let idx = match f.verdict {
            FileVerdict::Match => 0,
            FileVerdict::Mismatch { .. } => 1,
            FileVerdict::OnlyInReference => 2,
            FileVerdict::OnlyInOwn => 3,
        };
        by_folder.entry(folder.clone()).or_default()[idx] += 1;
        if idx != 0 {
            let list = samples.entry(folder).or_default();
            if list.len() < 50 {
                list.push(format!("{} {:?}", f.relative_path, f.verdict));
            }
        }
    }
    let mut total = [0usize; 4];
    println!("folder                       match mismatch only-ref only-other");
    for (k, v) in &by_folder {
        println!("{k:28} {:>6} {:>8} {:>8} {:>10}", v[0], v[1], v[2], v[3]);
        for i in 0..4 {
            total[i] += v[i];
        }
    }
    let all: usize = total.iter().sum();
    println!("{:28} {:>6} {:>8} {:>8} {:>10}  ({:.2}% match)", "TOTAL", total[0], total[1], total[2], total[3], total[0] as f64 * 100.0 / all.max(1) as f64);
    println!("\n== samples");
    for (k, v) in &samples {
        for s in v {
            println!("[{k}] {s}");
        }
    }
}
