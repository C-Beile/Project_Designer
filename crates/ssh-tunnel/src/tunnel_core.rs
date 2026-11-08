//! Bausteine fuer den SSH-Tunnel (plink): Eintrag, Auth, Argumente, Prozessstart, Warten auf den Port.
//! Reine Hilfen ohne Datenbank- oder Sitzungslogik. `scrub` entfernt Geheimnisse aus Texten fuer die UI.

use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TunnelEntry {
    pub tunnel_host: String,
    pub tunnel_port: u16,
    pub target_host: String,
    pub target_port: u16,
    pub user: String,
}

pub use app_base::scrub::{percent_encode, redact as scrub};

/// How the SSH tunnel authenticates (Manual appendix E). The password only lives in memory.
#[derive(Clone)]
pub enum TunnelAuth<'a> {
    /// PuTTY key file; `None` falls back to a running Pageant.
    Key(Option<&'a Path>),
    Basic { password: &'a str },
}

impl std::fmt::Debug for TunnelAuth<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TunnelAuth::Key(k) => f.debug_tuple("Key").field(k).finish(),
            TunnelAuth::Basic { .. } => f.write_str("Basic { password: <redacted> }"),
        }
    }
}

/// Argument list for `plink`; `-batch` keeps it from ever waiting for a prompt.
pub fn plink_args(t: &TunnelEntry, key: Option<&Path>, local_port: u16) -> Vec<String> {
    plink_args_auth(t, &TunnelAuth::Key(key), local_port)
}

/// Same with an explicit auth scheme. Basic auth passes the password via `-pw`, the only
/// non-interactive way plink offers; it is visible to local processes while the tunnel runs.
pub fn plink_args_auth(t: &TunnelEntry, auth: &TunnelAuth<'_>, local_port: u16) -> Vec<String> {
    let mut args = vec!["-ssh".to_string(), "-batch".into(), "-P".into(), t.tunnel_port.to_string()];
    match auth {
        TunnelAuth::Key(Some(k)) => {
            args.push("-i".into());
            args.push(k.to_string_lossy().into_owned());
        }
        TunnelAuth::Key(None) => {}
        TunnelAuth::Basic { password } => {
            args.push("-pw".into());
            args.push((*password).to_string());
        }
    }
    args.extend([
        "-l".to_string(),
        t.user.clone(),
        "-L".into(),
        format!("127.0.0.1:{local_port}:{}:{}", t.target_host, t.target_port),
        "-N".into(),
        t.tunnel_host.clone(),
    ]);
    args
}

pub fn find_plink() -> Option<PathBuf> {
    let candidates = ["C:\\Program Files\\PuTTY\\plink.exe", "C:\\Program Files (x86)\\PuTTY\\plink.exe"];
    if let Some(found) = candidates.iter().map(PathBuf::from).find(|p| p.is_file()) {
        return Some(found);
    }
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).map(|d| d.join("plink.exe")).find(|p| p.is_file())
}

pub fn free_local_port() -> Result<u16, String> {
    let l = TcpListener::bind("127.0.0.1:0").map_err(|e| plugin_api::at!(e.to_string()))?;
    Ok(l.local_addr().map_err(|e| plugin_api::at!(e.to_string()))?.port())
}

pub(crate) fn spawn_plink(plink: &Path, args: &[String]) -> Result<Child, String> {
    let mut cmd = platform::console::command(plink);
    cmd.args(args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped());
    cmd.spawn().map_err(|e| plugin_api::at!(format!("plink could not be started: {e}")))
}

pub(crate) fn wait_for_port(child: &mut Child, port: u16, timeout: Duration) -> Result<(), String> {
    wait_for_port_cancellable(child, port, timeout, None)
}

pub fn wait_for_port_cancellable(child: &mut Child, port: u16, timeout: Duration, cancel: Option<&std::sync::atomic::AtomicBool>) -> Result<(), String> {
    let addr: SocketAddr = ([127, 0, 0, 1], port).into();
    let start = Instant::now();
    loop {
        if cancel.map(|c| c.load(std::sync::atomic::Ordering::SeqCst)).unwrap_or(false) {
            return Err("Connecting was cancelled.".to_string());
        }
        if let Ok(Some(status)) = child.try_wait() {
            let mut msg = String::new();
            if let Some(mut err) = child.stderr.take() {
                use std::io::Read;
                let _ = err.read_to_string(&mut msg);
            }
            let msg = msg.trim();
            return Err(format!("SSH tunnel stopped ({status}){}", if msg.is_empty() { String::new() } else { format!(": {msg}") }));
        }
        if TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok() {
            return Ok(());
        }
        if start.elapsed() > timeout {
            return Err("SSH tunnel did not open in time".to_string());
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

/// Bereinigt die Tunnel-Eingaben der Oberflaeche (leere Strings zaehlen als nicht gesetzt).
pub fn clean_tunnel_inputs(key_file: Option<String>, tunnel_password: Option<String>) -> (Option<PathBuf>, Option<String>) {
    let key = key_file.filter(|k| !k.trim().is_empty()).map(PathBuf::from);
    let password = tunnel_password.filter(|p| !p.is_empty());
    (key, password)
}

/// Auth-Schema zu den Eingaben aus [`clean_tunnel_inputs`]: Passwort vor Schluesseldatei, ohne beides ein laufender Pageant.
pub fn tunnel_auth<'a>(key: &'a Option<PathBuf>, password: &'a Option<String>) -> TunnelAuth<'a> {
    match (password, key) {
        (Some(p), _) => TunnelAuth::Basic { password: p },
        (None, k) => TunnelAuth::Key(k.as_deref()),
    }
}
