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
    /// Author of a new commit as Git itself would record it (`user.name`, `user.email`).
    pub user_name: Option<String>,
    pub user_email: Option<String>,
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
        .map_err(|e| plugin_api::at!(format!("git could not be started in '{}': {e}", dir.display())))?;
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
    // No window of the Git Credential Manager: a failed sign-in is reported and the app asks itself.
    std::env::set_var("GCM_INTERACTIVE", "never");
}

pub fn overview(dir: &Path) -> Result<GitOverview, String> {
    prepare();
    let root = repo_root(dir)?;
    let git = CommandGitOperations::new();
    let status = git.status(&root).map_err(|e| plugin_api::at!(e.to_string()))?;
    let files = expand_untracked_dirs(&root, status.files);
    let branches = git.list_branches(&root).map_err(|e| plugin_api::at!(e.to_string()))?;
    let commits = git.log(&root, HISTORY_LIMIT).map_err(|e| plugin_api::at!(e.to_string()))?;
    let remote_branches = remote_branch_names(&root);
    let user_name = git_config(&root, "user.name");
    let user_email = git_config(&root, "user.email");
    Ok(GitOverview { root: root.to_string_lossy().into_owned(), branch: status.branch, files, branches, remote_branches, commits, user_name, user_email })
}

fn git_config(root: &Path, key: &str) -> Option<String> {
    let out = platform::console::command("git").args(["config", key]).current_dir(root).output().ok()?;
    let value = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if out.status.success() && !value.is_empty() { Some(value) } else { None }
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
    let status_files = expand_untracked_dirs(&root, git.status(&root).map_err(|e| plugin_api::at!(e.to_string()))?.files);
    if paths.is_empty() {
        return Err("No files selected.".into());
    }
    if let Some(bad) = paths.iter().find(|p| !status_files.iter().any(|f| &f.path == *p)) {
        return Err(format!("{bad} has no pending change."));
    }
    git.commit_paths(&root, &msg, paths).map(outcome).map_err(|e| plugin_api::at!(e.to_string()))
}

pub fn pull(dir: &Path) -> Result<GitOutput, String> {
    prepare();
    let root = repo_root(dir)?;
    CommandGitOperations::new().pull(&root).map(outcome).map_err(|e| plugin_api::at!(e.to_string()))
}

/// Puts local changes (untracked files too) aside, runs `op` and brings them back. If they conflict with
/// the result, they stay in the stash and the answer says so (`done` names what happened).
fn stash_around(root: &Path, message: &str, done: &str, op: impl Fn() -> Result<GitOutput, String>) -> Result<GitOutput, String> {
    let run = |args: &[&str]| -> Result<GitOutput, String> {
        let out = platform::console::command("git").args(args).current_dir(root).output().map_err(|e| plugin_api::at!(format!("git could not be started in '{}': {e}", root.display())))?;
        let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)).trim().to_string();
        Ok(GitOutput { ok: out.status.success(), text })
    };
    let stashed = run(&["stash", "push", "--include-untracked", "-m", message])?;
    if !stashed.ok {
        return Ok(stashed);
    }
    // Nothing to stash: the plain operation.
    let kept = !stashed.text.contains("No local changes to save");
    let result = op()?;
    if !kept {
        return Ok(result);
    }
    if !result.ok {
        let _ = run(&["stash", "pop", "--quiet"]);
        return Ok(result);
    }
    let popped = run(&["stash", "pop", "--quiet"])?;
    Ok(if popped.ok {
        GitOutput { ok: true, text: format!("{} Your changes came along.", result.text).trim().to_string() }
    } else {
        GitOutput { ok: false, text: format!("{done}, but your changes conflict with it. Check the files for conflicts; the changes also stay in the stash ('{message}').") }
    })
}

/// Text of a pull that Git refused because of local changes.
fn blocked_by_local_changes(text: &str) -> bool {
    let t = text.to_ascii_lowercase();
    ["would be overwritten by", "please commit your changes or stash them", "please commit or stash them", "you have unstaged changes", "cannot pull with rebase", "your index contains uncommitted changes"].iter().any(|p| t.contains(p))
}

/// Pull that does not bother the user when it does not have to: with a clean work tree a plain pull; with
/// local changes and nothing new on the remote nothing to do; when the new commits touch other files than the
/// local changes, the changes are stashed and brought back automatically. Only a real overlap is left to Git
/// (which refuses) so the UI can ask.
fn smart_pull(dir: &Path) -> Result<GitOutput, String> {
    prepare();
    let root = repo_root(dir)?;
    let git = CommandGitOperations::new();
    let dirty = expand_untracked_dirs(&root, git.status(&root).map_err(|e| plugin_api::at!(e.to_string()))?.files);
    if dirty.is_empty() || !has_upstream(&root) {
        return pull(&root);
    }
    let coming = match incoming(&root) {
        Ok(c) => c,
        Err(text) => return Ok(GitOutput { ok: false, text }),
    };
    if coming.is_empty() {
        return Ok(GitOutput { ok: true, text: "Already up to date.".into() });
    }
    let first = pull(&root)?;
    if first.ok || !blocked_by_local_changes(&first.text) {
        return Ok(first);
    }
    let diff = platform::console::command("git").args(["diff", "--name-only", "HEAD..@{u}"]).current_dir(&root).output().map_err(|e| plugin_api::at!(e.to_string()))?;
    let touched: Vec<String> = String::from_utf8_lossy(&diff.stdout).lines().map(|l| l.trim().to_string()).collect();
    if dirty.iter().any(|f| touched.iter().any(|t| *t == f.path)) {
        return Ok(first);
    }
    stash_around(&root, "Designer: before pull", "Pulled", || pull(&root))
}

/// Pull; with `mode` `stash` local changes are put aside first and brought back after the merge.
pub fn pull_with(dir: &Path, mode: Option<&str>) -> Result<GitOutput, String> {
    match mode {
        None => smart_pull(dir),
        Some("stash") => {
            prepare();
            let root = repo_root(dir)?;
            stash_around(&root, "Designer: before pull", "Pulled", || pull(&root))
        }
        Some(other) => Err(format!("Unknown pull mode '{other}'.")),
    }
}

pub fn push(dir: &Path) -> Result<GitOutput, String> {
    prepare();
    let root = repo_root(dir)?;
    CommandGitOperations::new().push(&root).map(outcome).map_err(|e| plugin_api::at!(e.to_string()))
}

/// Switches to an existing local branch; the name must be one of the listed branches.
pub fn checkout(dir: &Path, branch: &str) -> Result<GitOutput, String> {
    checkout_with(dir, branch, None)
}

/// What to do with local changes that stand in the way of a checkout.
/// `stash`: put them aside (untracked files too), switch, bring them back. `discard`: throw them away
/// (`checkout -f`; untracked files in the way are overwritten). Without a mode Git refuses, as usual.
pub fn checkout_with(dir: &Path, branch: &str, mode: Option<&str>) -> Result<GitOutput, String> {
    prepare();
    let root = repo_root(dir)?;
    let git = CommandGitOperations::new();
    let branches = git.list_branches(&root).map_err(|e| plugin_api::at!(e.to_string()))?;
    if !branches.iter().any(|b| b.name == branch) {
        return Err(format!("Branch {branch} does not exist."));
    }
    switch_with_mode(&root, &[branch], branch, mode)
}

/// Runs `git checkout <args>` (a switch or `-b`) and handles local changes in the way by `mode`.
fn switch_with_mode(root: &Path, args: &[&str], target: &str, mode: Option<&str>) -> Result<GitOutput, String> {
    let run = |args: &[&str]| -> Result<GitOutput, String> {
        let out = platform::console::command("git").args(args).current_dir(root).output().map_err(|e| plugin_api::at!(format!("git could not be started in '{}': {e}", root.display())))?;
        let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)).trim().to_string();
        Ok(GitOutput { ok: out.status.success(), text })
    };
    let checkout = |force: bool| -> Result<GitOutput, String> {
        let mut full = vec!["checkout"];
        if force {
            full.push("-f");
        }
        full.extend_from_slice(args);
        run(&full)
    };
    match mode {
        None => checkout(false),
        Some("discard") => checkout(true),
        Some("stash") => stash_around(root, &format!("Designer: before switching to {target}"), &format!("Switched to {target}"), || checkout(false)),
        Some(other) => Err(format!("Unknown checkout mode '{other}'.")),
    }
}

/// Creates a new local branch from the current HEAD, or from a listed remote branch, and switches
/// to it. Runs only from the confirming button of the branch dialog.
pub fn create_branch(dir: &Path, name: &str, start: Option<&str>) -> Result<GitOutput, String> {
    create_branch_with(dir, name, start, None)
}

/// Like `create_branch`; `mode` (`stash` or `discard`) decides what happens to local changes in the way.
pub fn create_branch_with(dir: &Path, name: &str, start: Option<&str>, mode: Option<&str>) -> Result<GitOutput, String> {
    prepare();
    let name = validate_branch_name(name)?;
    let start = start.map(str::trim).filter(|s| !s.is_empty());
    let root = repo_root(dir)?;
    let git = CommandGitOperations::new();
    let branches = git.list_branches(&root).map_err(|e| plugin_api::at!(e.to_string()))?;
    if branches.iter().any(|b| b.name == name) {
        return Err(format!("Branch {name} already exists."));
    }
    let mut args = vec!["-b", name.as_str()];
    if let Some(s) = start {
        if !remote_branch_names(&root).iter().any(|r| r == s) {
            return Err(format!("Remote branch {s} does not exist."));
        }
        args.push(s);
    }
    switch_with_mode(&root, &args, &name, mode)
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

    /// `main` has an untracked `x.txt` that the branch `other` contains as a tracked file.
    fn clash(name: &str) -> PathBuf {
        let dir = scratch(name);
        fs::write(dir.join("a.txt"), "a").unwrap();
        commit(&dir, "Init", &["a.txt".into()]).unwrap();
        git(&dir, &["checkout", "--quiet", "-b", "other"]);
        fs::write(dir.join("x.txt"), "from other").unwrap();
        commit(&dir, "Add x", &["x.txt".into()]).unwrap();
        git(&dir, &["checkout", "--quiet", "main"]);
        fs::write(dir.join("x.txt"), "mine").unwrap();
        dir
    }

    #[test]
    fn checkout_without_a_mode_refuses_when_local_files_are_in_the_way() {
        let dir = clash("clash-none");
        let r = checkout(&dir, "other").unwrap();
        let _ = fs::remove_dir_all(&dir);
        assert!(!r.ok && r.text.contains("would be overwritten by checkout"));
    }

    #[test]
    fn checkout_discard_switches_and_overwrites_the_files_in_the_way() {
        let dir = clash("clash-discard");
        let r = checkout_with(&dir, "other", Some("discard")).unwrap();
        let (branch, content) = (overview(&dir).unwrap().branch, fs::read_to_string(dir.join("x.txt")).unwrap());
        let _ = fs::remove_dir_all(&dir);
        assert!(r.ok);
        assert_eq!((branch.as_deref(), content.as_str()), (Some("other"), "from other"));
    }

    #[test]
    fn checkout_stash_switches_and_keeps_the_changes_that_do_not_conflict() {
        let dir = scratch("stash-ok");
        fs::write(dir.join("a.txt"), "a").unwrap();
        commit(&dir, "Init", &["a.txt".into()]).unwrap();
        git(&dir, &["branch", "other"]);
        fs::write(dir.join("a.txt"), "changed").unwrap();
        fs::write(dir.join("new.txt"), "new").unwrap();
        let r = checkout_with(&dir, "other", Some("stash")).unwrap();
        let (branch, a, new) = (overview(&dir).unwrap().branch, fs::read_to_string(dir.join("a.txt")).unwrap(), dir.join("new.txt").exists());
        let _ = fs::remove_dir_all(&dir);
        assert!(r.ok, "{}", r.text);
        assert_eq!((branch.as_deref(), a.as_str(), new), (Some("other"), "changed", true));
    }

    #[test]
    fn create_branch_from_a_remote_branch_takes_the_chosen_mode_for_files_in_the_way() {
        // `origin/other` has x.txt; the working copy has its own untracked x.txt.
        let remote = std::env::temp_dir().join(format!("forge-app-git-cbmode-remote-{}", std::process::id()));
        let _ = fs::remove_dir_all(&remote);
        fs::create_dir_all(&remote).unwrap();
        git(&remote, &["init", "--bare", "--quiet", "-b", "main"]);
        let dir = clash("cbmode");
        git(&dir, &["remote", "add", "origin", remote.to_str().unwrap()]);
        git(&dir, &["push", "--quiet", "origin", "main", "other"]);
        git(&dir, &["fetch", "--quiet", "origin"]);
        git(&dir, &["branch", "-D", "other"]);
        let refused = create_branch(&dir, "other", Some("origin/other")).unwrap();
        let stashed = create_branch_with(&dir, "other", Some("origin/other"), Some("discard")).unwrap();
        let (on, content) = (overview(&dir).unwrap().branch, fs::read_to_string(dir.join("x.txt")).unwrap());
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&remote);
        assert!(!refused.ok && refused.text.contains("would be overwritten by checkout"), "{}", refused.text);
        assert!(stashed.ok, "{}", stashed.text);
        assert_eq!((on.as_deref(), content.as_str()), (Some("other"), "from other"));
    }

    #[test]
    fn pull_with_stash_merges_incoming_commits_over_uncommitted_changes() {
        let remote = std::env::temp_dir().join(format!("forge-app-git-pullstash-remote-{}", std::process::id()));
        let _ = fs::remove_dir_all(&remote);
        fs::create_dir_all(&remote).unwrap();
        git(&remote, &["init", "--bare", "--quiet", "-b", "main"]);
        let a = scratch("pullstash-a");
        git(&a, &["remote", "add", "origin", remote.to_str().unwrap()]);
        fs::write(a.join("one.txt"), "1").unwrap();
        fs::write(a.join("two.txt"), "2").unwrap();
        commit(&a, "Init", &["one.txt".into(), "two.txt".into()]).unwrap();
        git(&a, &["push", "--quiet", "-u", "origin", "main"]);
        let b = std::env::temp_dir().join(format!("forge-app-git-pullstash-b-{}", std::process::id()));
        let _ = fs::remove_dir_all(&b);
        git(&std::env::temp_dir(), &["clone", "--quiet", remote.to_str().unwrap(), b.to_str().unwrap()]);
        // Der andere ändert one.txt und pusht; hier ändert jemand eine Datei lokal, die der Pull ebenfalls ändert.
        git(&b, &["config", "user.email", "t@example.invalid"]);
        git(&b, &["config", "user.name", "T"]);
        fs::write(b.join("one.txt"), "1 from b").unwrap();
        git(&b, &["commit", "--quiet", "-am", "B changes one"]);
        git(&b, &["push", "--quiet"]);
        fs::write(a.join("one.txt"), "1 local").unwrap();
        let refused = pull(&a).unwrap();
        let r = pull_with(&a, Some("stash")).unwrap();
        let left = fs::read_to_string(a.join("one.txt")).unwrap();
        let stashes = String::from_utf8_lossy(&Command::new("git").args(["stash", "list"]).current_dir(&a).output().unwrap().stdout).to_string();
        for d in [&a, &b, &remote] {
            let _ = fs::remove_dir_all(d);
        }
        assert!(!refused.ok, "{}", refused.text);
        // Dieselbe Zeile in beiden: Konflikt beim Zurückholen, der Stash bleibt.
        assert!(!r.ok && r.text.contains("stay in the stash"), "{}", r.text);
        assert!(stashes.contains("Designer: before pull"), "{left}");
    }

    /// Clone of a bare remote with one.txt and two.txt, and a second clone `b` that can push.
    fn pair(name: &str) -> (PathBuf, PathBuf, PathBuf) {
        let remote = std::env::temp_dir().join(format!("forge-app-git-{name}-remote-{}", std::process::id()));
        let _ = fs::remove_dir_all(&remote);
        fs::create_dir_all(&remote).unwrap();
        git(&remote, &["init", "--bare", "--quiet", "-b", "main"]);
        let a = scratch(&format!("{name}-a"));
        git(&a, &["remote", "add", "origin", remote.to_str().unwrap()]);
        fs::write(a.join("one.txt"), "1").unwrap();
        fs::write(a.join("two.txt"), "2").unwrap();
        commit(&a, "Init", &["one.txt".into(), "two.txt".into()]).unwrap();
        git(&a, &["push", "--quiet", "-u", "origin", "main"]);
        let b = std::env::temp_dir().join(format!("forge-app-git-{name}-b-{}", std::process::id()));
        let _ = fs::remove_dir_all(&b);
        git(&std::env::temp_dir(), &["clone", "--quiet", remote.to_str().unwrap(), b.to_str().unwrap()]);
        git(&b, &["config", "user.email", "t@example.invalid"]);
        git(&b, &["config", "user.name", "T"]);
        (remote, a, b)
    }

    #[test]
    fn smart_pull_with_local_changes_and_nothing_new_just_says_up_to_date() {
        let (remote, a, b) = pair("smart-none");
        git(&a, &["config", "pull.rebase", "true"]);
        fs::write(a.join("two.txt"), "2 local").unwrap();
        let r = pull_with(&a, None).unwrap();
        let kept = fs::read_to_string(a.join("two.txt")).unwrap();
        for d in [&a, &b, &remote] {
            let _ = fs::remove_dir_all(d);
        }
        assert!(r.ok && r.text.contains("up to date"), "{}", r.text);
        assert_eq!(kept, "2 local");
    }

    #[test]
    fn smart_pull_brings_local_changes_along_when_the_new_commits_touch_other_files() {
        let (remote, a, b) = pair("smart-other");
        git(&a, &["config", "pull.rebase", "true"]);
        fs::write(b.join("one.txt"), "1 from b").unwrap();
        git(&b, &["commit", "--quiet", "-am", "B changes one"]);
        git(&b, &["push", "--quiet"]);
        fs::write(a.join("two.txt"), "2 local").unwrap();
        fs::write(a.join("new.txt"), "new").unwrap();
        let plain = pull(&a).unwrap();
        let r = pull_with(&a, None).unwrap();
        let (one, two, new) = (fs::read_to_string(a.join("one.txt")).unwrap(), fs::read_to_string(a.join("two.txt")).unwrap(), fs::read_to_string(a.join("new.txt")).unwrap());
        for d in [&a, &b, &remote] {
            let _ = fs::remove_dir_all(d);
        }
        assert!(!plain.ok, "plain pull with rebase should be refused: {}", plain.text);
        assert!(r.ok, "{}", r.text);
        assert_eq!((one.as_str(), two.as_str(), new.as_str()), ("1 from b", "2 local", "new"));
    }

    #[test]
    fn smart_pull_leaves_a_real_overlap_to_git_so_the_ui_can_ask() {
        let (remote, a, b) = pair("smart-overlap");
        fs::write(b.join("one.txt"), "1 from b").unwrap();
        git(&b, &["commit", "--quiet", "-am", "B changes one"]);
        git(&b, &["push", "--quiet"]);
        fs::write(a.join("one.txt"), "1 local").unwrap();
        let r = pull_with(&a, None).unwrap();
        for d in [&a, &b, &remote] {
            let _ = fs::remove_dir_all(d);
        }
        assert!(!r.ok && blocked_by_local_changes(&r.text), "{}", r.text);
    }

    #[test]
    fn checkout_stash_reports_a_conflict_and_keeps_the_stash() {
        let dir = clash("clash-stash");
        let r = checkout_with(&dir, "other", Some("stash")).unwrap();
        let on = overview(&dir).unwrap().branch;
        let stashes = String::from_utf8_lossy(&Command::new("git").args(["stash", "list"]).current_dir(&dir).output().unwrap().stdout).to_string();
        let _ = fs::remove_dir_all(&dir);
        assert_eq!(on.as_deref(), Some("other"));
        assert!(!r.ok && r.text.contains("stay in the stash"), "{}", r.text);
        assert!(stashes.contains("Designer: before switching to other"));
    }

    #[test]
    fn push_of_a_new_local_branch_sets_the_upstream() {
        let remote = std::env::temp_dir().join(format!("forge-app-git-newbranch-remote-{}", std::process::id()));
        let _ = fs::remove_dir_all(&remote);
        fs::create_dir_all(&remote).unwrap();
        git(&remote, &["init", "--bare", "--quiet", "-b", "main"]);
        let dir = scratch("pushnew");
        git(&dir, &["remote", "add", "origin", remote.to_str().unwrap()]);
        fs::write(dir.join("a.txt"), "a").unwrap();
        commit(&dir, "Init", &["a.txt".into()]).unwrap();
        git(&dir, &["push", "--quiet", "-u", "origin", "main"]);
        assert!(create_branch(&dir, "fix/new", None).unwrap().ok);
        fs::write(dir.join("b.txt"), "b").unwrap();
        commit(&dir, "Add b", &["b.txt".into()]).unwrap();
        let out = push(&dir).unwrap();
        assert!(out.ok, "{}", out.text);
        assert!(unpushed(&dir).unwrap().is_empty());
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&remote);
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

/// `git status` lists a new folder as one entry ("dir/"); the commit window needs every file in it.
fn expand_untracked_dirs(root: &Path, files: Vec<GitFileStatus>) -> Vec<GitFileStatus> {
    let mut out = Vec::new();
    for f in files {
        if !f.path.ends_with('/') {
            out.push(f);
            continue;
        }
        let listed = platform::console::command("git")
            .args(["ls-files", "--others", "--exclude-standard", "--", &f.path])
            .current_dir(root)
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).lines().map(str::to_string).collect::<Vec<_>>())
            .unwrap_or_default();
        if listed.is_empty() {
            out.push(f);
        } else {
            out.extend(listed.into_iter().map(|path| GitFileStatus { code: f.code.clone(), path }));
        }
    }
    out
}

fn parse_log(text: &str) -> Vec<GitCommit> {
    text.lines()
        .filter_map(|l| {
            let mut p = l.split('\u{1f}');
            Some(GitCommit { hash: p.next()?.to_string(), author: p.next()?.to_string(), date: p.next()?.to_string(), subject: p.next()?.to_string() })
        })
        .collect()
}

const LOG_FORMAT: &str = "--format=%H%x1f%an%x1f%aI%x1f%s";

fn has_upstream(root: &Path) -> bool {
    platform::console::command("git")
        .args(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
        .current_dir(root)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn log_range(root: &Path, args: &[&str]) -> Vec<GitCommit> {
    let mut all = vec!["log", LOG_FORMAT];
    all.extend_from_slice(args);
    platform::console::command("git").args(all).current_dir(root).output().map(|o| parse_log(&String::from_utf8_lossy(&o.stdout))).unwrap_or_default()
}

/// Local commits that are not on the remote yet, newest first (read-only).
pub fn unpushed(dir: &Path) -> Result<Vec<GitCommit>, String> {
    prepare();
    let root = repo_root(dir)?;
    Ok(if has_upstream(&root) { log_range(&root, &["@{u}..HEAD"]) } else { log_range(&root, &["HEAD", "--not", "--remotes"]) })
}

/// Commits on the remote that a pull would bring in, newest first. Fetches first (changes no file).
pub fn incoming(dir: &Path) -> Result<Vec<GitCommit>, String> {
    prepare();
    let root = repo_root(dir)?;
    let mut fetch_command = platform::console::command("git");
    fetch_command.args(["fetch"]).current_dir(&root);
    let _keys = platform::git::use_ppk_keys(&mut fetch_command, &root);
    let fetch = fetch_command.output().map_err(|e| e.to_string())?;
    if !fetch.status.success() {
        return Err(String::from_utf8_lossy(&fetch.stderr).trim().to_string());
    }
    Ok(if has_upstream(&root) { log_range(&root, &["HEAD..@{u}"]) } else { Vec::new() })
}

/// Pushes the current branch up to the chosen local commit (and the commits before it). The commit
/// must be one of the unpushed ones.
pub fn push_up_to(dir: &Path, hash: &str) -> Result<GitOutput, String> {
    prepare();
    let root = repo_root(dir)?;
    if !unpushed(dir)?.iter().any(|c| c.hash == hash) {
        return Err("This commit is not waiting to be pushed.".into());
    }
    let status = CommandGitOperations::new().status(&root).map_err(|e| e.to_string())?;
    let branch = status.branch.ok_or("There is no current branch (detached HEAD).")?;
    let refspec = format!("{hash}:refs/heads/{branch}");
    // A branch without a counterpart on the server is created and linked on its first push.
    let has_upstream = platform::console::command("git").args(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).current_dir(&root).output().map(|o| o.status.success()).unwrap_or(false);
    let mut args = vec!["push"];
    if !has_upstream {
        args.push("--set-upstream");
    }
    args.extend(["origin", refspec.as_str()]);
    let mut push_command = platform::console::command("git");
    push_command.args(&args).current_dir(&root);
    let _keys = platform::git::use_ppk_keys(&mut push_command, &root);
    let out = push_command.output().map_err(|e| e.to_string())?;
    let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)).trim().to_string();
    Ok(GitOutput { ok: out.status.success(), text })
}
