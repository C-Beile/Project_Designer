//! SSH-Schlüssel: prüfen (vorhanden, Format, Passphrase nötig), entsperren und die Passphrase im
//! System-Schlüsselbund merken. Die Passphrase steht nie in `designer.conf`.

use platform::{Credential, CredentialStore};
use russh::keys::{decode_secret_key, PrivateKey};
use serde::Serialize;
use std::path::Path;

/// Ergebnis von [`inspect_key`].
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct KeyInfo {
    pub exists: bool,
    /// Der Schlüssel ist mit einer Passphrase geschützt.
    pub encrypted: bool,
    /// Das Format ist lesbar (PuTTY `.ppk`, OpenSSH, PEM).
    pub supported: bool,
    pub problem: Option<String>,
}

fn info(exists: bool, encrypted: bool, supported: bool, problem: Option<String>) -> KeyInfo {
    KeyInfo { exists, encrypted, supported, problem }
}

/// Prüft eine Schlüsseldatei, ohne eine Passphrase zu brauchen.
pub fn inspect_key(path: &str) -> KeyInfo {
    let path = path.trim();
    if path.is_empty() {
        return info(false, false, false, None);
    }
    let file = crate::tunnel_core::key_path(path);
    if !file.is_file() {
        return info(false, false, false, Some("File not found.".into()));
    }
    match std::fs::read_to_string(&file) {
        Ok(text) => inspect_text(&text),
        Err(e) => info(true, false, false, Some(format!("The key file cannot be read: {e}"))),
    }
}

/// Wie [`inspect_key`], aber für den Text einer Schlüsseldatei.
pub fn inspect_text(text: &str) -> KeyInfo {
    let trimmed = text.trim_start();
    if trimmed.starts_with("PuTTY-User-Key-File-") {
        let encryption = trimmed.lines().find_map(|l| l.strip_prefix("Encryption:")).map(str::trim);
        return info(true, encryption.is_some_and(|e| e != "none"), true, None);
    }
    if !text.contains("PRIVATE KEY") {
        return info(true, false, false, Some("This does not look like a private SSH key.".into()));
    }
    if text.contains("BEGIN OPENSSH PRIVATE KEY") {
        return match PrivateKey::from_openssh(text) {
            Ok(key) => info(true, key.is_encrypted(), true, None),
            Err(e) => info(true, false, false, Some(format!("The key cannot be read: {e}"))),
        };
    }
    info(true, text.contains("ENCRYPTED"), true, None)
}

/// Lädt den Schlüssel wirklich. Fehler sind Texte für die Oberfläche.
pub fn load_key(path: &Path, passphrase: Option<&str>) -> Result<PrivateKey, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("The SSH key file is missing or cannot be read: {e}"))?;
    let encrypted = inspect_text(&text).encrypted;
    let passphrase = passphrase.filter(|p| !p.is_empty());
    if encrypted && passphrase.is_none() {
        return Err("The SSH key is protected by a passphrase. Enter the passphrase in Tools > Options > ADITO > General.".into());
    }
    decode_secret_key(&text, passphrase).map_err(|e| {
        if encrypted {
            "The passphrase does not unlock the SSH key. Check it and try again.".to_string()
        } else {
            format!("The SSH key cannot be read: {e}")
        }
    })
}

/// Prüft, ob die Passphrase den Schlüssel öffnet (`None` für einen Schlüssel ohne Passphrase).
pub fn unlock_check(path: &str, passphrase: Option<&str>) -> Result<(), String> {
    load_key(&crate::tunnel_core::key_path(path.trim()), passphrase).map(|_| ())
}

fn target(path: &str) -> String {
    format!("dito/ssh-key/{}", platform::fs::path_key(&crate::tunnel_core::key_path(path.trim())))
}

fn store() -> platform::native::NativeCredentialStore {
    platform::native::NativeCredentialStore::default()
}

/// Die im Schlüsselbund gemerkte Passphrase zu einer Schlüsseldatei.
pub fn stored_passphrase(path: &str) -> Option<String> {
    store().get(&target(path)).ok().flatten().map(|c| c.secret).filter(|s| !s.is_empty())
}

pub fn save_passphrase(path: &str, passphrase: &str) -> Result<(), String> {
    store().set(&target(path), &Credential { username: "ssh-key".into(), secret: passphrase.to_string() }).map_err(|e| e.to_string())
}

pub fn forget_passphrase(path: &str) -> Result<(), String> {
    store().delete(&target(path)).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_and_missing_paths_are_reported() {
        assert_eq!(inspect_key("  "), info(false, false, false, None));
        let missing = inspect_key("Z:/does/not/exist.ppk");
        assert!(!missing.exists && missing.problem.is_some());
    }

    #[test]
    fn ppk_encryption_is_read_from_the_header() {
        let plain = "PuTTY-User-Key-File-3: ssh-ed25519\nEncryption: none\nComment: x\n";
        let locked = "PuTTY-User-Key-File-3: ssh-ed25519\nEncryption: aes256-cbc\nComment: x\n";
        assert!(!inspect_text(plain).encrypted);
        assert!(inspect_text(locked).encrypted);
        assert!(inspect_text(locked).supported);
    }

    #[test]
    fn pem_and_unknown_texts_are_told_apart() {
        assert!(inspect_text("-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\n").encrypted);
        assert!(!inspect_text("hello").supported);
    }

    #[test]
    fn an_encrypted_key_without_passphrase_asks_for_one() {
        let dir = std::env::temp_dir().join(format!("dito-key-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("k.ppk");
        std::fs::write(&file, "PuTTY-User-Key-File-3: ssh-ed25519\nEncryption: aes256-cbc\n").unwrap();
        let err = load_key(&file, None).unwrap_err();
        assert!(err.contains("passphrase"), "{err}");
        let _ = std::fs::remove_dir_all(dir);
    }
}
