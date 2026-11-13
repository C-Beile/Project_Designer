use platform::{Credential, CredentialStore};
use project::http_wire::{base64, is_token, parse_response, parse_target};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::{Duration, Instant};

const MAX_BODY: usize = 8 * 1024 * 1024;
const PASSWORD_REQUIRED: &str = "PASSWORD_REQUIRED";

#[tauri::command(async)]
pub fn rest_list_webservices(project_root: String) -> Vec<project::webservices::WebserviceDto> {
    crate::commands::guard("rest_list_webservices", || project::webservices::list_webservices(&PathBuf::from(project_root)))
}

#[tauri::command(async)]
pub fn rest_list_servers(project_root: String) -> Vec<project::webservices::ServerDto> {
    crate::commands::guard("rest_list_servers", || project::webservices::list_servers(&PathBuf::from(project_root)))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestAuth {
    pub kind: String,
    #[serde(default)]
    pub user: String,
    #[serde(default)]
    pub token_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestCallRequest {
    pub url: String,
    pub method: String,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub body: Option<String>,
    pub auth: RestAuth,
    #[serde(default)]
    pub insecure: bool,
    #[serde(default)]
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestCallResponse {
    pub status: u16,
    pub reason: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
    pub elapsed_ms: u64,
    pub size: usize,
    pub sent: String,
}

fn host_of(url: &str) -> String {
    let rest = url.split("://").nth(1).unwrap_or(url);
    rest.split(['/', '?', '#']).next().unwrap_or("").to_ascii_lowercase()
}

fn credential_key(url: &str, user: &str) -> String {
    format!("forge/rest/{}/{}", host_of(url), user.to_ascii_lowercase())
}

fn store() -> platform::native::NativeCredentialStore {
    platform::native::NativeCredentialStore::default()
}

#[tauri::command(async)]
pub fn rest_has_password(url: String, user: String) -> bool {
    crate::commands::guard("rest_has_password", || store().get(&credential_key(&url, &user)).ok().flatten().is_some())
}

#[tauri::command(async)]
pub fn rest_save_password(url: String, user: String, password: String) -> Result<(), String> {
    crate::commands::guard("rest_save_password", || {
        store().set(&credential_key(&url, &user), &Credential { username: user.clone(), secret: password.clone() }).map_err(|e| e.to_string())
    })
}

#[tauri::command(async)]
pub fn rest_forget_password(url: String, user: String) -> Result<(), String> {
    crate::commands::guard("rest_forget_password", || store().delete(&credential_key(&url, &user)).map_err(|e| e.to_string()))
}

fn valid_url(url: &str) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("The URL must start with http:// or https://.".into());
    }
    if url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("The URL must not contain spaces or line breaks; encode them (%20).".into());
    }
    Ok(())
}

#[derive(Debug)]
struct AcceptAny(std::sync::Arc<rustls::crypto::CryptoProvider>);

impl rustls::client::danger::ServerCertVerifier for AcceptAny {
    fn verify_server_cert(
        &self,
        _end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(&self, message: &[u8], cert: &rustls::pki_types::CertificateDer<'_>, dss: &rustls::DigitallySignedStruct) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(message, cert, dss, &self.0.signature_verification_algorithms)
    }

    fn verify_tls13_signature(&self, message: &[u8], cert: &rustls::pki_types::CertificateDer<'_>, dss: &rustls::DigitallySignedStruct) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(message, cert, dss, &self.0.signature_verification_algorithms)
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        self.0.signature_verification_algorithms.supported_schemes()
    }
}

fn tls_config(insecure: bool) -> Result<std::sync::Arc<rustls::ClientConfig>, String> {
    let provider = std::sync::Arc::new(rustls::crypto::ring::default_provider());
    let builder = rustls::ClientConfig::builder_with_provider(provider.clone()).with_safe_default_protocol_versions().map_err(|e| e.to_string())?;
    let config = if insecure {
        builder.dangerous().with_custom_certificate_verifier(std::sync::Arc::new(AcceptAny(provider))).with_no_client_auth()
    } else {
        rustls_platform_verifier::BuilderVerifierExt::with_platform_verifier(builder).map_err(|e| e.to_string())?.with_no_client_auth()
    };
    Ok(std::sync::Arc::new(config))
}

async fn exchange<S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin>(mut stream: S, request: &[u8]) -> Result<Vec<u8>, String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    stream.write_all(request).await.map_err(|e| format!("Sending failed: {e}"))?;
    stream.flush().await.map_err(|e| format!("Sending failed: {e}"))?;
    let mut raw = Vec::new();
    let mut buf = [0u8; 16 * 1024];
    loop {
        match stream.read(&mut buf).await {
            Ok(0) => break,
            Ok(n) => {
                raw.extend_from_slice(&buf[..n]);
                if raw.len() > MAX_BODY + 64 * 1024 {
                    return Err("The answer is larger than 8 MB.".into());
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof && !raw.is_empty() => break,
            Err(e) => return Err(format!("Reading the answer failed: {e}")),
        }
    }
    Ok(raw)
}

#[tauri::command]
pub async fn rest_send(request: RestCallRequest) -> Result<RestCallResponse, String> {
    crate::commands::guard_async("rest_send", async move {
        valid_url(&request.url)?;
        let _ = rustls::crypto::ring::default_provider().install_default();
        let method = request.method.trim().to_ascii_uppercase();
        if !is_token(&method) {
            return Err("The HTTP method is not valid.".into());
        }
        let target = parse_target(&request.url)?;
        let body = request.body.clone().filter(|b| !b.is_empty()).unwrap_or_default();
        let host_header = if (target.https && target.port == 443) || (!target.https && target.port == 80) { target.host.clone() } else { format!("{}:{}", target.host, target.port) };

        let mut head = format!("{method} {} HTTP/1.1\r\nHost: {host_header}\r\nConnection: close\r\nAccept-Encoding: identity\r\n", target.path);
        let mut shown = head.clone();
        let mut add = |name: &str, value: &str, masked: Option<&str>| {
            head.push_str(&format!("{name}: {value}\r\n"));
            shown.push_str(&format!("{name}: {}\r\n", masked.unwrap_or(value)));
        };
        for (k, v) in request.headers.iter().filter(|(k, _)| !k.trim().is_empty()) {
            let k = k.trim();
            if !is_token(k) || v.contains(['\r', '\n']) {
                return Err(format!("The header '{k}' is not valid."));
            }
            if ["host", "content-length", "connection", "authorization", "authmethod", "tokenid", "accept-encoding"].contains(&k.to_ascii_lowercase().as_str()) {
                continue;
            }
            add(k, v, None);
        }
        match request.auth.kind.as_str() {
            "basic" => {
                let key = credential_key(&request.url, &request.auth.user);
                let credential = store().get(&key).ok().flatten().ok_or_else(|| PASSWORD_REQUIRED.to_string())?;
                add("Authorization", &format!("Basic {}", base64(format!("{}:{}", request.auth.user, credential.secret).as_bytes())), Some(&format!("Basic *** (user {})", request.auth.user)));
            }
            "usertoken" => {
                add("authMethod", "usertoken", None);
                add("tokenId", request.auth.token_id.trim(), None);
            }
            _ => {}
        }
        if !body.is_empty() || matches!(method.as_str(), "POST" | "PUT" | "PATCH") {
            add("Content-Length", &body.len().to_string(), None);
        }
        head.push_str("\r\n");
        shown.push_str("\r\n");
        let mut bytes = head.into_bytes();
        bytes.extend_from_slice(body.as_bytes());

        let started = Instant::now();
        let timeout = Duration::from_secs(request.timeout_secs.unwrap_or(60).clamp(1, 600));
        let outcome = tokio::time::timeout(timeout, async {
            let tcp = tokio::net::TcpStream::connect((target.host.as_str(), target.port)).await.map_err(|e| format!("The server cannot be reached ({e}). Is the tunnel open and the URL right?"))?;
            if target.https {
                let name = rustls::pki_types::ServerName::try_from(target.host.clone()).map_err(|_| "The server name is not valid.".to_string())?;
                let connector = tokio_rustls::TlsConnector::from(tls_config(request.insecure)?);
                let tls = connector.connect(name, tcp).await.map_err(|e| format!("The secure connection failed: {e}. For a self-signed certificate tick Accept untrusted certificate."))?;
                exchange(tls, &bytes).await
            } else {
                exchange(tcp, &bytes).await
            }
        })
        .await;
        let raw = match outcome {
            Ok(result) => result?,
            Err(_) => return Err("The server did not answer in time.".into()),
        };
        let (status, reason, headers, payload) = parse_response(&raw)?;
        let size = payload.len();
        if size > MAX_BODY {
            return Err("The answer is larger than 8 MB.".into());
        }
        Ok(RestCallResponse { status, reason, headers, body: String::from_utf8_lossy(&payload).into_owned(), elapsed_ms: started.elapsed().as_millis() as u64, size, sent: shown })
    })
    .await
}
