//! Credential storage on macOS through the Keychain command line tool `security`. Other Unix
//! systems have no store behind this trait yet and report that honestly.
//! The secret is handed to `security` as an argument, so it is visible to local processes for
//! the fraction of a second the call runs (a limitation of the CLI, unverified on a real Mac).

use crate::credentials::{Credential, CredentialStore};
use crate::error::PlatformError;

#[cfg(target_os = "macos")]
const SERVICE: &str = "de.threehillsit.vendira-designer";

#[derive(Default)]
pub struct KeychainCredentialStore;

impl KeychainCredentialStore {
    pub fn new() -> Self {
        Self
    }
}

#[cfg(target_os = "macos")]
fn fail(target: &str, detail: impl Into<String>) -> PlatformError {
    PlatformError::Credential { target: target.to_string(), detail: detail.into() }
}

#[cfg(target_os = "macos")]
impl CredentialStore for KeychainCredentialStore {
    fn get(&self, target: &str) -> Result<Option<Credential>, PlatformError> {
        let out = std::process::Command::new("security").args(["find-generic-password", "-s", SERVICE, "-a", target, "-w"]).output().map_err(|e| fail(target, e.to_string()))?;
        if !out.status.success() {
            return Ok(None);
        }
        let stored = String::from_utf8_lossy(&out.stdout).trim_end_matches('\n').to_string();
        Ok(stored.split_once('\u{1f}').map(|(u, s)| Credential { username: u.to_string(), secret: s.to_string() }))
    }

    fn set(&self, target: &str, credential: &Credential) -> Result<(), PlatformError> {
        let value = format!("{}\u{1f}{}", credential.username, credential.secret);
        let status = std::process::Command::new("security")
            .args(["add-generic-password", "-U", "-s", SERVICE, "-a", target, "-w", &value])
            .status()
            .map_err(|e| fail(target, e.to_string()))?;
        if status.success() { Ok(()) } else { Err(fail(target, "security add-generic-password failed")) }
    }

    fn delete(&self, target: &str) -> Result<(), PlatformError> {
        let _ = std::process::Command::new("security").args(["delete-generic-password", "-s", SERVICE, "-a", target]).status().map_err(|e| fail(target, e.to_string()))?;
        Ok(())
    }
}

#[cfg(not(target_os = "macos"))]
impl CredentialStore for KeychainCredentialStore {
    fn get(&self, _target: &str) -> Result<Option<Credential>, PlatformError> {
        Err(PlatformError::NotImplemented("credential store on this operating system"))
    }
    fn set(&self, _target: &str, _credential: &Credential) -> Result<(), PlatformError> {
        Err(PlatformError::NotImplemented("credential store on this operating system"))
    }
    fn delete(&self, _target: &str) -> Result<(), PlatformError> {
        Err(PlatformError::NotImplemented("credential store on this operating system"))
    }
}
