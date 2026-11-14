//! Bausteine fuer den SSH-Tunnel: Eintrag, Auth, Schluesselpfad. Reine Hilfen ohne Datenbank- oder Sitzungslogik.
//! `scrub` entfernt Geheimnisse aus Texten fuer die UI.

use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TunnelEntry {
    pub tunnel_host: String,
    pub tunnel_port: u16,
    pub target_host: String,
    pub target_port: u16,
    pub user: String,
}

pub use app_base::scrub::{percent_encode, redact as scrub};

/// How the SSH tunnel authenticates (Manual appendix E). Passwords and passphrases only live in memory.
#[derive(Clone)]
pub enum TunnelAuth<'a> {
    /// Key file without a passphrase; `None` falls back to a running Pageant or ssh-agent.
    Key(Option<&'a Path>),
    Basic { password: &'a str },
    /// Key file whose passphrase is given.
    KeyPass { key: &'a Path, passphrase: &'a str },
}

impl std::fmt::Debug for TunnelAuth<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TunnelAuth::Key(k) => f.debug_tuple("Key").field(k).finish(),
            TunnelAuth::Basic { .. } => f.write_str("Basic { password: <redacted> }"),
            TunnelAuth::KeyPass { key, .. } => f.debug_struct("KeyPass").field("key", key).field("passphrase", &"<redacted>").finish(),
        }
    }
}

/// Bereinigt die Tunnel-Eingaben der Oberflaeche (leere Strings zaehlen als nicht gesetzt). Hat der
/// Schluessel noch keine Passphrase bekommen, wird die im Schluesselbund gemerkte benutzt.
pub fn clean_tunnel_inputs(key_file: Option<String>, tunnel_password: Option<String>) -> (Option<PathBuf>, Option<String>) {
    let typed = key_file.filter(|k| !k.trim().is_empty());
    let key = typed.as_deref().map(|k| key_path(k.trim()));
    let mut password = tunnel_password.filter(|p| !p.is_empty());
    if password.is_none() {
        if let Some(typed) = &typed {
            password = crate::ssh_keys::stored_passphrase(typed);
        }
    }
    (key, password)
}

/// The path of a key file as typed: `~` and `~/...` mean the home folder (macOS and Linux users write it that way), and
/// the home folder is looked up in `HOME` or `USERPROFILE`. Every other path is taken as it is.
pub fn key_path(typed: &str) -> PathBuf {
    let rest = if typed == "~" { Some("") } else { typed.strip_prefix("~/").or_else(|| typed.strip_prefix("~\\")) };
    match (rest, std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))) {
        (Some(rest), Some(home)) => PathBuf::from(home).join(rest),
        _ => PathBuf::from(typed),
    }
}

/// Auth-Schema zu den Eingaben aus [`clean_tunnel_inputs`]: Schluesseldatei mit Passwort = Passphrase, nur Passwort = Login,
/// sonst Schluesseldatei oder ein laufender Pageant.
pub fn tunnel_auth<'a>(key: &'a Option<PathBuf>, password: &'a Option<String>) -> TunnelAuth<'a> {
    match (password, key) {
        (Some(p), Some(k)) => TunnelAuth::KeyPass { key: k, passphrase: p },
        (Some(p), None) => TunnelAuth::Basic { password: p },
        (None, k) => TunnelAuth::Key(k.as_deref()),
    }
}

#[cfg(test)]
mod key_path_tests {
    use super::*;

    #[test]
    fn a_tilde_means_the_home_folder_and_other_paths_stay() {
        assert_eq!(key_path("/keys/id_ed25519"), PathBuf::from("/keys/id_ed25519"));
        assert_eq!(key_path("C:\\keys\\dev.ppk"), PathBuf::from("C:\\keys\\dev.ppk"));
        if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
            assert_eq!(key_path("~/.ssh/id_rsa"), PathBuf::from(home).join(".ssh/id_rsa"));
        }
    }

    #[test]
    fn a_key_with_a_password_is_a_passphrase_and_a_password_alone_is_a_login() {
        let key = Some(PathBuf::from("k.ppk"));
        let pw = Some("x".to_string());
        assert!(matches!(tunnel_auth(&key, &pw), TunnelAuth::KeyPass { .. }));
        assert!(matches!(tunnel_auth(&None, &pw), TunnelAuth::Basic { .. }));
        assert!(matches!(tunnel_auth(&key, &None), TunnelAuth::Key(Some(_))));
    }
}
