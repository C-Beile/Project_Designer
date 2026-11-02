// Windows Credential Manager access via raw CredReadW/CredWriteW/CredDeleteW (advapi32,
// windows-sys bindings) rather than a wrapper crate like `keyring` - this keeps the one
// Windows-API dependency this trait needs explicit and auditable, matching ADR-0004 rule 1
// ("no Windows specifics outside this crate": the raw calls stay contained to this one file).
// Credentials are stored as CRED_TYPE_GENERIC, persisted CRED_PERSIST_LOCAL_MACHINE (survives
// reboots, not roamed to other machines - appropriate for a per-machine DB login).

use crate::credentials::{Credential, CredentialStore};
use crate::error::PlatformError;
use std::ffi::c_void;
use windows_sys::Win32::Foundation::{ERROR_NOT_FOUND, FALSE};
use windows_sys::Win32::Security::Credentials::{
    CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
};

#[derive(Default)]
pub struct WindowsCredentialStore;

impl WindowsCredentialStore {
    pub fn new() -> Self {
        Self
    }
}

fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn from_wide_ptr(ptr: *const u16) -> String {
    if ptr.is_null() {
        return String::new();
    }
    // SAFETY: `ptr` comes from a CREDENTIALW the OS just populated for us via CredReadW; it is
    // a valid null-terminated UTF-16 string for the lifetime of that CREDENTIALW buffer, which
    // is still alive at every call site below (freed only after this function returns).
    unsafe {
        let mut len = 0usize;
        while *ptr.add(len) != 0 {
            len += 1;
        }
        let slice = std::slice::from_raw_parts(ptr, len);
        String::from_utf16_lossy(slice)
    }
}

impl CredentialStore for WindowsCredentialStore {
    fn get(&self, target: &str) -> Result<Option<Credential>, PlatformError> {
        let target_wide = to_wide(target);
        let mut credential_ptr: *mut CREDENTIALW = std::ptr::null_mut();

        // SAFETY: `target_wide` is a valid null-terminated wide string alive for the call;
        // `credential_ptr` is an out-parameter CredReadW fills with a pointer it owns (freed via
        // CredFree below).
        let ok = unsafe { CredReadW(target_wide.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential_ptr) };

        if ok == FALSE {
            let last_error = unsafe { windows_sys::Win32::Foundation::GetLastError() };
            return if last_error == ERROR_NOT_FOUND {
                Ok(None)
            } else {
                Err(PlatformError::Credential {
                    target: target.to_string(),
                    detail: format!("CredReadW failed, GetLastError = {last_error}"),
                })
            };
        }

        // SAFETY: `ok != FALSE` means CredReadW populated `credential_ptr` with a valid
        // CREDENTIALW we now own and must CredFree exactly once.
        let credential = unsafe {
            let c = &*credential_ptr;
            let username = from_wide_ptr(c.UserName);
            let secret = if c.CredentialBlob.is_null() || c.CredentialBlobSize == 0 {
                String::new()
            } else {
                let bytes = std::slice::from_raw_parts(c.CredentialBlob, c.CredentialBlobSize as usize);
                String::from_utf8_lossy(bytes).into_owned()
            };
            CredFree(credential_ptr as *const c_void);
            Credential { username, secret }
        };

        Ok(Some(credential))
    }

    fn set(&self, target: &str, credential: &Credential) -> Result<(), PlatformError> {
        let mut target_wide = to_wide(target);
        let mut username_wide = to_wide(&credential.username);
        let mut secret_bytes = credential.secret.as_bytes().to_vec();

        let mut raw = CREDENTIALW {
            Flags: 0,
            Type: CRED_TYPE_GENERIC,
            TargetName: target_wide.as_mut_ptr(),
            Comment: std::ptr::null_mut(),
            LastWritten: unsafe { std::mem::zeroed() },
            CredentialBlobSize: secret_bytes.len() as u32,
            CredentialBlob: secret_bytes.as_mut_ptr(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            AttributeCount: 0,
            Attributes: std::ptr::null_mut(),
            TargetAlias: std::ptr::null_mut(),
            UserName: username_wide.as_mut_ptr(),
        };

        // SAFETY: every pointer field above points into a local buffer kept alive for the
        // duration of this call (target_wide/username_wide/secret_bytes are not dropped until
        // after CredWriteW returns).
        let ok = unsafe { CredWriteW(&mut raw, 0) };
        if ok == FALSE {
            let last_error = unsafe { windows_sys::Win32::Foundation::GetLastError() };
            return Err(PlatformError::Credential {
                target: target.to_string(),
                detail: format!("CredWriteW failed, GetLastError = {last_error}"),
            });
        }
        Ok(())
    }

    fn delete(&self, target: &str) -> Result<(), PlatformError> {
        let target_wide = to_wide(target);
        // SAFETY: `target_wide` is a valid null-terminated wide string alive for the call.
        let ok = unsafe { CredDeleteW(target_wide.as_ptr(), CRED_TYPE_GENERIC, 0) };
        if ok == FALSE {
            let last_error = unsafe { windows_sys::Win32::Foundation::GetLastError() };
            if last_error == ERROR_NOT_FOUND {
                return Ok(());
            }
            return Err(PlatformError::Credential {
                target: target.to_string(),
                detail: format!("CredDeleteW failed, GetLastError = {last_error}"),
            });
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Real round-trip against the actual Windows Credential Manager of the account running the
    // test - deliberately scoped to a test-only target name and always cleaned up, per the
    // agent brief's instruction to test real interaction where it is reasonably possible
    // (unlike FileDialog/ShellIntegration, this needs no user interaction to verify).
    #[test]
    fn round_trips_a_credential_through_the_real_windows_credential_manager() {
        let store = WindowsCredentialStore::new();
        let target = format!("forge-platform-test-{}", std::process::id());
        let credential = Credential { username: "forge-test-user".into(), secret: "forge-test-secret".into() };

        store.delete(&target).unwrap();
        assert_eq!(store.get(&target).unwrap(), None);

        store.set(&target, &credential).unwrap();
        let fetched = store.get(&target).unwrap().expect("credential just written must be readable");
        assert_eq!(fetched, credential);

        store.delete(&target).unwrap();
        assert_eq!(store.get(&target).unwrap(), None);
    }
}
