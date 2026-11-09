// Checks the regular form against a tree of finished build output: every file must come out unchanged.
use std::path::Path;

fn walk(dir: &Path, out: &mut Vec<std::path::PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() {
            walk(&p, out);
        } else if p.extension().is_some_and(|x| x == "aod") {
            out.push(p);
        }
    }
}

fn main() {
    let root = std::env::args().nth(1).expect("dist folder");
    if let Some(reference) = std::env::args().nth(2) {
        let c = aod::document::canonicalize(&std::fs::read(&root).unwrap()).unwrap();
        let r = std::fs::read(&reference).unwrap();
        if c == r {
            println!("canonical(source) == reference");
        } else {
            let at = c.iter().zip(r.iter()).position(|(a, b)| a != b).unwrap_or(c.len().min(r.len()));
            let lo = at.saturating_sub(80);
            println!("DIFFERENT at {at} (canon {} bytes, reference {} bytes)
 canon: {:?}
 ref  : {:?}", c.len(), r.len(), String::from_utf8_lossy(&c[lo..(at + 80).min(c.len())]), String::from_utf8_lossy(&r[lo..(at + 80).min(r.len())]));
        }
        return;
    }
    let mut files = Vec::new();
    walk(Path::new(&root), &mut files);
    let (mut same, mut diff) = (0, 0);
    let mut shown = 0;
    for f in &files {
        let bytes = std::fs::read(f).unwrap();
        match aod::document::canonicalize(&bytes) {
            Ok(c) if c == bytes => same += 1,
            Ok(c) => {
                diff += 1;
                if shown < 6 {
                    shown += 1;
                    let at = c.iter().zip(bytes.iter()).position(|(a, b)| a != b).unwrap_or(c.len().min(bytes.len()));
                    let lo = at.saturating_sub(60);
                    println!("{}: first difference at {at}\n  canon: {:?}\n  file : {:?}", f.display(), String::from_utf8_lossy(&c[lo..(at + 60).min(c.len())]), String::from_utf8_lossy(&bytes[lo..(at + 60).min(bytes.len())]));
                }
            }
            Err(e) => {
                diff += 1;
                println!("{}: {e}", f.display());
            }
        }
    }
    println!("same {same}, different {diff}");
}
