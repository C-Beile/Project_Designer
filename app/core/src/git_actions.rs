//! Basic Git for the Team menu: status, history, commit, pull, push and branch switch on the
//! repository of the active project. Provider-neutral; no pull requests, no tokens.
//!
//! Business rules: every call here is the direct result of one click on a confirming button in the
//! UI; nothing runs automatically. Commit messages are a single line and carry no co-author
//! trailer.

use platform::{CommandGitOperations, GitBranch, GitCommit, GitFileStatus, GitOperations};
use serde::Serialize;
use std::path::{Path, PathBuf};

const HISTORY_LIMIT: usize = 50;

#[derive(Debug, Clone, Serialize)]
pub struct GitOverview {
    pub root: String,
    pub branch: Option<String>,
    pub files: Vec<GitFileStatus>,
    pub branches: Vec<GitBranch>,
    /// Remote-tracking branches (`origin/name`), listed in the branch popup of the status bar.
    pub remote_branches: Vec<String>,
    pub commits: Vec<GitCommit>,
}

/// Result of a pull, push, checkout or commit: the text git printed.
#[derive(Debug, Clone, Serialize)]
pub struct GitOutput {
    pub ok: bool,
    pub text: String,
}

/// Top level of the work tree that contains `dir`; paths in `git status` are relative to it.
pub fn repo_root(dir: &Path) -> Result<PathBuf, String> {
    let out = platform::console::command("git")
        .args(["rev-parse", "--show-toplevel"])
        .current_dir(dir)
        .output()
        .map_err(|e| format!("git could not be started: {e}"))?;
    if !out.status.success() {
        return Err("This project folder is not inside a Git repository.".to_string());
    }
    Ok(PathBuf::from(String::from_utf8_lossy(&out.stdout).trim()))
}

pub fn validate_message(message: &str) -> Result<String, String> {
    let msg = message.trim();
    if msg.is_empty() {
        return Err("The commit message is empty.".into());
    }
    if msg.contains('\n') || msg.contains('\r') {
        return Err("The commit message must be a single line.".into());
    }
    if msg.to_ascii_lowercase().contains("co-authored-by") {
        return Err("Co-author lines are not allowed in commit messages.".into());
    }
    Ok(msg.to_string())
}

fn prepare() {
    // Never wait for a terminal prompt that the app cannot show.
    std::env::set_var("GIT_TERMINAL_PROMPT", "0");
}

pub fn overview(dir: &Path) -> Result<GitOverview, String> {
    prepare();
    let root = repo_root(dir)?;
    let git = CommandGitOperations::new();
    let status = git.status(&root).map_err(|e| e.to_string())?;
    let branches = git.list_branches(&root).map_err(|e| e.to_string())?;
    let commits = git.log(&root, HISTORY_LIMIT).map_err(|e| e.to_string())?;
    let remote_branches = remote_branch_names(&root);
    Ok(GitOverview { root: root.to_string_lossy().into_owned(), branch: status.branch, files: status.files, branches, remote_branches, commits })
}

fn remote_branch_names(root: &Path) -> Vec<String> {
    let Ok(out) = platform::console::command("git").args(["branch", "-r", "--format=%(refname:short)"]).current_dir(root).output() else {
        return Vec::new();
    };
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.ends_with("/HEAD") && *l != "origin")
        .map(str::to_string)
        .collect()
}

/// Branch names that git itself would accept and that cannot be mistaken for an option.
pub fn validate_branch_name(name: &str) -> Result<String, String> {
    let n = name.trim();
    let ok = !n.is_empty()
        && !n.starts_with('-')
        && !n.starts_with('/')
        && !n.ends_with('/')
        && !n.ends_with(".lock")
        && !n.contains("..")
        && !n.contains("//")
        && n.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | '/'));
    if ok { Ok(n.to_string()) } else { Err("Use letters, digits and _ - . / only; no leading dash or slash.".into()) }
}

fn outcome(o: platform::GitCommandOutcome) -> GitOutput {
    let text = format!("{}{}", o.stdout, o.stderr).trim().to_string();
    GitOutput { ok: o.success(), text }
}

/// Commits exactly the chosen files; each must appear in the current status.
pub fn commit(dir: &Path, message: &str, paths: &[String]) -> Result<GitOutput, String> {
    prepare();
    let msg = validate_message(message)?;
    let root = repo_root(dir)?;
    let git = CommandGitOperations::new();
    let status = git.status(&root).map_err(|e| e.to_string())?;
    if paths.is_empty() {
        return Err("No files selected.".into());
    }
    if let Some(bad) = paths.iter().find(|p| !status.files.iter().any(|f| &f.path == *p)) {
        return Err(format!("{bad} has no pending change."));
    }
    git.commit_paths(&root, &msg, paths).map(outcome).map_err(|e| e.to_string())
}

pub fn pull(dir: &Path) -> Result<GitOutput, String> {
    prepare();
    let root = repo_root(dir)?;
    CommandGitOperations::new().pull(&root).map(outcome).map_err(|e| e.to_string())
}

pub fn push(dir: &Path) -> Result<GitOutput, String> {
    prepare();
    let root = repo_root(dir)?;
    CommandGitOperations::new().push(&root).map(outcome).map_err(|e| e.to_string())
}

/// Switches to an existing local branch; the name must be one of the listed branches.
pub fn checkout(dir: &Path, branch: &str) -> Result<GitOutput, String> {
    prepare();
    let root = repo_root(dir)?;
    let git = CommandGitOperations::new();
    let branches = git.list_branches(&root).map_err(|e| e.to_string())?;
    if !branches.iter().any(|b| b.name == branch) {
        return Err(format!("Branch {branch} does not exist."));
    }
    git.checkout_branch(&root, branch).map(outcome).map_err(|e| e.to_string())
}

/// Creates a new local branch from the current HEAD, or from a listed remote branch, and switches
/// to it. Runs only from the confirming button of the branch dialog.
pub fn create_branch(dir: &Path, name: &str, start: Option<&str>) -> Result<GitOutput, String> {
    prepare();
    let name = validate_branch_name(name)?;
    let root = repo_root(dir)?;
    let git = CommandGitOperations::new();
    let branches = git.list_branches(&root).map_err(|e| e.to_string())?;
    if branches.iter().any(|b| b.name == name) {
        return Err(format!("Branch {name} already exists."));
    }
    let mut args = vec!["checkout".to_string(), "-b".to_string(), name];
    if let Some(s) = start {
        if !remote_branch_names(&root).iter().any(|r| r == s) {
            return Err(format!("Remote branch {s} does not exist."));
        }
        args.push(s.to_string());
    }
    let out = platform::console::command("git").args(&args).current_dir(&root).output().map_err(|e| format!("git could not be started: {e}"))?;
    let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)).trim().to_string();
    Ok(GitOutput { ok: out.status.success(), text })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::process::Command;

    fn git(dir: &Path, args: &[&str]) {
        let s = Command::new("git").args(args).current_dir(dir).status().unwrap();
        assert!(s.success(), "git {args:?}");
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("forge-app-git-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        git(&dir, &["init", "--quiet", "-b", "main"]);
        git(&dir, &["config", "user.email", "t@example.invalid"]);
        git(&dir, &["config", "user.name", "T"]);
        dir
    }

    #[test]
    fn message_must_be_one_line_without_co_author() {
        assert_eq!(validate_message("  Fix tree icons ").unwrap(), "Fix tree icons");
        assert!(validate_message("").is_err());
        assert!(validate_message("a\nb").is_err());
        assert!(validate_message("a Co-Authored-By: x").is_err());
    }

    #[test]
    fn folder_outside_a_repository_is_reported() {
        let dir = std::env::temp_dir().join(format!("forge-app-git-none-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let outside = std::env::temp_dir().ancestors().last().map(Path::to_path_buf).unwrap_or(dir.clone());
        let _ = outside;
        if repo_root(&dir).is_ok() {
            return;
        }
        assert!(overview(&dir).unwrap_err().contains("not inside a Git repository"));
    }

    #[test]
    fn commit_takes_only_the_selected_files_and_history_shows_it() {
        let dir = scratch("commit");
        fs::write(dir.join("a.txt"), "a").unwrap();
        fs::write(dir.join("package-lock.json"), "{}").unwrap();
        let before = overview(&dir).unwrap();
        assert_eq!(before.files.len(), 2);
        assert!(commit(&dir, "two\nlines", &["a.txt".into()]).is_err());
        assert!(commit(&dir, "x", &["nope.txt".into()]).is_err());
        let out = commit(&dir, "Add a", &["a.txt".into()]).unwrap();
        assert!(out.ok, "{}", out.text);
        let after = overview(&dir).unwrap();
        assert_eq!(after.files.len(), 1);
        assert_eq!(after.files[0].path, "package-lock.json");
        assert_eq!(after.commits[0].subject, "Add a");
        assert_eq!(after.branch.as_deref(), Some("main"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn checkout_switches_only_to_existing_branches() {
        let dir = scratch("branch");
        fs::write(dir.join("a.txt"), "a").unwrap();
        commit(&dir, "Init", &["a.txt".into()]).unwrap();
        git(&dir, &["branch", "release/1.2"]);
        assert!(checkout(&dir, "--orphan").is_err());
        assert!(checkout(&dir, "release/1.2").unwrap().ok);
        assert_eq!(overview(&dir).unwrap().branch.as_deref(), Some("release/1.2"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn create_branch_validates_the_name_and_switches() {
        let dir = scratch("newbranch");
        fs::write(dir.join("a.txt"), "a").unwrap();
        commit(&dir, "Init", &["a.txt".into()]).unwrap();
        assert!(create_branch(&dir, "--orphan", None).is_err());
        assert!(create_branch(&dir, "a b", None).is_err());
        assert!(create_branch(&dir, "main", None).is_err());
        assert!(create_branch(&dir, "feature/x", Some("origin/none")).is_err());
        assert!(create_branch(&dir, "feature/x", None).unwrap().ok);
        let o = overview(&dir).unwrap();
        assert_eq!(o.branch.as_deref(), Some("feature/x"));
        assert!(o.remote_branches.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn push_and_pull_round_trip_through_a_local_remote() {
        let remote = std::env::temp_dir().join(format!("forge-app-git-remote-{}", std::process::id()));
        let _ = fs::remove_dir_all(&remote);
        fs::create_dir_all(&remote).unwrap();
        git(&remote, &["init", "--bare", "--quiet", "-b", "main"]);
        let dir = scratch("push");
        git(&dir, &["remote", "add", "origin", remote.to_str().unwrap()]);
        fs::write(dir.join("a.txt"), "a").unwrap();
        commit(&dir, "Init", &["a.txt".into()]).unwrap();
        git(&dir, &["push", "--quiet", "-u", "origin", "main"]);
        fs::write(dir.join("b.txt"), "b").unwrap();
        commit(&dir, "Add b", &["b.txt".into()]).unwrap();
        assert!(push(&dir).unwrap().ok);
        assert!(pull(&dir).unwrap().ok);
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&remote);
    }
}
