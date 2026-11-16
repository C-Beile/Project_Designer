// Baut das Projekt mit dem neuen Crate, schreibt `dist` und vergleicht es Byte für Byte mit dem V2-Orakel.
//
// Usage: cargo run --release --example compare_out -p dito-transpiler -- <projekt> <orakel_dir> <ausgabe_dir>
// Ausgabe: Tabelle je Ordner und Endung (gleich / anders / fehlt bei uns / zu viel bei uns), Beispiele, Zeiten.

use dito_transpiler::{BuildConfig, Builder, CancelToken};
use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

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
    // `.index` wird von V2 selbst erzeugt und gehört nicht zur Ausgabe.
    format!("{first} .{ext}")
}

fn first_diff_signature(own: &[u8], oracle: &[u8]) -> String {
    let (a, b) = (String::from_utf8_lossy(own), String::from_utf8_lossy(oracle));
    let (mut la, mut lb) = (a.lines(), b.lines());
    loop {
        match (la.next(), lb.next()) {
            (Some(x), Some(y)) if x == y => continue,
            (x, y) => {
                let cut = |t: Option<&str>| t.map(|t| t.trim().chars().take(48).collect::<String>()).unwrap_or_else(|| "<Ende>".into());
                return format!("{} || {}", cut(x), cut(y));
            }
        }
    }
}

fn main() {
    let mut args = env::args().skip(1);
    let project = args.next().expect("usage: compare_out <projekt> <orakel_dir> <ausgabe_dir>");
    let oracle = PathBuf::from(args.next().expect("orakel_dir"));
    let out = PathBuf::from(args.next().expect("ausgabe_dir"));

    let mut config = BuildConfig::new(&project);
    config.materialize_dist = Some(out.clone());
    let result = Builder::new(config).build(&CancelToken::new()).expect("build failed");
    let s = &result.stats;
    println!(
        "Zeiten: entdecken {:?} | overlay {:?} | planen {:?} | schreiben {:?} | gesamt {:?}",
        s.discover_time, s.overlay_time, s.plan_time, s.write_time, s.total_time
    );
    println!("Dateien: {} geplant | {} geschrieben | {} unverändert | {} Fehler", s.output_files, s.written, s.unchanged, s.write_failed);

    let (mut a, mut b) = (Vec::new(), Vec::new());
    walk(&oracle, &oracle, &mut a);
    walk(&out, &out, &mut b);
    let b_set: std::collections::HashSet<&String> = b.iter().collect();
    let a_set: std::collections::HashSet<&String> = a.iter().collect();

    // [gleich, anders, fehlt bei uns, zu viel bei uns]
    let mut table: BTreeMap<String, [usize; 4]> = BTreeMap::new();
    let mut samples: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut signatures: BTreeMap<String, (usize, String)> = BTreeMap::new();
    for rel in &a {
        let row = table.entry(group(rel)).or_default();
        if !b_set.contains(rel) {
            row[2] += 1;
            continue;
        }
        if fs::read(oracle.join(rel)).ok() == fs::read(out.join(rel)).ok() {
            row[0] += 1;
        } else {
            row[1] += 1;
            let list = samples.entry(group(rel)).or_default();
            if list.len() < 3 {
                list.push(rel.clone());
            }
            if rel.ends_with(".aod") {
                if let (Ok(o), Ok(m)) = (fs::read(oracle.join(rel)), fs::read(out.join(rel))) {
                    let sig = first_diff_signature(&m, &o);
                    let e = signatures.entry(sig).or_insert((0, rel.clone()));
                    e.0 += 1;
                }
            }
        }
    }
    for rel in &b {
        if !a_set.contains(rel) {
            table.entry(group(rel)).or_default()[3] += 1;
        }
    }

    println!("\n{:28} {:>7} {:>7} {:>9} {:>9}", "ordner .endung", "gleich", "anders", "fehlt", "zu viel");
    let mut total = [0usize; 4];
    for (g, v) in &table {
        println!("{g:28} {:>7} {:>7} {:>9} {:>9}", v[0], v[1], v[2], v[3]);
        for i in 0..4 {
            total[i] += v[i];
        }
    }
    let all: usize = total[0] + total[1] + total[2];
    println!("{:28} {:>7} {:>7} {:>9} {:>9}   ({:.2} % der Orakel-Dateien gleich)", "SUMME", total[0], total[1], total[2], total[3], total[0] as f64 * 100.0 / all.max(1) as f64);
    println!("\n== Häufigste erste Abweichung in .aod (eigene Zeile || Orakel-Zeile)");
    let mut sigs: Vec<_> = signatures.iter().collect();
    sigs.sort_by(|a, b| b.1 .0.cmp(&a.1 .0));
    for (sig, (n, example)) in sigs.iter().take(30) {
        println!("{n:>5}  {sig}\n         z. B. {example}");
    }
    println!("\n== Beispiele für 'anders'");
    for (g, list) in &samples {
        println!("[{g}] {}", list.join(" | "));
    }
}
