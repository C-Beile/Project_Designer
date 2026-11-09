//! The program that opens the SSH port forward, behind one interface.
//!
//! Windows uses `plink` (PuTTY) with `.ppk` keys or Pageant. macOS and Linux use the OpenSSH
//! `ssh` that ships with the system: it cannot read `.ppk` files, takes an OpenSSH private key
//! (or the keys of a running ssh-agent) and, for the simple password login, asks for the password
//! through `SSH_ASKPASS`. The password never appears on the command line: a tiny fixed helper
//! script prints it from an environment variable that only the started `ssh` process receives.
//!
//! The OpenSSH variant is prepared on Windows and unit tested for its arguments only; it has not
//! been run against a real server (see PROJECT/MACOS_PORT.md).

use crate::tunnel_core::{find_plink, plink_args_auth, spawn_plink, TunnelAuth, TunnelEntry};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};

/// Environment variable that carries the tunnel password to the askpass helper.
const PASSWORD_ENV: &str = "FORGE_SSH_PASSWORD";

static ACCEPT_NEW_HOST_KEYS: AtomicBool = AtomicBool::new(false);

/// Option from Tools > Options: trust the host key of a server on the first connect
/// (`StrictHostKeyChecking=accept-new`). Off by default; an unknown host then fails with a hint.
pub fn set_accept_new_host_keys(on: bool) {
    ACCEPT_NEW_HOST_KEYS.store(on, Ordering::SeqCst);
}

pub trait TunnelClient: Send + Sync {
    /// Name shown in messages.
    fn name(&self) -> &'static str;
    /// Starts the forward `127.0.0.1:<local_port>` -> target through the tunnel host.
    fn spawn(&self, entry: &TunnelEntry, auth: &TunnelAuth<'_>, local_port: u16) -> Result<Child, String>;
}

/// The client of the running operating system.
pub fn default_client() -> Box<dyn TunnelClient> {
    if cfg!(windows) {
        Box::new(PlinkClient)
    } else {
        Box::new(OpenSshClient { accept_new_host_keys: ACCEPT_NEW_HOST_KEYS.load(Ordering::SeqCst) })
    }
}

pub struct PlinkClient;

impl TunnelClient for PlinkClient {
    fn name(&self) -> &'static str {
        "plink"
    }

    fn spawn(&self, entry: &TunnelEntry, auth: &TunnelAuth<'_>, local_port: u16) -> Result<Child, String> {
        let plink = find_plink().ok_or_else(|| "plink.exe was not found".to_string())?;
        spawn_plink(&plink, &plink_args_auth(entry, auth, local_port))
    }
}

pub struct OpenSshClient {
    pub accept_new_host_keys: bool,
}

/// Argument list for OpenSSH. Without a password `BatchMode` keeps `ssh` from ever waiting for
/// input; with a password the askpass helper answers the single prompt.
pub fn openssh_args(t: &TunnelEntry, auth: &TunnelAuth<'_>, local_port: u16, accept_new_host_keys: bool) -> Vec<String> {
    let mut args: Vec<String> = vec!["-N".into(), "-o".into(), "ExitOnForwardFailure=yes".into(), "-o".into(), "ServerAliveInterval=30".into()];
    args.push("-o".into());
    args.push(format!("StrictHostKeyChecking={}", if accept_new_host_keys { "accept-new" } else { "yes" }));
    match auth {
        TunnelAuth::Key(key) => {
            args.extend(["-o".to_string(), "BatchMode=yes".into()]);
            if let Some(k) = key {
                args.extend(["-i".to_string(), k.to_string_lossy().into_owned(), "-o".into(), "IdentitiesOnly=yes".into()]);
            }
        }
        TunnelAuth::Basic { .. } => {
            args.extend([
                "-o".to_string(),
                "PreferredAuthentications=password,keyboard-interactive".into(),
                "-o".into(),
                "NumberOfPasswordPrompts=1".into(),
                "-o".into(),
                "PubkeyAuthentication=no".into(),
            ]);
        }
    }
    args.extend([
        "-p".to_string(),
        t.tunnel_port.to_string(),
        "-l".into(),
        t.user.clone(),
        "-L".into(),
        format!("127.0.0.1:{local_port}:{}:{}", t.target_host, t.target_port),
        t.tunnel_host.clone(),
    ]);
    args
}

fn find_ssh() -> Option<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    dirs.push(PathBuf::from("/usr/bin"));
    dirs.iter().map(|d| d.join("ssh")).find(|p| p.is_file())
}

/// Writes the fixed helper that prints the password from the environment; it holds no secret.
fn askpass_script() -> Result<PathBuf, String> {
    let path = std::env::temp_dir().join("dito-ssh-askpass.sh");
    std::fs::write(&path, format!("#!/bin/sh\nprintf '%s\\n' \"${PASSWORD_ENV}\"\n")).map_err(|e| plugin_api::at!(format!("ssh password helper could not be written: {e}")))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).map_err(|e| plugin_api::at!(format!("ssh password helper could not be prepared: {e}")))?;
    }
    Ok(path)
}

fn is_putty_key(key: &Path) -> bool {
    key.extension().map(|e| e.eq_ignore_ascii_case("ppk")).unwrap_or(false)
}

impl TunnelClient for OpenSshClient {
    fn name(&self) -> &'static str {
        "ssh"
    }

    fn spawn(&self, entry: &TunnelEntry, auth: &TunnelAuth<'_>, local_port: u16) -> Result<Child, String> {
        let ssh = find_ssh().ok_or_else(|| "ssh was not found".to_string())?;
        // A PuTTY .ppk key is converted to an OpenSSH copy for this one connection; ssh reads it at start, so the copy is
        // removed shortly after. The .ppk file itself stays as it is.
        let converted = match auth {
            TunnelAuth::Key(Some(k)) if is_putty_key(k) => Some(platform::ppk::openssh_copy(k)?),
            _ => None,
        };
        let openssh_auth = match &converted {
            Some(copy) => TunnelAuth::Key(Some(copy.as_path())),
            None => auth.clone(),
        };
        let mut cmd = Command::new(ssh);
        cmd.args(openssh_args(entry, &openssh_auth, local_port, self.accept_new_host_keys)).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped());
        if let TunnelAuth::Basic { password } = auth {
            cmd.env("SSH_ASKPASS", askpass_script()?).env("SSH_ASKPASS_REQUIRE", "force").env("DISPLAY", ":0").env(PASSWORD_ENV, password);
        }
        let child = cmd.spawn().map_err(|e| {
            if let Some(copy) = &converted {
                platform::ppk::remove_key_file(copy);
            }
            plugin_api::at!(format!("ssh could not be started: {e}"))
        });
        if let Some(copy) = converted {
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(20));
                platform::ppk::remove_key_file(&copy);
            });
        }
        child
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry() -> TunnelEntry {
        TunnelEntry { tunnel_host: "jump.example".into(), tunnel_port: 2222, target_host: "db.internal".into(), target_port: 3306, user: "dev".into() }
    }

    #[test]
    fn key_login_is_non_interactive_and_forwards_the_port() {
        let key = Path::new("/keys/id_ed25519");
        let args = openssh_args(&entry(), &TunnelAuth::Key(Some(key)), 40000, false);
        assert!(args.contains(&"BatchMode=yes".to_string()));
        assert!(args.contains(&"StrictHostKeyChecking=yes".to_string()));
        assert!(args.contains(&"ExitOnForwardFailure=yes".to_string()));
        assert!(args.windows(2).any(|w| w[0] == "-i" && w[1] == "/keys/id_ed25519"));
        assert!(args.windows(2).any(|w| w[0] == "-L" && w[1] == "127.0.0.1:40000:db.internal:3306"));
        assert!(args.windows(2).any(|w| w[0] == "-p" && w[1] == "2222"));
        assert_eq!(args.last().map(String::as_str), Some("jump.example"));
    }

    #[test]
    fn host_keys_are_only_accepted_when_the_option_is_on() {
        let on = openssh_args(&entry(), &TunnelAuth::Key(None), 1, true);
        assert!(on.contains(&"StrictHostKeyChecking=accept-new".to_string()));
        assert!(!openssh_args(&entry(), &TunnelAuth::Key(None), 1, false).contains(&"StrictHostKeyChecking=accept-new".to_string()));
    }

    #[test]
    fn password_login_never_puts_the_password_on_the_command_line() {
        let args = openssh_args(&entry(), &TunnelAuth::Basic { password: "s3cret-pw" }, 1, false);
        assert!(args.iter().all(|a| !a.contains("s3cret-pw")));
        assert!(!args.contains(&"BatchMode=yes".to_string()));
        assert!(args.contains(&"PreferredAuthentications=password,keyboard-interactive".to_string()));
    }

    #[test]
    fn putty_keys_are_recognised_by_extension() {
        assert!(is_putty_key(Path::new("C:/k/dev.PPK")));
        assert!(!is_putty_key(Path::new("/k/id_rsa")));
    }
}
