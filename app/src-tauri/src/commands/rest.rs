use platform::{Credential, CredentialStore};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::{Duration, Instant};

const MAX_BODY: usize = 8 * 1024 * 1024;
const PASSWORD_REQUIRED: &str = "PASSWORD_REQUIRED";

#[tauri::command(async)]
pub fn rest_list_webservices(project_root: String) -> Vec<project::webservices::WebserviceDto> {
    crate::commands::guard("rest_list_webservices", || project::webservices::list_webservices(&PathBuf::from(project_root)))
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

#[tauri::command]
pub async fn rest_send(request: RestCallRequest) -> Result<RestCallResponse, String> {
    crate::commands::guard_async("rest_send", async move {
        valid_url(&request.url)?;
        let method = reqwest::Method::from_bytes(request.method.trim().to_ascii_uppercase().as_bytes()).map_err(|_| "The HTTP method is not valid.".to_string())?;
        let client = reqwest::Client::builder()
            .danger_accept_invalid_certs(request.insecure)
            .timeout(Duration::from_secs(request.timeout_secs.unwrap_or(60).clamp(1, 600)))
            .redirect(reqwest::redirect::Policy::limited(5))
            .build()
            .map_err(|e| e.to_string())?;
        let mut builder = client.request(method, &request.url);
        for (k, v) in request.headers.iter().filter(|(k, _)| !k.trim().is_empty()) {
            if k.eq_ignore_ascii_case("authorization") || k.eq_ignore_ascii_case("authmethod") || k.eq_ignore_ascii_case("tokenid") {
                continue;
            }
            builder = builder.header(k.trim(), v);
        }
        match request.auth.kind.as_str() {
            "basic" => {
                let key = credential_key(&request.url, &request.auth.user);
                let credential = store().get(&key).ok().flatten().ok_or_else(|| PASSWORD_REQUIRED.to_string())?;
                builder = builder.header("authMethod", "Basic").basic_auth(&request.auth.user, Some(credential.secret));
            }
            "usertoken" => {
                builder = builder.header("authMethod", "usertoken").header("tokenId", request.auth.token_id.trim());
            }
            _ => {}
        }
        if let Some(body) = request.body.filter(|b| !b.is_empty()) {
            builder = builder.body(body);
        }
        let started = Instant::now();
        let response = builder.send().await.map_err(|e| describe(&e))?;
        let status = response.status();
        let headers: Vec<(String, String)> = response.headers().iter().map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string())).collect();
        let bytes = response.bytes().await.map_err(|e| describe(&e))?;
        let size = bytes.len();
        if size > MAX_BODY {
            return Err("The answer is larger than 8 MB.".into());
        }
        Ok(RestCallResponse {
            status: status.as_u16(),
            reason: status.canonical_reason().unwrap_or("").to_string(),
            headers,
            body: String::from_utf8_lossy(&bytes).into_owned(),
            elapsed_ms: started.elapsed().as_millis() as u64,
            size,
        })
    })
    .await
}

fn describe(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        "The server did not answer in time.".into()
    } else if e.is_connect() {
        "The server cannot be reached. Is the tunnel open and the URL right?".into()
    } else {
        e.to_string()
    }
}
