// Where the parts of an ADITO Designer installation sit relative to its root, per operating
// system. Windows is verified against the real installation (nbexec64.exe under
// lib\designer\platform\lib). The macOS layout is an ASSUMPTION (UNBELEGT): the Designer is
// NetBeans based, whose Unix launcher is the shell script `nbexec` in the same folder, and a
// macOS app keeps its files below `<name>.app/Contents/Resources`. Nothing here has been run on
// a Mac; the candidates are tried in order and the Designer folder can always be chosen by hand
// in Tools > Options.

use std::path::{Path, PathBuf};

/// Joins a relative path written with `/` or `\` onto `base` using the separator of the running OS.
pub fn join_rel(base: &Path, rel: &str) -> PathBuf {
    let mut out = base.to_path_buf();
    for part in rel.split(['/', '\\']).filter(|p| !p.is_empty()) {
        out.push(part);
    }
    out
}

/// Launcher locations below an installation root, most likely first.
pub fn launcher_relative_candidates() -> &'static [&'static str] {
    if cfg!(windows) {
        &["lib/designer/platform/lib/nbexec64.exe"]
    } else {
        &["lib/designer/platform/lib/nbexec", "designer/platform/lib/nbexec", "platform/lib/nbexec"]
    }
}

/// Folders below a chosen path that may hold the installation root (a macOS `.app` bundle keeps
/// it under `Contents/Resources`). The chosen path itself comes first.
pub fn root_candidates(chosen: &Path) -> Vec<PathBuf> {
    let mut out = vec![chosen.to_path_buf()];
    if !cfg!(windows) {
        out.push(join_rel(chosen, "Contents/Resources"));
        out.push(join_rel(chosen, "Contents/Resources/designer"));
    }
    out
}

/// The launcher file of this installation root, if it exists.
pub fn find_launcher(root: &Path) -> Option<PathBuf> {
    launcher_relative_candidates().iter().map(|rel| join_rel(root, rel)).find(|p| p.is_file())
}

/// The installation root belonging to a chosen folder (the folder itself or a known sub-folder
/// of a macOS app bundle), or `None` when no launcher is found.
pub fn designer_root(chosen: &Path) -> Option<PathBuf> {
    root_candidates(chosen).into_iter().find(|root| find_launcher(root).is_some())
}

/// Launcher path for display and error messages: the existing one, otherwise the first candidate.
pub fn launcher_path(root: &Path) -> PathBuf {
    find_launcher(root).unwrap_or_else(|| join_rel(root, launcher_relative_candidates()[0]))
}

/// Java runtime folder handed to the launcher as `--jdkhome`: the first existing candidate,
/// otherwise `jre` (the verified Windows location).
pub fn jdk_home(root: &Path) -> PathBuf {
    ["jre", "jre/Contents/Home", "jdk", "jdk/Contents/Home"]
        .iter()
        .map(|rel| join_rel(root, rel))
        .find(|p| p.is_dir())
        .unwrap_or_else(|| root.join("jre"))
}

/// Separator of the `--clusters` list (`File.pathSeparator` of the Java side).
pub const CLUSTER_SEPARATOR: &str = if cfg!(windows) { ";" } else { ":" };

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn join_rel_accepts_both_separators() {
        assert_eq!(join_rel(Path::new("base"), "a/b\\c"), Path::new("base").join("a").join("b").join("c"));
    }

    #[test]
    fn launcher_is_found_below_the_root_and_inside_an_app_bundle() {
        let dir = std::env::temp_dir().join(format!("forge-layout-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let launcher = join_rel(&dir, launcher_relative_candidates()[0]);
        std::fs::create_dir_all(launcher.parent().unwrap()).unwrap();
        std::fs::write(&launcher, b"x").unwrap();
        assert_eq!(designer_root(&dir), Some(dir.clone()));
        assert_eq!(launcher_path(&dir), launcher);
        std::fs::remove_dir_all(&dir).unwrap();

        if !cfg!(windows) {
            let app = std::env::temp_dir().join(format!("forge-layout-app-{}.app", std::process::id()));
            let _ = std::fs::remove_dir_all(&app);
            let resources = join_rel(&app, "Contents/Resources");
            let launcher = join_rel(&resources, launcher_relative_candidates()[0]);
            std::fs::create_dir_all(launcher.parent().unwrap()).unwrap();
            std::fs::write(&launcher, b"x").unwrap();
            assert_eq!(designer_root(&app), Some(resources));
            std::fs::remove_dir_all(&app).unwrap();
        }
    }

    #[test]
    fn a_folder_without_launcher_is_no_installation() {
        assert_eq!(designer_root(Path::new("definitely/not/there")), None);
    }
}
