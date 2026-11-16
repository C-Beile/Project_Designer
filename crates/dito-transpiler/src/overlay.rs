// Das Overlay: eine virtuelle Dateiliste über alle Module. Es ersetzt das Kopieren der Module.
// Für jeden relativen Pfad merkt es nur, welche Datei auf der Platte gewinnt. Es liest keine Inhalte.
// Gleicher Pfad in mehreren Modulen: das höhere Modul (laut `merge::order`) gewinnt, der Verlust wird gemeldet.

use std::path::PathBuf;

use indexmap::IndexMap;

use crate::api::{Diagnostic, Severity};
use crate::discover::SourceModule;
use crate::rules::IgnoreRules;

/// Ordner, die nie zu einem Modul gehören.
const SKIP_DIRS: &[&str] = &["node_modules", ".git", "dist", "dist_backup", ".forge-incremental-cache", ".index"];

#[derive(Debug, Clone)]
pub struct FileSource {
    /// Index in der Modul-Liste.
    pub module: usize,
    pub path: PathBuf,
    /// Größe und Änderungszeit (ns seit 1970) beim Lesen der Liste. Daran erkennt der Cache Änderungen, ohne Inhalte zu lesen.
    pub size: u64,
    pub mtime_ns: u64,
}

pub struct Overlay {
    files: IndexMap<String, FileSource>,
    ignored: usize,
    diagnostics: Vec<Diagnostic>,
}

/// Ergebnis des Durchlaufs eines Moduls.
struct ModuleScan {
    files: Vec<(String, FileSource)>,
    ignored: usize,
}

impl Overlay {
    /// `modules` in Modul-Reihenfolge (niedrig zuerst, Projekt zuletzt). Die Module werden parallel durchlaufen,
    /// zusammengesetzt wird danach in Modul-Reihenfolge (die Gewinner-Regel hängt daran).
    pub fn build(modules: &[SourceModule]) -> Self {
        use rayon::prelude::*;
        let scans: Vec<ModuleScan> = modules.par_iter().enumerate().map(|(index, module)| scan_module(index, module)).collect();
        let mut overlay = Overlay { files: IndexMap::new(), ignored: 0, diagnostics: Vec::new() };
        for (index, scan) in scans.into_iter().enumerate() {
            overlay.ignored += scan.ignored;
            for (key, source) in scan.files {
                let path = source.path.clone();
                if let Some(previous) = overlay.files.insert(key.clone(), source) {
                    // Der Eintrag bleibt an seiner alten Stelle, nur die Quelle wechselt (IndexMap::insert).
                    overlay.diagnostics.push(Diagnostic {
                        severity: Severity::Info,
                        message: format!("{key}: Modul '{}' überschreibt eine frühere Quelle", modules[index].name),
                        sources: vec![previous.path, path],
                    });
                }
            }
        }
        overlay
    }

    pub fn len(&self) -> usize {
        self.files.len()
    }

    pub fn is_empty(&self) -> bool {
        self.files.is_empty()
    }

    pub fn ignored_count(&self) -> usize {
        self.ignored
    }

    pub fn diagnostics(&self) -> &[Diagnostic] {
        &self.diagnostics
    }

    pub fn get(&self, relative: &str) -> Option<&FileSource> {
        self.files.get(relative)
    }

    pub fn iter(&self) -> impl Iterator<Item = (&String, &FileSource)> {
        self.files.iter()
    }
}

fn scan_module(index: usize, module: &SourceModule) -> ModuleScan {
    let rules = IgnoreRules::load(&module.root);
    let walker = ignore::WalkBuilder::new(&module.root)
        .standard_filters(false)
        .hidden(false)
        .follow_links(false)
        .filter_entry(|e| {
            // Nur Ordner unterhalb der Wurzel prüfen (Tiefe 0 ist die Wurzel selbst).
            e.depth() == 0 || !e.file_type().is_some_and(|t| t.is_dir()) || !SKIP_DIRS.contains(&e.file_name().to_string_lossy().as_ref())
        })
        .build();
    let mut scan = ModuleScan { files: Vec::new(), ignored: 0 };
    for entry in walker.flatten() {
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        let Ok(relative) = entry.path().strip_prefix(&module.root) else { continue };
        if rules.is_ignored(relative, false) {
            scan.ignored += 1;
            continue;
        }
        let key = relative.to_string_lossy().replace('\\', "/");
        let (size, mtime_ns) = match entry.metadata() {
            Ok(m) => (m.len(), m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |d| d.as_nanos() as u64)),
            Err(_) => (0, 0),
        };
        scan.files.push((key, FileSource { module: index, path: entry.path().to_path_buf(), size, mtime_ns }));
    }
    scan
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn module(root: PathBuf, name: &str, is_project: bool) -> SourceModule {
        SourceModule { name: name.into(), root, is_project }
    }

    #[test]
    fn later_module_wins_and_conflict_is_reported() {
        let base = std::env::temp_dir().join("dito-transpiler-overlay-test");
        let _ = fs::remove_dir_all(&base);
        let (a, b) = (base.join("a"), base.join("b"));
        for dir in [&a, &b] {
            fs::create_dir_all(dir.join("entity")).unwrap();
        }
        fs::write(a.join("entity/x.aod"), "A").unwrap();
        fs::write(b.join("entity/x.aod"), "B").unwrap();
        fs::write(a.join("only-a.txt"), "A").unwrap();
        fs::write(b.join(".transpilerignore"), "skip.txt\n").unwrap();
        fs::write(b.join("skip.txt"), "B").unwrap();

        let overlay = Overlay::build(&[module(a.clone(), "a", false), module(b.clone(), "b", true)]);
        assert_eq!(overlay.get("entity/x.aod").unwrap().module, 1);
        assert_eq!(overlay.get("only-a.txt").unwrap().module, 0);
        assert!(overlay.get("skip.txt").is_none());
        // `skip.txt` (eigene Liste) und `.transpilerignore` selbst (eingebaute Vorgabe).
        assert_eq!(overlay.ignored_count(), 2);
        assert_eq!(overlay.diagnostics().len(), 1);
    }
}
