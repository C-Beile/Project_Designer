// Hardening run (rc2): real-corpus load / round-trip / navigator / properties / problems sweep.
// Read-only: every file is only read; run it against COPIES of the corpus projects.
// Usage: cargo run --release --example hardening_corpus -p forge-app-core -- <project_root>

use forge_app_core::catalog::{load_catalog, Catalog};
use forge_app_core::project_actor::ProjectActorHandle;
use std::collections::BTreeMap;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

fn skip(p: &Path) -> bool {
    p.components().any(|c| {
        let s = c.as_os_str().to_string_lossy();
        s == "node_modules" || s == "dist" || s == ".git"
    })
}

fn count(nodes: &[forge_app_core::tree::TreeNode]) -> usize {
    nodes.iter().map(|n| 1 + count(&n.children)).sum()
}

fn flatten<'a>(nodes: &'a [forge_app_core::catalog::sheet::NavNode], out: &mut Vec<&'a str>) {
    for n in nodes {
        if let Some(p) = &n.path {
            out.push(p);
        }
        flatten(&n.children, out);
    }
}

fn main() {
    let root = PathBuf::from(std::env::args().nth(1).expect("project root"));
    let t0 = Instant::now();
    let actor = ProjectActorHandle::spawn();
    let tree = catch_unwind(AssertUnwindSafe(|| actor.scan_tree(root.clone())));
    let scan_ms = t0.elapsed().as_millis();
    match &tree {
        Ok(Ok(n)) => println!("scan_tree: {} nodes total, {} ms", count(n), scan_ms),
        other => println!("scan_tree FAILED: {:?}", other.as_ref().map(|r| r.as_ref().err())),
    }

    let catalog: Option<Arc<Catalog>> = forge_app_core::settings::detect_designer_install()
        .and_then(|d| load_catalog(Path::new(&d), None).ok())
        .map(Arc::new);
    println!("catalog: {}", if catalog.is_some() { "loaded" } else { "MISSING" });

    let files: Vec<PathBuf> = walk(&root).into_iter().filter(|p| p.extension().map_or(false, |e| e == "aod") && !skip(p)).collect();
    println!("aod files (excl. node_modules/dist): {}", files.len());

    let mut rt_fail = Vec::new();
    let mut by_ext: BTreeMap<&str, usize> = BTreeMap::new();
    let t = Instant::now();
    for f in &files {
        let bytes = std::fs::read(f).unwrap();
        match catch_unwind(|| aod_io::round_trip_check(&bytes)) {
            Ok(Ok(())) => {}
            Ok(Err(e)) => rt_fail.push((f.clone(), e)),
            Err(_) => rt_fail.push((f.clone(), "PANIC".into())),
        }
    }
    println!("roundtrip: {} files, {} mismatches, {} ms", files.len(), rt_fail.len(), t.elapsed().as_millis());
    for (f, e) in rt_fail.iter().take(10) {
        println!("  RT-FAIL {} :: {}", f.display(), e);
    }

    let (mut open_err, mut nav_err, mut sheet_err, mut diag_err, mut panics) = (vec![], vec![], vec![], vec![], 0usize);
    let (mut nav_nodes, mut sheets) = (0usize, 0usize);
    let (mut t_open, mut t_nav, mut t_sheet, mut t_diag) = (0u128, 0u128, 0u128, 0u128);
    let mut worst = (0u128, String::new());
    for f in &files {
        let id = f.to_string_lossy().replace(std::path::MAIN_SEPARATOR, "/");
        *by_ext.entry("aod").or_default() += 1;
        let r = catch_unwind(AssertUnwindSafe(|| {
            let t = Instant::now();
            let o = actor.get_property_tree(id.clone());
            t_open += t.elapsed().as_millis();
            if let Err(e) = o {
                open_err.push((id.clone(), e));
                return;
            }
            let t = Instant::now();
            let nav = actor.navigator(id.clone());
            t_nav += t.elapsed().as_millis();
            let mut paths: Vec<String> = vec!["$".into()];
            match nav {
                Ok(n) => {
                    let mut v = Vec::new();
                    flatten(&n, &mut v);
                    nav_nodes += v.len();
                    paths.extend(v.into_iter().map(String::from));
                }
                Err(e) => nav_err.push((id.clone(), e)),
            }
            let t = Instant::now();
            for p in &paths {
                sheets += 1;
                if let Err(e) = actor.property_sheet(id.clone(), p.clone(), catalog.clone()) {
                    sheet_err.push((format!("{id} @ {p}"), e));
                }
            }
            let el = t.elapsed().as_millis();
            t_sheet += el;
            if el > worst.0 {
                worst = (el, id.clone());
            }
            let t = Instant::now();
            if let Err(e) = actor.list_diagnostics(id.clone()) {
                diag_err.push((id.clone(), e));
            }
            t_diag += t.elapsed().as_millis();
        }));
        if r.is_err() {
            panics += 1;
        }
    }
    println!("objects processed: {}, nav paths: {}, sheets built: {}", files.len(), nav_nodes, sheets);
    println!("time ms: open {} nav {} sheets {} diagnostics {}; slowest object sheets {} ms {}", t_open, t_nav, t_sheet, t_diag, worst.0, worst.1);
    for (name, v) in [("OPEN", &open_err), ("NAV", &nav_err), ("SHEET", &sheet_err), ("DIAG", &diag_err)] {
        println!("{} errors: {}", name, v.len());
        let mut kinds: BTreeMap<String, usize> = BTreeMap::new();
        for (_, e) in v.iter() {
            *kinds.entry(e.chars().take(90).collect()).or_default() += 1;
        }
        for (k, n) in kinds.iter().take(8) {
            println!("   {n}x {k}");
        }
        if let Some((f, _)) = v.first() {
            println!("   e.g. {f}");
        }
    }
    println!("panics caught: {panics}");

    let t = Instant::now();
    let probs = forge_app_core::problems::scan_project(&root);
    println!("problems scan: {} problems, {} ms", probs.len(), t.elapsed().as_millis());
    let mut kinds: BTreeMap<String, usize> = BTreeMap::new();
    for p in &probs {
        *kinds.entry(format!("{:?}", p.severity)).or_default() += 1;
    }
    println!("   by severity: {kinds:?}");
    let pid = std::process::id();
    let out = std::process::Command::new("powershell")
        .args(["-NoProfile", "-Command", &format!("(Get-Process -Id {pid}).PeakWorkingSet64/1MB")])
        .output();
    if let Ok(o) = out {
        println!("peak working set MB: {}", String::from_utf8_lossy(&o.stdout).trim());
    }
    println!("total {} ms", t0.elapsed().as_millis());
}

fn walk(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            if skip(&p) {
                continue;
            }
            if p.is_dir() {
                stack.push(p)
            } else {
                out.push(p)
            }
        }
    }
    out
}
