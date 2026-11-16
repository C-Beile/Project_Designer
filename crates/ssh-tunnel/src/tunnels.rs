//! Offene Weiterleitungen (SSH über russh, in diesem Prozess).
//!
//! Regeln: Je Tunnel-Host und Benutzer gibt es eine SSH-Sitzung, alle Weiterleitungen laufen als Kanäle
//! durch sie. Je Ziel (Host und Port) gibt es genau eine Weiterleitung mit freiem lokalem Port. Die
//! Datenbank-Sitzung nutzt die Weiterleitung zu ihrem Datenbank-Host mit. Zugangsdaten bleiben im Speicher
//! und werden aus jeder Meldung entfernt.

use crate::ssh_keys::load_key;
use crate::shared_tunnels::{self, OWNER_DESIGNER};
use crate::ssh_session::{connect as ssh_connect, host_id, OwnedAuth, SshHandle};
use crate::tunnel_core::{scrub, TunnelAuth, TunnelEntry};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::RecvTimeoutError;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tokio::net::TcpListener;
use tokio::task::JoinHandle;

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
    /// Adresse, auf der die Weiterleitung lauscht (`127.0.200.x`, sonst `127.0.0.1`).
    pub local_host: String,
    pub local_port: u16,
    pub up: bool,
    /// Wer den Tunnel geöffnet hat: `designer` (dieser Prozess) oder ein anderes Programm (`hub`, zweiter Designer).
    pub owner: String,
}

struct Forward {
    /// `host:port` des Ziels, so wie es in der gemeinsamen Liste steht.
    target: String,
    session_key: String,
    local_host: String,
    local_port: u16,
    task: JoinHandle<()>,
}

impl Drop for Forward {
    fn drop(&mut self) {
        self.task.abort();
        shared_tunnels::withdraw(&self.target);
    }
}

#[derive(Default)]
struct State {
    sessions: HashMap<String, Arc<SshHandle>>,
    forwards: HashMap<String, Forward>,
}

#[derive(Default)]
pub struct TunnelManager {
    state: Arc<Mutex<State>>,
    /// Ob der Hintergrundlauf für Bitten anderer Programme (Trennen) schon läuft.
    watching: AtomicBool,
}

/// Die Laufzeit für alle SSH-Sitzungen. Sie lebt bis zum Programmende.
fn runtime() -> &'static tokio::runtime::Runtime {
    static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    RUNTIME.get_or_init(|| tokio::runtime::Builder::new_multi_thread().worker_threads(2).thread_name("ssh-tunnel").enable_all().build().expect("tokio runtime for ssh tunnels"))
}

/// Führt eine Aufgabe auf der SSH-Laufzeit aus und wartet blockierend auf sie. So darf der Aufruf auch aus
/// einem Tokio-Thread kommen. `cancel` bricht das Warten ab.
fn run<T: Send + 'static>(job: impl Future<Output = T> + Send + 'static, cancel: Option<&AtomicBool>) -> Result<T, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let join = runtime().spawn(async move {
        let _ = tx.send(job.await);
    });
    loop {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(value) => return Ok(value),
            Err(RecvTimeoutError::Timeout) => {
                if cancel.is_some_and(|c| c.load(Ordering::SeqCst)) {
                    join.abort();
                    return Err("Connecting was cancelled.".into());
                }
            }
            Err(RecvTimeoutError::Disconnected) => return Err("The tunnel task ended unexpectedly.".into()),
        }
    }
}

fn key_of(host: &str, port: u16) -> String {
    format!("{}:{port}", host.to_ascii_lowercase())
}

fn session_key_of(entry: &TunnelEntry) -> String {
    format!("{}|{}", host_id(&entry.tunnel_host, entry.tunnel_port), entry.user)
}

/// Turns SSH errors into a message the user can act on.
pub fn friendly_error(raw: &str, uses_key_file: bool) -> String {
    let lower = raw.to_ascii_lowercase();
    if lower.contains("permission denied") || lower.contains("access denied") || lower.contains("authentication failed") {
        return if uses_key_file {
            "The server rejected the SSH key. Check the key file, the user name and that the key is still valid on the server.".into()
        } else {
            crate::ssh_session::NO_KEY.into()
        };
    }
    if lower.contains("could not resolve") || lower.contains("no route to host") || lower.contains("connection refused") || lower.contains("host does not exist") || lower.contains("network error") {
        return "The SSH host cannot be reached. Check the host address and the network or VPN.".into();
    }
    if lower.contains("timed out") || lower.contains("did not open in time") || lower.contains("timeout") {
        return "Timeout: the SSH host did not answer. Check the network or VPN.".into();
    }
    raw.to_string()
}

/// Der Adressbereich des Designers. Der Hub vergibt `127.0.2.x` aufwärts; ein eigener Bereich verhindert, dass beide
/// dieselbe Adresse mit demselben Port wollen.
const LOOPBACK_RANGE: &str = "127.0.200";

/// Lokale Adresse einer Weiterleitung. Reihenfolge: eigene Adresse `127.0.200.x` mit dem echten Port des Ziels (wie der
/// AditoHub), dann `127.0.0.1` mit dem echten Port, dann `127.0.0.1` mit freiem Port. Die Schritte 2 und 3 brauchen kein
/// Admin-Recht; sie greifen, wo das System die Zusatzadressen nicht kennt (macOS) oder der Port schon belegt ist.
async fn bind_local(target_port: u16) -> Result<(TcpListener, String), String> {
    for last in 1..=254u8 {
        let ip = format!("{LOOPBACK_RANGE}.{last}");
        match TcpListener::bind((ip.as_str(), target_port)).await {
            Ok(listener) => return Ok((listener, ip)),
            Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => continue,
            // Die Adresse gibt es auf diesem System nicht (macOS) oder der Port ist gesperrt: nächster Schritt.
            Err(_) => break,
        }
    }
    if let Ok(listener) = TcpListener::bind(("127.0.0.1", target_port)).await {
        return Ok((listener, "127.0.0.1".to_string()));
    }
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.map_err(|e| format!("No free local port: {e}"))?;
    Ok((listener, "127.0.0.1".to_string()))
}

/// Ob dieses System die Zusatzadressen `127.0.200.x` kennt (Windows, Linux; macOS erst nach der Einrichtung).
pub fn extra_loopback_available() -> bool {
    std::net::TcpListener::bind((format!("{LOOPBACK_RANGE}.1").as_str(), 0)).is_ok()
}

async fn accept_loop(listener: TcpListener, handle: Arc<SshHandle>, host: String, port: u16) {
    loop {
        let (mut tcp, peer) = match listener.accept().await {
            Ok(pair) => pair,
            Err(_) => {
                tokio::time::sleep(Duration::from_millis(100)).await;
                continue;
            }
        };
        let handle = handle.clone();
        let host = host.clone();
        tokio::spawn(async move {
            if let Ok(channel) = handle.channel_open_direct_tcpip(host, u32::from(port), peer.ip().to_string(), u32::from(peer.port())).await {
                let mut stream = channel.into_stream();
                let _ = tokio::io::copy_bidirectional(&mut tcp, &mut stream).await;
            }
        });
    }
}

impl State {
    /// Wirft Weiterleitungen und Sitzungen weg, deren Verbindung beendet ist.
    fn prune(&mut self) {
        let alive: Vec<String> = self.sessions.iter().filter(|(_, h)| !h.is_closed()).map(|(k, _)| k.clone()).collect();
        self.sessions.retain(|k, _| alive.contains(k));
        self.forwards.retain(|_, f| alive.contains(&f.session_key) && !f.task.is_finished());
    }

    /// Schließt Sitzungen, die keine Weiterleitung mehr tragen.
    fn release_idle_sessions(&mut self) {
        let used: Vec<String> = self.forwards.values().map(|f| f.session_key.clone()).collect();
        let idle: Vec<String> = self.sessions.keys().filter(|k| !used.contains(k)).cloned().collect();
        for key in idle {
            if let Some(handle) = self.sessions.remove(&key) {
                close_session(handle);
            }
        }
    }
}

fn close_session(handle: Arc<SshHandle>) {
    runtime().spawn(async move {
        let _ = tokio::time::timeout(Duration::from_secs(3), handle.disconnect(russh::Disconnect::ByApplication, "", "en")).await;
    });
}

/// Schließt die Weiterleitungen, um deren Schließen ein anderes Programm (Hub, zweiter Designer) gebeten hat.
fn serve_requests(state: &Mutex<State>) {
    let targets = shared_tunnels::take_disconnect_requests();
    if targets.is_empty() {
        return;
    }
    let mut state = state.lock().unwrap();
    for target in targets {
        state.forwards.remove(&target.to_ascii_lowercase());
    }
    state.release_idle_sessions();
}

impl TunnelManager {
    /// Startet (einmal) den Lauf, der Bitten anderer Programme abarbeitet. Er endet mit dem Programm.
    fn watch_requests(&self) {
        if self.watching.swap(true, Ordering::SeqCst) {
            return;
        }
        let state = self.state.clone();
        runtime().spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(1)).await;
                let state = state.clone();
                let _ = tokio::task::spawn_blocking(move || serve_requests(&state)).await;
            }
        });
    }

    /// Opens the forward for this row, or returns the running one.
    pub fn connect(&self, entry: &TunnelEntry, auth: &TunnelAuth<'_>) -> Result<ForwardStatus, String> {
        self.connect_cancellable(entry, auth, None)
    }

    /// Wie [`Self::connect`]; `cancel` bricht das Warten auf die Anmeldung ab.
    pub fn connect_cancellable(&self, entry: &TunnelEntry, auth: &TunnelAuth<'_>, cancel: Option<&AtomicBool>) -> Result<ForwardStatus, String> {
        let key = key_of(&entry.target_host, entry.target_port);
        let session_key = session_key_of(entry);
        let existing = {
            let mut state = self.state.lock().unwrap();
            state.prune();
            if let Some(f) = state.forwards.get(&key) {
                return Ok(ForwardStatus { target_host: entry.target_host.clone(), target_port: entry.target_port, local_host: f.local_host.clone(), local_port: f.local_port, up: true, owner: OWNER_DESIGNER.into() });
            }
            state.sessions.get(&session_key).cloned()
        };
        // Hat schon ein anderes Programm (AditoHub, zweiter Designer) diesen Tunnel offen, wird er mitbenutzt.
        if let Some(found) = shared_tunnels::find_foreign(&key) {
            return Ok(ForwardStatus { target_host: entry.target_host.clone(), target_port: entry.target_port, local_host: found.ip, local_port: found.port, up: true, owner: found.owner });
        }
        if matches!(auth, TunnelAuth::Key(None)) {
            return Err(crate::ssh_session::NO_KEY.to_string());
        }
        let secrets: Vec<&str> = match auth {
            TunnelAuth::Basic { password } => vec![*password],
            TunnelAuth::KeyPass { passphrase, .. } => vec![*passphrase],
            TunnelAuth::Key(_) => Vec::new(),
        };
        let uses_key = matches!(auth, TunnelAuth::Key(Some(_)) | TunnelAuth::KeyPass { .. });
        let fail = |e: String| friendly_error(&scrub(&e, &secrets), uses_key);
        if let TunnelAuth::Key(Some(k)) | TunnelAuth::KeyPass { key: k, .. } = auth {
            if !k.is_file() {
                return Err("The SSH key file is missing or cannot be read. Choose a valid key file.".to_string());
            }
            // Fehler wie "Passphrase fehlt" oder "falsche Passphrase" kommen so schon vor dem Netz.
            let passphrase = if let TunnelAuth::KeyPass { passphrase, .. } = auth { Some(*passphrase) } else { None };
            load_key(k, passphrase)?;
        }
        let owned = OwnedAuth::from(auth);
        let job_entry = entry.clone();
        let outcome = run(
            async move {
                let handle = match existing {
                    Some(h) => h,
                    None => Arc::new(ssh_connect(&job_entry, &owned).await?),
                };
                // Früh prüfen, ob der Tunnel-Host das Ziel erreicht: sonst käme der Fehler erst bei der ersten Verbindung.
                let probe = handle
                    .channel_open_direct_tcpip(job_entry.target_host.clone(), u32::from(job_entry.target_port), "127.0.0.1", 0)
                    .await
                    .map_err(|e| format!("The SSH host cannot reach {}:{}: {e}", job_entry.target_host, job_entry.target_port))?;
                let _ = probe.close().await;
                let (listener, local_host) = bind_local(job_entry.target_port).await?;
                let local_port = listener.local_addr().map_err(|e| e.to_string())?.port();
                let task = tokio::spawn(accept_loop(listener, handle.clone(), job_entry.target_host.clone(), job_entry.target_port));
                Ok::<_, String>((handle, local_host, local_port, task))
            },
            cancel,
        )?;
        let (handle, local_host, local_port, task) = outcome.map_err(&fail)?;
        self.watch_requests();
        let mut state = self.state.lock().unwrap();
        state.sessions.insert(session_key.clone(), handle);
        shared_tunnels::publish(&key, &local_host, local_port);
        state.forwards.insert(key.clone(), Forward { target: key, session_key, local_host: local_host.clone(), local_port, task });
        Ok(ForwardStatus { target_host: entry.target_host.clone(), target_port: entry.target_port, local_host, local_port, up: true, owner: OWNER_DESIGNER.into() })
    }

    /// Local port of a running forward to this target.
    pub fn local_port(&self, host: &str, port: u16) -> Option<u16> {
        self.local_addr(host, port).map(|(_, p)| p)
    }

    /// Adresse (Host und Port) einer laufenden Weiterleitung zu diesem Ziel.
    pub fn local_addr(&self, host: &str, port: u16) -> Option<(String, u16)> {
        let key = key_of(host, port);
        {
            let mut state = self.state.lock().unwrap();
            state.prune();
            if let Some(f) = state.forwards.get(&key) {
                return Some((f.local_host.clone(), f.local_port));
            }
        }
        shared_tunnels::find_foreign(&key).map(|e| (e.ip, e.port))
    }

    /// Schließt die eigene Weiterleitung. Ein Tunnel eines anderen Programms bleibt unberührt.
    pub fn disconnect(&self, host: &str, port: u16) {
        let mut state = self.state.lock().unwrap();
        state.forwards.remove(&key_of(host, port));
        state.release_idle_sessions();
    }

    /// Wie [`Self::disconnect`], aber gehört der Tunnel einem anderen Programm, bekommt dessen Besitzer die Bitte, ihn zu
    /// schließen (er tut es innerhalb von Sekunden). Gibt `true` zurück, wenn so eine Bitte gestellt wurde.
    pub fn disconnect_any(&self, host: &str, port: u16) -> bool {
        let key = key_of(host, port);
        if self.state.lock().unwrap().forwards.contains_key(&key) {
            self.disconnect(host, port);
            return false;
        }
        match shared_tunnels::find_foreign(&key) {
            Some(found) => {
                shared_tunnels::request_disconnect(&key, found.pid);
                true
            }
            None => false,
        }
    }

    pub fn disconnect_all(&self) {
        let mut state = self.state.lock().unwrap();
        state.forwards.clear();
        state.release_idle_sessions();
    }

    /// Running forwards; ones whose connection ended are dropped.
    pub fn list(&self) -> Vec<ForwardStatus> {
        let mut state = self.state.lock().unwrap();
        state.prune();
        let mut out: Vec<ForwardStatus> = state
            .forwards
            .iter()
            .map(|(k, f)| {
                let (h, p) = k.rsplit_once(':').unwrap_or((k, "0"));
                ForwardStatus { target_host: h.to_string(), target_port: p.parse().unwrap_or(0), local_host: f.local_host.clone(), local_port: f.local_port, up: true, owner: OWNER_DESIGNER.into() }
            })
            .collect();
        // Dazu die Tunnel anderer Programme, die gerade offen sind.
        let own_pid = std::process::id();
        for e in shared_tunnels::read_live().into_iter().filter(|e| e.pid != own_pid) {
            let (h, p) = e.target.rsplit_once(':').map(|(h, p)| (h.to_string(), p.parse().unwrap_or(0))).unwrap_or((e.target.clone(), 0));
            if !out.iter().any(|o| key_of(&o.target_host, o.target_port) == e.target.to_ascii_lowercase()) {
                out.push(ForwardStatus { target_host: h, target_port: p, local_host: e.ip, local_port: e.port, up: true, owner: e.owner });
            }
        }
        out.sort_by(|a, b| (a.target_host.as_str(), a.target_port).cmp(&(b.target_host.as_str(), b.target_port)));
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Die gemeinsame Liste zeigt in Tests auf einen eigenen Ordner, nie auf den des Benutzers.
    fn isolate() {
        static DIR: std::sync::Once = std::sync::Once::new();
        DIR.call_once(|| std::env::set_var("ADITO_TUNNELS_DIR", std::env::temp_dir().join(format!("dito-tunnels-test-{}", std::process::id()))));
    }

    #[test]
    fn ssh_errors_become_a_readable_message() {
        assert!(friendly_error("Permission denied", true).contains("rejected the SSH key"));
        assert!(friendly_error("Access denied", false).contains("key file"));
        assert!(friendly_error("connection refused", false).contains("cannot be reached"));
        assert!(friendly_error("operation timed out", false).starts_with("Timeout"));
        assert_eq!(friendly_error("something else", false), "something else");
    }

    #[test]
    fn a_missing_key_file_is_reported_before_the_network_is_used() {
        isolate();
        let m = TunnelManager::default();
        let e = TunnelEntry { tunnel_host: "j".into(), tunnel_port: 22, target_host: "db".into(), target_port: 3306, user: "u".into() };
        let err = m.connect(&e, &TunnelAuth::Key(Some(std::path::Path::new("Z:/does/not/exist.ppk")))).unwrap_err();
        assert!(err.contains("key file"));
        assert!(m.list().iter().all(|f| f.owner != "designer"));
    }

    #[test]
    fn a_forward_without_a_live_session_is_dropped() {
        isolate();
        let m = TunnelManager::default();
        let task = runtime().spawn(std::future::pending::<()>());
        m.state.lock().unwrap().forwards.insert(key_of("DB.svc", 3306), Forward { target: "db.svc:3306".into(), session_key: "gone".into(), local_host: "127.0.0.1".into(), local_port: 41001, task });
        assert_eq!(m.local_port("db.svc", 3306), None);
        assert!(m.list().iter().all(|f| f.owner != "designer"));
    }

    #[test]
    fn the_local_address_uses_the_real_port_and_falls_back_to_a_free_one() {
        let (first, host_a) = run(bind_local(45871), None).unwrap().unwrap();
        let (second, host_b) = run(bind_local(45871), None).unwrap().unwrap();
        // Der gleiche Port zweimal: nie ein Fehler, die zweite Weiterleitung bekommt eine andere Adresse oder einen anderen Port.
        let a = (host_a, first.local_addr().unwrap().port());
        let b = (host_b, second.local_addr().unwrap().port());
        assert_ne!(a, b);
        if extra_loopback_available() {
            assert!(a.0.starts_with("127.0.200.") && a.1 == 45871);
        }
    }

    #[test]
    fn a_tunnel_of_another_program_is_used_instead_of_opening_a_second_one() {
        isolate();
        let open = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = open.local_addr().unwrap().port();
        let dir = shared_tunnels::shared_dir().unwrap();
        shared_tunnels::publish_in(&dir, shared_tunnels::SharedEntry { target: "hubdb.svc:3306".into(), ip: "127.0.0.1".into(), port, owner: "hub".into(), pid: 1, since: 1 });
        let m = TunnelManager::default();
        let e = TunnelEntry { tunnel_host: "127.0.0.1".into(), tunnel_port: 1, target_host: "HubDb.svc".into(), target_port: 3306, user: "u".into() };
        let status = m.connect(&e, &TunnelAuth::Key(None)).unwrap();
        assert_eq!((status.owner.as_str(), status.local_port), ("hub", port));
        assert_eq!(m.local_port("hubdb.svc", 3306), Some(port));
        assert!(m.list().iter().any(|f| f.owner == "hub" && f.target_host == "hubdb.svc"));
        // Schließen berührt den fremden Tunnel nicht.
        // Bei einem fremden Tunnel entsteht nur eine Bitte an den Besitzer; der Tunnel selbst bleibt, bis er sie erfüllt.
        assert!(m.disconnect_any("hubdb.svc", 3306));
        assert_eq!(m.local_port("hubdb.svc", 3306), Some(port));
        assert_eq!(shared_tunnels::take_disconnect_requests_in(&dir, 1), vec!["hubdb.svc:3306".to_string()]);
        shared_tunnels::withdraw_in(&dir, 1, "hubdb.svc:3306");
    }

    #[test]
    fn a_request_from_another_program_closes_the_own_forward() {
        isolate();
        let m = TunnelManager::default();
        let task = runtime().spawn(std::future::pending::<()>());
        m.state.lock().unwrap().forwards.insert("req.svc:3306".into(), Forward { target: "req.svc:3306".into(), session_key: "s".into(), local_host: "127.0.0.1".into(), local_port: 41002, task });
        shared_tunnels::request_disconnect_in(&shared_tunnels::shared_dir().unwrap(), "req.svc:3306", std::process::id(), "hub");
        serve_requests(&m.state);
        assert!(m.state.lock().unwrap().forwards.is_empty());
    }

    #[test]
    fn a_cancelled_wait_ends_with_a_message() {
        let cancel = AtomicBool::new(true);
        let err = run(std::future::pending::<()>(), Some(&cancel)).unwrap_err();
        assert!(err.contains("cancelled"));
    }

    #[test]
    fn an_unreachable_host_fails_with_a_hint() {
        isolate();
        let m = TunnelManager::default();
        let e = TunnelEntry { tunnel_host: "127.0.0.1".into(), tunnel_port: 1, target_host: "db".into(), target_port: 3306, user: "u".into() };
        let err = m.connect(&e, &TunnelAuth::Key(None)).unwrap_err();
        assert!(!err.is_empty());
        assert!(m.list().iter().all(|f| f.owner != "designer"));
    }
}
