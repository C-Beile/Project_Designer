// Schreibt die Ausgabedateien nach `dist`. Nur auf Wunsch (`BuildConfig::materialize_dist`).
// Viele kleine Schreibvorgänge bremst der Virenscanner. Darum: Ordner einmal anlegen, parallel schreiben,
// nur schreiben, was sich geändert hat (gleiche Größe und gleiche Bytes: nicht anfassen).

use std::collections::BTreeSet;
use std::fs;
use std::io;
use std::path::Path;

use rayon::prelude::*;

use crate::pipeline::{Content, OutputFile};

#[derive(Debug, Default, Clone)]
pub struct WriteStats {
    pub written: usize,
    pub unchanged: usize,
    pub failed: usize,
}

pub fn write_dist(files: &[OutputFile], dist: &Path) -> io::Result<WriteStats> {
    // Ordner einmal anlegen, nicht je Datei prüfen.
    let dirs: BTreeSet<&str> = files.iter().filter_map(|f| f.path.rsplit_once('/').map(|(d, _)| d)).collect();
    fs::create_dir_all(dist)?;
    for d in dirs {
        fs::create_dir_all(dist.join(d))?;
    }

    let results: Vec<u8> = files
        .par_iter()
        .map(|f| {
            let target = dist.join(&f.path);
            let bytes: std::borrow::Cow<[u8]> = match &f.content {
                Content::Bytes(b) => std::borrow::Cow::Borrowed(b),
                Content::FromDisk(p) => match fs::read(p) {
                    Ok(b) => std::borrow::Cow::Owned(b),
                    Err(_) => return 2u8,
                },
            };
            if fs::read(&target).is_ok_and(|existing| existing == *bytes) {
                return 1;
            }
            if fs::write(&target, &*bytes).is_ok() {
                0
            } else {
                2
            }
        })
        .collect();

    // Veraltete Dateien aus früheren Läufen entfernen, sonst stimmt `dist` nicht mit der Ausgabe überein.
    let wanted: std::collections::HashSet<&str> = files.iter().map(|f| f.path.as_str()).collect();
    remove_stale(dist, dist, &wanted);

    let mut stats = WriteStats::default();
    for r in results {
        match r {
            0 => stats.written += 1,
            1 => stats.unchanged += 1,
            _ => stats.failed += 1,
        }
    }
    Ok(stats)
}

/// Löscht alles unter `dir`, was nicht in `wanted` steht, und leere Ordner danach. `.index` bleibt (gehört V2).
fn remove_stale(root: &Path, dir: &Path, wanted: &std::collections::HashSet<&str>) -> bool {
    let Ok(entries) = fs::read_dir(dir) else { return true };
    let mut empty = true;
    for entry in entries.flatten() {
        let path = entry.path();
        let rel = path.strip_prefix(root).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or_default();
        if path.is_dir() {
            if rel == ".index" {
                empty = false;
            } else if remove_stale(root, &path, wanted) {
                let _ = fs::remove_dir(&path);
            } else {
                empty = false;
            }
        } else if wanted.contains(rel.as_str()) {
            empty = false;
        } else {
            let _ = fs::remove_file(&path);
        }
    }
    empty
}
