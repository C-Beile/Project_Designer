// Compares the COMPACT form of the own engine output against a reference folder in COMPACT form.
//
// Usage: cargo run --release --example compact_vs_dist -p deploy -- <own_output_dir> <reference_compact_dir>
//
// For every model of the own output (<folder>/<name>/<name>.aod) the deploy encoder builds the COMPACT text
// (linked files written into the elements). It is compared with the same file in the reference folder, once
// byte for byte and once with CRLF treated as LF.

use deploy::deploy_encode::{encode_model, MODEL_KINDS};
use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::PathBuf;

fn first_diff(a: &[u8], b: &[u8]) -> usize {
    a.iter().zip(b.iter()).position(|(x, y)| x != y).unwrap_or(a.len().min(b.len()))
}

fn context(bytes: &[u8], at: usize) -> String {
    let from = at.saturating_sub(60);
    let to = (at + 80).min(bytes.len());
    String::from_utf8_lossy(&bytes[from..to]).replace('\r', "\\r").replace('\n', "\\n")
}

fn main() {
    let mut args = env::args().skip(1);
    let own = PathBuf::from(args.next().expect("usage: compact_vs_dist <own_output_dir> <reference_dir>"));
    let reference = PathBuf::from(args.next().expect("usage: compact_vs_dist <own_output_dir> <reference_dir>"));

    // [exact, same ignoring CR, different, missing in reference, encode error]
    let mut by_folder: BTreeMap<&str, [usize; 5]> = BTreeMap::new();
    let mut samples: BTreeMap<&str, Vec<String>> = BTreeMap::new();

    for (folder, _) in MODEL_KINDS {
        let Ok(entries) = fs::read_dir(own.join(folder)) else { continue };
        let mut names: Vec<String> = entries.flatten().filter(|e| e.path().is_dir()).map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        for name in names {
            let main = own.join(folder).join(&name).join(format!("{name}.aod"));
            if !main.is_file() {
                continue;
            }
            let row = by_folder.entry(folder).or_default();
            let ref_file = reference.join(folder).join(&name).join(format!("{name}.aod"));
            let Ok(ref_bytes) = fs::read(&ref_file) else {
                row[3] += 1;
                continue;
            };
            let encoded = match encode_model(&own, &main) {
                Ok(text) => text,
                Err(e) => {
                    row[4] += 1;
                    samples.entry(folder).or_default().push(format!("{name}: encode error {e}"));
                    continue;
                }
            };
            let mine = encoded.as_bytes();
            if mine == ref_bytes.as_slice() {
                row[0] += 1;
                continue;
            }
            let strip = |b: &[u8]| -> Vec<u8> { b.iter().copied().filter(|c| *c != b'\r').collect() };
            let (a, b) = (strip(mine), strip(&ref_bytes));
            if a == b {
                row[1] += 1;
            } else {
                row[2] += 1;
                let list = samples.entry(folder).or_default();
                if list.len() < 3 {
                    let at = first_diff(&a, &b);
                    list.push(format!("{name}: first diff at {at} (own {} / ref {} bytes)\n    own: {}\n    ref: {}", a.len(), b.len(), context(&a, at), context(&b, at)));
                }
            }
        }
    }

    println!("folder                    exact  same-ignoring-CR  different  not-in-ref  error");
    let mut total = [0usize; 5];
    for (folder, v) in &by_folder {
        println!("{folder:24} {:>6} {:>17} {:>10} {:>11} {:>6}", v[0], v[1], v[2], v[3], v[4]);
        for i in 0..5 {
            total[i] += v[i];
        }
    }
    println!("{:24} {:>6} {:>17} {:>10} {:>11} {:>6}", "TOTAL", total[0], total[1], total[2], total[3], total[4]);
    println!("\n== samples");
    for (folder, list) in &samples {
        for s in list {
            println!("[{folder}] {s}");
        }
    }
}
