//! Welche Ordner beobachtet werden (Entscheidung D1): jeder nicht ignorierte Ordner der obersten
//! Ebene rekursiv, die Wurzel selbst nicht rekursiv (für `package.json` usw.), `.git` und
//! `node_modules` nicht rekursiv (nur `HEAD` und `.package-lock.json` zählen). So hat jeder Watch
//! seinen eigenen OS-Puffer, und Lärm in `node_modules` oder `dist` läuft nicht über den Puffer des Projekts.

use crate::ignore::IgnoreRules;
use platform::WatchTarget;
use std::path::Path;

/// Targets for a project folder as it is now.
pub fn initial_targets(root: &Path, rules: &IgnoreRules) -> Vec<WatchTarget> {
    let mut targets = vec![WatchTarget::flat(root)];
    let Ok(read) = std::fs::read_dir(root) else { return targets };
    let mut names: Vec<(String, bool)> = read
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .map(|e| (e.file_name().to_string_lossy().into_owned(), true))
        .collect();
    names.sort();
    for (name, _) in names {
        if let Some(t) = target_for_dir(root, &name, rules) {
            targets.push(t);
        }
    }
    targets
}

/// Target for a top-level folder with this name (`None` = not watched at all).
pub fn target_for_dir(root: &Path, name: &str, rules: &IgnoreRules) -> Option<WatchTarget> {
    let path = root.join(name);
    if name.eq_ignore_ascii_case(".git") || name.eq_ignore_ascii_case("node_modules") {
        return path.is_dir().then(|| WatchTarget::flat(path));
    }
    if rules.is_ignored_folder_name(name) {
        return None;
    }
    Some(WatchTarget::recursive(path))
}

/// For a created path: the new watch if it is a new top-level folder.
pub fn target_for_created(root: &Path, created: &Path, rules: &IgnoreRules) -> Option<WatchTarget> {
    if created.parent()? != root || !created.is_dir() {
        return None;
    }
    target_for_dir(root, &created.file_name()?.to_string_lossy(), rules)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn root_is_flat_and_ignored_folders_are_left_out() {
        let root = std::env::temp_dir().join(format!("forge-fw-set-{}", std::process::id()));
        for d in ["entity/A", "node_modules/x", ".git", "dist", "process", "target"] {
            std::fs::create_dir_all(root.join(d)).unwrap();
        }
        let rules = IgnoreRules::standard();
        let t = initial_targets(&root, &rules);
        let find = |name: &str| t.iter().find(|x| x.path == root.join(name));
        assert!(!t[0].recursive && t[0].path == root);
        assert!(find("entity").unwrap().recursive);
        assert!(find("process").unwrap().recursive);
        assert!(!find(".git").unwrap().recursive);
        assert!(!find("node_modules").unwrap().recursive);
        assert!(find("dist").is_none());
        assert!(find("target").is_none());

        let new_dir = root.join("context");
        std::fs::create_dir_all(&new_dir).unwrap();
        assert!(target_for_created(&root, &new_dir, &rules).unwrap().recursive);
        assert!(target_for_created(&root, &root.join("entity/A"), &rules).is_none(), "nested folder is covered already");
        std::fs::remove_dir_all(&root).ok();
    }
}
