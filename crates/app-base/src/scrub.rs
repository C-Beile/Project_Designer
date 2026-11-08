//! Maskiert Geheimnisse in Texten, bevor sie in Logs oder die Oberfläche gelangen.

/// Masks secrets that could end up in an error text: `password=...`, `-pw <x>`, `pwd:...`, URLs with credentials.
#[must_use]
pub fn scrub(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let lower = text.to_lowercase();
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < text.len() {
        let mut matched = false;
        for key in ["password=", "password:", "passwd=", "pwd=", "pwd:", "-pw ", "secret=", "token="] {
            if lower[i..].starts_with(key) && text.is_char_boundary(i + key.len()) {
                out.push_str(&text[i..i + key.len()]);
                out.push_str("***");
                let mut j = i + key.len();
                while j < bytes.len() && !bytes[j].is_ascii_whitespace() && bytes[j] != b'&' && bytes[j] != b';' && bytes[j] != b'"' && bytes[j] != b'\'' {
                    j += 1;
                }
                while j < text.len() && !text.is_char_boundary(j) {
                    j += 1;
                }
                i = j;
                matched = true;
                break;
            }
        }
        if !matched {
            let ch = text[i..].chars().next().unwrap_or(' ');
            out.push(ch);
            i += ch.len_utf8();
        }
    }
    out
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
pub fn redact(text: &str, secrets: &[&str]) -> String {
    let mut out = text.to_string();
    for s in secrets.iter().filter(|s| s.len() >= 3) {
        out = out.replace(s, "***").replace(&percent_encode(s), "***");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scrub_masks_passwords_in_all_known_spellings() {
        assert_eq!(scrub("connect password=hunter2 failed"), "connect password=*** failed");
        assert_eq!(scrub("plink -pw s3cret -batch host"), "plink -pw *** -batch host");
        assert_eq!(scrub("jdbc:x?user=a&pwd=abc&x=1"), "jdbc:x?user=a&pwd=***&x=1");
        assert_eq!(scrub("Straße ü ohne Geheimnis"), "Straße ü ohne Geheimnis");
    }

    #[test]
    fn percent_encoding_protects_url_special_characters() {
        assert_eq!(percent_encode("p@ss/w#rd"), "p%40ss%2Fw%23rd");
        assert_eq!(percent_encode("abc-1_.~"), "abc-1_.~");
    }

    #[test]
    fn redact_removes_plain_and_encoded_secrets() {
        let out = redact("denied for dbuser using p@ss/w#rd / p%40ss%2Fw%23rd", &["dbuser", "p@ss/w#rd"]);
        assert!(!out.contains("dbuser") && !out.contains("p@ss") && !out.contains("p%40ss"));
    }
}
