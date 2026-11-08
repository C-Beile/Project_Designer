//! Plain file operations of the Projects tree (original Designer, context menu of a file): copy and
//! cut/paste, rename, delete, file properties and the NodeJS menu (npm commands).
//!
//! Business rules: files of installed modules (node_modules) are never changed; nothing leaves the
//! project folder; an existing file is never overwritten (a pasted copy gets a free name); a deleted
//! file is kept in the backup folder first; npm runs in the project folder without a console window,
//! `npm login` and `npm publish` only run because the caller asked for them explicitly.

use crate::tree::ensure_writable;
use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::Stdio;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct FileInfo {
    pub name: String,
    pub extension: String,
    pub size: u64,
    /// Milliseconds since 1970-01-01 UTC; `None` when the file system gives no time.
    pub modified_ms: Option<u64>,
    pub path: String,
}

pub fn file_info(path: &Path) -> Result<FileInfo, String> {
    let meta = std::fs::metadata(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let modified_ms = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64);
    Ok(FileInfo {
        name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        extension: path.extension().map(|e| e.to_string_lossy().into_owned()).unwrap_or_default(),
        size: meta.len(),
        modified_ms,
        path: path.to_string_lossy().into_owned(),
    })
}

fn valid_file_name(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && !name.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|']) && !name.ends_with('.') && !name.ends_with(' ')
}

fn inside(root: &Path, path: &Path) -> bool {
    let norm = |p: &Path| p.to_string_lossy().replace('\\', "/").trim_end_matches('/').to_lowercase();
    let (r, p) = (norm(root), norm(path));
    p == r || p.starts_with(&format!("{r}/"))
}

fn free_name(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    for n in 1.. {
        let candidate = dir.join(if n == 1 { format!("{stem} - Copy{ext}") } else { format!("{stem} - Copy ({n}){ext}") });
        if !candidate.exists() {
            return candidate;
        }
    }
    unreachable!()
}

fn check_target(project_root: &Path, src: &Path, dest_dir: &Path) -> Result<(), String> {
    if !src.is_file() {
        return Err(format!("{} is not a file.", src.display()));
    }
    if !dest_dir.is_dir() {
        return Err(format!("{} is not a folder.", dest_dir.display()));
    }
    if !inside(project_root, dest_dir) {
        return Err("The target folder is outside the project.".into());
    }
    ensure_writable(dest_dir)
}

/// Copy of a file into a folder of the project; the new path.
pub fn copy_file(project_root: &Path, src: &Path, dest_dir: &Path) -> Result<PathBuf, String> {
    check_target(project_root, src, dest_dir)?;
    let name = src.file_name().ok_or("The file has no name.")?.to_string_lossy().into_owned();
    let target = free_name(dest_dir, &name);
    std::fs::copy(src, &target).map_err(|e| format!("cannot copy to {}: {e}", target.display()))?;
    Ok(target)
}

/// Move (cut and paste); the source must be writable, too.
pub fn move_file(project_root: &Path, src: &Path, dest_dir: &Path) -> Result<PathBuf, String> {
    check_target(project_root, src, dest_dir)?;
    ensure_writable(src)?;
    if !inside(project_root, src) {
        return Err("The file is outside the project.".into());
    }
    let name = src.file_name().ok_or("The file has no name.")?.to_string_lossy().into_owned();
    let target = dest_dir.join(&name);
    if target.exists() {
        return Err(format!("{} already exists in the target folder.", name));
    }
    if std::fs::rename(src, &target).is_err() {
        std::fs::copy(src, &target).map_err(|e| format!("cannot move to {}: {e}", target.display()))?;
        std::fs::remove_file(src).map_err(|e| format!("copied, but the original could not be removed: {e}"))?;
    }
    Ok(target)
}

pub fn rename_file(project_root: &Path, path: &Path, new_name: &str) -> Result<PathBuf, String> {
    ensure_writable(path)?;
    if !path.is_file() || !inside(project_root, path) {
        return Err("Only files of the project can be renamed here.".into());
    }
    if !valid_file_name(new_name) {
        return Err(format!("'{new_name}' is not a valid file name."));
    }
    let target = path.with_file_name(new_name);
    if target.exists() {
        return Err(format!("{new_name} already exists."));
    }
    std::fs::rename(path, &target).map_err(|e| format!("cannot rename: {e}"))?;
    Ok(target)
}

/// Deletes a file after a copy went to the backup folder.
pub fn delete_file(project_root: &Path, path: &Path) -> Result<(), String> {
    ensure_writable(path)?;
    if !path.is_file() || !inside(project_root, path) {
        return Err("Only files of the project can be deleted here.".into());
    }
    crate::backup::backup_file(path)?;
    std::fs::remove_file(path).map_err(|e| format!("cannot delete {}: {e}", path.display()))
}

/// The npm commands of the NodeJS menu, as given on the command line.
pub fn npm_arguments(action: &str) -> Option<&'static [&'static str]> {
    Some(match action {
        "install" => &["install"],
        "clean-install" => &["clean-install"],
        "outdated" => &["outdated"],
        "update" => &["update"],
        "login" => &["login"],
        "publish" => &["publish"],
        _ => return None,
    })
}

/// Commands that change the account or the registry: they only run when the caller confirmed them.
pub fn npm_needs_confirmation(action: &str) -> bool {
    matches!(action, "login" | "publish")
}

/// Runs one npm command in the project folder; every output line goes to `on_line(is_error, line)`
/// while it is produced. Returns the exit code.
pub fn run_npm(project_root: &Path, action: &str, confirmed: bool, on_line: &(dyn Fn(bool, &str) + Sync)) -> Result<i32, String> {
    let args = npm_arguments(action).ok_or_else(|| format!("'{action}' is not an npm command of this menu."))?;
    if npm_needs_confirmation(action) && !confirmed {
        return Err(format!("npm {action} changes your npm account or the registry and needs an explicit confirmation."));
    }
    if !project_root.join("package.json").is_file() {
        return Err("There is no package.json in the project folder.".into());
    }
    let program = resolve_npm()?;
    let mut cmd = platform::console::command(&program);
    cmd.args(args).current_dir(project_root).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    // A GUI app started from Finder has a minimal PATH; npm is a script that looks up `node` through
    // it, so the folder of npm (which holds node as well) is put in front.
    #[cfg(not(windows))]
    if let Some(dir) = program.parent() {
        let mut paths = vec![dir.to_path_buf()];
        paths.extend(std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect::<Vec<_>>()).unwrap_or_default());
        if let Ok(joined) = std::env::join_paths(paths) {
            cmd.env("PATH", joined);
        }
    }
    // The lock file is only ever changed by npm itself; nothing here stages or commits it.
    let mut child = cmd.spawn().map_err(|e| format!("cannot start npm ({}): {e}", program.display()))?;
    let stdout = child.stdout.take().ok_or("no output pipe")?;
    let stderr = child.stderr.take().ok_or("no error pipe")?;
    std::thread::scope(|scope| {
        scope.spawn(|| {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                on_line(false, &line);
            }
        });
        scope.spawn(|| {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                on_line(true, &line);
            }
        });
    });
    let status = child.wait().map_err(|e| format!("npm did not finish: {e}"))?;
    Ok(status.code().unwrap_or(-1))
}

fn resolve_npm() -> Result<PathBuf, String> {
    use platform::node::NodeResolver;
    let found = platform::native::PathNodeResolver::new().resolve(Path::new(".")).map_err(|e| e.to_string())?;
    found.npm_path.ok_or_else(|| "npm was not found next to node (Windows: npm.cmd, macOS: install Node.js from nodejs.org or Homebrew).".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("forge-file-ops-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn copy_never_overwrites_and_gets_a_free_name() {
        let root = temp("copy");
        std::fs::write(root.join("a.txt"), "x").unwrap();
        std::fs::create_dir(root.join("sub")).unwrap();
        let first = copy_file(&root, &root.join("a.txt"), &root).unwrap();
        assert_eq!(first.file_name().unwrap(), "a - Copy.txt");
        let second = copy_file(&root, &root.join("a.txt"), &root).unwrap();
        assert_eq!(second.file_name().unwrap(), "a - Copy (2).txt");
        let moved = copy_file(&root, &root.join("a.txt"), &root.join("sub")).unwrap();
        assert_eq!(moved, root.join("sub").join("a.txt"));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn move_refuses_to_overwrite_and_to_leave_the_project() {
        let root = temp("move");
        let other = temp("move-other");
        std::fs::write(root.join("a.txt"), "x").unwrap();
        std::fs::create_dir(root.join("sub")).unwrap();
        std::fs::write(root.join("sub").join("a.txt"), "y").unwrap();
        assert!(move_file(&root, &root.join("a.txt"), &root.join("sub")).unwrap_err().contains("already exists"));
        assert!(move_file(&root, &root.join("a.txt"), &other).unwrap_err().contains("outside the project"));
        std::fs::remove_file(root.join("sub").join("a.txt")).unwrap();
        let target = move_file(&root, &root.join("a.txt"), &root.join("sub")).unwrap();
        assert!(target.is_file() && !root.join("a.txt").exists());
        std::fs::remove_dir_all(&root).ok();
        std::fs::remove_dir_all(&other).ok();
    }

    #[test]
    fn rename_checks_the_name_and_existing_files() {
        let root = temp("rename");
        std::fs::write(root.join("a.txt"), "x").unwrap();
        std::fs::write(root.join("b.txt"), "y").unwrap();
        assert!(rename_file(&root, &root.join("a.txt"), "b.txt").is_err());
        assert!(rename_file(&root, &root.join("a.txt"), "x/y.txt").is_err());
        assert!(rename_file(&root, &root.join("a.txt"), "").is_err());
        let to = rename_file(&root, &root.join("a.txt"), "c.txt").unwrap();
        assert!(to.is_file());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn module_files_are_read_only() {
        let root = temp("module");
        let dir = root.join("node_modules").join("@s").join("m");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.txt"), "x").unwrap();
        assert!(delete_file(&root, &dir.join("a.txt")).unwrap_err().contains("read-only"));
        assert!(rename_file(&root, &dir.join("a.txt"), "b.txt").is_err());
        assert!(copy_file(&root, &root.join("nothing"), &dir).is_err());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn delete_keeps_a_copy_in_the_backup_folder() {
        let root = temp("delete");
        std::fs::write(root.join("a.txt"), "keep me").unwrap();
        delete_file(&root, &root.join("a.txt")).unwrap();
        assert!(!root.join("a.txt").exists());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn file_info_reports_name_extension_size_and_time() {
        let root = temp("info");
        std::fs::write(root.join("package.json"), "{}").unwrap();
        let info = file_info(&root.join("package.json")).unwrap();
        assert_eq!((info.name.as_str(), info.extension.as_str(), info.size), ("package.json", "json", 2));
        assert!(info.modified_ms.is_some());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn npm_menu_is_a_closed_list_and_account_commands_need_confirmation() {
        for a in ["install", "clean-install", "outdated", "update", "login", "publish"] {
            assert!(npm_arguments(a).is_some());
        }
        assert!(npm_arguments("exec").is_none());
        assert!(npm_arguments("install --foo").is_none());
        assert!(npm_needs_confirmation("login") && npm_needs_confirmation("publish"));
        assert!(!npm_needs_confirmation("install"));
        let root = temp("npm");
        std::fs::write(root.join("package.json"), "{}").unwrap();
        assert!(run_npm(&root, "publish", false, &|_, _| {}).unwrap_err().contains("explicit confirmation"));
        assert!(run_npm(&root, "exec", true, &|_, _| {}).is_err());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn npm_needs_a_package_json() {
        let root = temp("nopkg");
        assert!(run_npm(&root, "install", true, &|_, _| {}).unwrap_err().contains("package.json"));
        std::fs::remove_dir_all(&root).ok();
    }
}
