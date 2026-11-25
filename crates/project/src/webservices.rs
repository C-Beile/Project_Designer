//! The web services of a project and its modules (read-only): the entity web services with their allowed methods and
//! login types, and the custom web services, which are processes published as REST (`publishAsWebservice`).

use serde::Serialize;
use std::collections::BTreeMap;
use std::path::Path;

/// A query parameter a custom web service reads, found in its script.
#[derive(Debug, Clone, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ParamHintDto {
    pub name: String,
    pub kind: Option<String>,
    pub mandatory: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WebserviceDto {
    pub name: String,
    pub module: Option<String>,
    pub methods: Vec<String>,
    pub login_types: Vec<String>,
    #[specta(type = u32)]
    pub fields: usize,
    /// `entity` for an entity web service, `custom` for a process published as web service.
    pub kind: String,
    pub accepts: Option<String>,
    pub delivers: Option<String>,
    pub params: Vec<ParamHintDto>,
}

const CUSTOM_METHODS: [&str; 5] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

fn elements_of(text: &str, tag: &str) -> Vec<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let Some(start) = text.find(&open) else { return Vec::new() };
    let Some(len) = text[start..].find(&close) else { return Vec::new() };
    let block = &text[start + open.len()..start + len];
    block
        .split("<element>")
        .skip(1)
        .filter_map(|part| part.split("</element>").next())
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .collect()
}

fn read_webservice(dir: &Path, module: Option<&str>) -> Option<WebserviceDto> {
    let name = dir.file_name()?.to_string_lossy().into_owned();
    let bytes = std::fs::read(dir.join(format!("{name}.aod"))).ok()?;
    let text = String::from_utf8_lossy(&bytes);
    let mut methods: Vec<String> = elements_of(&text, "webserviceMethods").into_iter().map(|m| m.to_ascii_uppercase()).collect();
    methods.dedup();
    Some(WebserviceDto {
        name,
        module: module.map(str::to_string),
        methods,
        login_types: elements_of(&text, "loginTypeId"),
        fields: text.matches("<webserviceField>").count(),
        kind: "entity".into(),
        accepts: None,
        delivers: None,
        params: Vec::new(),
    })
}

fn tag_text(text: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let start = text.find(&open)? + open.len();
    let end = text[start..].find(&format!("</{tag}>"))? + start;
    let value = text[start..end].trim();
    (!value.is_empty()).then(|| value.to_string())
}

/// The HTTP methods a custom web service script answers: one function `restget`, `restpost`, ... per method.
fn script_methods(script: &str) -> Vec<String> {
    let lower = script.to_ascii_lowercase();
    CUSTOM_METHODS
        .iter()
        .filter(|m| {
            let needle = format!("function rest{}", m.to_ascii_lowercase());
            lower.match_indices(&needle).any(|(at, _)| !lower[at + needle.len()..].chars().next().is_some_and(|c| c.is_ascii_alphanumeric() || c == '_'))
        })
        .map(|m| m.to_string())
        .collect()
}

fn quoted_after(text: &str, key: &str) -> Option<String> {
    let at = text.find(key)? + key.len();
    let rest = text[at..].trim_start().strip_prefix(':')?.trim_start();
    let quote = rest.chars().next().filter(|c| matches!(c, '"' | '\''))?;
    let inner = &rest[1..];
    Some(inner[..inner.find(quote)?].to_string())
}

/// The query parameters a script reads: the descriptors handed to `checkQueryParams(request.query, [ { name: "x",
/// mandatory: true, type: "Number" } ])` and plain `request.query.x` accesses. A hint only, found by reading the text.
fn script_params(script: &str) -> Vec<ParamHintDto> {
    let mut out: Vec<ParamHintDto> = Vec::new();
    let mut add = |name: String, kind: Option<String>, mandatory: bool| {
        if !name.is_empty() && !out.iter().any(|p| p.name == name) {
            out.push(ParamHintDto { name, kind, mandatory });
        }
    };
    let mut from = 0;
    while let Some(found) = script[from..].find("checkQueryParams(") {
        let start = from + found;
        let end = script[start..].find(");").map(|e| start + e).unwrap_or(script.len());
        for part in script[start..end].split('{').skip(1) {
            let block = part.split('}').next().unwrap_or(part);
            if let Some(name) = quoted_after(block, "name") {
                let mandatory = block.find("mandatory").is_some_and(|at| block[at + "mandatory".len()..].trim_start().trim_start_matches(':').trim_start().starts_with("true"));
                add(name, quoted_after(block, "type"), mandatory);
            }
        }
        from = end;
    }
    for needle in ["request.query.", "request.query["] {
        for (at, _) in script.match_indices(needle) {
            let rest = &script[at + needle.len()..];
            let name: String = if needle.ends_with('[') {
                rest.trim_start_matches(['"', '\'']).chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '_').collect()
            } else {
                rest.chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '_').collect()
            };
            add(name, None, false);
        }
    }
    out
}

fn read_custom_webservice(root: &Path, dir: &Path, module: Option<&str>) -> Option<WebserviceDto> {
    let name = dir.file_name()?.to_string_lossy().into_owned();
    let bytes = std::fs::read(dir.join(format!("{name}.aod"))).ok()?;
    let text = String::from_utf8_lossy(&bytes);
    if !text.contains("<publishAsWebservice v=\"true\"") {
        return None;
    }
    if tag_text(&text, "style").is_some_and(|s| !s.eq_ignore_ascii_case("REST")) {
        return None;
    }
    let script_ref = tag_text(&text, "process");
    let script_path = match script_ref.as_deref().and_then(|r| r.strip_prefix("%aditoprj%/")) {
        Some(rel) => root.join(rel),
        None => dir.join("process.js"),
    };
    let script = std::fs::read(&script_path).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default();
    let mut methods = script_methods(&script);
    if methods.is_empty() {
        methods = CUSTOM_METHODS.iter().map(|m| m.to_string()).collect();
    }
    Some(WebserviceDto {
        name,
        module: module.map(str::to_string),
        methods,
        login_types: Vec::new(),
        fields: 0,
        kind: "custom".into(),
        accepts: tag_text(&text, "restAcceptedMimeType"),
        delivers: tag_text(&text, "restDeliveredMimeType"),
        params: script_params(&script),
    })
}

fn collect(root: &Path, module: Option<&str>, out: &mut Vec<WebserviceDto>) {
    if let Ok(entries) = std::fs::read_dir(root.join("entityWebservice")) {
        for entry in entries.flatten() {
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                if let Some(ws) = read_webservice(&entry.path(), module) {
                    out.push(ws);
                }
            }
        }
    }
    if let Ok(entries) = std::fs::read_dir(root.join("process")) {
        for entry in entries.flatten() {
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                if let Some(ws) = read_custom_webservice(root, &entry.path(), module) {
                    out.push(ws);
                }
            }
        }
    }
}

/// The entity web services of the project and of its modules, with exactly the methods each one allows.
pub fn list_webservices(project_root: &Path) -> Vec<WebserviceDto> {
    let mut out = Vec::new();
    collect(project_root, None, &mut out);
    if let Ok(scopes) = std::fs::read_dir(project_root.join("node_modules")) {
        for scope in scopes.flatten() {
            let scope_name = scope.file_name().to_string_lossy().into_owned();
            if let Some(org) = scope_name.strip_prefix('@') {
                let _ = org;
                if let Ok(modules) = std::fs::read_dir(scope.path()) {
                    for module in modules.flatten() {
                        collect(&module.path(), Some(&format!("{scope_name}/{}", module.file_name().to_string_lossy())), &mut out);
                    }
                }
            }
        }
    }
    out.sort_by_key(|w| (w.module.is_some(), w.name.to_ascii_lowercase()));
    out
}


#[derive(Debug, Clone, Serialize, PartialEq, Eq, specta::Type)]
pub struct ServerDto {
    pub host: String,
    pub systems: Vec<String>,
}

/// The host a server config file is named after: `hermes-mig.test.htc1.adito.cloud_serverconfig_system_bg.xml` gives
/// `hermes-mig.test.htc1.adito.cloud`.
pub fn host_of_server_config(reference: &str) -> Option<String> {
    let file = reference.rsplit(['/', '\\']).next()?;
    let lower = file.to_ascii_lowercase();
    let at = lower.find("_serverconfig")?;
    let host = file[..at].trim();
    (!host.is_empty() && host.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-'))).then(|| host.to_string())
}

/// The hosts of the systems of a project, named after their server config files, with the systems that use each.
pub fn list_servers(project_root: &Path) -> Vec<ServerDto> {
    let mut by_host: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let Ok(entries) = std::fs::read_dir(project_root.join("system")) else { return Vec::new() };
    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let Ok(bytes) = std::fs::read(entry.path().join(format!("{name}.aod"))) else { continue };
        let text = String::from_utf8_lossy(&bytes);
        let Some(start) = text.find("<serverConfigPath>") else { continue };
        let rest = &text[start + "<serverConfigPath>".len()..];
        let Some(end) = rest.find("</serverConfigPath>") else { continue };
        if let Some(host) = host_of_server_config(rest[..end].trim()) {
            by_host.entry(host).or_default().push(name);
        }
    }
    by_host.into_iter().map(|(host, mut systems)| {
        systems.sort();
        ServerDto { host, systems }
    }).collect()
}

#[cfg(test)]
mod server_tests {
    use super::*;

    #[test]
    fn the_host_is_the_part_before_the_server_config_suffix() {
        assert_eq!(host_of_server_config("$PROJECTHOME/others/cloud/hermes-mig.test.htc1.adito.cloud_serverconfig_system.xml").as_deref(), Some("hermes-mig.test.htc1.adito.cloud"));
        assert_eq!(host_of_server_config("hermes1-bg.dev.htc1.adito.cloud_serverconfig_system_bg.xml").as_deref(), Some("hermes1-bg.dev.htc1.adito.cloud"));
        assert_eq!(host_of_server_config("$PROJECTHOME/others/other.xml"), None);
        assert_eq!(host_of_server_config(""), None);
    }

    #[test]
    fn lists_each_host_once_with_its_systems() {
        let root = std::env::temp_dir().join(format!("forge-servers-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        for (system, file) in [("dev2", "h2.example.cloud_serverconfig_system.xml"), ("dev2_bg", "h2.example.cloud_serverconfig_system_bg.xml"), ("test", "t.example.cloud_serverconfig_system.xml")] {
            let dir = root.join("system").join(system);
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join(format!("{system}.aod")), format!("<system><serverConfigPath>$PROJECTHOME/others/cloud/{file}</serverConfigPath></system>")).unwrap();
        }
        let list = list_servers(&root);
        assert_eq!(list.iter().map(|s| s.host.as_str()).collect::<Vec<_>>(), vec!["h2.example.cloud", "t.example.cloud"]);
        assert_eq!(list[0].systems, vec!["dev2", "dev2_bg"]);
        let _ = std::fs::remove_dir_all(&root);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_methods_login_types_and_field_count() {
        let root = std::env::temp_dir().join(format!("forge-rest-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let dir = root.join("entityWebservice/Person_ws");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("Person_ws.aod"),
            "<entityWebservice>\r\n<name>Person_ws</name>\r\n<webserviceMethods>\r\n<element>GET</element>\r\n<element>patch</element>\r\n</webserviceMethods>\r\n<loginTypeId>\r\n<element>internal.default</element>\r\n</loginTypeId>\r\n<webserviceFields>\r\n<webserviceField><name>a</name></webserviceField>\r\n<webserviceField><name>b</name></webserviceField>\r\n</webserviceFields>\r\n</entityWebservice>",
        )
        .unwrap();
        let list = list_webservices(&root);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].methods, vec!["GET", "PATCH"]);
        assert_eq!(list[0].login_types, vec!["internal.default"]);
        assert_eq!(list[0].fields, 2);
        assert_eq!(list[0].kind, "entity");
        let _ = std::fs::remove_dir_all(&root);
    }

    fn process(root: &Path, name: &str, flag: &str, style: &str, script: &str) {
        let dir = root.join("process").join(name);
        std::fs::create_dir_all(&dir).unwrap();
        let aod = format!(
            "<process>\r\n<name>{name}</name>\r\n<process>%aditoprj%/process/{name}/process.js</process>\r\n{flag}\r\n<style>{style}</style>\r\n<restAcceptedMimeType>application/json</restAcceptedMimeType>\r\n<restDeliveredMimeType>text/plain</restDeliveredMimeType>\r\n</process>"
        );
        std::fs::write(dir.join(format!("{name}.aod")), aod).unwrap();
        std::fs::write(dir.join("process.js"), script).unwrap();
    }

    #[test]
    fn processes_published_as_rest_are_custom_web_services_with_their_methods_and_params() {
        let root = std::env::temp_dir().join(format!("forge-custom-ws-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let script = "function restget(pRequest) {\n let q = checkQueryParams(request.query, [\n { name : \"fromDate\", mandatory : false, type : \"Number\" },\n { name : 'id', mandatory : true, type : \"String\" }\n ]);\n let c = request.query.count;\n}\nfunction restpost (pRequest) {}\nfunction restdeleteAll() {}\nfunction helper() {}";
        process(&root, "Orders_c_ws", "<publishAsWebservice v=\"true\" />", "REST", script);
        process(&root, "Hidden_lib", "<publishAsWebservice v=\"false\" />", "REST", "function restget() {}");
        process(&root, "Plain_lib", "", "REST", "function restget() {}");
        process(&root, "Soap_ws", "<publishAsWebservice v=\"true\" />", "SOAP", "function restget() {}");
        let list = list_webservices(&root);
        assert_eq!(list.iter().map(|w| w.name.as_str()).collect::<Vec<_>>(), vec!["Orders_c_ws"]);
        let ws = &list[0];
        assert_eq!(ws.kind, "custom");
        assert_eq!(ws.methods, vec!["GET", "POST"]);
        assert_eq!(ws.accepts.as_deref(), Some("application/json"));
        assert_eq!(ws.delivers.as_deref(), Some("text/plain"));
        assert!(ws.login_types.is_empty());
        let params: Vec<(&str, Option<&str>, bool)> = ws.params.iter().map(|p| (p.name.as_str(), p.kind.as_deref(), p.mandatory)).collect();
        assert_eq!(params, vec![("fromDate", Some("Number"), false), ("id", Some("String"), true), ("count", None, false)]);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_custom_web_service_without_a_readable_script_offers_every_method() {
        let root = std::env::temp_dir().join(format!("forge-custom-ws-none-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        process(&root, "X_c_ws", "<publishAsWebservice v=\"true\" />", "REST", "");
        std::fs::remove_file(root.join("process/X_c_ws/process.js")).unwrap();
        let list = list_webservices(&root);
        assert_eq!(list[0].methods, vec!["GET", "POST", "PUT", "PATCH", "DELETE"]);
        let _ = std::fs::remove_dir_all(&root);
    }
}
