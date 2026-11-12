//! The entity web services of a project and its modules: name, allowed methods, login types (read-only).

use serde::Serialize;
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
