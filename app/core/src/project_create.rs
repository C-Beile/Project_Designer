//! Creating a project: an empty one, or a clone of a Git repository.
//! The clone runs `git clone` with the settings the user typed; a password never goes to the command line
//! or into a message, it reaches git only through an askpass helper that exists while the clone runs.

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

/// A folder name for the project: one plain name, no path.
pub fn validate_project_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Enter a project name.".into());
    }
    if name == "." || name == ".." || name.chars().any(|c| matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control()) || name.ends_with('.') {
        return Err("The project name must be a plain folder name without path characters.".into());
    }
    Ok(name.to_string())
}

/// `<location>/<name>`, which must not exist yet or be empty.
fn target_dir(location: &str, name: &str) -> Result<PathBuf, String> {
    let name = validate_project_name(name)?;
    let location = location.trim();
    if location.is_empty() {
        return Err("Choose the project location.".into());
    }
    let dir = Path::new(location).join(&name);
    if dir.exists() && std::fs::read_dir(&dir).map(|mut d| d.next().is_some()).unwrap_or(true) {
        return Err(format!("The folder {} already exists and is not empty.", dir.display()));
    }
    std::fs::create_dir_all(location).map_err(|e| format!("The location cannot be created: {e}"))?;
    Ok(dir)
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

/// Clones the repository into `<location>/<name>` and returns that folder.
pub fn clone_repository(url: &str, location: &str, name: &str, ssh_key: Option<&str>, password: Option<&str>) -> Result<PathBuf, String> {
    let url = validate_repository_url(url)?;
    let dir = target_dir(location, name)?;
    let mut command = platform::console::command("git");
    command.env("GIT_TERMINAL_PROMPT", "0").args(["clone", "--"]).arg(&url).arg(&dir);
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
        let helper = write_askpass(&std::env::temp_dir()).map_err(|e| format!("The password helper could not be created: {e}"))?;
        command.env("GIT_ASKPASS", &helper).env("SSH_ASKPASS", &helper).env("SSH_ASKPASS_REQUIRE", "force").env("FORGE_GIT_PASSWORD", password);
        askpass = Some(helper);
    }
    let output = command.output();
    if let Some(helper) = askpass {
        let _ = std::fs::remove_file(helper);
    }
    let output = output.map_err(|e| format!("git could not be started: {e}"))?;
    if !output.status.success() {
        let _ = std::fs::remove_dir_all(&dir);
        let text = String::from_utf8_lossy(&output.stderr);
        return Err(scrub(text.trim(), &[password.unwrap_or("")]));
    }
    Ok(dir)
}

/// Creates an empty project: its package.json (type `project`) and a .gitignore. The folders of the models appear with the first object.
pub fn create_empty_project(location: &str, name: &str) -> Result<PathBuf, String> {
    let dir = target_dir(location, name)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let package_name = name.trim().to_lowercase().replace(' ', "-");
    let package = format!("{{\r\n    \"name\": \"{package_name}\",\r\n    \"version\": \"0.0.1\",\r\n    \"adito\": {{\r\n        \"type\": \"project\"\r\n    }},\r\n    \"dependencies\": {{}}\r\n}}\r\n");
    std::fs::write(dir.join("package.json"), package).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(".gitignore"), "node_modules/\r\ndist/\r\n").map_err(|e| e.to_string())?;
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
    fn project_names_are_plain_folder_names() {
        assert!(validate_project_name("clemens-onboarding").is_ok());
        assert!(validate_project_name("../x").is_err());
        assert!(validate_project_name("a\\b").is_err());
        assert!(validate_project_name("").is_err());
    }

    #[test]
    fn an_empty_project_has_a_project_package_and_refuses_a_filled_folder() {
        let tmp = std::env::temp_dir().join(format!("forge-newproj-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let dir = create_empty_project(tmp.to_str().unwrap(), "My Project").unwrap();
        let package = std::fs::read_to_string(dir.join("package.json")).unwrap();
        assert!(package.contains("\"type\": \"project\"") && package.contains("my-project"));
        assert!(create_empty_project(tmp.to_str().unwrap(), "My Project").is_err());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn a_password_never_appears_in_an_error() {
        assert_eq!(scrub("fatal: bad secret123 here", &["secret123"]), "fatal: bad *** here");
    }
}
