//! `git clone` mit den Eingaben des Benutzers. Ein Passwort geht nie auf die Kommandozeile oder in eine
//! Meldung, es erreicht git nur über einen Askpass-Helfer, der während des Klonens existiert.

use std::path::{Path, PathBuf};

/// A repository address git may clone: https, ssh, git and the `git@host:path` form. Anything else
/// (a leading `-`, `ext::` transports, local paths) is refused so the text can never act as an option or a command.
pub fn validate_repository_url(url: &str) -> Result<String, String> {
    let url = url.trim();
    if url.is_empty() {
        return Err("Enter the URL of the repository.".into());
    }
    if url.starts_with('-') || url.chars().any(|c| c.is_control() || c == ' ') {
        return Err("The repository URL is not valid.".into());
    }
    let lower = url.to_ascii_lowercase();
    let ok = ["https://", "http://", "ssh://", "git://"].iter().any(|p| lower.starts_with(p)) || (url.starts_with("git@") && url.contains(':'));
    if !ok {
        return Err("Use an https://, ssh:// or git@host:path address.".into());
    }
    Ok(url.to_string())
}

fn scrub(text: &str, secrets: &[&str]) -> String {
    let mut out = text.to_string();
    for s in secrets.iter().filter(|s| !s.is_empty()) {
        out = out.replace(s, "***");
    }
    out
}

#[cfg(windows)]
fn write_askpass(dir: &Path) -> std::io::Result<PathBuf> {
    let path = dir.join(format!("forge-askpass-{}.cmd", std::process::id()));
    std::fs::write(&path, "@echo off\r\necho %FORGE_GIT_PASSWORD%\r\n")?;
    Ok(path)
}

#[cfg(not(windows))]
fn write_askpass(dir: &Path) -> std::io::Result<PathBuf> {
    use std::os::unix::fs::PermissionsExt;
    let path = dir.join(format!("forge-askpass-{}.sh", std::process::id()));
    std::fs::write(&path, "#!/bin/sh\nprintf '%s\\n' \"$FORGE_GIT_PASSWORD\"\n")?;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700))?;
    Ok(path)
}

/// Klont `url` nach `dir` (ohne den Ordner anzulegen). Bei einem Fehler wird `dir` wieder gelöscht.
pub fn clone_repo(url: &str, dir: &Path, ssh_key: Option<&str>, password: Option<&str>) -> Result<(), String> {
    let mut command = platform::console::command("git");
    command.env("GIT_TERMINAL_PROMPT", "0").args(["clone", "--"]).arg(url).arg(dir);
    let key = ssh_key.map(str::trim).filter(|k| !k.is_empty());
    let mut ssh = String::from("ssh -o StrictHostKeyChecking=accept-new");
    if let Some(key) = key {
        if !Path::new(key).is_file() {
            return Err("The SSH key file was not found.".into());
        }
        ssh.push_str(&format!(" -i \"{}\" -o IdentitiesOnly=yes", key.replace('\\', "/")));
    }
    command.env("GIT_SSH_COMMAND", ssh);
    let password = password.filter(|p| !p.is_empty());
    let mut askpass = None;
    if let Some(password) = password {
        let helper = write_askpass(&std::env::temp_dir()).map_err(|e| plugin_api::at!(format!("The password helper could not be created: {e}")))?;
        command.env("GIT_ASKPASS", &helper).env("SSH_ASKPASS", &helper).env("SSH_ASKPASS_REQUIRE", "force").env("FORGE_GIT_PASSWORD", password);
        askpass = Some(helper);
    }
    let output = command.output();
    if let Some(helper) = askpass {
        let _ = std::fs::remove_file(helper);
    }
    let output = output.map_err(|e| plugin_api::at!(format!("git could not be started: {e}")))?;
    if !output.status.success() {
        let _ = std::fs::remove_dir_all(dir);
        let text = String::from_utf8_lossy(&output.stderr);
        return Err(scrub(text.trim(), &[password.unwrap_or("")]));
    }
    Ok(())
}

/// Klont das Repository nach `<location>/<name>` und gibt diesen Ordner zurück.
pub fn clone_repository(url: &str, location: &str, name: &str, ssh_key: Option<&str>, password: Option<&str>) -> Result<PathBuf, String> {
    let url = validate_repository_url(url)?;
    let dir = app_base::project_dir::target_dir(location, name)?;
    clone_repo(&url, &dir, ssh_key, password)?;
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repository_urls_cannot_act_as_options_or_odd_transports() {
        assert!(validate_repository_url("https://github.com/a/b.git").is_ok());
        assert!(validate_repository_url("git@github.com:a/b.git").is_ok());
        assert!(validate_repository_url("ssh://git@host/a/b").is_ok());
        assert!(validate_repository_url("--upload-pack=calc").is_err());
        assert!(validate_repository_url("ext::sh -c calc").is_err());
        assert!(validate_repository_url("C:/local/repo").is_err());
        assert!(validate_repository_url("  ").is_err());
    }

    #[test]
    fn a_password_never_appears_in_an_error() {
        assert_eq!(scrub("fatal: bad secret123 here", &["secret123"]), "fatal: bad *** here");
    }
}
