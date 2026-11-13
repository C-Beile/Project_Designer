//! The entity web services of a project and its modules: name, allowed methods, login types (read-only).

use serde::Serialize;
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WebserviceDto {
    pub name: String,
    pub module: Option<String>,
    pub methods: Vec<String>,
    pub login_types: Vec<String>,
    pub fields: usize,
}

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
    Some(WebserviceDto { name, module: module.map(str::to_string), methods, login_types: elements_of(&text, "loginTypeId"), fields: text.matches("<webserviceField>").count() })
}

fn collect(root: &Path, module: Option<&str>, out: &mut Vec<WebserviceDto>) {
    let Ok(entries) = std::fs::read_dir(root.join("entityWebservice")) else { return };
    for entry in entries.flatten() {
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            if let Some(ws) = read_webservice(&entry.path(), module) {
                out.push(ws);
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


#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
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
        let _ = std::fs::remove_dir_all(&root);
    }
}
