//! Per-row SSH port forwards for the tunnel config editor.
//!
//! Business rule: one forward per target (host and port) with a free local port. The database
//! session reuses the forward that points at its database host instead of opening a second SSH
//! connection. Credentials live in memory only and are scrubbed from every message.

use crate::db_session::{free_local_port, scrub, wait_for_port, TunnelAuth, TunnelEntry};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Child;
use std::sync::Mutex;
use std::time::Duration;

/// A tunnel row as the UI sends it (the values come from the tunnel config file, no secrets).
#[derive(Debug, Clone, Deserialize)]
pub struct TunnelRequest {
    pub tunnel_host: String,
    pub tunnel_port: u16,
    pub target_host: String,
    pub target_port: u16,
    pub user: String,
}

impl From<TunnelRequest> for TunnelEntry {
    fn from(r: TunnelRequest) -> Self {
        TunnelEntry { tunnel_host: r.tunnel_host, tunnel_port: r.tunnel_port, target_host: r.target_host, target_port: r.target_port, user: r.user }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ForwardStatus {
    pub target_host: String,
    pub target_port: u16,
    pub local_port: u16,
    pub up: bool,
}

struct Forward {
    child: Child,
    local_port: u16,
}

#[derive(Default)]
pub struct TunnelManager {
    forwards: Mutex<HashMap<String, Forward>>,
}

fn key_of(host: &str, port: u16) -> String {
    format!("{}:{port}", host.to_ascii_lowercase())
}

impl Drop for Forward {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Turns plink or ssh output into a message the user can act on.
pub fn friendly_error(raw: &str, uses_key_file: bool) -> String {
    let lower = raw.to_ascii_lowercase();
    if lower.contains("ssh was not found") || lower.contains("ssh could not be started") {
        return "The ssh program was not found. OpenSSH ships with macOS; check that /usr/bin/ssh exists.".into();
    }
    if lower.contains("host key verification failed") {
        return "The server's host key is not known yet. Connect once in the Terminal (ssh -p <port> <user>@<host>) and accept the key, or switch on Tools > Options > ADITO > General > Trust unknown SSH host keys on first connect.".into();
    }
    if lower.contains("permission denied") {
        return if uses_key_file {
            "The server rejected the SSH key. Check the key file and the user name of the tunnel row.".into()
        } else {
            "Login refused: no usable SSH key in the ssh-agent and no password given. Choose an OpenSSH key file or enter the tunnel password.".into()
        };
    }
    if lower.contains("could not resolve hostname") || lower.contains("operation timed out") || lower.contains("no route to host") {
        return "The SSH host cannot be reached. Check the host address and the network or VPN.".into();
    }
    if lower.contains("cannot use a putty .ppk key") {
        return raw.to_string();
    }
    if lower.contains("plink.exe was not found") || lower.contains("plink could not be started") {
        return "plink.exe was not found. Install PuTTY (plink) and try again.".into();
    }
    if lower.contains("unable to use key file") || lower.contains("unable to open") || lower.contains("couldn't load private key") || lower.contains("cannot open") {
        return "The SSH key file is missing or cannot be read. Choose a valid .ppk key file.".into();
    }
    if lower.contains("access denied") || lower.contains("no supported authentication") || lower.contains("authentication failed") || lower.contains("no matching key") {
        return if uses_key_file {
            "The server rejected the SSH key. Check the key file and the user name of the tunnel row.".into()
        } else {
            "No SSH key available: choose a .ppk key file or start Pageant with the key loaded.".into()
        };
    }
    if lower.contains("timed out") || lower.contains("did not open in time") {
        return "Timeout: the SSH host did not answer. Check the network or VPN.".into();
    }
    if lower.contains("host does not exist") || lower.contains("connection refused") || lower.contains("network error") {
        return "The SSH host cannot be reached. Check the host address and the network or VPN.".into();
    }
    raw.to_string()
}

impl TunnelManager {
    /// Opens the forward for this row, or returns the running one.
    pub fn connect(&self, entry: &TunnelEntry, auth: &TunnelAuth<'_>) -> Result<ForwardStatus, String> {
        let key = key_of(&entry.target_host, entry.target_port);
        {
            let mut map = self.forwards.lock().unwrap();
            if let Some(f) = map.get_mut(&key) {
                if matches!(f.child.try_wait(), Ok(None)) {
                    return Ok(ForwardStatus { target_host: entry.target_host.clone(), target_port: entry.target_port, local_port: f.local_port, up: true });
                }
                map.remove(&key);
            }
        }
        let secrets: Vec<&str> = match auth {
            TunnelAuth::Basic { password } => vec![*password],
            TunnelAuth::Key(_) => Vec::new(),
        };
        let uses_key = matches!(auth, TunnelAuth::Key(Some(_)));
        let fail = |e: String| friendly_error(&scrub(&e, &secrets), uses_key);
        if let TunnelAuth::Key(Some(k)) = auth {
            if !k.is_file() {
                return Err(format!("The SSH key file is missing or cannot be read. Choose a valid {} key file.", if cfg!(windows) { ".ppk" } else { "OpenSSH" }));
            }
        }
        let local_port = free_local_port()?;
        let mut child = crate::tunnel_client::default_client().spawn(entry, auth, local_port).map_err(&fail)?;
        if let Err(e) = wait_for_port(&mut child, local_port, Duration::from_secs(20)) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(fail(e));
        }
        self.forwards.lock().unwrap().insert(key, Forward { child, local_port });
        Ok(ForwardStatus { target_host: entry.target_host.clone(), target_port: entry.target_port, local_port, up: true })
    }

    /// Local port of a running forward to this target.
    pub fn local_port(&self, host: &str, port: u16) -> Option<u16> {
        let mut map = self.forwards.lock().unwrap();
        let key = key_of(host, port);
        match map.get_mut(&key) {
            Some(f) => {
                if matches!(f.child.try_wait(), Ok(None)) {
                    return Some(f.local_port);
                }
                map.remove(&key);
                None
            }
            None => None,
        }
    }

    pub fn disconnect(&self, host: &str, port: u16) {
        self.forwards.lock().unwrap().remove(&key_of(host, port));
    }

    pub fn disconnect_all(&self) {
        self.forwards.lock().unwrap().clear();
    }

    /// Running forwards; ones whose plink process ended are dropped.
    pub fn list(&self) -> Vec<ForwardStatus> {
        let mut map = self.forwards.lock().unwrap();
        map.retain(|_, f| matches!(f.child.try_wait(), Ok(None)));
        let mut out: Vec<ForwardStatus> = map
            .iter()
            .map(|(k, f)| {
                let (h, p) = k.rsplit_once(':').unwrap_or((k, "0"));
                ForwardStatus { target_host: h.to_string(), target_port: p.parse().unwrap_or(0), local_port: f.local_port, up: true }
            })
            .collect();
        out.sort_by(|a, b| (a.target_host.as_str(), a.target_port).cmp(&(b.target_host.as_str(), b.target_port)));
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::{Command, Stdio};

    fn sleeper() -> Child {
        #[cfg(windows)]
        let c = Command::new("cmd").args(["/C", "ping -n 30 127.0.0.1 >nul"]).stdout(Stdio::null()).stderr(Stdio::null()).spawn();
        #[cfg(not(windows))]
        let c = Command::new("sleep").arg("30").stdout(Stdio::null()).stderr(Stdio::null()).spawn();
        c.unwrap()
    }

    #[test]
    fn plink_output_becomes_a_readable_message() {
        assert!(friendly_error("Unable to use key file \"x.ppk\"", true).contains("key file"));
        assert!(friendly_error("SSH tunnel stopped (exit code: 1): Access denied", false).contains("Pageant"));
        assert!(friendly_error("Access denied", true).contains("rejected the SSH key"));
        assert!(friendly_error("SSH tunnel did not open in time", false).starts_with("Timeout"));
        assert!(friendly_error("plink.exe was not found (install PuTTY).", false).contains("Install PuTTY"));
        assert_eq!(friendly_error("something else", false), "something else");
    }

    #[test]
    fn a_missing_key_file_is_reported_before_plink_starts() {
        let m = TunnelManager::default();
        let e = TunnelEntry { tunnel_host: "j".into(), tunnel_port: 22, target_host: "db".into(), target_port: 3306, user: "u".into() };
        let err = m.connect(&e, &TunnelAuth::Key(Some(std::path::Path::new("Z:/does/not/exist.ppk")))).unwrap_err();
        assert!(err.contains("key file"));
        assert!(m.list().is_empty());
    }

    #[test]
    fn forwards_are_tracked_per_target_and_closed_individually() {
        let m = TunnelManager::default();
        m.forwards.lock().unwrap().insert(key_of("DB.svc", 3306), Forward { child: sleeper(), local_port: 41001 });
        m.forwards.lock().unwrap().insert(key_of("web.svc", 8080), Forward { child: sleeper(), local_port: 41002 });
        assert_eq!(m.local_port("db.SVC", 3306), Some(41001));
        assert_eq!(m.list().len(), 2);
        m.disconnect("db.svc", 3306);
        assert_eq!(m.local_port("db.svc", 3306), None);
        assert_eq!(m.list().len(), 1);
        m.disconnect_all();
        assert!(m.list().is_empty());
    }

    #[test]
    fn a_forward_whose_process_ended_is_dropped() {
        let m = TunnelManager::default();
        let mut c = sleeper();
        c.kill().unwrap();
        let _ = c.wait();
        m.forwards.lock().unwrap().insert(key_of("x", 1), Forward { child: c, local_port: 41003 });
        assert!(m.list().is_empty());
        assert_eq!(m.local_port("x", 1), None);
    }
}
