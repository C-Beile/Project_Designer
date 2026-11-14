//! Gemeinsame Tunnel-Liste mit dem AditoHub (und anderen Werkzeugen): `tunnels.json` im Ordner `AditoTunnels`.
//! Jeder Eintrag sagt: Das Ziel `host:port` ist auf `ip:port` erreichbar, geöffnet von diesem Besitzer.
//! So nutzt der Designer einen Tunnel des Hubs mit und umgekehrt, statt eine zweite SSH-Verbindung zu öffnen.
//!
//! Regeln: Ein Eintrag zählt nur, solange sein Port antwortet (tote Einträge nach einem Absturz werden entfernt).
//! Geschrieben wird atomar und unter einer Sperrdatei. Das Format steht in `docs/shared-tunnels.md`.

use serde::{Deserialize, Serialize};
use std::net::{SocketAddr, TcpStream};
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

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct SharedFile {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    entries: Vec<SharedEntry>,
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
    let Ok(addr) = format!("{}:{}", entry.ip, entry.port).parse::<SocketAddr>() else { return false };
    TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
}

fn read_file(dir: &Path) -> SharedFile {
    std::fs::read_to_string(dir.join("tunnels.json")).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn write_file(dir: &Path, file: &SharedFile) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let text = serde_json::to_string_pretty(&SharedFile { version: 1, entries: file.entries.clone() }).map_err(|e| e.to_string())?;
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
    fn a_broken_file_reads_as_empty() {
        let dir = temp_dir("broken");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("tunnels.json"), "{ not json").unwrap();
        assert!(read_live_in(&dir, 1).is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }
}
