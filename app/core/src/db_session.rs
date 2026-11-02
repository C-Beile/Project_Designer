//! Database session for the Services tab: reads the system-DB alias and the tunnel entry from the
//! two export files the user picks (`*_serverconfig_system.xml`, `*_tunnelconfig.xml`), opens an
//! SSH port forward with `plink` and connects through `db-layer`.
//!
//! Business rule: the credentials exist only in memory while a session is open. They are never
//! written to disk, never logged and never part of an error message (see `scrub`).

use db_layer::mariadb;
use db_layer::{ConnectionConfig, DbConnection, DbValue, TxStatement};
use quick_xml::events::Event;
use quick_xml::Reader;
use serde::Serialize;
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Hard cap so a careless `SELECT *` on a large table cannot flood the UI.
pub const MAX_ROWS: usize = 1000;

/// Database user and password of the system alias; Debug never prints the password.
#[derive(Clone)]
pub struct DbAlias {
    pub host: String,
    pub port: u16,
    pub database: String,
    pub user: String,
    pub password: String,
}

impl std::fmt::Debug for DbAlias {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DbAlias")
            .field("host", &self.host)
            .field("port", &self.port)
            .field("database", &self.database)
            .field("user", &"<redacted>")
            .field("password", &"<redacted>")
            .finish()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TunnelEntry {
    pub tunnel_host: String,
    pub tunnel_port: u16,
    pub target_host: String,
    pub target_port: u16,
    pub user: String,
}

/// The `db alias` map of the system DB node inside `serverconfig_system.xml`.
pub fn parse_system_alias(xml: &str) -> Result<DbAlias, String> {
    let mut reader = Reader::from_str(xml);
    let mut node_stack: Vec<String> = Vec::new();
    let mut entries: Vec<(String, String)> = Vec::new();
    loop {
        match reader.read_event().map_err(|e| format!("serverconfig is not valid XML: {e}"))? {
            Event::Start(e) => {
                if e.name().as_ref() == b"node" {
                    node_stack.push(attr(&e, "name").unwrap_or_default());
                }
            }
            Event::Empty(e) => {
                if e.name().as_ref() == b"entry" && node_stack.last().map(|n| n == "db alias").unwrap_or(false) {
                    if let (Some(k), Some(v)) = (attr(&e, "key"), attr(&e, "value")) {
                        entries.push((k, v));
                    }
                }
            }
            Event::End(e) => {
                if e.name().as_ref() == b"node" {
                    node_stack.pop();
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    let get = |key: &str| entries.iter().find(|(k, _)| k == key).map(|(_, v)| v.clone());
    let host = get("host").ok_or("serverconfig has no db alias host")?;
    let port = get("port").and_then(|p| p.parse::<u16>().ok()).ok_or("serverconfig has no valid db alias port")?;
    let user = get("user").ok_or("serverconfig has no db alias user")?;
    let password = get("password").ok_or("serverconfig has no db alias password")?;
    let database = get("database").unwrap_or_default();
    Ok(DbAlias { host, port, database, user, password })
}

pub(crate) fn attr(e: &quick_xml::events::BytesStart<'_>, key: &str) -> Option<String> {
    e.attributes()
        .flatten()
        .find(|a| a.key.as_ref() == key.as_bytes())
        .and_then(|a| a.unescape_value().ok().map(|v| v.into_owned()))
}

/// All `TunnelConfigDataModel` entries of `tunnelconfig.xml`.
pub fn parse_tunnels(xml: &str) -> Result<Vec<TunnelEntry>, String> {
    let mut reader = Reader::from_str(xml);
    let mut out = Vec::new();
    let mut current: Option<[String; 5]> = None;
    let mut field: Option<usize> = None;
    loop {
        match reader.read_event().map_err(|e| format!("tunnelconfig is not valid XML: {e}"))? {
            Event::Start(e) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).into_owned();
                if name == "TunnelConfigDataModel" {
                    current = Some(Default::default());
                } else if current.is_some() {
                    field = ["tunnelHostAddress", "tunnelHostPort", "targetServerAddress", "targetServerPort", "user"]
                        .iter()
                        .position(|n| *n == name);
                }
            }
            Event::Text(t) => {
                if let (Some(cur), Some(i)) = (current.as_mut(), field) {
                    cur[i] = t.unescape().map_err(|e| e.to_string())?.trim().to_string();
                }
            }
            Event::End(e) => {
                if e.name().as_ref() == b"TunnelConfigDataModel" {
                    if let Some(c) = current.take() {
                        if let (Ok(tp), Ok(pp)) = (c[1].parse::<u16>(), c[3].parse::<u16>()) {
                            out.push(TunnelEntry { tunnel_host: c[0].clone(), tunnel_port: tp, target_host: c[2].clone(), target_port: pp, user: c[4].clone() });
                        }
                    }
                }
                field = None;
            }
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(out)
}

/// The tunnel that forwards to the alias' database host and port.
pub fn find_db_tunnel<'a>(tunnels: &'a [TunnelEntry], alias: &DbAlias) -> Option<&'a TunnelEntry> {
    tunnels.iter().find(|t| t.target_host.eq_ignore_ascii_case(&alias.host) && t.target_port == alias.port)
}

/// Percent-encodes everything but unreserved characters: `db-layer` builds a `mysql://` URL from
/// user and password, so characters like `@`, `/` or `#` in a password must not break it.
pub fn percent_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// Removes every secret (and its URL-encoded form) from text that may reach the UI.
pub fn scrub(text: &str, secrets: &[&str]) -> String {
    let mut out = text.to_string();
    for s in secrets.iter().filter(|s| s.len() >= 3) {
        out = out.replace(s, "***").replace(&percent_encode(s), "***");
    }
    out
}

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

pub(crate) fn free_local_port() -> Result<u16, String> {
    let l = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    Ok(l.local_addr().map_err(|e| e.to_string())?.port())
}

/// Read-only guard: exactly one statement that starts with a reading keyword.
pub fn is_read_only(sql: &str) -> bool {
    let cleaned = strip_comments(sql);
    let trimmed = cleaned.trim().trim_end_matches(';').trim();
    if trimmed.is_empty() || contains_unquoted_semicolon(trimmed) {
        return false;
    }
    let lower = trimmed.to_ascii_lowercase();
    let first = lower.split_whitespace().next().unwrap_or("");
    if !matches!(first, "select" | "show" | "describe" | "desc" | "explain") {
        return false;
    }
    !(lower.contains("into outfile") || lower.contains("into dumpfile") || lower.contains("for update") || lower.contains("lock in share mode"))
}

fn strip_comments(sql: &str) -> String {
    let mut out = String::with_capacity(sql.len());
    let chars: Vec<char> = sql.chars().collect();
    let mut i = 0;
    let mut quote: Option<char> = None;
    while i < chars.len() {
        let c = chars[i];
        if let Some(q) = quote {
            out.push(c);
            if c == q {
                quote = None;
            }
            i += 1;
        } else if c == '\'' || c == '"' || c == '`' {
            quote = Some(c);
            out.push(c);
            i += 1;
        } else if c == '-' && chars.get(i + 1) == Some(&'-') || c == '#' {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
        } else if c == '/' && chars.get(i + 1) == Some(&'*') {
            i += 2;
            while i + 1 < chars.len() && !(chars[i] == '*' && chars[i + 1] == '/') {
                i += 1;
            }
            i += 2;
            out.push(' ');
        } else {
            out.push(c);
            i += 1;
        }
    }
    out
}

fn contains_unquoted_semicolon(sql: &str) -> bool {
    let mut quote: Option<char> = None;
    for c in sql.chars() {
        match quote {
            Some(q) if c == q => quote = None,
            Some(_) => {}
            None if c == '\'' || c == '"' || c == '`' => quote = Some(c),
            None if c == ';' => return true,
            None => {}
        }
    }
    false
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DbStatus {
    pub connected: bool,
    pub tunnel_up: bool,
    pub database: Option<String>,
    pub host: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SqlResult {
    pub columns: Vec<String>,
    /// `None` is SQL NULL.
    pub rows: Vec<Vec<Option<String>>>,
    pub truncated: bool,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct SchemaTable {
    pub schema: String,
    pub name: String,
}

fn display(v: &DbValue) -> Option<String> {
    match v {
        DbValue::Null => None,
        DbValue::Bool(b) => Some(b.to_string()),
        DbValue::Int(i) => Some(i.to_string()),
        DbValue::Float(f) => Some(f.to_string()),
        DbValue::Text(s) => Some(s.clone()),
        DbValue::Bytes(b) => Some(format!("<{} bytes>", b.len())),
    }
}

fn system_label(system: &str) -> String {
    if system.is_empty() { "test".into() } else { system.to_string() }
}

struct Session {
    plink: Option<Child>,
    runtime: Option<tokio::runtime::Runtime>,
    conn: Box<dyn DbConnection>,
    secrets: Vec<String>,
    database: String,
    host: String,
    /// Target of a forward owned by the tunnel manager; this session only uses its local port.
    shared: Option<(String, u16)>,
}

impl Session {
    fn secret_refs(&self) -> Vec<&str> {
        self.secrets.iter().map(|s| s.as_str()).collect()
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        if let Some(rt) = self.runtime.take() {
            rt.shutdown_background();
        }
        if let Some(mut p) = self.plink.take() {
            let _ = p.kill();
            let _ = p.wait();
        }
    }
}

/// Receives the phases of a connect: (system key, phase text, finished). No credentials in the text.
pub type ProgressSink = std::sync::Arc<dyn Fn(&str, &str, bool) + Send + Sync>;

/// Holds one open session per system; the active one answers queries, schema and deploy calls.
/// Connecting a system never closes the session of another system.
#[derive(Default)]
pub struct DbManager {
    sessions: Mutex<std::collections::HashMap<String, Session>>,
    active: Mutex<Option<String>>,
    progress: Mutex<Option<ProgressSink>>,
    cancel: std::sync::atomic::AtomicBool,
    pub tunnels: std::sync::Arc<crate::tunnels::TunnelManager>,
}

pub(crate) fn spawn_plink(plink: &Path, args: &[String]) -> Result<Child, String> {
    let mut cmd = platform::console::command(plink);
    cmd.args(args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped());
    cmd.spawn().map_err(|e| format!("plink could not be started: {e}"))
}

pub(crate) fn wait_for_port(child: &mut Child, port: u16, timeout: Duration) -> Result<(), String> {
    wait_for_port_cancellable(child, port, timeout, None)
}

pub(crate) fn wait_for_port_cancellable(child: &mut Child, port: u16, timeout: Duration, cancel: Option<&std::sync::atomic::AtomicBool>) -> Result<(), String> {
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

impl DbManager {
    /// The shell registers one sink; every connect reports its phases to it.
    pub fn set_progress_sink(&self, sink: ProgressSink) {
        *self.progress.lock().unwrap() = Some(sink);
    }

    fn report(&self, system: &str, phase: &str, finished: bool) {
        if let Some(sink) = self.progress.lock().unwrap().clone() {
            sink(system, phase, finished);
        }
    }

    /// Stops a connect that is still waiting for the tunnel or the database.
    pub fn cancel_connect(&self) {
        self.cancel.store(true, std::sync::atomic::Ordering::SeqCst);
    }

    fn status_of(&self, mut s: Option<&mut Session>) -> DbStatus {
        let tunnel_up = match s {
            Some(ref mut s) if s.shared.is_some() => {
                let (h, p) = s.shared.clone().unwrap();
                self.tunnels.local_port(&h, p).is_some()
            }
            Some(ref mut s) => s.plink.as_mut().map(|p| matches!(p.try_wait(), Ok(None))).unwrap_or(false),
            None => false,
        };
        let present = s.is_some();
        DbStatus { connected: present && tunnel_up, tunnel_up, database: s.as_ref().map(|s| s.database.clone()), host: s.as_ref().map(|s| s.host.clone()) }
    }

    fn active_key(&self) -> Option<String> {
        self.active.lock().unwrap().clone()
    }

    /// Status of the active session.
    pub fn status(&self) -> DbStatus {
        let key = self.active_key();
        self.status_for(key.as_deref().unwrap_or(""))
    }

    /// Status of the session of one system (not connected when it has none).
    pub fn status_for(&self, system: &str) -> DbStatus {
        let mut guard = self.sessions.lock().unwrap();
        self.status_of(guard.get_mut(system))
    }

    /// Every system that has a session, with its status.
    pub fn statuses(&self) -> Vec<(String, DbStatus)> {
        let mut guard = self.sessions.lock().unwrap();
        let keys: Vec<String> = guard.keys().cloned().collect();
        let mut out: Vec<(String, DbStatus)> = keys.into_iter().map(|k| { let st = self.status_of(guard.get_mut(&k)); (k, st) }).collect();
        out.sort_by(|a, b| a.0.cmp(&b.0));
        out
    }

    /// Makes the session of `system` the one that queries and deploys use. False when it has none.
    pub fn activate(&self, system: &str) -> bool {
        if !self.sessions.lock().unwrap().contains_key(system) {
            return false;
        }
        *self.active.lock().unwrap() = Some(system.to_string());
        true
    }

    pub fn active_system(&self) -> Option<String> {
        self.active_key().filter(|k| self.sessions.lock().unwrap().contains_key(k))
    }

    /// Closes the active session.
    pub fn disconnect(&self) {
        if let Some(k) = self.active_key() {
            self.disconnect_system(&k);
        } else {
            self.sessions.lock().unwrap().remove("");
        }
    }

    /// Closes the session of one system; the others stay open.
    pub fn disconnect_system(&self, system: &str) {
        let removed = self.sessions.lock().unwrap().remove(system);
        drop(removed);
        let mut active = self.active.lock().unwrap();
        if active.as_deref() == Some(system) {
            *active = self.sessions.lock().unwrap().keys().next().cloned();
        }
    }

    /// Opens tunnel and database connection. `key_file` is the PuTTY key; without it `plink` falls
    /// back to a running Pageant.
    pub fn connect(&self, tunnel_xml_path: &Path, server_xml_path: &Path, key_file: Option<&Path>) -> Result<DbStatus, String> {
        self.connect_with(tunnel_xml_path, server_xml_path, &TunnelAuth::Key(key_file))
    }

    pub fn connect_with(&self, tunnel_xml_path: &Path, server_xml_path: &Path, auth: &TunnelAuth<'_>) -> Result<DbStatus, String> {
        self.connect_system("", tunnel_xml_path, server_xml_path, auth)
    }

    pub fn connect_system(&self, system: &str, tunnel_xml_path: &Path, server_xml_path: &Path, auth: &TunnelAuth<'_>) -> Result<DbStatus, String> {
        self.disconnect_system(system);
        self.cancel.store(false, std::sync::atomic::Ordering::SeqCst);
        let result = self.connect_inner(system, tunnel_xml_path, server_xml_path, auth);
        match &result {
            Ok(_) => self.report(system, "Connected", true),
            Err(e) => self.report(system, &format!("Failed: {e}"), true),
        }
        result
    }

    fn connect_inner(&self, system: &str, tunnel_xml_path: &Path, server_xml_path: &Path, auth: &TunnelAuth<'_>) -> Result<DbStatus, String> {
        self.report(system, "Reading the tunnel and server config", false);
        let tunnel_xml = std::fs::read_to_string(tunnel_xml_path).map_err(|e| format!("tunnel config not readable: {e}"))?;
        let server_xml = std::fs::read_to_string(server_xml_path).map_err(|e| format!("server config not readable: {e}"))?;
        let alias = parse_system_alias(&server_xml)?;
        let tunnels = parse_tunnels(&tunnel_xml)?;
        let tunnel = find_db_tunnel(&tunnels, &alias)
            .ok_or("No tunnel entry in the tunnel config points to the database host of the system alias.")?
            .clone();
        let mut secrets = vec![alias.user.clone(), alias.password.clone()];
        if let TunnelAuth::Basic { password } = auth {
            secrets.push((*password).to_string());
        }
        let shared_port = self.tunnels.local_port(&tunnel.target_host, tunnel.target_port);
        let (mut child, local_port) = match shared_port {
            Some(p) => (None, p),
            None => {
                self.report(system, "Starting ssh/plink", false);
                let local_port = free_local_port()?;
                let mut child = crate::tunnel_client::default_client().spawn(&tunnel, auth, local_port).map_err(|e| crate::tunnels::friendly_error(&e, false))?;
                self.report(system, "Authenticating and forwarding the port", false);
                if let Err(e) = wait_for_port_cancellable(&mut child, local_port, Duration::from_secs(20), Some(&self.cancel)) {
                    let _ = child.kill();
                    let _ = child.wait();
                    let refs: Vec<&str> = secrets.iter().map(|s| s.as_str()).collect();
                    return Err(crate::tunnels::friendly_error(&scrub(&e, &refs), matches!(auth, TunnelAuth::Key(Some(_)))));
                }
                (Some(child), local_port)
            }
        };
        self.report(system, "Waiting for the database", false);
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .map_err(|e| e.to_string())?;
        let mut config = ConnectionConfig::new("127.0.0.1", local_port, percent_encode(&alias.database), percent_encode(&alias.user), percent_encode(&alias.password));
        config.connect_timeout = Duration::from_secs(10);
        let connected = runtime.block_on(async {
            let conn = mariadb::connect(&config).await?;
            conn.test_connection().await?;
            Ok::<_, db_layer::DbError>(conn)
        });
        let refs: Vec<&str> = secrets.iter().map(|s| s.as_str()).collect();
        let conn = match connected {
            Ok(c) => c,
            Err(e) => {
                if let Some(c) = child.as_mut() {
                    let _ = c.kill();
                    let _ = c.wait();
                }
                runtime.shutdown_background();
                let hint = " The tunnel opened, but the database did not answer; the dev environment may be switched off.";
                return Err(format!("{}{hint}", scrub(&e.to_string(), &refs)));
            }
        };
        let session = Session { plink: child, runtime: Some(runtime), conn: Box::new(conn), secrets, database: alias.database.clone(), host: alias.host.clone(), shared: shared_port.map(|_| (tunnel.target_host.clone(), tunnel.target_port)) };
        self.sessions.lock().unwrap().insert(system.to_string(), session);
        *self.active.lock().unwrap() = Some(system.to_string());
        Ok(self.status_for(system))
    }

    /// Opens a read-only session to another database alias of the same system through an already
    /// open forward (the alias host:port must be a target in the tunnel config). The session gets
    /// its own key and becomes the active one.
    pub fn connect_alias(&self, key: &str, tunnel_xml_path: &Path, alias: &DbAlias) -> Result<DbStatus, String> {
        self.disconnect_system(key);
        let tunnel_xml = std::fs::read_to_string(tunnel_xml_path).map_err(|e| format!("tunnel config not readable: {e}"))?;
        let tunnels = parse_tunnels(&tunnel_xml)?;
        let tunnel = tunnels
            .iter()
            .find(|t| t.target_host.eq_ignore_ascii_case(&alias.host) && t.target_port == alias.port)
            .ok_or_else(|| format!("No tunnel entry points to {}:{}. Add it in the tunnel config editor.", alias.host, alias.port))?;
        let local_port = self
            .tunnels
            .local_port(&tunnel.target_host, tunnel.target_port)
            .ok_or_else(|| format!("Open the tunnel to {}:{} first (tunnel config editor).", alias.host, alias.port))?;
        let secrets = vec![alias.user.clone(), alias.password.clone()];
        let refs: Vec<&str> = secrets.iter().map(|s| s.as_str()).collect();
        let runtime = tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build().map_err(|e| e.to_string())?;
        let mut config = ConnectionConfig::new("127.0.0.1", local_port, percent_encode(&alias.database), percent_encode(&alias.user), percent_encode(&alias.password));
        config.connect_timeout = Duration::from_secs(10);
        let connected = runtime.block_on(async {
            let conn = mariadb::connect(&config).await?;
            conn.test_connection().await?;
            Ok::<_, db_layer::DbError>(conn)
        });
        let conn = match connected {
            Ok(c) => c,
            Err(e) => {
                runtime.shutdown_background();
                return Err(scrub(&e.to_string(), &refs));
            }
        };
        let session = Session { plink: None, runtime: Some(runtime), conn: Box::new(conn), secrets, database: alias.database.clone(), host: alias.host.clone(), shared: Some((tunnel.target_host.clone(), tunnel.target_port)) };
        self.sessions.lock().unwrap().insert(key.to_string(), session);
        *self.active.lock().unwrap() = Some(key.to_string());
        Ok(self.status_for(key))
    }

    pub fn query(&self, sql: &str, allow_write: bool) -> Result<SqlResult, String> {
        if !allow_write && !is_read_only(sql) {
            return Err("Read-only mode: only a single SELECT, SHOW, DESCRIBE or EXPLAIN statement is allowed. Enable writing explicitly to run other statements.".into());
        }
        let key = self.active_key().unwrap_or_default();
        let guard = self.sessions.lock().unwrap();
        let s = guard.get(&key).ok_or("Not connected.")?;
        let rt = s.runtime.as_ref().ok_or("Not connected.")?;
        let started = Instant::now();
        let result = rt.block_on(s.conn.execute_query(sql)).map_err(|e| scrub(&e.to_string(), &s.secret_refs()))?;
        let truncated = result.rows.len() > MAX_ROWS;
        let rows = result.rows.iter().take(MAX_ROWS).map(|r| r.iter().map(display).collect()).collect();
        Ok(SqlResult { columns: result.columns, rows, truncated, elapsed_ms: started.elapsed().as_millis() as u64 })
    }

    /// All statements in one transaction (commit or full rollback); the caller has already
    /// asked the user for confirmation. Returns the affected row count per statement.
    pub fn transaction(&self, statements: &[TxStatement]) -> Result<Vec<u64>, String> {
        let key = self.active_key().unwrap_or_default();
        let guard = self.sessions.lock().unwrap();
        let s = guard.get(&key).ok_or("Not connected.")?;
        let rt = s.runtime.as_ref().ok_or("Not connected.")?;
        rt.block_on(s.conn.execute_transaction(statements)).map_err(|e| scrub(&e.to_string(), &s.secret_refs()))
    }

    /// Test seam: uses a ready connection (mock) instead of opening a tunnel.
    #[doc(hidden)]
    pub fn attach_connection(&self, conn: Box<dyn DbConnection>, secrets: Vec<String>) {
        self.attach_connection_for("", conn, secrets);
    }

    #[doc(hidden)]
    pub fn attach_connection_for(&self, system: &str, conn: Box<dyn DbConnection>, secrets: Vec<String>) {
        let runtime = tokio::runtime::Builder::new_multi_thread().worker_threads(1).enable_all().build().unwrap();
        self.sessions.lock().unwrap().insert(system.to_string(), Session { plink: None, runtime: Some(runtime), conn, secrets, database: system_label(system), host: "localhost".into(), shared: None });
        *self.active.lock().unwrap() = Some(system.to_string());
    }

    /// Credentials of the open session, only for scrubbing texts that go to the UI.
    pub(crate) fn secret_values(&self) -> Vec<String> {
        let key = self.active_key().unwrap_or_default();
        self.sessions.lock().unwrap().get(&key).map(|s| s.secrets.clone()).unwrap_or_default()
    }

    pub fn database_label(&self) -> Option<String> {
        let key = self.active_key().unwrap_or_default();
        self.sessions.lock().unwrap().get(&key).map(|s| format!("{} @ {}", s.database, s.host))
    }

    pub fn schema(&self) -> Result<Vec<SchemaTable>, String> {
        let key = self.active_key().unwrap_or_default();
        let guard = self.sessions.lock().unwrap();
        let s = guard.get(&key).ok_or("Not connected.")?;
        let rt = s.runtime.as_ref().ok_or("Not connected.")?;
        let mut tables: Vec<SchemaTable> = rt
            .block_on(s.conn.list_tables())
            .map_err(|e| scrub(&e.to_string(), &s.secret_refs()))?
            .into_iter()
            .map(|t| SchemaTable { schema: t.schema, name: t.name })
            .collect();
        tables.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        Ok(tables)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basic_auth_passes_the_password_and_never_prints_it() {
        let t = TunnelEntry { tunnel_host: "j".into(), tunnel_port: 22, target_host: "db".into(), target_port: 3306, user: "u".into() };
        let auth = TunnelAuth::Basic { password: "s3cret!" };
        let args = plink_args_auth(&t, &auth, 4000);
        let i = args.iter().position(|a| a == "-pw").unwrap();
        assert_eq!(args[i + 1], "s3cret!");
        assert!(!args.contains(&"-i".to_string()));
        assert!(!format!("{auth:?}").contains("s3cret"));
        assert!(!plink_args_auth(&t, &TunnelAuth::Key(None), 4000).contains(&"-pw".to_string()));
    }

    const SERVER: &str = r#"<preferences><root type="system"><map/><node name="systemdb"><map><entry key="caching" value="3"/></map>
        <node name="db alias"><map>
        <entry key="database" value="_____systemalias"/><entry key="databasetype" value="12"/>
        <entry key="host" value="adito-db.svc.cluster.local"/><entry key="password" value="p@ss/w#rd"/>
        <entry key="port" value="3306"/><entry key="user" value="dbuser"/></map></node></node></root></preferences>"#;

    const TUNNEL: &str = r#"<TunnelConfigContainerDataModel><tunnels>
        <TunnelConfigDataModel name="a"><tunnelHostAddress>jump.example</tunnelHostAddress><tunnelHostPort>22</tunnelHostPort>
        <targetServerAddress>other.svc</targetServerAddress><targetServerPort>8080</targetServerPort><user>tu</user></TunnelConfigDataModel>
        <TunnelConfigDataModel name="b"><tunnelHostAddress>jump.example</tunnelHostAddress><tunnelHostPort>22</tunnelHostPort>
        <targetServerAddress>adito-db.svc.cluster.local</targetServerAddress><targetServerPort>3306</targetServerPort><user>tu</user></TunnelConfigDataModel>
        </tunnels></TunnelConfigContainerDataModel>"#;

    #[test]
    fn alias_is_read_from_the_db_alias_node() {
        let a = parse_system_alias(SERVER).unwrap();
        assert_eq!((a.host.as_str(), a.port, a.database.as_str(), a.user.as_str()), ("adito-db.svc.cluster.local", 3306, "_____systemalias", "dbuser"));
        assert_eq!(a.password, "p@ss/w#rd");
    }

    #[test]
    fn alias_debug_output_hides_credentials() {
        let text = format!("{:?}", parse_system_alias(SERVER).unwrap());
        assert!(!text.contains("dbuser") && !text.contains("p@ss"));
    }

    #[test]
    fn missing_alias_is_reported() {
        assert!(parse_system_alias("<preferences/>").is_err());
    }

    #[test]
    fn matching_tunnel_is_found_by_target_host_and_port() {
        let tunnels = parse_tunnels(TUNNEL).unwrap();
        assert_eq!(tunnels.len(), 2);
        let alias = parse_system_alias(SERVER).unwrap();
        let t = find_db_tunnel(&tunnels, &alias).unwrap();
        assert_eq!((t.tunnel_host.as_str(), t.tunnel_port, t.user.as_str()), ("jump.example", 22, "tu"));
    }

    #[test]
    fn plink_arguments_forward_the_local_port_to_the_target() {
        let t = parse_tunnels(TUNNEL).unwrap().remove(1);
        let args = plink_args(&t, Some(Path::new("k.ppk")), 40000);
        assert!(args.contains(&"-batch".to_string()));
        assert!(args.windows(2).any(|w| w[0] == "-L" && w[1] == "127.0.0.1:40000:adito-db.svc.cluster.local:3306"));
        assert!(args.windows(2).any(|w| w[0] == "-i" && w[1] == "k.ppk"));
        assert_eq!(args.last().unwrap(), "jump.example");
    }

    #[test]
    fn percent_encoding_protects_url_special_characters() {
        assert_eq!(percent_encode("p@ss/w#rd"), "p%40ss%2Fw%23rd");
        assert_eq!(percent_encode("abc-1_.~"), "abc-1_.~");
    }

    #[test]
    fn scrub_removes_plain_and_encoded_secrets() {
        let out = scrub("denied for dbuser using p@ss/w#rd / p%40ss%2Fw%23rd", &["dbuser", "p@ss/w#rd"]);
        assert!(!out.contains("dbuser") && !out.contains("p@ss") && !out.contains("p%40ss"));
    }

    #[test]
    fn read_only_guard_accepts_reads_and_rejects_everything_else() {
        assert!(is_read_only("SELECT 1"));
        assert!(is_read_only("  select * from t where a = 'x;y'; "));
        assert!(is_read_only("/* c */ SHOW TABLES"));
        assert!(is_read_only("-- c\nDESCRIBE t"));
        assert!(!is_read_only("DELETE FROM t"));
        assert!(!is_read_only("SELECT 1; DROP TABLE t"));
        assert!(!is_read_only("UPDATE t SET a = 1"));
        assert!(!is_read_only("SELECT * FROM t INTO OUTFILE '/x'"));
        assert!(!is_read_only("SELECT * FROM t FOR UPDATE"));
        assert!(!is_read_only("/* SELECT */ DROP TABLE t"));
        assert!(!is_read_only(""));
    }

    #[test]
    fn query_without_session_reports_not_connected() {
        let m = DbManager::default();
        assert_eq!(m.query("SELECT 1", false).unwrap_err(), "Not connected.");
        assert!(m.query("DELETE FROM t", false).unwrap_err().starts_with("Read-only"));
        assert!(!m.status().connected);
    }

    #[test]
    fn unreadable_config_files_give_a_clear_error() {
        let m = DbManager::default();
        let err = m.connect(Path::new("Z:/nope/t.xml"), Path::new("Z:/nope/s.xml"), None).unwrap_err();
        assert!(err.contains("not readable"));
    }

    #[test]
    fn sessions_of_two_systems_stay_open_next_to_each_other() {
        use db_layer::mock::MockConnection;
        let m = DbManager::default();
        m.attach_connection_for("FFG", Box::new(MockConnection::default()), vec![]);
        m.attach_connection_for("SVB", Box::new(MockConnection::default()), vec![]);
        assert_eq!(m.active_system().as_deref(), Some("SVB"));
        let names: Vec<String> = m.statuses().into_iter().map(|(k, _)| k).collect();
        assert_eq!(names, vec!["FFG".to_string(), "SVB".to_string()]);
        assert_eq!(m.status_for("FFG").database.as_deref(), Some("FFG"));
        assert!(m.activate("FFG"));
        assert_eq!(m.database_label().unwrap(), "FFG @ localhost");
        m.disconnect_system("FFG");
        assert_eq!(m.active_system().as_deref(), Some("SVB"));
        assert!(m.status_for("FFG").database.is_none());
        assert!(m.status_for("SVB").database.is_some());
        assert!(!m.activate("FFG"));
    }
}
