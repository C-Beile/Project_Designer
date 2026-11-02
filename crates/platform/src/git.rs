// Basic Git operations (R33, clarified 2026-09-27): commit, pull, push, branch switch/list,
// status - provider-agnostic, working only against whatever remote URL a local repo already has
// configured (GitHub/GitLab/Azure DevOps/etc. are never special-cased). Explicitly NOT in scope:
// PR/MR creation, per-provider OAuth/PAT auth, issues, CI status (architecture.md §9, RISKS.md
// R33) - that would be a real platform-integration feature module, not this small addition.
//
// Shelling out to the system `git` binary via `std::process::Command`, not `git2`/libgit2
// bindings: `git --version` on this machine reports 2.49.0.windows.1 already on PATH, so no
// bindings build is needed, and this stays consistent with how the rest of this crate already
// favors `std::process::Command` (see `windows::shell`, `windows::process`) over pulling in a
// heavier dependency for something the OS already provides.
//
// No OS-specific split under `windows`/`macos` here, same reasoning as `fs::atomic_write`: `git`
// the CLI behaves identically on every target this project cares about (same subcommands, same
// argument shapes), so there is no OS-specific branch to hide behind a trait - this is the
// second genuinely platform-neutral piece of the platform crate's interfaces.

use crate::error::PlatformError;
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct GitCommandOutcome {
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

impl GitCommandOutcome {
    pub fn success(&self) -> bool {
        self.exit_code == Some(0)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct GitFileStatus {
    /// Raw two-character `git status --porcelain=v1` index/worktree code (e.g. "M ", "??", "A ").
    pub code: String,
    pub path: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct GitStatus {
    pub branch: Option<String>,
    pub files: Vec<GitFileStatus>,
}

impl GitStatus {
    pub fn is_clean(&self) -> bool {
        self.files.is_empty()
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct GitBranch {
    pub name: String,
    pub is_current: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct GitCommit {
    pub hash: String,
    pub author: String,
    /// Author date, strict ISO 8601.
    pub date: String,
    pub subject: String,
}

/// Narrow seam around "the handful of Git operations Forge actually needs" (R33: commit, pull,
/// push, branch switch/list, status). Deliberately not a general Git-porcelain wrapper - no
/// merge/rebase/stash/tag surface, since nothing in the current spec calls for it and a wider
/// trait would just be unused surface to keep in sync with `git`'s own CLI.
pub trait GitOperations: Send + Sync {
    /// `git status --porcelain=v1 --branch` against `repo`, parsed into files + current branch.
    fn status(&self, repo: &Path) -> Result<GitStatus, PlatformError>;

    /// Stages every already-tracked-or-new change under `repo` (`git add -A`) and commits with
    /// `message`. Returns the raw command outcome rather than a parsed commit hash - callers that
    /// need the hash can call `status`/`git rev-parse` themselves; keeping this method's
    /// contract to "did the commit happen" avoids parsing `git commit`'s output format.
    fn commit(&self, repo: &Path, message: &str) -> Result<GitCommandOutcome, PlatformError>;

    /// `git pull` on `repo`'s current branch, against whatever remote it already has configured.
    fn pull(&self, repo: &Path) -> Result<GitCommandOutcome, PlatformError>;

    /// `git push` on `repo`'s current branch, against whatever remote it already has configured.
    fn push(&self, repo: &Path) -> Result<GitCommandOutcome, PlatformError>;

    /// Switches `repo`'s working tree to `branch` (`git checkout <branch>`). Only switches
    /// between existing branches - creating a new branch is deliberately out of this trait's
    /// R33 scope (not requested; `checkout -b` can be added later if that changes).
    fn checkout_branch(&self, repo: &Path, branch: &str) -> Result<GitCommandOutcome, PlatformError>;

    /// Lists local branches of `repo`, marking whichever one is currently checked out.
    fn list_branches(&self, repo: &Path) -> Result<Vec<GitBranch>, PlatformError>;

    /// Read-only `git log` of one file, newest first, following renames. `repo` is any directory
    /// inside the work tree; `file` is the absolute path of the file. A repository without
    /// commits yields an empty list; a directory outside any repository is an error.
    fn file_log(&self, repo: &Path, file: &Path, limit: usize) -> Result<Vec<GitCommit>, PlatformError>;

    /// Stages exactly `paths` (relative to `repo`) and commits them with `message`; nothing else
    /// in the work tree is touched. Used by the UI, where the user picks the files to commit.
    fn commit_paths(&self, repo: &Path, message: &str, paths: &[String]) -> Result<GitCommandOutcome, PlatformError>;

    /// Read-only `git log` of the whole current branch, newest first.
    fn log(&self, repo: &Path, limit: usize) -> Result<Vec<GitCommit>, PlatformError>;
}

/// Shells out to the system `git` binary found on `PATH`.
#[derive(Default)]
pub struct CommandGitOperations;

impl CommandGitOperations {
    pub fn new() -> Self {
        Self
    }

    fn run(&self, repo: &Path, args: &[&str]) -> Result<GitCommandOutcome, PlatformError> {
        let program = PathBuf::from("git");
        let output = crate::console::command(&program)
            .args(args)
            .current_dir(repo)
            .output()
            .map_err(|source| PlatformError::Spawn { program: program.display().to_string(), source })?;

        Ok(GitCommandOutcome {
            exit_code: output.status.code(),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
    }
}

impl GitOperations for CommandGitOperations {
    fn status(&self, repo: &Path) -> Result<GitStatus, PlatformError> {
        let outcome = self.run(repo, &["status", "--porcelain=v1", "--branch"])?;
        if !outcome.success() {
            return Err(PlatformError::Git { operation: "status".into(), detail: outcome.stderr });
        }

        let mut branch = None;
        let mut files = Vec::new();
        for line in outcome.stdout.lines() {
            if let Some(header) = line.strip_prefix("## ") {
                // `--branch` prints one leading "## <branch>...<upstream info>" line; take just
                // the branch name, dropping any "...origin/x [ahead 1]" upstream tracking suffix.
                branch = header.split("...").next().and_then(|b| b.split(' ').next()).map(str::to_string).filter(|s| !s.is_empty());
                continue;
            }
            if line.len() < 3 {
                continue;
            }
            let (code, path) = line.split_at(2);
            files.push(GitFileStatus { code: code.to_string(), path: path.trim_start().to_string() });
        }

        Ok(GitStatus { branch, files })
    }

    fn commit(&self, repo: &Path, message: &str) -> Result<GitCommandOutcome, PlatformError> {
        let add_outcome = self.run(repo, &["add", "-A"])?;
        if !add_outcome.success() {
            return Err(PlatformError::Git { operation: "add".into(), detail: add_outcome.stderr });
        }
        self.run(repo, &["commit", "-m", message])
    }

    fn pull(&self, repo: &Path) -> Result<GitCommandOutcome, PlatformError> {
        self.run(repo, &["pull"])
    }

    fn push(&self, repo: &Path) -> Result<GitCommandOutcome, PlatformError> {
        self.run(repo, &["push"])
    }

    fn checkout_branch(&self, repo: &Path, branch: &str) -> Result<GitCommandOutcome, PlatformError> {
        self.run(repo, &["checkout", branch])
    }

    fn list_branches(&self, repo: &Path) -> Result<Vec<GitBranch>, PlatformError> {
        let outcome = self.run(repo, &["branch", "--list"])?;
        if !outcome.success() {
            return Err(PlatformError::Git { operation: "branch --list".into(), detail: outcome.stderr });
        }

        let branches = outcome
            .stdout
            .lines()
            .filter_map(|line| {
                let is_current = line.starts_with('*');
                let name = line.trim_start_matches('*').trim();
                (!name.is_empty()).then(|| GitBranch { name: name.to_string(), is_current })
            })
            .collect();
        Ok(branches)
    }

    fn commit_paths(&self, repo: &Path, message: &str, paths: &[String]) -> Result<GitCommandOutcome, PlatformError> {
        if paths.is_empty() {
            return Err(PlatformError::Git { operation: "commit".into(), detail: "no files selected".into() });
        }
        let mut add: Vec<&str> = vec!["add", "-A", "--"];
        add.extend(paths.iter().map(String::as_str));
        let add_outcome = self.run(repo, &add)?;
        if !add_outcome.success() {
            return Err(PlatformError::Git { operation: "add".into(), detail: add_outcome.stderr });
        }
        let mut commit: Vec<&str> = vec!["commit", "-m", message, "--only", "--"];
        commit.extend(paths.iter().map(String::as_str));
        self.run(repo, &commit)
    }

    fn log(&self, repo: &Path, limit: usize) -> Result<Vec<GitCommit>, PlatformError> {
        let count = format!("-n{}", limit.max(1));
        let outcome = self.run(repo, &["log", &count, "--format=%H%x1f%an%x1f%aI%x1f%s%x1e"])?;
        if !outcome.success() {
            if outcome.stderr.contains("does not have any commits") {
                return Ok(Vec::new());
            }
            return Err(PlatformError::Git { operation: "log".into(), detail: outcome.stderr });
        }
        Ok(parse_file_log(&outcome.stdout))
    }

    fn file_log(&self, repo: &Path, file: &Path, limit: usize) -> Result<Vec<GitCommit>, PlatformError> {
        let inside = self.run(repo, &["rev-parse", "--is-inside-work-tree"])?;
        if !inside.success() {
            return Err(PlatformError::Git { operation: "rev-parse".into(), detail: inside.stderr });
        }
        let count = format!("-n{}", limit.max(1));
        let file_arg = file.to_string_lossy().into_owned();
        let outcome = self.run(
            repo,
            &["log", &count, "--follow", "--format=%H%x1f%an%x1f%aI%x1f%s%x1e", "--", &file_arg],
        )?;
        if !outcome.success() {
            // A freshly initialised repository has no HEAD yet; that is an empty history, not a failure.
            if outcome.stderr.contains("does not have any commits") {
                return Ok(Vec::new());
            }
            return Err(PlatformError::Git { operation: "log".into(), detail: outcome.stderr });
        }
        Ok(parse_file_log(&outcome.stdout))
    }
}

fn parse_file_log(raw: &str) -> Vec<GitCommit> {
    raw.split('\u{1e}')
        .filter_map(|record| {
            let mut parts = record.trim_start_matches(['\r', '\n']).split('\u{1f}');
            let hash = parts.next()?.trim();
            if hash.is_empty() {
                return None;
            }
            Some(GitCommit {
                hash: hash.to_string(),
                author: parts.next()?.to_string(),
                date: parts.next()?.to_string(),
                subject: parts.next().unwrap_or_default().trim_end().to_string(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command as StdCommand;

    /// Scratch-only test fixture: creates a brand-new local repo (and, for push/pull tests, a
    /// second local bare repo as its remote) under the OS temp dir, never touching any real
    /// project repo. Per packager.md this is the ONLY kind of repo these tests are allowed to
    /// run Git operations against.
    struct ScratchRepo {
        dir: PathBuf,
    }

    impl ScratchRepo {
        fn init(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("forge-platform-git-test-{name}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            let status = StdCommand::new("git").args(["init", "--quiet"]).current_dir(&dir).status().unwrap();
            assert!(status.success());
            // Deterministic author identity so `git commit` never falls back to interactively
            // prompting/failing on a machine with no global user.name/user.email configured.
            StdCommand::new("git").args(["config", "user.email", "forge-test@example.invalid"]).current_dir(&dir).status().unwrap();
            StdCommand::new("git").args(["config", "user.name", "Forge Test"]).current_dir(&dir).status().unwrap();
            Self { dir }
        }

        fn init_bare(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("forge-platform-git-test-{name}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            let status =
                StdCommand::new("git").args(["init", "--bare", "--quiet"]).current_dir(&dir).status().unwrap();
            assert!(status.success());
            Self { dir }
        }

        fn write_file(&self, name: &str, contents: &str) {
            std::fs::write(self.dir.join(name), contents).unwrap();
        }
    }

    impl Drop for ScratchRepo {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    #[test]
    fn status_reports_a_clean_repo_after_the_first_commit() {
        let repo = ScratchRepo::init("status-clean");
        let git = CommandGitOperations::new();
        repo.write_file("readme.txt", "hello");
        git.commit(&repo.dir, "initial commit").unwrap();

        let status = git.status(&repo.dir).unwrap();

        assert!(status.is_clean(), "status = {status:?}");
    }

    #[test]
    fn status_lists_an_untracked_file_before_it_is_committed() {
        let repo = ScratchRepo::init("status-untracked");
        let git = CommandGitOperations::new();
        repo.write_file("new-file.txt", "not committed yet");

        let status = git.status(&repo.dir).unwrap();

        assert!(!status.is_clean());
        assert!(status.files.iter().any(|f| f.path == "new-file.txt" && f.code == "??"));
    }

    #[test]
    fn commit_stages_and_commits_a_new_file() {
        let repo = ScratchRepo::init("commit");
        let git = CommandGitOperations::new();
        repo.write_file("a.txt", "content");

        let outcome = git.commit(&repo.dir, "add a.txt").unwrap();

        assert!(outcome.success(), "outcome = {outcome:?}");
        let status = git.status(&repo.dir).unwrap();
        assert!(status.is_clean(), "status after commit = {status:?}");
    }

    #[test]
    fn list_branches_marks_the_current_branch_after_an_initial_commit() {
        let repo = ScratchRepo::init("list-branches");
        let git = CommandGitOperations::new();
        repo.write_file("a.txt", "content");
        git.commit(&repo.dir, "initial commit").unwrap();

        let branches = git.list_branches(&repo.dir).unwrap();

        assert_eq!(branches.len(), 1, "branches = {branches:?}");
        assert!(branches[0].is_current);
    }

    #[test]
    fn checkout_branch_switches_the_current_branch() {
        let repo = ScratchRepo::init("checkout");
        let git = CommandGitOperations::new();
        repo.write_file("a.txt", "content");
        git.commit(&repo.dir, "initial commit").unwrap();
        StdCommand::new("git").args(["branch", "feature-x"]).current_dir(&repo.dir).status().unwrap();

        let outcome = git.checkout_branch(&repo.dir, "feature-x").unwrap();

        assert!(outcome.success(), "outcome = {outcome:?}");
        let status = git.status(&repo.dir).unwrap();
        assert_eq!(status.branch.as_deref(), Some("feature-x"));
    }

    #[test]
    fn file_log_lists_only_commits_touching_the_file_newest_first() {
        let repo = ScratchRepo::init("file-log");
        let git = CommandGitOperations::new();
        repo.write_file("a.txt", "one");
        git.commit(&repo.dir, "add a").unwrap();
        repo.write_file("b.txt", "other");
        git.commit(&repo.dir, "add b").unwrap();
        repo.write_file("a.txt", "two");
        git.commit(&repo.dir, "change a").unwrap();

        let log = git.file_log(&repo.dir, &repo.dir.join("a.txt"), 50).unwrap();

        let subjects: Vec<&str> = log.iter().map(|c| c.subject.as_str()).collect();
        assert_eq!(subjects, ["change a", "add a"]);
        assert_eq!(log[0].author, "Forge Test");
        assert_eq!(log[0].hash.len(), 40);
        assert!(log[0].date.contains('T'), "date = {}", log[0].date);
        assert_eq!(git.file_log(&repo.dir, &repo.dir.join("a.txt"), 1).unwrap().len(), 1);
    }

    #[test]
    fn file_log_of_a_repository_without_commits_is_empty() {
        let repo = ScratchRepo::init("file-log-empty");
        let git = CommandGitOperations::new();
        repo.write_file("a.txt", "one");
        assert!(git.file_log(&repo.dir, &repo.dir.join("a.txt"), 50).unwrap().is_empty());
    }

    #[test]
    fn file_log_outside_a_repository_is_an_error() {
        let dir = std::env::temp_dir().join(format!("forge-platform-git-test-norepo-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let result = CommandGitOperations::new().file_log(&dir, &dir.join("a.txt"), 50);
        std::fs::remove_dir_all(&dir).ok();
        assert!(result.is_err());
    }

    #[test]
    fn parse_file_log_handles_empty_output_and_subjects_with_spaces() {
        assert!(parse_file_log("").is_empty());
        let parsed = parse_file_log("abc\u{1f}Jane Doe\u{1f}2026-01-02T03:04:05+01:00\u{1f}fix: a b c\u{1e}\ndef\u{1f}X\u{1f}d\u{1f}s\u{1e}\n");
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].subject, "fix: a b c");
        assert_eq!(parsed[1].hash, "def");
    }

    #[test]
    fn push_and_pull_round_trip_through_a_local_bare_remote() {
        // Local bare repo standing in for "any remote host" (R33: provider-agnostic) - no real
        // network/GitHub/GitLab/Azure DevOps access, per packager.md's explicit ban on that.
        let remote = ScratchRepo::init_bare("remote");
        let origin = ScratchRepo::init("push-origin");
        let git = CommandGitOperations::new();
        StdCommand::new("git")
            .args(["remote", "add", "origin", remote.dir.to_str().unwrap()])
            .current_dir(&origin.dir)
            .status()
            .unwrap();
        origin.write_file("a.txt", "content");
        git.commit(&origin.dir, "initial commit").unwrap();
        StdCommand::new("git")
            .args(["push", "--set-upstream", "origin", "master"])
            .current_dir(&origin.dir)
            .status()
            .unwrap();

        let clone = ScratchRepo::init("push-clone");
        // `git clone` needs an empty target dir; re-clone into the already-created scratch dir.
        let _ = std::fs::remove_dir_all(&clone.dir);
        let clone_status = StdCommand::new("git")
            .args(["clone", "--quiet", remote.dir.to_str().unwrap(), clone.dir.to_str().unwrap()])
            .status()
            .unwrap();
        assert!(clone_status.success());

        // Push a second commit from `origin`, then pull it into `clone` through the trait.
        origin.write_file("b.txt", "more content");
        git.commit(&origin.dir, "second commit").unwrap();
        let push_outcome = git.push(&origin.dir).unwrap();
        assert!(push_outcome.success(), "push outcome = {push_outcome:?}");

        let pull_outcome = git.pull(&clone.dir).unwrap();

        assert!(pull_outcome.success(), "pull outcome = {pull_outcome:?}");
        assert!(clone.dir.join("b.txt").exists(), "pulled file should now exist in the clone");
    }
}
