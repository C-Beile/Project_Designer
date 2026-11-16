//! Eine SSH-Sitzung (russh) je Tunnel-Host und Benutzer. Alle Weiterleitungen dieses Hosts laufen
//! als Kanäle durch dieselbe Sitzung. Anmeldung: Schlüsseldatei (mit Passphrase), Passwort oder
//! (kein Agent, kein Pageant). Der Host-Key wird beim ersten Mal gemerkt und danach geprüft.

use crate::ssh_keys::load_key;
use crate::tunnel_core::{TunnelAuth, TunnelEntry};
use russh::client::{self, Handle, KeyboardInteractiveAuthResponse};
use russh::keys::{HashAlg, PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

// ---- bekannte Host-Keys -------------------------------------------------------------------------

static KNOWN_FILE: Mutex<Option<PathBuf>> = Mutex::new(None);
static KNOWN_MEMORY: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

/// Die Konfigurationsdatei (`designer.conf`), in der die Fingerabdrücke stehen (`[ssh.known_hosts]`).
/// Ohne Datei merkt sich der Prozess sie nur im Speicher.
pub fn set_known_hosts_file(file: PathBuf) {
    *KNOWN_FILE.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = Some(file);
}

#[derive(Debug, PartialEq, Eq)]
pub enum HostKeyState {
    Known,
    New,
    Changed(String),
}

fn known_file() -> Option<PathBuf> {
    KNOWN_FILE.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone()
}

fn saved_fingerprint(id: &str) -> Option<String> {
    if let Some(file) = known_file() {
        let table = app_base::config::load(&file);
        return app_base::config::get_path(&table, &["ssh", "known_hosts", id]).and_then(|v| v.as_str().map(str::to_string));
    }
    KNOWN_MEMORY.lock().unwrap_or_else(std::sync::PoisonError::into_inner).as_ref().and_then(|m| m.get(id).cloned())
}

/// Der Schlüsselpfad aus den Optionen (`[ssh] key_path` in `designer.conf`). Für Aufrufe, die keinen Pfad mitschicken
/// (Datenbank-Verbindung, Tunnel eines Systems), da es keinen Agenten mehr gibt.
pub fn configured_key_path() -> Option<String> {
    let file = known_file()?;
    let table = app_base::config::load(&file);
    app_base::config::get_section(&table, "ssh.key_path").and_then(|v| v.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

pub fn check_host(id: &str, fingerprint: &str) -> HostKeyState {
    match saved_fingerprint(id) {
        None => HostKeyState::New,
        Some(saved) if saved == fingerprint => HostKeyState::Known,
        Some(saved) => HostKeyState::Changed(saved),
    }
}

pub fn remember_host(id: &str, fingerprint: &str) {
    if let Some(file) = known_file() {
        let _ = app_base::config::update(&file, |t| app_base::config::set_path(t, &["ssh", "known_hosts", id], &serde_json::Value::String(fingerprint.to_string())));
        return;
    }
    KNOWN_MEMORY.lock().unwrap_or_else(std::sync::PoisonError::into_inner).get_or_insert_with(HashMap::new).insert(id.to_string(), fingerprint.to_string());
}

/// Vergisst den gemerkten Host-Key (etwa nach einem erwarteten Server-Wechsel).
pub fn forget_host(id: &str) {
    if let Some(file) = known_file() {
        let _ = app_base::config::update(&file, |t| app_base::config::set_path(t, &["ssh", "known_hosts", id], &serde_json::Value::Null));
        return;
    }
    if let Some(m) = KNOWN_MEMORY.lock().unwrap_or_else(std::sync::PoisonError::into_inner).as_mut() {
        m.remove(id);
    }
}

/// `host:port` in Kleinschreibung, so wie der Host-Key gemerkt wird.
pub fn host_id(host: &str, port: u16) -> String {
    format!("{}:{port}", host.to_ascii_lowercase())
}

// ---- Verbindung ---------------------------------------------------------------------------------

/// Die Anmeldung mit eigenen Werten (für die Tasks im Hintergrund).
#[derive(Clone)]
pub enum OwnedAuth {
    Key(Option<PathBuf>),
    Basic(String),
    KeyPass(PathBuf, String),
}

impl From<&TunnelAuth<'_>> for OwnedAuth {
    fn from(a: &TunnelAuth<'_>) -> Self {
        match a {
            TunnelAuth::Key(k) => OwnedAuth::Key(k.map(Path::to_path_buf)),
            TunnelAuth::Basic { password } => OwnedAuth::Basic((*password).to_string()),
            TunnelAuth::KeyPass { key, passphrase } => OwnedAuth::KeyPass((*key).to_path_buf(), (*passphrase).to_string()),
        }
    }
}

pub struct ClientHandler {
    host_id: String,
    problem: Arc<Mutex<Option<String>>>,
}

impl client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(&mut self, key: &PublicKeyOrCertificate) -> Result<bool, Self::Error> {
        let fingerprint = match key {
            PublicKeyOrCertificate::PublicKey { key, .. } => key.fingerprint(HashAlg::Sha256).to_string(),
            PublicKeyOrCertificate::Certificate(cert) => cert.public_key().fingerprint(HashAlg::Sha256).to_string(),
        };
        match check_host(&self.host_id, &fingerprint) {
            HostKeyState::Known => Ok(true),
            HostKeyState::New => {
                remember_host(&self.host_id, &fingerprint);
                Ok(true)
            }
            HostKeyState::Changed(saved) => {
                *self.problem.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = Some(format!(
                    "The SSH host key of {} changed (saved {saved}, offered {fingerprint}). If the server was replaced on purpose, remove the saved key and connect again.",
                    self.host_id
                ));
                Ok(false)
            }
        }
    }
}

pub type SshHandle = Handle<ClientHandler>;

/// Baut die Verbindung auf und meldet sich an. Fehler sind lesbare Texte.
pub async fn connect(entry: &TunnelEntry, auth: &OwnedAuth) -> Result<SshHandle, String> {
    let id = host_id(&entry.tunnel_host, entry.tunnel_port);
    let problem = Arc::new(Mutex::new(None));
    let config = client::Config {
        keepalive_interval: Some(Duration::from_secs(15)),
        keepalive_max: 3,
        nodelay: true,
        ..Default::default()
    };
    let handler = ClientHandler { host_id: id, problem: problem.clone() };
    let connecting = client::connect(Arc::new(config), (entry.tunnel_host.as_str(), entry.tunnel_port), handler);
    let mut handle = match tokio::time::timeout(Duration::from_secs(20), connecting).await {
        Err(_) => return Err("Timeout: the SSH host did not answer. Check the network or VPN.".into()),
        Ok(Err(e)) => {
            let saved = problem.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone();
            return Err(saved.unwrap_or_else(|| format!("The SSH host cannot be reached: {e}")));
        }
        Ok(Ok(h)) => h,
    };
    let signed_in = tokio::time::timeout(Duration::from_secs(20), authenticate(&mut handle, &entry.user, auth))
        .await
        .map_err(|_| "Timeout: the SSH login did not finish. Check the network or VPN.".to_string())??;
    if !signed_in {
        return Err(refused_text(auth));
    }
    Ok(handle)
}

/// Ohne Schlüsseldatei und ohne Passwort gibt es keine Anmeldung.
pub const NO_KEY: &str = "No SSH key file set: choose a key file in Options > ADITO > General.";

fn refused_text(auth: &OwnedAuth) -> String {
    match auth {
        OwnedAuth::Key(Some(_)) | OwnedAuth::KeyPass(..) => "The server rejected the SSH key. Check the key file, the user name and that the key is still valid on the server.".into(),
        OwnedAuth::Key(None) => NO_KEY.into(),
        OwnedAuth::Basic(_) => "Login refused: wrong user name or password.".into(),
    }
}

async fn authenticate(handle: &mut SshHandle, user: &str, auth: &OwnedAuth) -> Result<bool, String> {
    match auth {
        OwnedAuth::Key(Some(path)) => auth_key(handle, user, path, None).await,
        OwnedAuth::KeyPass(path, passphrase) => auth_key(handle, user, path, Some(passphrase)).await,
        OwnedAuth::Key(None) => Err(NO_KEY.to_string()),
        OwnedAuth::Basic(password) => auth_password(handle, user, password).await,
    }
}

async fn auth_key(handle: &mut SshHandle, user: &str, path: &Path, passphrase: Option<&str>) -> Result<bool, String> {
    let key = load_key(path, passphrase)?;
    let hash = handle.best_supported_rsa_hash().await.map_err(|e| e.to_string())?.flatten();
    let result = handle.authenticate_publickey(user, PrivateKeyWithHashAlg::new(Arc::new(key), hash)).await.map_err(|e| e.to_string())?;
    Ok(result.success())
}

async fn auth_password(handle: &mut SshHandle, user: &str, password: &str) -> Result<bool, String> {
    let result = handle.authenticate_password(user, password).await.map_err(|e| e.to_string())?;
    if result.success() {
        return Ok(true);
    }
    // Manche Server fragen das Passwort nur per keyboard-interactive.
    let mut reply = handle.authenticate_keyboard_interactive_start(user, None::<String>).await.map_err(|e| e.to_string())?;
    for _ in 0..4 {
        match reply {
            KeyboardInteractiveAuthResponse::Success => return Ok(true),
            KeyboardInteractiveAuthResponse::Failure { .. } => return Ok(false),
            KeyboardInteractiveAuthResponse::InfoRequest { prompts, .. } => {
                let answers = prompts.iter().map(|_| password.to_string()).collect();
                reply = handle.authenticate_keyboard_interactive_respond(answers).await.map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_keys_are_new_known_or_changed() {
        let id = host_id("Test-Host.Example", 22);
        assert_eq!(id, "test-host.example:22");
        forget_host(&id);
        assert_eq!(check_host(&id, "SHA256:a"), HostKeyState::New);
        remember_host(&id, "SHA256:a");
        assert_eq!(check_host(&id, "SHA256:a"), HostKeyState::Known);
        assert_eq!(check_host(&id, "SHA256:b"), HostKeyState::Changed("SHA256:a".into()));
        forget_host(&id);
    }
}
