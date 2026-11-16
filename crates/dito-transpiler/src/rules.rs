// `.transpilerignore`: welche Dateien eines Moduls nicht in die Ausgabe gehören.
// Syntax wie `.gitignore` (Crate `ignore`). Gilt je Modul, auch im Projekt-Wurzelordner.
// Bekannte Lücke der alten Engine: dort wurde die Datei im Projekt-Wurzelordner nicht angewendet.

use std::path::Path;

use ignore::gitignore::{Gitignore, GitignoreBuilder};

pub const IGNORE_FILE_NAME: &str = ".transpilerignore";

/// Ein Muster ohne Platzhalter und ohne `/` gilt nur ab der Modulwurzel (`data` = der Ordner `data` im Modul-Wurzelordner),
/// nicht in jeder Tiefe wie bei `.gitignore`. Belegt am Orakel: `.liquibase/*/xrm/*/data/*.xml` bleibt trotz `data` in der Liste.
/// Muster mit `*`, `?`, `[` oder `/` bleiben, wie sie sind.
fn anchor(line: &str) -> String {
    let t = line.trim();
    if t.is_empty() || t.starts_with('#') || t.starts_with('!') || t.starts_with('/') || t.contains(['*', '?', '[', '/']) {
        return line.to_string();
    }
    format!("/{t}")
}

/// Eingebaute Vorgabe für jedes Modul (gleich der Vorlage von ADITO). Belegt am Orakel: `README.md`, `.aditoprj`, `.idea`
/// u. a. aus Modulen ohne eigene Liste fehlen in der V2-Ausgabe. Gilt nur ab der Modulwurzel (siehe `anchor`).
const DEFAULT_IGNORE: &[&str] = &[
    ".transpilerignore", ".git", ".gitignore", ".gitattributes", ".gitlab-ci.yml", "README.md", "CHANGELOG.md", ".aditoprj", "data", "dist",
    "others", "scripts", "jsconfig.json", "jsconfig.template.json", ".eslintrc.json", "eslint.config.mjs", "node_modules", "package.json",
    "package-lock.json", ".idea", ".vscode", "cache.txt", "cacheMods.txt", ".netbeans.xml", "cypress.config.ts",
];

pub struct IgnoreRules {
    matcher: Option<Gitignore>,
}

impl IgnoreRules {
    /// Eingebaute Vorgabe plus `<module_root>/.transpilerignore` (falls vorhanden).
    pub fn load(module_root: &Path) -> Self {
        let text = std::fs::read_to_string(module_root.join(IGNORE_FILE_NAME)).unwrap_or_default();
        let mut builder = GitignoreBuilder::new(module_root);
        for pattern in DEFAULT_IGNORE {
            let _ = builder.add_line(None, &anchor(pattern));
        }
        // Zeile für Zeile, ohne `\r`: die Datei hat oft CRLF, und `add` würde das `\r` im Muster lassen.
        // Fehler einzelner Zeilen ignorieren wir: die Zeile fällt weg, der Rest gilt.
        for line in text.lines() {
            let _ = builder.add_line(None, &anchor(line.trim_end_matches('\r')));
        }
        Self { matcher: builder.build().ok() }
    }

    /// `relative` ist der Pfad ab Modulwurzel. Ordner-Treffer gelten auch für alles darunter.
    pub fn is_ignored(&self, relative: &Path, is_dir: bool) -> bool {
        match &self.matcher {
            Some(m) => m.matched_path_or_any_parents(relative, is_dir).is_ignore(),
            None => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn missing_file_uses_only_defaults() {
        let dir = std::env::temp_dir().join("dito-transpiler-ignore-none");
        let _ = fs::create_dir_all(&dir);
        let _ = fs::remove_file(dir.join(IGNORE_FILE_NAME));
        let rules = IgnoreRules::load(&dir);
        assert!(!rules.is_ignored(Path::new("entity/a.aod"), false));
        assert!(rules.is_ignored(Path::new("README.md"), false));
        assert!(!rules.is_ignored(Path::new("doc/README.md"), false));
    }

    #[test]
    fn crlf_file_works() {
        let dir = std::env::temp_dir().join("dito-transpiler-ignore-crlf");
        let _ = fs::create_dir_all(&dir);
        fs::write(dir.join(IGNORE_FILE_NAME), "# Git\r\nREADME.md\r\ndata\r\n").unwrap();
        let rules = IgnoreRules::load(&dir);
        assert!(rules.is_ignored(Path::new("README.md"), false));
        assert!(rules.is_ignored(Path::new("data/x.csv"), false));
    }

    #[test]
    fn folder_pattern_covers_children() {
        let dir = std::env::temp_dir().join("dito-transpiler-ignore-folder");
        let _ = fs::create_dir_all(&dir);
        fs::write(dir.join(IGNORE_FILE_NAME), "cypress/\n*.bak\n").unwrap();
        let rules = IgnoreRules::load(&dir);
        assert!(rules.is_ignored(Path::new("cypress/e2e/a.js"), false));
        assert!(rules.is_ignored(Path::new(".npmrc.bak"), false));
        assert!(!rules.is_ignored(Path::new("entity/a.aod"), false));
    }
}
