//! Gemeinsame Tunnel-Liste mit dem AditoHub (und anderen Werkzeugen): `tunnels.json` im Ordner `AditoTunnels`.
//! Jeder Eintrag sagt: Das Ziel `host:port` ist auf `ip:port` erreichbar, geöffnet von diesem Besitzer.
//! So nutzt der Designer einen Tunnel des Hubs mit und umgekehrt, statt eine zweite SSH-Verbindung zu öffnen.
//!
//! Regeln: Ein Eintrag zählt nur, solange sein Port antwortet (tote Einträge nach einem Absturz werden entfernt).
//! Geschrieben wird atomar und unter einer Sperrdatei. Das Format steht in `docs/shared-tunnels.md`.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::{SocketAddr, TcpStream};
use std::sync::Mutex;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub const OWNER_DESIGNER: &str = "designer";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SharedEntry {
    /// Das Ziel, `host:port` in Kleinschreibung (beim Hub `domain:port`).
    pub target: String,
    pub ip: String,
    pub port: u16,
    /// Wer den Tunnel geöffnet hat: `designer`, `hub`.
    pub owner: String,
    pub pid: u32,
    /// Sekunden seit 1970.
    pub since: u64,
}

/// Bitte an den Besitzer eines Tunnels, ihn zu schließen. Der Besitzer führt sie aus und trägt sie aus.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SharedRequest {
    /// Das Ziel, `host:port` in Kleinschreibung.
    pub target: String,
    /// Bisher nur `disconnect`.
    pub action: String,
    /// Prozess des Besitzers, an den sich die Bitte richtet.
    pub to_pid: u32,
    /// Wer bittet: `designer`, `hub`.
    pub from: String,
    /// Sekunden seit 1970. Bitten über 60 s Alter sind verfallen.
    pub at: u64,
}

pub const ACTION_DISCONNECT: &str = "disconnect";
const REQUEST_TTL_SECS: u64 = 60;

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct SharedFile {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    entries: Vec<SharedEntry>,
    #[serde(default)]
    requests: Vec<SharedRequest>,
}

/// Der gemeinsame Ordner: Windows `%LOCALAPPDATA%\AditoTunnels`, macOS `~/Library/Application Support/AditoTunnels`,
/// Linux `$XDG_DATA_HOME/aditotunnels` oder `~/.local/share/aditotunnels`. `ADITO_TUNNELS_DIR` überschreibt ihn.
pub fn shared_dir() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("ADITO_TUNNELS_DIR").filter(|d| !d.is_empty()) {
        return Some(PathBuf::from(dir));
    }
    #[cfg(windows)]
    {
        std::env::var_os("LOCALAPPDATA").map(|d| PathBuf::from(d).join("AditoTunnels"))
    }
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support/AditoTunnels"))
    }
    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        std::env::var_os("XDG_DATA_HOME")
            .map(|d| PathBuf::from(d).join("aditotunnels"))
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share/aditotunnels")))
    }
}

pub fn target_key(host: &str, port: u16) -> String {
    format!("{}:{port}", host.to_ascii_lowercase())
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Antwortet der Port? Kurzer Verbindungsversuch auf dem eigenen Rechner.
fn is_alive(entry: &SharedEntry) -> bool {
    // Jeder Verbindungsversuch öffnet beim Besitzer (Hub) einen SSH-Kanal zum Ziel. Die Oberfläche fragt alle 3 s:
    // darum nur selten wirklich verbinden, sonst überfluten wir den fremden Tunnel.
    static RECENT: Mutex<Option<HashMap<(String, u16), Instant>>> = Mutex::new(None);
    let key = (entry.ip.clone(), entry.port);
    let fresh = |m: &mut Option<HashMap<(String, u16), Instant>>| m.get_or_insert_with(HashMap::new).get(&key).is_some_and(|t| t.elapsed() < ALIVE_CACHE);
    if fresh(&mut RECENT.lock().unwrap_or_else(std::sync::PoisonError::into_inner)) {
        return true;
    }
    let Ok(addr) = format!("{}:{}", entry.ip, entry.port).parse::<SocketAddr>() else { return false };
    let alive = TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok();
    let mut recent = RECENT.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    let map = recent.get_or_insert_with(HashMap::new);
    if alive {
        map.insert(key, Instant::now());
    } else {
        map.remove(&key);
    }
    alive
}

/// So lange gilt ein bestandener Lebenszeichen-Test.
const ALIVE_CACHE: Duration = Duration::from_secs(30);

fn read_file(dir: &Path) -> SharedFile {
    std::fs::read_to_string(dir.join("tunnels.json")).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn write_file(dir: &Path, file: &SharedFile) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let text = serde_json::to_string_pretty(&SharedFile { version: 1, entries: file.entries.clone(), requests: file.requests.clone() }).map_err(|e| e.to_string())?;
    platform::fs::atomic_write(&dir.join("tunnels.json"), text.as_bytes()).map_err(|e| e.to_string())
}

/// Liest, ändert und schreibt die Liste unter einer Sperrdatei (`tunnels.lock`, `create_new`). Eine verwaiste Sperre
/// (älter als 5 s) wird übernommen. Gelingt die Sperre nicht, ist die Änderung verloren: das ist unkritisch, denn die
/// Liste ist nur eine Hilfe und jeder Eintrag wird beim Lesen geprüft.
fn with_lock<T>(dir: &Path, change: impl FnOnce(&mut SharedFile) -> T) -> Option<T> {
    std::fs::create_dir_all(dir).ok()?;
    let lock = dir.join("tunnels.lock");
    let start = Instant::now();
    loop {
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&lock) {
            Ok(_) => break,
            Err(_) if start.elapsed() > Duration::from_secs(1) => {
                let stale = std::fs::metadata(&lock).and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|age| age > Duration::from_secs(5));
                if stale {
                    let _ = std::fs::remove_file(&lock);
                    continue;
                }
                return None;
            }
            Err(_) => std::thread::sleep(Duration::from_millis(20)),
        }
    }
    let mut file = read_file(dir);
    let out = change(&mut file);
    let _ = write_file(dir, &file);
    let _ = std::fs::remove_file(&lock);
    Some(out)
}

/// Alle Einträge, deren Port antwortet. Tote Einträge anderer Prozesse werden dabei aus der Datei entfernt.
pub fn read_live_in(dir: &Path, own_pid: u32) -> Vec<SharedEntry> {
    let file = read_file(dir);
    let (live, dead): (Vec<_>, Vec<_>) = file.entries.into_iter().partition(|e| e.pid == own_pid || is_alive(e));
    if !dead.is_empty() {
        let dead_keys: Vec<(String, String)> = dead.iter().map(|e| (e.target.clone(), e.ip.clone())).collect();
        with_lock(dir, |f| f.entries.retain(|e| !(e.pid != own_pid && dead_keys.contains(&(e.target.clone(), e.ip.clone())))));
    }
    live
}

pub fn read_live() -> Vec<SharedEntry> {
    shared_dir().map(|d| read_live_in(&d, std::process::id())).unwrap_or_default()
}

/// Ein Tunnel eines anderen Prozesses (Hub oder zweiter Designer) zu diesem Ziel.
pub fn find_foreign_in(dir: &Path, own_pid: u32, target: &str) -> Option<SharedEntry> {
    read_live_in(dir, own_pid).into_iter().find(|e| e.pid != own_pid && e.target.eq_ignore_ascii_case(target))
}

pub fn find_foreign(target: &str) -> Option<SharedEntry> {
    shared_dir().and_then(|d| find_foreign_in(&d, std::process::id(), target))
}

/// Trägt einen eigenen Tunnel ein (ersetzt einen alten Eintrag desselben Ziels dieses Besitzers).
pub fn publish_in(dir: &Path, entry: SharedEntry) {
    with_lock(dir, |f| {
        f.entries.retain(|e| !(e.target == entry.target && e.owner == entry.owner && e.pid == entry.pid));
        f.entries.push(entry);
    });
}

pub fn publish(target: &str, ip: &str, port: u16) {
    if let Some(dir) = shared_dir() {
        publish_in(&dir, SharedEntry { target: target.to_string(), ip: ip.to_string(), port, owner: OWNER_DESIGNER.into(), pid: std::process::id(), since: now() });
    }
}

/// Nimmt den eigenen Eintrag zu diesem Ziel wieder heraus.
pub fn withdraw_in(dir: &Path, own_pid: u32, target: &str) {
    with_lock(dir, |f| f.entries.retain(|e| !(e.target == target && e.pid == own_pid)));
}

pub fn withdraw(target: &str) {
    if let Some(dir) = shared_dir() {
        withdraw_in(&dir, std::process::id(), target);
    }
}

/// Bittet den Besitzer (`owner_pid`), den Tunnel zu diesem Ziel zu schließen. Gleiche Bitte ersetzt die alte.
pub fn request_disconnect_in(dir: &Path, target: &str, owner_pid: u32, from: &str) {
    with_lock(dir, |f| {
        f.requests.retain(|r| !(r.target == target && r.to_pid == owner_pid));
        f.requests.push(SharedRequest { target: target.to_string(), action: ACTION_DISCONNECT.into(), to_pid: owner_pid, from: from.to_string(), at: now() });
    });
}

pub fn request_disconnect(target: &str, owner_pid: u32) {
    if let Some(dir) = shared_dir() {
        request_disconnect_in(&dir, target, owner_pid, OWNER_DESIGNER);
    }
}

/// Holt die Bitten an diesen Prozess ab und trägt sie aus der Datei aus. Verfallene Bitten (auch fremde) werden entfernt.
/// Gibt die Ziele zurück, die zu schließen sind.
pub fn take_disconnect_requests_in(dir: &Path, own_pid: u32) -> Vec<String> {
    // Billige Vorprüfung ohne Sperre: die Datei kennt keine Bitte, wenn der Text das Feld nicht enthält.
    let pending = std::fs::read_to_string(dir.join("tunnels.json")).map(|t| t.contains("\"toPid\"")).unwrap_or(false);
    if !pending {
        return Vec::new();
    }
    with_lock(dir, |f| {
        let t = now();
        let mut mine = Vec::new();
        f.requests.retain(|r| {
            if t.saturating_sub(r.at) > REQUEST_TTL_SECS {
                return false;
            }
            if r.to_pid == own_pid && r.action == ACTION_DISCONNECT {
                mine.push(r.target.clone());
                return false;
            }
            true
        });
        mine
    })
    .unwrap_or_default()
}

pub fn take_disconnect_requests() -> Vec<String> {
    shared_dir().map(|d| take_disconnect_requests_in(&d, std::process::id())).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("dito-shared-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    fn entry(target: &str, port: u16, owner: &str, pid: u32) -> SharedEntry {
        SharedEntry { target: target.into(), ip: "127.0.0.1".into(), port, owner: owner.into(), pid, since: 1 }
    }

    #[test]
    fn a_live_foreign_tunnel_is_found_and_a_dead_one_is_removed() {
        let dir = temp_dir("foreign");
        let open = TcpListener::bind("127.0.0.1:0").unwrap();
        let live_port = open.local_addr().unwrap().port();
        let dead_port = {
            let l = TcpListener::bind("127.0.0.1:0").unwrap();
            l.local_addr().unwrap().port()
        };
        publish_in(&dir, entry("db.svc:3306", live_port, "hub", 111));
        publish_in(&dir, entry("web.svc:8080", dead_port, "hub", 111));
        let found = find_foreign_in(&dir, 222, "DB.svc:3306").unwrap();
        assert_eq!((found.owner.as_str(), found.port), ("hub", live_port));
        assert!(find_foreign_in(&dir, 222, "web.svc:8080").is_none());
        // Der tote Eintrag ist aus der Datei verschwunden, der lebende bleibt.
        let left: Vec<String> = read_file(&dir).entries.into_iter().map(|e| e.target).collect();
        assert_eq!(left, vec!["db.svc:3306".to_string()]);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn own_entries_are_not_foreign_and_can_be_withdrawn() {
        let dir = temp_dir("own");
        publish_in(&dir, entry("db.svc:3306", 1, OWNER_DESIGNER, 333));
        assert!(find_foreign_in(&dir, 333, "db.svc:3306").is_none());
        assert_eq!(read_live_in(&dir, 333).len(), 1);
        withdraw_in(&dir, 333, "db.svc:3306");
        assert!(read_file(&dir).entries.is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn the_file_uses_camel_case_and_a_version() {
        let dir = temp_dir("format");
        publish_in(&dir, entry("db.svc:3306", 5, "hub", 9));
        let text = std::fs::read_to_string(dir.join("tunnels.json")).unwrap();
        assert!(text.contains("\"version\": 1") && text.contains("\"target\": \"db.svc:3306\"") && text.contains("\"since\""));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_disconnect_request_reaches_only_its_owner_and_is_removed() {
        let dir = temp_dir("requests");
        publish_in(&dir, entry("db.svc:3306", 1, "hub", 111));
        request_disconnect_in(&dir, "db.svc:3306", 111, OWNER_DESIGNER);
        assert!(take_disconnect_requests_in(&dir, 222).is_empty());
        assert_eq!(take_disconnect_requests_in(&dir, 111), vec!["db.svc:3306".to_string()]);
        assert!(take_disconnect_requests_in(&dir, 111).is_empty());
        // Die Einträge bleiben beim Ändern der Bitten erhalten, und Bitten überleben das Schreiben der Einträge.
        request_disconnect_in(&dir, "x:1", 5, "hub");
        publish_in(&dir, entry("web.svc:80", 2, "hub", 111));
        assert_eq!(read_file(&dir).requests.len(), 1);
        assert_eq!(read_file(&dir).entries.len(), 2);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn an_old_request_expires() {
        let dir = temp_dir("expired");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("tunnels.json"), r#"{"version":1,"entries":[],"requests":[{"target":"a:1","action":"disconnect","toPid":9,"from":"hub","at":1}]}"#).unwrap();
        assert!(take_disconnect_requests_in(&dir, 9).is_empty());
        assert!(read_file(&dir).requests.is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_broken_file_reads_as_empty() {
        let dir = temp_dir("broken");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("tunnels.json"), "{ not json").unwrap();
        assert!(read_live_in(&dir, 1).is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }
}
