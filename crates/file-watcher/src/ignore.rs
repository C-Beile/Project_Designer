//! Eine Ignore-Liste für alle: was der Watcher nie melden soll.

use app_base::backup::BUILD_FOLDERS;
use std::path::Path;

/// Ordner, die nie beobachtet werden (außer den Sonderfällen unten).
const ALWAYS_IGNORED: [&str; 3] = ["node_modules", "target", ".claude"];

#[derive(Debug, Clone)]
pub struct IgnoreRules {
    folders: Vec<String>,
}

impl IgnoreRules {
    pub fn standard() -> Self {
        let mut folders: Vec<String> = ALWAYS_IGNORED.iter().map(|s| (*s).to_string()).collect();
        folders.extend(BUILD_FOLDERS.iter().map(|s| (*s).to_string()));
        Self { folders }
    }

    /// True when a top-level or nested folder with this name is ignored.
    pub fn is_ignored_folder_name(&self, name: &str) -> bool {
        name.eq_ignore_ascii_case(".git") || self.folders.iter().any(|f| f.eq_ignore_ascii_case(name))
    }

    /// `rel` is the path inside the project ('/' or '\' separated). `.git/HEAD` and `.git/ORIG_HEAD`
    /// are NOT ignored (they signal a branch switch); everything else in `.git` is.
    pub fn is_ignored(&self, rel: &str) -> bool {
        let parts: Vec<&str> = rel.split(['/', '\\']).filter(|p| !p.is_empty()).collect();
        if parts.is_empty() {
            return false;
        }
        if parts[0].eq_ignore_ascii_case(".git") {
            return !(parts.len() == 2 && (parts[1] == "HEAD" || parts[1] == "ORIG_HEAD"));
        }
        if parts.iter().any(|p| self.folders.iter().any(|f| p.eq_ignore_ascii_case(f))) {
            return true;
        }
        is_atomic_temp(parts[parts.len() - 1])
    }
}

/// Temp file of `platform::fs::atomic_write`: `.{name}.{pid}.{n}.tmp`.
fn is_atomic_temp(file_name: &str) -> bool {
    file_name.starts_with('.') && file_name.ends_with(".tmp")
}

/// Same check for an absolute path below `root`.
pub fn is_ignored_path(rules: &IgnoreRules, root: &Path, path: &Path) -> bool {
    match path.strip_prefix(root) {
        Ok(rel) => rules.is_ignored(&rel.to_string_lossy()),
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn table() {
        let r = IgnoreRules::standard();
        for (rel, ignored) in [
            ("node_modules/x/y.aod", true),
            ("entity/A_entity/A_entity.aod", false),
            (".git/config", true),
            (".git/index", true),
            (".git/HEAD", false),
            (".git/ORIG_HEAD", false),
            (".git/refs/HEAD", true),
            ("dist/a.js", true),
            ("transpile-cache/a", true),
            ("target/debug/x", true),
            (".claude/settings.json", true),
            ("entity/A_entity/.A_entity.aod.12.3.tmp", true),
            ("entity/A_entity/real.tmp", false),
            ("process/P/index.js", false),
            ("entity\\A\\A.aod", false),
            ("Node_Modules/a", true),
        ] {
            assert_eq!(r.is_ignored(rel), ignored, "{rel}");
        }
    }
}
