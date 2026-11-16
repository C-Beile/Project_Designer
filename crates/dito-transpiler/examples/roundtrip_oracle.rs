// Selbsttest des Writers: Jedes `.aod` des V2-Orakels wird gelesen und wieder geschrieben. Es muss byte-gleich sein,
// denn die V2-Ausgabe ist selbst schon im V2-Format. Abweichungen zeigen fehlende Writer-Regeln.
//
// Usage: cargo run --release --example roundtrip_oracle -p dito-transpiler -- <orakel_dir>

use dito_transpiler::model::{parse::parse, write::write_v2};
use std::env;
use std::fs;
use std::path::Path;

fn collect(dir: &Path, out: &mut Vec<std::path::PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() {
            collect(&p, out);
        } else if p.extension().is_some_and(|x| x == "aod") && !p.to_string_lossy().contains(".index") {
            out.push(p);
        }
    }
}

fn main() {
    let root = std::path::PathBuf::from(env::args().nth(1).expect("usage: roundtrip_oracle <orakel_dir>"));
    let mut files = Vec::new();
    collect(&root, &mut files);
    let (mut same, mut diff, mut failed) = (0, 0, 0);
    let mut shown = 0;
    for f in &files {
        let bytes = fs::read(f).unwrap();
        match parse(&bytes) {
            Err(e) => {
                failed += 1;
                if shown < 5 {
                    println!("parse-Fehler {}: {e}", f.display());
                    shown += 1;
                }
            }
            Ok(doc) => {
                let out = write_v2(&doc);
                if out == bytes {
                    same += 1;
                } else {
                    diff += 1;
                    if shown < 8 {
                        let at = out.iter().zip(bytes.iter()).position(|(a, b)| a != b).unwrap_or(out.len().min(bytes.len()));
                        let ctx = |b: &[u8]| String::from_utf8_lossy(&b[at.saturating_sub(40)..(at + 60).min(b.len())]).replace('\n', "\\n");
                        println!("anders {} bei {at}\n  eigen: {}\n  orakel: {}", f.display(), ctx(&out), ctx(&bytes));
                        shown += 1;
                    }
                }
            }
        }
    }
    println!("{} Modelle: gleich {same} | anders {diff} | nicht lesbar {failed}", files.len());
}
