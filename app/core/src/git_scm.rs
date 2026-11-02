//! Source Control of the main window: staged and unstaged changes, stage / unstage / discard,
//! commit of the staged files, the two sides of a diff, gutter hunks of one file and the files of
//! a commit. Local Git only (no platform integration, no pull requests).
//!
//! Business rules: every writing call here is the direct result of one click in the Source Control
//! panel, nothing runs by itself. `package-lock.json` is never staged by "Stage All" and a commit
//! refuses while it is staged. Discarding keeps a copy of the file in the backup folder first, so
//! nothing is lost for good. Commit messages are a single line without a co-author trailer.
//!
//! Git runs as an external process (`git2` is not available offline); every call goes through
//! `platform::console`, so no console window appears.

use crate::git_actions::{validate_message, GitOutput};
use platform::{GitBranch, GitCommit};
use serde::Serialize;
use std::path::{Component, Path, PathBuf};

const DIFF_LIMIT_BYTES: usize = 2 * 1024 * 1024;
const FILE_LIMIT: usize = 5000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ScmFile {
    /// Path relative to the repository root, with forward slashes.
    pub path: String,
    /// Status in the index (`M`, `A`, `D`, `R`, `C`, `U`, space) and in the work tree (`M`, `D`, `?`, space).
    pub index: char,
    pub worktree: char,
    /// Old path of a rename.
    pub from: Option<String>,
}

impl ScmFile {
    pub fn staged(&self) -> bool {
        self.index != ' ' && self.index != '?' && self.index != '!'
    }
    pub fn unstaged(&self) -> bool {
        self.worktree != ' ' || self.index == '?'
    }
    pub fn untracked(&self) -> bool {
        self.index == '?'
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ScmOverview {
    pub root: String,
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub files: Vec<ScmFile>,
    /// More changes than the panel lists (it stops at a limit).
    pub truncated: bool,
    pub branches: Vec<GitBranch>,
    pub remote_branches: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiffContent {
    pub original: String,
    pub modified: String,
    pub binary: bool,
    pub too_large: bool,
}

/// One changed block of a file against HEAD, in lines of the current file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Hunk {
    /// `added`, `modified` or `deleted` (a marker between lines).
    pub kind: String,
    pub start: u32,
    pub count: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct Gutter {
    pub untracked: bool,
    pub hunks: Vec<Hunk>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CommitFile {
    pub status: char,
    pub path: String,
}

pub fn is_package_lock(path: &str) -> bool {
    path.rsplit('/').next() == Some("package-lock.json")
}

fn git(root: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    std::env::set_var("GIT_TERMINAL_PROMPT", "0");
    platform::console::command("git")
        .args(args)
        .current_dir(root)
        .output()
        .map_err(|e| format!("git could not be started: {e}"))
}

fn text(out: &std::process::Output) -> String {
    format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)).trim().to_string()
}

fn run(root: &Path, args: &[&str]) -> Result<GitOutput, String> {
    let out = git(root, args)?;
    Ok(GitOutput { ok: out.status.success(), text: text(&out) })
}

fn has_head(root: &Path) -> bool {
    git(root, &["rev-parse", "--verify", "-q", "HEAD"]).map(|o| o.status.success()).unwrap_or(false)
}

/// A path the UI may hand to git: relative, inside the repository, no option look-alike.
pub fn validate_rel_path(path: &str) -> Result<String, String> {
    let p = path.trim().replace('\\', "/");
    if p.is_empty() || p.starts_with('-') || p.starts_with('/') || p.contains(':') || p.contains('\0') {
        return Err(format!("'{path}' is not a path inside the repository."));
    }
    if Path::new(&p).components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(format!("'{path}' leaves the repository."));
    }
    Ok(p)
}

fn parse_branch_header(header: &str) -> (Option<String>, Option<String>, u32, u32) {
    let h = header.trim_start_matches("## ");
    if h.starts_with("No commits yet on ") {
        return (Some(h.trim_start_matches("No commits yet on ").to_string()), None, 0, 0);
    }
    if h.starts_with("HEAD (no branch)") {
        return (None, None, 0, 0);
    }
    let (names, tracking) = match h.split_once(" [") {
        Some((n, t)) => (n, t.trim_end_matches(']')),
        None => (h, ""),
    };
    let (branch, upstream) = match names.split_once("...") {
        Some((b, u)) => (b.to_string(), Some(u.to_string())),
        None => (names.to_string(), None),
    };
    let mut ahead = 0;
    let mut behind = 0;
    for part in tracking.split(", ") {
        if let Some(n) = part.strip_prefix("ahead ") {
            ahead = n.trim().parse().unwrap_or(0);
        } else if let Some(n) = part.strip_prefix("behind ") {
            behind = n.trim().parse().unwrap_or(0);
        }
    }
    (Some(branch), upstream, ahead, behind)
}

/// Parses `git status --porcelain=v1 -z --branch` output.
pub fn parse_status(raw: &[u8]) -> (Option<String>, Option<String>, u32, u32, Vec<ScmFile>) {
    let mut entries = raw.split(|b| *b == 0).filter(|e| !e.is_empty());
    let mut branch = None;
    let mut upstream = None;
    let (mut ahead, mut behind) = (0, 0);
    let mut files = Vec::new();
    while let Some(entry) = entries.next() {
        let s = String::from_utf8_lossy(entry).into_owned();
        if s.starts_with("## ") {
            (branch, upstream, ahead, behind) = parse_branch_header(&s);
            continue;
        }
        let mut chars = s.chars();
        let (Some(x), Some(y)) = (chars.next(), chars.next()) else { continue };
        let path: String = s.chars().skip(3).collect();
        let from = if x == 'R' || x == 'C' || y == 'R' || y == 'C' { entries.next().map(|o| String::from_utf8_lossy(o).into_owned()) } else { None };
        files.push(ScmFile { path, index: x, worktree: y, from });
    }
    (branch, upstream, ahead, behind, files)
}

pub fn status(dir: &Path) -> Result<ScmOverview, String> {
    let root = crate::git_actions::repo_root(dir)?;
    let out = git(&root, &["status", "--porcelain=v1", "-z", "--branch", "--untracked-files=all"])?;
    if !out.status.success() {
        return Err(text(&out));
    }
    let (branch, upstream, ahead, behind, mut files) = parse_status(&out.stdout);
    let truncated = files.len() > FILE_LIMIT;
    files.truncate(FILE_LIMIT);
    let ops = platform::CommandGitOperations::new();
    use platform::GitOperations;
    let branches = ops.list_branches(&root).map_err(|e| e.to_string())?;
    let remote_branches = remote_branch_names(&root);
    Ok(ScmOverview { root: root.to_string_lossy().into_owned(), branch, upstream, ahead, behind, files, truncated, branches, remote_branches })
}

fn remote_branch_names(root: &Path) -> Vec<String> {
    let Ok(out) = git(root, &["branch", "-r", "--format=%(refname:short)"]) else { return Vec::new() };
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.ends_with("/HEAD") && *l != "origin")
        .map(str::to_string)
        .collect()
}

pub fn history(dir: &Path, limit: usize) -> Result<Vec<GitCommit>, String> {
    let root = crate::git_actions::repo_root(dir)?;
    use platform::GitOperations;
    platform::CommandGitOperations::new().log(&root, limit).map_err(|e| e.to_string())
}

/// Every given path must have a pending change; returns the validated list.
fn checked_paths(root: &Path, paths: &[String]) -> Result<(Vec<String>, Vec<ScmFile>), String> {
    if paths.is_empty() {
        return Err("No files selected.".into());
    }
    let out = git(root, &["status", "--porcelain=v1", "-z", "--untracked-files=all"])?;
    let (_, _, _, _, files) = parse_status(&out.stdout);
    let mut clean = Vec::new();
    for p in paths {
        let p = validate_rel_path(p)?;
        if !files.iter().any(|f| f.path == p) {
            return Err(format!("{p} has no pending change."));
        }
        clean.push(p);
    }
    Ok((clean, files))
}

fn with_paths<'a>(head: &[&'a str], paths: &'a [String]) -> Vec<&'a str> {
    let mut v: Vec<&str> = head.to_vec();
    v.push("--");
    v.extend(paths.iter().map(String::as_str));
    v
}

pub fn stage(dir: &Path, paths: &[String]) -> Result<GitOutput, String> {
    let root = crate::git_actions::repo_root(dir)?;
    let (clean, _) = checked_paths(&root, paths)?;
    run(&root, &with_paths(&["add"], &clean))
}

/// Stages every change except `package-lock.json`.
pub fn stage_all(dir: &Path) -> Result<GitOutput, String> {
    let root = crate::git_actions::repo_root(dir)?;
    let out = git(&root, &["status", "--porcelain=v1", "-z", "--untracked-files=all"])?;
    let (_, _, _, _, files) = parse_status(&out.stdout);
    let paths: Vec<String> = files.iter().filter(|f| f.unstaged() && !is_package_lock(&f.path)).map(|f| f.path.clone()).collect();
    if paths.is_empty() {
        return Ok(GitOutput { ok: true, text: "Nothing to stage.".into() });
    }
    run(&root, &with_paths(&["add"], &paths))
}

pub fn unstage(dir: &Path, paths: &[String]) -> Result<GitOutput, String> {
    let root = crate::git_actions::repo_root(dir)?;
    let (clean, _) = checked_paths(&root, paths)?;
    if has_head(&root) {
        run(&root, &with_paths(&["restore", "--staged"], &clean))
    } else {
        run(&root, &with_paths(&["rm", "--cached", "-q", "-r"], &clean))
    }
}

/// Throws away the work-tree changes of the files; a copy of each file goes to the backup folder first.
pub fn discard(dir: &Path, paths: &[String]) -> Result<GitOutput, String> {
    let root = crate::git_actions::repo_root(dir)?;
    let (clean, files) = checked_paths(&root, paths)?;
    let mut tracked = Vec::new();
    let mut untracked = Vec::new();
    for p in &clean {
        let abs = root.join(p);
        if abs.is_file() {
            crate::backup::backup_file(&abs)?;
        }
        if files.iter().any(|f| &f.path == p && f.untracked()) {
            untracked.push(p.clone());
        } else {
            tracked.push(p.clone());
        }
    }
    let mut text = String::new();
    let mut ok = true;
    if !tracked.is_empty() {
        let r = run(&root, &with_paths(&["restore"], &tracked))?;
        ok &= r.ok;
        text.push_str(&r.text);
    }
    if !untracked.is_empty() {
        let r = run(&root, &with_paths(&["clean", "-f", "-q"], &untracked))?;
        ok &= r.ok;
        text.push_str(&r.text);
    }
    Ok(GitOutput { ok, text })
}

/// Commits what is staged; nothing else in the work tree is touched.
pub fn commit_staged(dir: &Path, message: &str) -> Result<GitOutput, String> {
    let msg = validate_message(message)?;
    let root = crate::git_actions::repo_root(dir)?;
    let out = git(&root, &["status", "--porcelain=v1", "-z", "--untracked-files=no"])?;
    let (_, _, _, _, files) = parse_status(&out.stdout);
    let staged: Vec<&ScmFile> = files.iter().filter(|f| f.staged()).collect();
    if staged.is_empty() {
        return Err("Nothing is staged. Stage the files to commit first.".into());
    }
    if let Some(lock) = staged.iter().find(|f| is_package_lock(&f.path)) {
        return Err(format!("{} is staged. It is never committed from here; unstage it first.", lock.path));
    }
    run(&root, &["commit", "-m", &msg])
}

/// Pull, then push when the pull went through.
pub fn sync(dir: &Path) -> Result<GitOutput, String> {
    let pulled = crate::git_actions::pull(dir)?;
    if !pulled.ok {
        return Ok(pulled);
    }
    let pushed = crate::git_actions::push(dir)?;
    Ok(GitOutput { ok: pushed.ok, text: format!("{}\n{}", pulled.text, pushed.text).trim().to_string() })
}

fn blob(root: &Path, spec: &str) -> Result<Option<Vec<u8>>, String> {
    let out = git(root, &["show", spec])?;
    Ok(if out.status.success() { Some(out.stdout) } else { None })
}

fn side_text(bytes: Option<Vec<u8>>, binary: &mut bool, too_large: &mut bool) -> String {
    let Some(b) = bytes else { return String::new() };
    if b.len() > DIFF_LIMIT_BYTES {
        *too_large = true;
        return String::new();
    }
    if b.contains(&0) {
        *binary = true;
        return String::new();
    }
    String::from_utf8_lossy(&b).into_owned()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DiffSide {
    /// Index against work tree.
    Unstaged,
    /// HEAD against index.
    Staged,
    /// Parent of the commit against the commit.
    Commit(String),
}

pub fn diff_sides(dir: &Path, path: &str, side: &DiffSide) -> Result<DiffContent, String> {
    let root = crate::git_actions::repo_root(dir)?;
    let rel = validate_rel_path(path)?;
    let (mut binary, mut too_large) = (false, false);
    let (original, modified) = match side {
        DiffSide::Unstaged => {
            let index = blob(&root, &format!(":{rel}"))?;
            let abs = root.join(&rel);
            let work = std::fs::read(&abs).ok();
            (side_text(index, &mut binary, &mut too_large), side_text(work, &mut binary, &mut too_large))
        }
        DiffSide::Staged => {
            let head = blob(&root, &format!("HEAD:{rel}"))?;
            let index = blob(&root, &format!(":{rel}"))?;
            (side_text(head, &mut binary, &mut too_large), side_text(index, &mut binary, &mut too_large))
        }
        DiffSide::Commit(hash) => {
            if hash.len() < 7 || hash.len() > 40 || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
                return Err("Not a commit id.".into());
            }
            let parent = blob(&root, &format!("{hash}^:{rel}"))?;
            let this = blob(&root, &format!("{hash}:{rel}"))?;
            (side_text(parent, &mut binary, &mut too_large), side_text(this, &mut binary, &mut too_large))
        }
    };
    Ok(DiffContent { original, modified, binary, too_large })
}

pub fn commit_files(dir: &Path, hash: &str) -> Result<Vec<CommitFile>, String> {
    if hash.len() < 7 || hash.len() > 40 || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("Not a commit id.".into());
    }
    let root = crate::git_actions::repo_root(dir)?;
    let out = git(&root, &["show", "--name-status", "--format=", "--no-renames", "-z", hash])?;
    if !out.status.success() {
        return Err(text(&out));
    }
    let raw = String::from_utf8_lossy(&out.stdout).into_owned();
    let mut parts = raw.split('\0').filter(|p| !p.is_empty());
    let mut files = Vec::new();
    while let (Some(status), Some(path)) = (parts.next(), parts.next()) {
        files.push(CommitFile { status: status.chars().next().unwrap_or('M'), path: path.to_string() });
    }
    Ok(files)
}

/// Parses `@@ -a,b +c,d @@` lines of a zero-context diff.
pub fn parse_hunks(diff: &str) -> Vec<Hunk> {
    let mut hunks = Vec::new();
    for line in diff.lines().filter(|l| l.starts_with("@@ ")) {
        let Some(plus) = line.split(' ').find(|t| t.starts_with('+')) else { continue };
        let minus = line.split(' ').find(|t| t.starts_with('-')).unwrap_or("-0");
        let num = |t: &str| -> (u32, u32) {
            let t = &t[1..];
            match t.split_once(',') {
                Some((a, b)) => (a.parse().unwrap_or(0), b.parse().unwrap_or(0)),
                None => (t.parse().unwrap_or(0), 1),
            }
        };
        let (new_start, new_count) = num(plus);
        let (_, old_count) = num(minus);
        let kind = if new_count == 0 {
            "deleted"
        } else if old_count == 0 {
            "added"
        } else {
            "modified"
        };
        hunks.push(Hunk { kind: kind.into(), start: new_start.max(1), count: new_count.max(1) });
    }
    hunks
}

/// Changed lines of one file against HEAD (gutter markers of the editor).
pub fn gutter(dir: &Path, file: &Path) -> Result<Gutter, String> {
    let root = crate::git_actions::repo_root(dir)?;
    let rel = file
        .strip_prefix(&root)
        .map(PathBuf::from)
        .or_else(|_| {
            let canon_root = std::fs::canonicalize(&root).map_err(|e| e.to_string())?;
            let canon_file = std::fs::canonicalize(file).map_err(|e| e.to_string())?;
            canon_file.strip_prefix(canon_root).map(PathBuf::from).map_err(|_| "The file is outside the repository.".to_string())
        })?;
    let rel = validate_rel_path(&rel.to_string_lossy())?;
    let tracked = git(&root, &["ls-files", "--error-unmatch", "--", &rel]).map(|o| o.status.success()).unwrap_or(false);
    if !tracked {
        return Ok(Gutter { untracked: true, hunks: Vec::new() });
    }
    let args: Vec<&str> = if has_head(&root) { vec!["diff", "-U0", "--no-color", "--no-ext-diff", "HEAD", "--", &rel] } else { vec!["diff", "-U0", "--no-color", "--cached", "--", &rel] };
    let out = git(&root, &args)?;
    Ok(Gutter { untracked: false, hunks: parse_hunks(&String::from_utf8_lossy(&out.stdout)) })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::process::Command;

    fn sh(dir: &Path, args: &[&str]) {
        let s = Command::new("git").args(args).current_dir(dir).status().unwrap();
        assert!(s.success(), "git {args:?}");
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("forge-scm-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        sh(&dir, &["init", "--quiet", "-b", "main"]);
        sh(&dir, &["config", "user.email", "t@example.invalid"]);
        sh(&dir, &["config", "user.name", "T"]);
        dir
    }

    fn paths(p: &[&str]) -> Vec<String> {
        p.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn status_header_and_entries_are_parsed() {
        let raw = b"## main...origin/main [ahead 2, behind 1]\0 M a.txt\0A  b.txt\0R  new.txt\0old.txt\0?? c.txt\0";
        let (branch, upstream, ahead, behind, files) = parse_status(raw);
        assert_eq!((branch.as_deref(), upstream.as_deref(), ahead, behind), (Some("main"), Some("origin/main"), 2, 1));
        assert_eq!(files.len(), 4);
        assert!(!files[0].staged() && files[0].unstaged());
        assert!(files[1].staged() && !files[1].unstaged());
        assert_eq!(files[2].from.as_deref(), Some("old.txt"));
        assert!(files[3].untracked());
        let (b, u, _, _, _) = parse_status(b"## No commits yet on main\0");
        assert_eq!((b.as_deref(), u), (Some("main"), None));
    }

    #[test]
    fn stage_unstage_and_commit_only_the_staged_files() {
        let dir = scratch("flow");
        fs::write(dir.join("a.txt"), "a").unwrap();
        fs::write(dir.join("b.txt"), "b").unwrap();
        assert!(stage(&dir, &paths(&["a.txt"])).unwrap().ok);
        let o = status(&dir).unwrap();
        assert!(o.files.iter().find(|f| f.path == "a.txt").unwrap().staged());
        assert!(o.files.iter().find(|f| f.path == "b.txt").unwrap().untracked());
        assert!(unstage(&dir, &paths(&["a.txt"])).unwrap().ok);
        assert!(commit_staged(&dir, "Nothing").is_err());
        stage(&dir, &paths(&["a.txt"])).unwrap();
        assert!(commit_staged(&dir, "two\nlines").is_err());
        assert!(commit_staged(&dir, "x Co-Authored-By: y").is_err());
        let c = commit_staged(&dir, "Add a").unwrap();
        assert!(c.ok, "{}", c.text);
        let after = status(&dir).unwrap();
        assert_eq!(after.files.len(), 1);
        assert_eq!(after.files[0].path, "b.txt");
        assert_eq!(history(&dir, 5).unwrap()[0].subject, "Add a");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn stage_all_skips_package_lock_and_commit_refuses_a_staged_one() {
        let dir = scratch("lock");
        fs::write(dir.join("a.txt"), "a").unwrap();
        fs::write(dir.join("package-lock.json"), "{}").unwrap();
        fs::create_dir_all(dir.join("sub")).unwrap();
        fs::write(dir.join("sub").join("package-lock.json"), "{}").unwrap();
        assert!(stage_all(&dir).unwrap().ok);
        let o = status(&dir).unwrap();
        assert!(o.files.iter().find(|f| f.path == "a.txt").unwrap().staged());
        assert!(o.files.iter().filter(|f| is_package_lock(&f.path)).all(|f| f.untracked()));
        stage(&dir, &paths(&["package-lock.json"])).unwrap();
        let err = commit_staged(&dir, "Add").unwrap_err();
        assert!(err.contains("package-lock.json"), "{err}");
        unstage(&dir, &paths(&["package-lock.json"])).unwrap();
        assert!(commit_staged(&dir, "Add").unwrap().ok);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn discard_restores_tracked_files_and_removes_untracked_ones_after_a_backup() {
        let dir = scratch("discard");
        crate::backup::set_backup_dir(std::env::temp_dir().join(format!("forge-scm-backups-{}", std::process::id())));
        fs::write(dir.join("a.txt"), "one").unwrap();
        stage(&dir, &paths(&["a.txt"])).unwrap();
        commit_staged(&dir, "Init").unwrap();
        fs::write(dir.join("a.txt"), "two").unwrap();
        fs::write(dir.join("new.txt"), "n").unwrap();
        assert!(discard(&dir, &paths(&["a.txt", "new.txt"])).unwrap().ok);
        assert_eq!(fs::read_to_string(dir.join("a.txt")).unwrap(), "one");
        assert!(!dir.join("new.txt").exists());
        assert!(discard(&dir, &paths(&["nope.txt"])).is_err());
        assert!(discard(&dir, &paths(&["../x"])).is_err());
        assert!(stage(&dir, &paths(&["--all"])).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn diff_sides_gutter_and_commit_files() {
        let dir = scratch("diff");
        fs::write(dir.join("a.txt"), "1\n2\n3\n").unwrap();
        stage(&dir, &paths(&["a.txt"])).unwrap();
        commit_staged(&dir, "Init").unwrap();
        fs::write(dir.join("a.txt"), "1\nX\n3\n4\n").unwrap();
        let d = diff_sides(&dir, "a.txt", &DiffSide::Unstaged).unwrap();
        assert_eq!((d.original.as_str(), d.modified.as_str()), ("1\n2\n3\n", "1\nX\n3\n4\n"));
        stage(&dir, &paths(&["a.txt"])).unwrap();
        let s = diff_sides(&dir, "a.txt", &DiffSide::Staged).unwrap();
        assert_eq!(s.original, "1\n2\n3\n");
        assert_eq!(s.modified, "1\nX\n3\n4\n");
        commit_staged(&dir, "Change").unwrap();
        let hash = history(&dir, 1).unwrap()[0].hash.clone();
        let c = diff_sides(&dir, "a.txt", &DiffSide::Commit(hash.clone())).unwrap();
        assert_eq!(c.original, "1\n2\n3\n");
        assert_eq!(commit_files(&dir, &hash).unwrap(), vec![CommitFile { status: 'M', path: "a.txt".into() }]);
        assert!(diff_sides(&dir, "a.txt", &DiffSide::Commit("zz; rm".into())).is_err());
        fs::write(dir.join("a.txt"), "1\nY\n3\n4\n5\n").unwrap();
        let g = gutter(&dir, &dir.join("a.txt")).unwrap();
        assert!(!g.untracked);
        assert_eq!(g.hunks, vec![Hunk { kind: "modified".into(), start: 2, count: 1 }, Hunk { kind: "added".into(), start: 5, count: 1 }]);
        fs::write(dir.join("fresh.txt"), "x").unwrap();
        assert!(gutter(&dir, &dir.join("fresh.txt")).unwrap().untracked);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn hunks_of_a_deletion_and_an_addition() {
        let hunks = parse_hunks("@@ -3,2 +2,0 @@\n-a\n-b\n@@ -10,0 +9,3 @@\n+x\n+y\n+z\n");
        assert_eq!(hunks[0], Hunk { kind: "deleted".into(), start: 2, count: 1 });
        assert_eq!(hunks[1], Hunk { kind: "added".into(), start: 9, count: 3 });
    }

    #[test]
    fn sync_pulls_then_pushes_through_a_local_remote() {
        let remote = std::env::temp_dir().join(format!("forge-scm-remote-{}", std::process::id()));
        let _ = fs::remove_dir_all(&remote);
        fs::create_dir_all(&remote).unwrap();
        sh(&remote, &["init", "--bare", "--quiet", "-b", "main"]);
        let dir = scratch("sync");
        sh(&dir, &["remote", "add", "origin", remote.to_str().unwrap()]);
        fs::write(dir.join("a.txt"), "a").unwrap();
        stage(&dir, &paths(&["a.txt"])).unwrap();
        commit_staged(&dir, "Init").unwrap();
        sh(&dir, &["push", "--quiet", "-u", "origin", "main"]);
        fs::write(dir.join("b.txt"), "b").unwrap();
        stage(&dir, &paths(&["b.txt"])).unwrap();
        commit_staged(&dir, "Add b").unwrap();
        let before = status(&dir).unwrap();
        assert_eq!((before.ahead, before.behind), (1, 0));
        assert!(sync(&dir).unwrap().ok);
        assert_eq!(status(&dir).unwrap().ahead, 0);
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&remote);
    }
}
