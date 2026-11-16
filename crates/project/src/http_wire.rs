//! The plain-text parts of an HTTP/1.1 exchange for the REST client: the target of a URL, the parsing of an answer, the
//! Basic credentials. Kept here, away from the network code, so they can be tested.

pub struct Target {
    pub https: bool,
    pub host: String,
    pub port: u16,
    pub path: String,
}

pub fn parse_target(url: &str) -> Result<Target, String> {
    let (scheme, rest) = url.split_once("://").ok_or("The URL must start with http:// or https://.")?;
    let https = scheme.eq_ignore_ascii_case("https");
    let cut = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let (authority, tail) = rest.split_at(cut);
    if authority.is_empty() || authority.contains('@') {
        return Err("The URL has no valid server name.".into());
    }
    let (host, port) = match authority.rsplit_once(':') {
        Some((h, p)) if !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()) => (h.to_string(), p.parse::<u16>().map_err(|_| "The port is not valid.".to_string())?),
        _ => (authority.to_string(), if https { 443 } else { 80 }),
    };
    let tail = tail.split('#').next().unwrap_or("");
    let path = if tail.starts_with('/') { tail.to_string() } else { format!("/{tail}") };
    Ok(Target { https, host, port, path })
}

fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

fn dechunk(mut data: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    while let Some(line_end) = find(data, b"\r\n") {
        let size_text = String::from_utf8_lossy(&data[..line_end]).into_owned();
        let Ok(size) = usize::from_str_radix(size_text.split(';').next().unwrap_or("").trim(), 16) else { break };
        data = &data[line_end + 2..];
        if size == 0 || data.len() < size {
            out.extend_from_slice(&data[..data.len().min(size)]);
            break;
        }
        out.extend_from_slice(&data[..size]);
        data = data.get(size + 2..).unwrap_or(&[]);
    }
    out
}

pub fn parse_response(raw: &[u8]) -> Result<(u16, String, Vec<(String, String)>, Vec<u8>), String> {
    let split = find(raw, b"\r\n\r\n").ok_or("The server sent no valid HTTP answer.")?;
    let head = String::from_utf8_lossy(&raw[..split]).into_owned();
    let mut lines = head.lines();
    let status_line = lines.next().unwrap_or("");
    let mut parts = status_line.splitn(3, ' ');
    let _version = parts.next();
    let status: u16 = parts.next().and_then(|s| s.parse().ok()).ok_or("The server sent no valid HTTP answer.")?;
    let reason = parts.next().unwrap_or("").to_string();
    let headers: Vec<(String, String)> = lines.filter_map(|l| l.split_once(':').map(|(k, v)| (k.trim().to_string(), v.trim().to_string()))).collect();
    let mut body = raw[split + 4..].to_vec();
    if headers.iter().any(|(k, v)| k.eq_ignore_ascii_case("transfer-encoding") && v.to_ascii_lowercase().contains("chunked")) {
        body = dechunk(&body);
    }
    Ok((status, reason, headers, body))
}

pub fn is_token(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "!#$%&'*+-.^_`|~".contains(c))
}

pub fn base64(input: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in input.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_a_url_into_host_port_and_path() {
        let t = parse_target("https://hermes.example.cloud/services/rest/X?count=1#frag").unwrap();
        assert_eq!((t.https, t.host.as_str(), t.port, t.path.as_str()), (true, "hermes.example.cloud", 443, "/services/rest/X?count=1"));
        let t = parse_target("http://localhost:8080").unwrap();
        assert_eq!((t.https, t.host.as_str(), t.port, t.path.as_str()), (false, "localhost", 8080, "/"));
        assert!(parse_target("https://user@host/").is_err());
        assert!(parse_target("host/path").is_err());
    }

    #[test]
    fn reads_status_headers_and_a_chunked_body() {
        let raw = b"HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm=\"x\"\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n";
        let (status, reason, headers, body) = parse_response(raw).unwrap();
        assert_eq!((status, reason.as_str()), (401, "Unauthorized"));
        assert_eq!(headers[0], ("WWW-Authenticate".to_string(), "Basic realm=\"x\"".to_string()));
        assert_eq!(body, b"hello world");
        assert!(parse_response(b"garbage").is_err());
    }

    #[test]
    fn encodes_basic_credentials() {
        assert_eq!(base64(b"user:pass"), "dXNlcjpwYXNz");
        assert_eq!(base64(b"a"), "YQ==");
        assert!(is_token("authMethod") && !is_token("bad header"));
    }
}
