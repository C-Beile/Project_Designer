// Prüft den Cache an einem echten Projekt (am besten an einer Kopie, die Datei werden kurz verändert und danach zurückgesetzt):
//  1. ohne Cache bauen (Referenz)
//  2. mit Cache: erster Lauf (Fehlschlag, Cache wird geschrieben), zweiter Lauf (Treffer, gleich der Referenz, Zeit)
//  3. N Skripte ändern: der Lauf muss das neue Ergebnis liefern, gleich einem frischen Bau ohne Cache
//  4. Danach Cache wieder warm (nach dem Racy-Fenster) und Treffer prüfen
//
// Usage: cargo run --release --example cache_check -p dito-transpiler -- <projekt> [anzahl_änderungen]

use dito_transpiler::{BuildConfig, BuildResult, Builder, CancelToken};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use xxhash_rust::xxh3::Xxh3;

/// Prüfsumme über alle Ausgabedateien (Pfad und Inhalt).
fn digest(result: &BuildResult) -> u64 {
    let mut h = Xxh3::new();
    for f in result.files.iter() {
        h.update(f.path.as_bytes());
        match &f.content {
            dito_transpiler::pipeline::Content::Bytes(b) => h.update(b),
            dito_transpiler::pipeline::Content::FromDisk(p) => h.update(&fs::read(p).unwrap_or_default()),
        };
    }
    h.digest()
}

fn run(project: &Path, cache: Option<&Path>) -> (BuildResult, Duration) {
    let mut config = BuildConfig::new(project);
    config.cache_file = cache.map(Path::to_path_buf);
    let started = Instant::now();
    let mut result = Builder::new(config).build(&CancelToken::new()).expect("build");
    let elapsed = started.elapsed();
    result.wait_for_cache();
    (result, elapsed)
}

fn scripts(root: &Path, out: &mut Vec<PathBuf>, depth: usize) {
    let Ok(entries) = fs::read_dir(root) else { return };
    for e in entries.flatten() {
        let p = e.path();
        let name = e.file_name().to_string_lossy().into_owned();
        if p.is_dir() {
            if depth < 6 && name != ".git" && name != "dist" && !name.starts_with("dist_") {
                scripts(&p, out, depth + 1);
            }
        } else if name == "process.js" || name == "valueProcess.js" {
            out.push(p);
        }
    }
}

fn main() {
    let project = PathBuf::from(env::args().nth(1).expect("usage: cache_check <projekt> [anzahl]"));
    let count: usize = env::args().nth(2).and_then(|s| s.parse().ok()).unwrap_or(50);
    let cache = env::temp_dir().join("dito-transpiler-cache-check.bin");
    let _ = fs::remove_file(&cache);

    let (reference, t_ref) = run(&project, None);
    let reference_digest = digest(&reference);
    println!("1. ohne Cache:           {:>8.2?}  {} Dateien", t_ref, reference.files.len());

    let (mut first, t_first) = run(&project, Some(&cache));
    first.wait_for_cache();
    println!("2a. Cache, 1. Lauf:      {:>8.2?}  Treffer: {}  Cache-Datei: {} MB", t_first, first.stats.cache_hit, fs::metadata(&cache).map_or(0, |m| m.len()) / 1_000_000);
    let (second, t_second) = run(&project, Some(&cache));
    println!("2b. Cache, 2. Lauf:      {:>8.2?}  Treffer: {}  (Laden {:?})  gleich Referenz: {}", t_second, second.stats.cache_hit, second.stats.cache_time, digest(&second) == reference_digest);

    // N Skripte ändern.
    let mut all = Vec::new();
    scripts(&project, &mut all, 0);
    all.sort();
    let step = (all.len() / count.max(1)).max(1);
    let chosen: Vec<PathBuf> = all.iter().step_by(step).take(count).cloned().collect();
    let originals: Vec<(PathBuf, Vec<u8>)> = chosen.iter().map(|p| (p.clone(), fs::read(p).unwrap())).collect();
    for (p, original) in &originals {
        let mut changed = original.clone();
        changed.extend_from_slice(b"\n// cache-check\n");
        fs::write(p, changed).unwrap();
    }
    println!("3.  {} Skripte geändert", originals.len());

    let (fresh, t_fresh) = run(&project, None);
    let fresh_digest = digest(&fresh);
    let (after, t_after) = run(&project, Some(&cache));
    println!("3a. Cache nach Änderung: {:>8.2?}  Treffer: {} (muss false sein)  gleich frischem Bau: {}  Ergebnis geändert: {}", t_after, after.stats.cache_hit, digest(&after) == fresh_digest, fresh_digest != reference_digest);
    println!("    frischer Bau ohne Cache: {:>8.2?}", t_fresh);

    // Racy-Fenster abwarten, dann warm und Treffer.
    std::thread::sleep(Duration::from_millis(3500));
    let (_warm, _) = run(&project, Some(&cache));
    let (hit, t_hit) = run(&project, Some(&cache));
    println!("4.  Cache nach Änderung, warm: {:>8.2?}  Treffer: {}  gleich frischem Bau: {}", t_hit, hit.stats.cache_hit, digest(&hit) == fresh_digest);

    // Zurücksetzen.
    for (p, original) in &originals {
        fs::write(p, original).unwrap();
    }
    std::thread::sleep(Duration::from_millis(3500));
    let (restored, _) = run(&project, Some(&cache));
    println!("5.  zurückgesetzt:       Treffer: {} (muss false sein)  gleich Referenz: {}", restored.stats.cache_hit, digest(&restored) == reference_digest);
    let _ = fs::remove_file(&cache);
}
