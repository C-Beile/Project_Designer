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
    // Auf "Username for ..." antwortet der Benutzername (falls gesetzt), sonst das Passwort bzw. der Token.
    std::fs::write(
        &path,
        "@echo off\r\necho %~1| findstr /b /i /c:\"Username\" >nul\r\nif %errorlevel%==0 if defined FORGE_GIT_USER (echo %FORGE_GIT_USER%& exit /b 0)\r\necho %FORGE_GIT_PASSWORD%\r\n",
    )?;
    Ok(path)
}

#[cfg(not(windows))]
fn write_askpass(dir: &Path) -> std::io::Result<PathBuf> {
    use std::os::unix::fs::PermissionsExt;
    let path = dir.join(format!("forge-askpass-{}.sh", std::process::id()));
    std::fs::write(
        &path,
        "#!/bin/sh\ncase \"$1\" in Username*) if [ -n \"$FORGE_GIT_USER\" ]; then printf '%s\\n' \"$FORGE_GIT_USER\"; exit 0; fi ;; esac\nprintf '%s\\n' \"$FORGE_GIT_PASSWORD\"\n",
    )?;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700))?;
    Ok(path)
}

/// Führt `git <args>` mit SSH-Schlüssel und Passwort (nur über Askpass) aus und liefert stdout.
/// Fehlertext ist von Geheimnissen bereinigt. `dir` ist das Arbeitsverzeichnis (None = aktuelles).
pub(crate) fn run_git_auth(dir: Option<&Path>, args: &[&std::ffi::OsStr], ssh_key: Option<&str>, password: Option<&str>) -> Result<String, String> {
    run_git_auth_as(dir, args, ssh_key, None, password)
}

/// Wie `run_git_auth`, mit Benutzername für https-Anmeldungen (der Token ist dann das Passwort).
pub(crate) fn run_git_auth_as(dir: Option<&Path>, args: &[&std::ffi::OsStr], ssh_key: Option<&str>, user: Option<&str>, password: Option<&str>) -> Result<String, String> {
    let mut command = platform::console::command("git");
    // Kein Fenster des Git Credential Managers: Anmeldedaten fragt der Designer selbst im Dialog.
    command.env("GIT_TERMINAL_PROMPT", "0").env("GCM_INTERACTIVE", "never").args(args);
    if let Some(dir) = dir {
        command.current_dir(dir);
    }
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
        if let Some(user) = user.map(str::trim).filter(|u| !u.is_empty()) {
            command.env("FORGE_GIT_USER", user);
        }
        askpass = Some(helper);
    }
    let output = command.output();
    if let Some(helper) = askpass {
        let _ = std::fs::remove_file(helper);
    }
    let output = output.map_err(|e| plugin_api::at!(format!("git could not be started: {e}")))?;
    if !output.status.success() {
        let text = String::from_utf8_lossy(&output.stderr);
        return Err(scrub(text.trim(), &[password.unwrap_or("")]));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Klont `url` nach `dir` (ohne den Ordner anzulegen). Bei einem Fehler wird `dir` wieder gelöscht.
pub fn clone_repo(url: &str, dir: &Path, ssh_key: Option<&str>, password: Option<&str>) -> Result<(), String> {
    use std::ffi::OsStr;
    let result = run_git_auth(None, &[OsStr::new("clone"), OsStr::new("--"), OsStr::new(url), dir.as_os_str()], ssh_key, password);
    if result.is_err() {
        let _ = std::fs::remove_dir_all(dir);
    }
    result.map(|_| ())
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

    #[cfg(windows)]
    #[test]
    fn askpass_answers_username_prompts_with_the_user_and_others_with_the_password() {
        let dir = std::env::temp_dir().join(format!("askpass-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let helper = write_askpass(&dir).unwrap();
        let ask = |prompt: &str, user: Option<&str>| {
            let mut c = std::process::Command::new(&helper);
            c.arg(prompt).env("FORGE_GIT_PASSWORD", "tok3n").env_remove("FORGE_GIT_USER");
            if let Some(u) = user {
                c.env("FORGE_GIT_USER", u);
            }
            String::from_utf8_lossy(&c.output().unwrap().stdout).trim().to_string()
        };
        let results = (ask("Username for 'https://h': ", Some("lion")), ask("Password for 'https://lion@h': ", Some("lion")), ask("Username for 'https://h': ", None));
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(results, ("lion".into(), "tok3n".into(), "tok3n".into()));
    }
}
