//! Verknüpfung des Projektordners mit einem Remote-Repository: anzeigen, ändern oder (ohne `.git`)
//! neu herstellen. Dateien im Ordner werden dabei nie überschrieben oder gelöscht.

use crate::clone::{run_git_auth, run_git_auth_as, validate_repository_url};
use crate::git_actions::repo_root;
use serde::Serialize;
use std::ffi::OsStr;
use std::path::Path;

const REMOTE: &str = "origin";

#[derive(Debug, Clone, Serialize)]
pub struct RepoLink {
    /// Der Ordner liegt in einem Git-Repository.
    pub is_repo: bool,
    /// Adresse von `origin`, falls vorhanden.
    pub url: Option<String>,
    pub branch: Option<String>,
}

fn git(dir: &Path, args: &[&str]) -> Result<String, String> {
    let os: Vec<&OsStr> = args.iter().map(OsStr::new).collect();
    run_git_auth(Some(dir), &os, None, None)
}

/// Aktueller Stand der Verknüpfung. Funktioniert auch ohne Repository.
pub fn link_info(dir: &Path) -> RepoLink {
    let Ok(root) = repo_root(dir) else { return RepoLink { is_repo: false, url: None, branch: None } };
    let url = git(&root, &["config", "--get", &format!("remote.{REMOTE}.url")]).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let branch = git(&root, &["symbolic-ref", "--short", "-q", "HEAD"]).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    RepoLink { is_repo: true, url, branch }
}

/// Meldet den Benutzer am https-Remote `origin` an: ein `ls-remote` mit Benutzername und Token. Gelingt es,
/// speichert Git die Daten über den eingestellten Credential-Helper (Windows: Anmeldeinfo), wie vorher
/// über das Fenster des Credential Managers. Danach laufen Pull und Push ohne Nachfrage.
pub fn login(dir: &Path, user: &str, password: &str) -> Result<String, String> {
    let root = repo_root(dir)?;
    let url = link_info(&root).url.ok_or_else(|| "This repository has no remote 'origin'.".to_string())?;
    if !url.to_ascii_lowercase().starts_with("http") {
        return Err("Signing in with a user name and token is only for https:// remotes.".into());
    }
    if user.trim().is_empty() || password.is_empty() {
        return Err("Enter the user name and the access token.".into());
    }
    let args = [OsStr::new("ls-remote"), OsStr::new(REMOTE), OsStr::new("HEAD")];
    run_git_auth_as(Some(&root), &args, None, Some(user), Some(password))?;
    Ok("Signed in.".into())
}

/// Standard-Branch des Remotes (`ls-remote --symref`), sonst `main`/`master`, wenn es sie gibt.
fn remote_default_branch(dir: &Path, ssh_key: Option<&str>, user: Option<&str>, password: Option<&str>) -> Option<String> {
    let args = [OsStr::new("ls-remote"), OsStr::new("--symref"), OsStr::new(REMOTE), OsStr::new("HEAD")];
    if let Ok(out) = run_git_auth_as(Some(dir), &args, ssh_key, user, password) {
        for line in out.lines() {
            if let Some(rest) = line.strip_prefix("ref: refs/heads/") {
                if let Some(name) = rest.split_whitespace().next() {
                    return Some(name.to_string());
                }
            }
        }
    }
    ["main", "master"].into_iter().find(|b| git(dir, &["rev-parse", "--verify", "-q", &format!("refs/remotes/{REMOTE}/{b}")]).is_ok()).map(str::to_string)
}

/// Setzt `origin` auf `url`. Ohne Repository: `git init`. Hat das Repository noch keinen Commit: `origin` anlegen, holen und den Branch
/// des Remotes übernehmen, ohne Dateien zu ändern (die Unterschiede erscheinen als Änderungen).
/// Gibt eine kurze Meldung zurück.
pub fn connect(dir: &Path, url: &str, ssh_key: Option<&str>, user: Option<&str>, password: Option<&str>) -> Result<String, String> {
    let url = validate_repository_url(url)?;
    let existing = repo_root(dir).ok();
    let created = existing.is_none();
    let root = match existing {
        Some(r) => r,
        None => {
            git(dir, &["init"])?;
            dir.to_path_buf()
        }
    };
    // Ein Repository ohne einen einzigen Commit (neu angelegt oder halb verbunden) übernimmt den Branch des Remotes.
    let takeover = git(&root, &["rev-parse", "--verify", "-q", "HEAD"]).is_err();
    let result = link(&root, &url, takeover, ssh_key, user, password);
    if result.is_err() && created {
        // Nur was wir selbst angelegt haben, wird wieder entfernt.
        let _ = std::fs::remove_dir_all(root.join(".git"));
    }
    result
}

fn link(root: &Path, url: &str, takeover: bool, ssh_key: Option<&str>, user: Option<&str>, password: Option<&str>) -> Result<String, String> {
    let has_remote = git(root, &["remote", "get-url", REMOTE]).is_ok();
    git(root, &["remote", if has_remote { "set-url" } else { "add" }, REMOTE, url])?;
    if !takeover {
        return Ok(format!("The remote '{REMOTE}' now points to {url}."));
    }
    let fetch = [OsStr::new("fetch"), OsStr::new(REMOTE)];
    run_git_auth_as(Some(root), &fetch, ssh_key, user, password)?;
    let Some(branch) = remote_default_branch(root, ssh_key, user, password) else {
        return Ok(format!("Connected to {url}. The remote has no branch yet."));
    };
    git(root, &["symbolic-ref", "HEAD", &format!("refs/heads/{branch}")])?;
    git(root, &["reset", "-q", &format!("{REMOTE}/{branch}")])?;
    git(root, &["branch", &format!("--set-upstream-to={REMOTE}/{branch}"), &branch])?;
    Ok(format!("Connected to {url} on branch '{branch}'. Your files were not changed; differences show as changes."))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("git-connect-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_folder_without_git_reports_no_repository() {
        let dir = temp("none");
        let info = link_info(&dir);
        let _ = std::fs::remove_dir_all(&dir);
        assert!(!info.is_repo && info.url.is_none());
    }

    #[test]
    fn connect_keeps_files_and_a_bad_url_leaves_no_git_folder() {
        let dir = temp("bad");
        std::fs::write(dir.join("a.txt"), "x").unwrap();
        assert!(connect(&dir, "--oops", None, None, None).is_err());
        assert!(connect(&dir, "https://127.0.0.1:1/none.git", None, None, None).is_err());
        let left = (dir.join(".git").exists(), dir.join("a.txt").exists());
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(left, (false, true));
    }

    #[test]
    fn connect_to_a_local_remote_takes_over_its_branch_without_touching_files() {
        let remote = temp("remote");
        let work = temp("work");
        let run = |d: &Path, a: &[&str]| git(d, a).unwrap();
        run(&remote, &["init", "-q", "-b", "trunk"]);
        run(&remote, &["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "first"]);
        std::fs::write(work.join("mine.txt"), "mine").unwrap();
        // Lokale Pfade lehnt `validate_repository_url` ab; der Test ruft darum `link` direkt.
        run(&work, &["init", "-q"]);
        let url = remote.to_string_lossy().into_owned();
        let msg = link(&work, &url, true, None, None, None).unwrap();
        let info = link_info(&work);
        let kept = work.join("mine.txt").exists();
        let _ = std::fs::remove_dir_all(&remote);
        let _ = std::fs::remove_dir_all(&work);
        assert!(msg.contains("trunk"));
        assert_eq!(info.branch.as_deref(), Some("trunk"));
        assert!(kept);
    }
}
