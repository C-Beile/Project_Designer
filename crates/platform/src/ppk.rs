//! PuTTY `.ppk` keys as OpenSSH keys. Windows users keep their keys in PuTTY format; `ssh` (macOS, Linux and the
//! git commands of the Designer) only reads OpenSSH keys, so the file is converted on the fly. The original `.ppk`
//! is never changed. Keys with a passphrase are refused: nothing could ask for it.

use base64::Engine;
use ssh_key::private::{Ed25519Keypair, KeypairData, RsaKeypair, RsaPrivateKey};
use ssh_key::public::RsaPublicKey;
use ssh_key::{LineEnding, Mpint, PrivateKey};
use std::path::{Path, PathBuf};

struct Reader<'a>(&'a [u8]);

impl<'a> Reader<'a> {
    fn string(&mut self) -> Result<&'a [u8], String> {
        if self.0.len() < 4 {
            return Err("The key file is cut off.".into());
        }
        let len = u32::from_be_bytes([self.0[0], self.0[1], self.0[2], self.0[3]]) as usize;
        let rest = &self.0[4..];
        if rest.len() < len {
            return Err("The key file is cut off.".into());
        }
        let (value, tail) = rest.split_at(len);
        self.0 = tail;
        Ok(value)
    }

    fn mpint(&mut self) -> Result<Mpint, String> {
        let bytes = self.string()?;
        Mpint::from_bytes(bytes).map_err(|e| format!("The key file holds a number that cannot be read: {e}"))
    }
}

fn field<'a>(lines: &[&'a str], name: &str) -> Option<&'a str> {
    lines.iter().find_map(|l| l.strip_prefix(name).and_then(|r| r.strip_prefix(':')).map(str::trim))
}

/// The base64 block that follows `<name>: <count>`.
fn block(lines: &[&str], name: &str) -> Result<Vec<u8>, String> {
    let at = lines.iter().position(|l| l.strip_prefix(name).map(|r| r.starts_with(':')).unwrap_or(false)).ok_or("The file is not a complete PuTTY key.")?;
    let count: usize = field(lines, name).and_then(|v| v.parse().ok()).ok_or("The file is not a complete PuTTY key.")?;
    let joined: String = lines.iter().skip(at + 1).take(count).map(|l| l.trim()).collect();
    base64::engine::general_purpose::STANDARD.decode(joined).map_err(|e| format!("The key file cannot be decoded: {e}"))
}

/// Converts the text of an unencrypted `.ppk` file (format 2 or 3) of an RSA or ed25519 key to an OpenSSH private key.
pub fn ppk_to_openssh(text: &str) -> Result<String, String> {
    let lines: Vec<&str> = text.lines().collect();
    let header = lines.first().copied().unwrap_or("");
    let algorithm = header
        .strip_prefix("PuTTY-User-Key-File-2:")
        .or_else(|| header.strip_prefix("PuTTY-User-Key-File-3:"))
        .map(str::trim)
        .ok_or("This is not a PuTTY key file.")?;
    if field(&lines, "Encryption") != Some("none") {
        return Err("This PuTTY key is protected by a passphrase. Remove the passphrase (PuTTYgen) or load the key into an ssh-agent.".into());
    }
    let comment = field(&lines, "Comment").unwrap_or("").to_string();
    let public = block(&lines, "Public-Lines")?;
    let private = block(&lines, "Private-Lines")?;
    let mut public = Reader(&public);
    let mut private = Reader(&private);
    if public.string()? != algorithm.as_bytes() {
        return Err("The key file is damaged: the key type does not match.".into());
    }
    let data = match algorithm {
        "ssh-rsa" => {
            let e = public.mpint()?;
            let n = public.mpint()?;
            let d = private.mpint()?;
            let p = private.mpint()?;
            let q = private.mpint()?;
            let iqmp = private.mpint()?;
            KeypairData::Rsa(RsaKeypair { public: RsaPublicKey { e, n }, private: RsaPrivateKey { d, iqmp, p, q } })
        }
        "ssh-ed25519" => {
            let seed = private.string()?;
            let seed: [u8; 32] = seed.try_into().map_err(|_| "The ed25519 key has the wrong length.".to_string())?;
            KeypairData::Ed25519(Ed25519Keypair::from_seed(&seed))
        }
        other => return Err(format!("The key type {other} is not supported. Use an RSA or ed25519 key.")),
    };
    let key = PrivateKey::new(data, comment).map_err(|e| format!("The key could not be converted: {e}"))?;
    key.to_openssh(LineEnding::LF).map(|k| k.to_string()).map_err(|e| format!("The key could not be written: {e}"))
}

/// A short-lived OpenSSH copy of a `.ppk` file in the temp folder, readable by the user only. The caller deletes it
/// with `remove_key_file` as soon as `ssh` has started and read it.
pub fn openssh_copy(ppk: &Path) -> Result<PathBuf, String> {
    let text = std::fs::read_to_string(ppk).map_err(|e| format!("The key file cannot be read: {e}"))?;
    let converted = ppk_to_openssh(&text)?;
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    std::hash::Hash::hash(&(ppk, std::process::id(), std::time::SystemTime::now()), &mut hasher);
    let target = std::env::temp_dir().join(format!("dito-key-{:016x}", std::hash::Hasher::finish(&hasher)));
    write_private(&target, converted.as_bytes())?;
    Ok(target)
}

#[cfg(unix)]
fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let mut file = std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(path).map_err(|e| format!("The key copy could not be written: {e}"))?;
    file.write_all(bytes).map_err(|e| format!("The key copy could not be written: {e}"))
}

#[cfg(not(unix))]
fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    // The temp folder of a Windows user is only open to that user (and the system).
    std::fs::write(path, bytes).map_err(|e| format!("The key copy could not be written: {e}"))
}

pub fn remove_key_file(path: &Path) {
    let _ = std::fs::remove_file(path);
}

pub fn is_ppk(path: &Path) -> bool {
    path.extension().map(|e| e.eq_ignore_ascii_case("ppk")).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ssh_string(out: &mut Vec<u8>, bytes: &[u8]) {
        out.extend((bytes.len() as u32).to_be_bytes());
        out.extend(bytes);
    }

    fn lines(blob: &[u8]) -> String {
        base64::engine::general_purpose::STANDARD.encode(blob)
    }

    fn ed25519_ppk(seed: [u8; 32], encryption: &str) -> (String, String) {
        let pair = Ed25519Keypair::from_seed(&seed);
        let mut public = Vec::new();
        ssh_string(&mut public, b"ssh-ed25519");
        ssh_string(&mut public, pair.public.as_ref());
        let mut private = Vec::new();
        ssh_string(&mut private, &seed);
        let ppk = format!(
            "PuTTY-User-Key-File-3: ssh-ed25519\nEncryption: {encryption}\nComment: test key\nPublic-Lines: 1\n{}\nPrivate-Lines: 1\n{}\nPrivate-MAC: 00\n",
            lines(&public),
            lines(&private)
        );
        let expected = PrivateKey::from(pair).public_key().to_openssh().unwrap();
        (ppk, expected)
    }

    #[test]
    fn an_ed25519_ppk_becomes_the_same_openssh_key() {
        let (ppk, expected) = ed25519_ppk([7; 32], "none");
        let openssh = ppk_to_openssh(&ppk).unwrap();
        assert!(openssh.starts_with("-----BEGIN OPENSSH PRIVATE KEY-----"));
        let back = PrivateKey::from_openssh(&openssh).unwrap();
        let key_of = |s: String| s.split(' ').take(2).map(str::to_string).collect::<Vec<_>>();
        assert_eq!(key_of(back.public_key().to_openssh().unwrap()), key_of(expected));
        assert_eq!(back.comment(), "test key");
    }

    #[test]
    fn a_key_with_a_passphrase_is_refused_with_a_reason() {
        let (ppk, _) = ed25519_ppk([7; 32], "aes256-cbc");
        assert!(ppk_to_openssh(&ppk).unwrap_err().contains("passphrase"));
    }

    #[test]
    fn other_files_and_damaged_keys_are_refused() {
        assert!(ppk_to_openssh("-----BEGIN OPENSSH PRIVATE KEY-----").is_err());
        let (ppk, _) = ed25519_ppk([1; 32], "none");
        assert!(ppk_to_openssh(&ppk.replace("Private-Lines: 1", "Private-Lines: 3")).is_err());
        assert!(ppk_to_openssh(&ppk.replace("ssh-ed25519", "ecdsa-sha2-nistp256")).is_err());
    }

    #[test]
    fn the_copy_is_written_and_removed() {
        let (ppk, _) = ed25519_ppk([3; 32], "none");
        let src = std::env::temp_dir().join(format!("forge-ppk-src-{}.ppk", std::process::id()));
        std::fs::write(&src, ppk).unwrap();
        let copy = openssh_copy(&src).unwrap();
        assert!(std::fs::read_to_string(&copy).unwrap().contains("OPENSSH PRIVATE KEY"));
        remove_key_file(&copy);
        assert!(!copy.exists());
        let _ = std::fs::remove_file(&src);
        assert!(is_ppk(&src));
    }
}
