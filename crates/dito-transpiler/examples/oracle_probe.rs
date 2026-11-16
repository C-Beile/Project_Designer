// Vergleicht das Overlay (Quellen aller Module) mit der Ausgabe des V2-Orakels.
// Zeigt, welche Dateien V2 unverändert, nur mit LF/COMPACT oder gar nicht ausgibt.
//
// Usage: cargo run --release --example oracle_probe -p dito-transpiler -- <projekt> <orakel_dir>

use dito_transpiler::discover::discover_modules;
use dito_transpiler::format::v2;
use dito_transpiler::overlay::Overlay;
use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::Path;

fn walk(root: &Path, dir: &Path, out: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() {
            walk(root, &p, out);
        } else if let Ok(rel) = p.strip_prefix(root) {
            out.push(rel.to_string_lossy().replace('\\', "/"));
        }
    }
}

fn group(rel: &str) -> String {
    let first = rel.split('/').next().unwrap_or("");
    let ext = rel.rsplit('.').next().filter(|e| !e.contains('/')).unwrap_or("-");
    format!("{first} .{ext}")
}

fn main() {
    let mut args = env::args().skip(1);
    let project = args.next().expect("usage: oracle_probe <project> <oracle_dir>");
    let oracle = std::path::PathBuf::from(args.next().expect("usage: oracle_probe <project> <oracle_dir>"));

    let modules = discover_modules(Path::new(&project)).expect("discover");
    let overlay = Overlay::build(&modules);

    let mut oracle_files = Vec::new();
    walk(&oracle, &oracle, &mut oracle_files);

    // [gleiche Bytes, nur LF/COMPACT, anders, nur im Orakel]
    let mut table: BTreeMap<String, [usize; 4]> = BTreeMap::new();
    let mut samples: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut no_link: BTreeMap<String, usize> = BTreeMap::new();
    for rel in &oracle_files {
        let g = group(rel);
        let row = table.entry(g.clone()).or_default();
        let Some(source) = overlay.get(rel) else {
            row[3] += 1;
            let list = samples.entry(format!("{g} nur im Orakel")).or_default();
            if list.len() < 3 {
                list.push(rel.clone());
            }
            continue;
        };
        let (Ok(src), Ok(ora)) = (fs::read(&source.path), fs::read(oracle.join(rel))) else { continue };
        if src == ora {
            row[0] += 1;
        } else if rel.ends_with(".aod") && v2::to_v2_bytes(&src) == ora {
            row[1] += 1;
        } else {
            row[2] += 1;
            // Ohne Verweis `%aditoprj%` kommt der Unterschied nicht von verknüpften Dateien (P2), sondern von Merge (P3) oder Format.
            let has_link = src.windows(10).any(|w| w == b"%aditoprj%");
            let key = if has_link { format!("{g} anders") } else { format!("{g} anders OHNE Verweis") };
            if !has_link {
                *no_link.entry(g.clone()).or_default() += 1;
            }
            let list = samples.entry(key).or_default();
            if list.len() < 4 {
                list.push(rel.clone());
            }
        }
    }

    println!("{:28} {:>7} {:>9} {:>7} {:>11}", "ordner .endung", "gleich", "LF+COMPACT", "anders", "nur Orakel");
    let mut total = [0usize; 4];
    for (g, v) in &table {
        println!("{g:28} {:>7} {:>9} {:>7} {:>11}", v[0], v[1], v[2], v[3]);
        for i in 0..4 {
            total[i] += v[i];
        }
    }
    println!("{:28} {:>7} {:>9} {:>7} {:>11}", "SUMME", total[0], total[1], total[2], total[3]);

    println!("\n== 'anders' ohne Verweis auf verknüpfte Dateien (Merge oder Format)");
    for (g, n) in &no_link {
        println!("{g:28} {n:>7}");
    }

    // Dateien, die das Overlay hat, das Orakel aber nicht.
    let oracle_set: std::collections::HashSet<&String> = oracle_files.iter().collect();
    let mut dropped: BTreeMap<String, usize> = BTreeMap::new();
    let mut dropped_samples: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for (rel, source) in overlay.iter() {
        if !oracle_set.contains(rel) {
            let g = group(rel);
            *dropped.entry(g.clone()).or_default() += 1;
            let list = dropped_samples.entry(g).or_default();
            if list.len() < 2 {
                list.push(format!("{rel} (aus {})", modules[source.module].name));
            }
        }
    }
    println!("\n== im Overlay, aber nicht im Orakel (V2 lässt sie weg)");
    for (g, n) in &dropped {
        println!("{g:28} {n:>7}   z. B. {}", dropped_samples[g].join(" | "));
    }
    println!("\n== Beispiele");
    for (k, list) in &samples {
        println!("[{k}] {}", list.join(" | "));
    }
}
