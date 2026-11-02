//! Read-only views on the two per-system export files that the system editor shows: the alias
//! configs of `*_serverconfig_system.xml` and the tunnel list of `*_tunnelconfig.xml`.
//!
//! Business rule: passwords, keys and tokens never leave this module. A secret property is
//! reported as present or absent only; its value is dropped while parsing.
//!
//! Assumption (not verified against the original Designer): besides the system DB alias, the
//! original lists further alias configs; their storage in the export file is unknown, so only a
//! node `aliasconfig` with one child node per alias is read generically.

use crate::db_session::{attr, parse_tunnels, DbAlias};
use quick_xml::events::Event;
use quick_xml::Reader;
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AliasProp {
    pub name: String,
    pub value: String,
    pub secret: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AliasGroup {
    pub label: String,
    pub props: Vec<AliasProp>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AliasConfigDto {
    pub name: String,
    pub type_label: String,
    pub icon: String,
    pub jdbc_url: Option<String>,
    pub groups: Vec<AliasGroup>,
}

#[derive(Debug, Clone, Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct TunnelRowDto {
    pub tunnel_host: String,
    pub tunnel_port: u16,
    pub target_host: String,
    pub target_port: u16,
    pub user: String,
}

/// Resolves `$PROJECTHOME/...` (or a project-relative path) and refuses anything outside the
/// project folder.
pub fn resolve_config_path(project_root: &Path, reference: &str) -> Result<PathBuf, String> {
    let relative = reference
        .strip_prefix("$PROJECTHOME/")
        .or_else(|| reference.strip_prefix("%aditoprj%/"))
        .unwrap_or(reference);
    if relative.split(['/', '\\']).any(|p| p == "..") || Path::new(relative).is_absolute() {
        return Err("Config path must stay inside the project folder.".into());
    }
    Ok(project_root.join(relative))
}

pub fn is_secret_key(key: &str) -> bool {
    let k = key.to_ascii_lowercase();
    ["password", "passwd", "secret", "token", "key", "passphrase"].iter().any(|s| k.contains(s))
}

fn group_of(key: &str) -> &'static str {
    let k = key.to_ascii_lowercase();
    if is_secret_key(&k) || k == "user" || k == "username" {
        "Authentication"
    } else if k.contains("host") || k.contains("port") || k.contains("url") || k == "database" {
        "Address"
    } else {
        "Other"
    }
}

/// Mail server aliases show their properties as the original does: what is needed to receive
/// mail, and what is needed to send it (SMTP host, port, security, authentication, outbox).
fn is_mail_server(type_label: &str) -> bool {
    let t = type_label.to_ascii_lowercase();
    t.contains("mail") && !t.contains("repository")
}

fn mail_group_of(key: &str) -> &'static str {
    let k = key.to_ascii_lowercase();
    if k.starts_with("smtp") || k == "outbox" {
        "Send"
    } else {
        "Receive"
    }
}

fn icon_for(type_label: &str) -> &'static str {
    let t = type_label.to_ascii_lowercase();
    if t.starts_with("database") {
        "database"
    } else if t.contains("repository") {
        "mail"
    } else if t.contains("mail") || t.contains("cluster") || t.contains("workflow") {
        "server"
    } else if t.contains("exchange") {
        "calendar"
    } else if t.contains("authentication") {
        "key"
    } else if t.contains("instance") {
        "gear"
    } else if t.contains("index") {
        "globe"
    } else {
        "file"
    }
}

fn build(name: &str, entries: &[(String, String)], type_label: String, jdbc_url: Option<String>) -> AliasConfigDto {
    let mut groups: Vec<AliasGroup> = Vec::new();
    let mail = is_mail_server(&type_label);
    let labels: &[&str] = if mail { &["Receive", "Send"] } else { &["Address", "Authentication", "Other"] };
    for label in labels.iter().copied() {
        let props: Vec<AliasProp> = entries
            .iter()
            .filter(|(k, _)| if mail { mail_group_of(k) == label } else { group_of(k) == label })
            .map(|(k, v)| {
                let secret = is_secret_key(k);
                AliasProp { name: k.clone(), value: if secret { String::new() } else { v.clone() }, secret }
            })
            .collect();
        if !props.is_empty() {
            groups.push(AliasGroup { label: label.into(), props });
        }
    }
    let icon = icon_for(&type_label).to_string();
    AliasConfigDto { name: name.into(), type_label, icon, jdbc_url, groups }
}

struct Collected {
    path: Vec<String>,
    entries: Vec<(String, String)>,
}

/// Text leaves of an alias config document (`<name>text</name>` and `<name v="text"/>`).
fn leaf_pairs(xml: &str) -> Vec<(String, String)> {
    let mut reader = Reader::from_str(xml);
    let mut out = Vec::new();
    let mut current: Option<String> = None;
    while let Ok(ev) = reader.read_event() {
        match ev {
            Event::Start(e) => current = Some(String::from_utf8_lossy(e.name().as_ref()).to_string()),
            Event::Empty(e) => {
                if let Some(v) = attr(&e, "v") {
                    out.push((String::from_utf8_lossy(e.name().as_ref()).to_string(), v));
                }
            }
            Event::Text(t) => {
                if let (Some(k), Ok(text)) = (current.as_ref(), t.unescape()) {
                    let text = text.trim();
                    if !text.is_empty() {
                        out.push((k.clone(), text.to_string()));
                    }
                }
            }
            Event::End(_) => current = None,
            Event::Eof => break,
            _ => {}
        }
    }
    out
}

fn jdbc_label(url: &str) -> String {
    let scheme = url.strip_prefix("jdbc:").and_then(|r| r.split(':').next()).unwrap_or("").to_ascii_lowercase();
    let name = match scheme.as_str() {
        "mariadb" => "MariaDB",
        "mysql" => "MySQL",
        "sqlserver" => "MSSQL",
        "oracle" => "Oracle",
        "postgresql" => "PostgreSQL",
        "derby" => "Derby",
        "db2" => "DB2",
        _ => "",
    };
    if name.is_empty() {
        "Database".into()
    } else {
        format!("Database ({name})")
    }
}

/// Type line of an alias config row. UNVERIFIED: the original derives it from the alias config
/// document; here the document's own `type` leaf wins and the name is only a fallback.
fn type_label_for(alias_id: &str, leaves: &[(String, String)], jdbc: Option<&str>) -> String {
    if let Some((_, v)) = leaves.iter().find(|(k, _)| ["type", "aliastype"].contains(&k.to_ascii_lowercase().as_str())) {
        return v.clone();
    }
    if let Some(url) = jdbc {
        return jdbc_label(url);
    }
    let n = alias_id.to_ascii_lowercase();
    let label = if n.contains("configuration") {
        "Instance Configuration"
    } else if n.contains("mailserver") || n.contains("mailbridge") {
        if n.contains("imap") {
            "Mailserver IMAP"
        } else {
            "Mailserver"
        }
    } else if n.contains("exchange") {
        "MS-Exchange (Webservice)"
    } else if n.contains("authentication") {
        "Authentication Provider"
    } else if n.contains("cluster") {
        "Cluster Messaging"
    } else if n.contains("repository") {
        "Mailrepository"
    } else if n.contains("index") {
        "Index Search"
    } else if n.contains("flowable") || n.contains("workflow") {
        "Workflow engine"
    } else if n.contains("plugin") {
        "Plugin"
    } else if n.contains("contentanalysis") {
        "Content Analysis"
    } else if n == "aialias" {
        "AI"
    } else {
        "Alias"
    };
    label.into()
}

/// One row of ASYS_ALIASCONFIG as shown in the system editor. Secret leaves are reported as
/// present only; the XML text itself is dropped here.
pub fn alias_row_to_dto(alias_id: &str, description: Option<&str>, xml: Option<&str>) -> AliasConfigDto {
    let leaves = xml.map(leaf_pairs).unwrap_or_default();
    let from_leaf = leaves.iter().find(|(k, v)| k.to_ascii_lowercase().contains("url") && v.starts_with("jdbc:")).map(|(_, v)| v.clone());
    let from_description = description.filter(|d| d.starts_with("jdbc:")).map(|d| d.to_string());
    let get = |key: &str| leaves.iter().find(|(k, _)| k.eq_ignore_ascii_case(key)).map(|(_, v)| v.clone());
    let from_parts = get("host").map(|h| format!("jdbc:mariadb://{h}:{}/{}", get("port").unwrap_or_default(), get("database").unwrap_or_default()));
    let jdbc = from_leaf.or(from_description).or(from_parts);
    let label = type_label_for(alias_id, &leaves, jdbc.as_deref());
    let shown: Vec<(String, String)> = leaves
        .into_iter()
        .filter(|(k, _)| !["name", "type", "aliastype", "title", "description", "majormodelmode"].contains(&k.to_ascii_lowercase().as_str()))
        .collect();
    build(alias_id, &shown, label, jdbc)
}

/// Connection data of a database alias config (ASYS_ALIASCONFIG.XMLDATA), read as tolerantly as the
/// list: host, port, database, user and password as leaf elements, or the parts of a jdbc URL.
/// UNVERIFIED against the original: the real layout of XMLDATA is not documented.
pub fn alias_db_connection(xml: &str) -> Option<DbAlias> {
    let leaves = leaf_pairs(xml);
    let get = |keys: &[&str]| keys.iter().find_map(|key| leaves.iter().find(|(k, v)| k.eq_ignore_ascii_case(key) && !v.is_empty()).map(|(_, v)| v.clone()));
    let url = leaves.iter().find(|(k, v)| k.to_ascii_lowercase().contains("url") && v.starts_with("jdbc:")).map(|(_, v)| v.clone());
    let (mut host, mut port, mut database) = (get(&["host"]), get(&["port"]).and_then(|p| p.parse::<u16>().ok()), get(&["database"]));
    if let Some(u) = url.as_deref().and_then(|u| u.split("://").nth(1)) {
        let (hp, db) = u.split_once('/').unwrap_or((u, ""));
        let (h, p) = hp.split_once(':').unwrap_or((hp, ""));
        host = host.or_else(|| Some(h.to_string()).filter(|h| !h.is_empty()));
        port = port.or_else(|| p.parse().ok());
        database = database.or_else(|| Some(db.split(['?', ';']).next().unwrap_or("").to_string()).filter(|d| !d.is_empty()));
    }
    Some(DbAlias { host: host?, port: port.unwrap_or(3306), database: database?, user: get(&["user", "username"])?, password: get(&["password"]).unwrap_or_default() })
}

/// Stage part of a cloud system file name (`x1.dev.htc1.adito.cloud_serverconfig_system.xml` ->
/// `dev`); the system name decides the `-bg` variant. UNVERIFIED mapping, derived from the
/// screenshots (system dev1 reads SERVERID `dev`).
pub fn server_id_candidates(config_reference: &str, system_name: &str) -> Vec<String> {
    let file = config_reference.rsplit(['/', '\\']).next().unwrap_or("");
    let host = file.split('_').next().unwrap_or("");
    let mut labels = host.split('.');
    labels.next();
    let stage = labels.next().unwrap_or("").to_string();
    let background = system_name.to_ascii_lowercase().ends_with("_bg");
    let mut out = Vec::new();
    if !stage.is_empty() {
        out.push(if background { format!("{stage}-bg") } else { stage });
    }
    let plain = system_name.trim_end_matches("_bg").trim_end_matches(|c: char| c.is_ascii_digit());
    if !plain.is_empty() {
        let c = if background { format!("{plain}-bg") } else { plain.to_string() };
        if !out.contains(&c) {
            out.push(c);
        }
    }
    out
}

/// Alias configs of one `serverconfig_system.xml`, sorted by name.
pub fn parse_alias_configs(xml: &str) -> Result<Vec<AliasConfigDto>, String> {
    let mut reader = Reader::from_str(xml);
    let mut stack: Vec<String> = Vec::new();
    let mut nodes: Vec<Collected> = Vec::new();
    let mut open: Vec<usize> = Vec::new();
    loop {
        match reader.read_event().map_err(|e| format!("serverconfig is not valid XML: {e}"))? {
            Event::Start(e) if e.name().as_ref() == b"node" => {
                stack.push(attr(&e, "name").unwrap_or_default());
                nodes.push(Collected { path: stack.clone(), entries: Vec::new() });
                open.push(nodes.len() - 1);
            }
            Event::Empty(e) if e.name().as_ref() == b"node" => {
                let mut path = stack.clone();
                path.push(attr(&e, "name").unwrap_or_default());
                nodes.push(Collected { path, entries: Vec::new() });
            }
            Event::Empty(e) if e.name().as_ref() == b"entry" => {
                if let (Some(&i), Some(k), Some(v)) = (open.last(), attr(&e, "key"), attr(&e, "value")) {
                    nodes[i].entries.push((k, v));
                }
            }
            Event::End(e) if e.name().as_ref() == b"node" => {
                stack.pop();
                open.pop();
            }
            Event::Eof => break,
            _ => {}
        }
    }
    let get = |entries: &[(String, String)], key: &str| entries.iter().find(|(k, _)| k == key).map(|(_, v)| v.clone());
    let mut out = Vec::new();
    for n in &nodes {
        let last = n.path.last().map(|s| s.as_str()).unwrap_or("");
        let parent = if n.path.len() >= 2 { n.path[n.path.len() - 2].to_ascii_lowercase() } else { String::new() };
        if last == "db alias" {
            let name = get(&n.entries, "server id").unwrap_or_else(|| "alias".into()).to_uppercase();
            let host = get(&n.entries, "host").unwrap_or_default();
            let port = get(&n.entries, "port").unwrap_or_default();
            let database = get(&n.entries, "database").unwrap_or_default();
            // Assumption: databasetype 12 is MariaDB (the value found in the cloud exports).
            let kind = match get(&n.entries, "databasetype").as_deref() {
                Some("12") => "Database (MariaDB)".to_string(),
                _ => "Database".to_string(),
            };
            let jdbc = (!host.is_empty()).then(|| format!("jdbc:mariadb://{host}:{port}/{database}"));
            let shown: Vec<(String, String)> = n
                .entries
                .iter()
                .filter(|(k, _)| ["host", "port", "database", "user", "password"].contains(&k.as_str()))
                .cloned()
                .collect();
            out.push(build(&name, &shown, kind, jdbc));
        } else if ["aliasconfig", "aliasconfigs", "alias config"].contains(&parent.as_str()) {
            let kind = get(&n.entries, "type").unwrap_or_else(|| "Alias".into());
            let shown: Vec<(String, String)> = n.entries.iter().filter(|(k, _)| k != "type").cloned().collect();
            out.push(build(last, &shown, kind, None));
        }
    }
    out.sort_by_key(|a| a.name.to_ascii_lowercase());
    Ok(out)
}

pub fn read_alias_configs(project_root: &Path, reference: &str) -> Result<Vec<AliasConfigDto>, String> {
    let path = resolve_config_path(project_root, reference)?;
    let xml = std::fs::read_to_string(&path).map_err(|e| format!("server config not readable ({}): {e}", path.display()))?;
    parse_alias_configs(&xml)
}

pub fn read_tunnel_rows(project_root: &Path, reference: &str) -> Result<Vec<TunnelRowDto>, String> {
    let path = resolve_config_path(project_root, reference)?;
    let xml = std::fs::read_to_string(&path).map_err(|e| format!("tunnel config not readable ({}): {e}", path.display()))?;
    Ok(parse_tunnels(&xml)?
        .into_iter()
        .map(|t| TunnelRowDto { tunnel_host: t.tunnel_host, tunnel_port: t.tunnel_port, target_host: t.target_host, target_port: t.target_port, user: t.user })
        .collect())
}

const TUNNEL_OPEN: &str = "<TunnelConfigDataModel";
const TUNNEL_CLOSE: &str = "</TunnelConfigDataModel>";

/// Byte spans (start of the line, end after the closing line) of the tunnel entries that
/// `parse_tunnels` reports, in the same order.
fn tunnel_spans(xml: &str) -> Vec<(usize, usize)> {
    let mut spans = Vec::new();
    let mut from = 0;
    while let Some(rel) = xml[from..].find(TUNNEL_OPEN) {
        let open = from + rel;
        let Some(close_rel) = xml[open..].find(TUNNEL_CLOSE) else { break };
        let close_end = open + close_rel + TUNNEL_CLOSE.len();
        let start = match xml[..open].rfind('\n') {
            Some(i) if xml[i + 1..open].trim().is_empty() => i + 1,
            _ => open,
        };
        let end = match xml[close_end..].find('\n') {
            Some(i) if xml[close_end..close_end + i].trim().is_empty() => close_end + i + 1,
            _ => close_end,
        };
        if parse_tunnels(&xml[open..close_end]).map(|v| v.len() == 1).unwrap_or(false) {
            spans.push((start, end));
        }
        from = close_end;
    }
    spans
}

/// Random version-4 style id for the name attribute (the original names its entries with UUIDs).
fn new_entry_name() -> String {
    use std::hash::{BuildHasher, Hasher};
    let mut bytes = [0u8; 16];
    for chunk in bytes.chunks_mut(8) {
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
        chunk.copy_from_slice(&h.finish().to_le_bytes());
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: Vec<String> = bytes.iter().map(|b| format!("{b:02x}")).collect();
    format!("{}-{}-{}-{}-{}", hex[0..4].concat(), hex[4..6].concat(), hex[6..8].concat(), hex[8..10].concat(), hex[10..16].concat())
}

fn xml_escape(v: &str) -> String {
    v.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// Appends one tunnel entry in front of `</tunnels>`; every other byte of the file stays as it is.
/// The entry is written like the existing ones of the corpus files (name attribute = UUID).
pub fn add_tunnel_xml(xml: &str, row: &TunnelRowDto) -> Result<String, String> {
    if row.tunnel_host.trim().is_empty() || row.target_host.trim().is_empty() || row.user.trim().is_empty() {
        return Err("Tunnel host, target host and user must be filled.".into());
    }
    if parse_tunnels(xml)?.iter().any(|t| t.target_host == row.target_host && t.target_port == row.target_port) {
        return Err(format!("A tunnel to {}:{} exists already.", row.target_host, row.target_port));
    }
    let close = xml.find("</tunnels>").ok_or("The tunnel config has no <tunnels> list to add to.")?;
    let eol = if xml.contains("\r\n") { "\r\n" } else { "\n" };
    let spans = tunnel_spans(xml);
    let (indent, child_indent) = match spans.last() {
        Some(&(start, _)) => {
            let line = &xml[start..];
            let indent: String = line.chars().take_while(|c| *c == ' ' || *c == '\t').collect();
            let next = line.find('\n').map(|i| &line[i + 1..]).unwrap_or("");
            let child: String = next.chars().take_while(|c| *c == ' ' || *c == '\t').collect();
            let child = if child.is_empty() { format!("{indent}    ") } else { child };
            (indent, child)
        }
        None => ("    ".to_string(), "        ".to_string()),
    };
    let line_start = match xml[..close].rfind('\n') {
        Some(i) if xml[i + 1..close].trim().is_empty() => i + 1,
        _ => close,
    };
    let e = xml_escape;
    let block = format!(
        "{indent}<TunnelConfigDataModel name=\"{}\">{eol}{child_indent}<tunnelHostAddress>{}</tunnelHostAddress>{eol}{child_indent}<tunnelHostPort>{}</tunnelHostPort>{eol}{child_indent}<targetServerAddress>{}</targetServerAddress>{eol}{child_indent}<targetServerPort>{}</targetServerPort>{eol}{child_indent}<user>{}</user>{eol}{indent}</TunnelConfigDataModel>{eol}",
        new_entry_name(),
        e(&row.tunnel_host),
        row.tunnel_port,
        e(&row.target_host),
        row.target_port,
        e(&row.user)
    );
    Ok(format!("{}{}{}", &xml[..line_start], block, &xml[line_start..]))
}

/// Removes the tunnel entry at `index` (position in the list the editor shows).
pub fn delete_tunnel_xml(xml: &str, index: usize) -> Result<String, String> {
    let spans = tunnel_spans(xml);
    let &(start, end) = spans.get(index).ok_or("That tunnel is not in the file any more. Refresh the list.")?;
    Ok(format!("{}{}", &xml[..start], &xml[end..]))
}

fn rewrite_tunnel_file(project_root: &Path, reference: &str, change: impl FnOnce(&str) -> Result<String, String>) -> Result<Vec<TunnelRowDto>, String> {
    let path = resolve_config_path(project_root, reference)?;
    let xml = std::fs::read_to_string(&path).map_err(|e| format!("tunnel config not readable ({}): {e}", path.display()))?;
    let next = change(&xml)?;
    parse_tunnels(&next).map_err(|e| format!("The change would break the file: {e}"))?;
    crate::tree::ensure_writable(&path)?;
    forge_core::platform::fs::atomic_write(&path, next.as_bytes()).map_err(|e| format!("tunnel config could not be written ({}): {e}", path.display()))?;
    read_tunnel_rows(project_root, reference)
}

pub fn add_tunnel_row(project_root: &Path, reference: &str, row: &TunnelRowDto) -> Result<Vec<TunnelRowDto>, String> {
    rewrite_tunnel_file(project_root, reference, |xml| add_tunnel_xml(xml, row))
}

pub fn delete_tunnel_row(project_root: &Path, reference: &str, index: usize) -> Result<Vec<TunnelRowDto>, String> {
    rewrite_tunnel_file(project_root, reference, |xml| delete_tunnel_xml(xml, index))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SERVER: &str = r#"<preferences><root type="system"><map/><node name="prefs"><map/>
<node name="systemdb"><map/><node name="db alias"><map>
<entry key="server id" value="_____systemalias"/><entry key="databasetype" value="12"/>
<entry key="host" value="db.example"/><entry key="password" value="TOPSECRET"/>
<entry key="port" value="3306"/><entry key="user" value="adito"/><entry key="database" value="sys"/>
</map></node></node>
<node name="aliasconfig"><map/><node name="WorkflowModeler"><map>
<entry key="type" value="Workflow modeler"/><entry key="modelerUrl" value="https://x/y"/>
<entry key="user" value="admin"/><entry key="password" value="HUSH"/></map></node></node>
</node></root></preferences>"#;

    #[test]
    fn lists_system_alias_with_jdbc_url_and_masked_secret() {
        let list = parse_alias_configs(SERVER).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].name, "_____SYSTEMALIAS");
        assert_eq!(list[0].jdbc_url.as_deref(), Some("jdbc:mariadb://db.example:3306/sys"));
        assert_eq!(list[0].icon, "database");
        let json = serde_json::to_string(&list).unwrap();
        assert!(!json.contains("TOPSECRET") && !json.contains("HUSH"));
    }

    #[test]
    fn generic_alias_node_is_grouped_into_address_and_authentication() {
        let list = parse_alias_configs(SERVER).unwrap();
        let wf = list.iter().find(|a| a.name == "WorkflowModeler").unwrap();
        assert_eq!(wf.groups[0].label, "Address");
        assert_eq!(wf.groups[1].label, "Authentication");
        assert!(wf.groups[1].props.iter().any(|p| p.name == "password" && p.secret && p.value.is_empty()));
    }

    #[test]
    fn alias_row_without_xml_falls_back_to_name_and_description() {
        let db = alias_row_to_dto("Data_alias", Some("jdbc:mariadb://h:3306/d"), None);
        assert_eq!(db.type_label, "Database (MariaDB)");
        assert_eq!(db.icon, "database");
        assert_eq!(alias_row_to_dto("mailServerIMAP", None, None).type_label, "Mailserver IMAP");
        assert_eq!(alias_row_to_dto("_____CONFIGURATION", None, None).icon, "gear");
    }

    #[test]
    fn alias_row_xml_never_leaks_secrets() {
        let xml = "<aliasConfig><name>X</name><modelerUrl>https://m</modelerUrl><user>admin</user><password>HUSH</password></aliasConfig>";
        let dto = alias_row_to_dto("WorkflowModeler", None, Some(xml));
        assert!(!serde_json::to_string(&dto).unwrap().contains("HUSH"));
        assert!(dto.groups.iter().flat_map(|g| &g.props).any(|p| p.name == "password" && p.secret));
    }

    #[test]
    fn server_id_is_the_stage_of_the_cloud_host() {
        assert_eq!(server_id_candidates("$PROJECTHOME/others/cloud/fz-1.dev.htc1.adito.cloud_serverconfig_system.xml", "dev1")[0], "dev");
        assert_eq!(server_id_candidates("x/fz-1.dev.htc1.adito.cloud_serverconfig_system.xml", "dev1_bg")[0], "dev-bg");
    }

    #[test]
    fn config_paths_stay_inside_the_project() {
        let root = Path::new("C:/p");
        assert!(resolve_config_path(root, "$PROJECTHOME/others/a.xml").is_ok());
        assert!(resolve_config_path(root, "$PROJECTHOME/../x.xml").is_err());
        assert!(resolve_config_path(root, "C:/x.xml").is_err());
    }

    #[test]
    fn tunnel_rows_carry_no_secrets_field() {
        let xml = "<C><tunnels><TunnelConfigDataModel name=\"a\"><tunnelHostAddress>h</tunnelHostAddress><tunnelHostPort>22</tunnelHostPort><targetServerAddress>t</targetServerAddress><targetServerPort>3306</targetServerPort><user>u</user></TunnelConfigDataModel></tunnels></C>";
        let rows = parse_tunnels(xml).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].target_port, 3306);
    }

    const TUNNELS_FILE: &str = "<?xml version=\"1.0\"?>\r\n<TunnelConfigContainerDataModel>\r\n  <tunnels>\r\n    <TunnelConfigDataModel name=\"a\">\r\n      <tunnelHostAddress>jump</tunnelHostAddress>\r\n      <tunnelHostPort>22</tunnelHostPort>\r\n      <targetServerAddress>db1</targetServerAddress>\r\n      <targetServerPort>3306</targetServerPort>\r\n      <user>u</user>\r\n    </TunnelConfigDataModel>\r\n  </tunnels>\r\n</TunnelConfigContainerDataModel>\r\n";

    fn new_row() -> TunnelRowDto {
        TunnelRowDto { tunnel_host: "jump".into(), tunnel_port: 22, target_host: "db2".into(), target_port: 3307, user: "u".into() }
    }

    #[test]
    fn adding_a_tunnel_keeps_every_other_byte_and_the_line_style() {
        let next = add_tunnel_xml(TUNNELS_FILE, &new_row()).unwrap();
        assert!(next.starts_with(&TUNNELS_FILE[..TUNNELS_FILE.find("  </tunnels>").unwrap()]));
        assert!(next.ends_with("  </tunnels>\r\n</TunnelConfigContainerDataModel>\r\n"));
        assert!(!next.replace("\r\n", "").contains('\n'));
        let rows = parse_tunnels(&next).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!((rows[1].target_host.as_str(), rows[1].target_port), ("db2", 3307));
        let name = next.split("name=\"").nth(2).unwrap().split('"').next().unwrap();
        assert_eq!(name.len(), 36);
        assert_eq!(name.matches('-').count(), 4);
    }

    #[test]
    fn deleting_a_tunnel_restores_the_original_file_exactly() {
        let added = add_tunnel_xml(TUNNELS_FILE, &new_row()).unwrap();
        assert_eq!(delete_tunnel_xml(&added, 1).unwrap(), TUNNELS_FILE);
        assert!(delete_tunnel_xml(TUNNELS_FILE, 5).is_err());
    }

    #[test]
    fn a_duplicate_or_incomplete_tunnel_is_refused() {
        let mut dup = new_row();
        dup.target_host = "db1".into();
        dup.target_port = 3306;
        assert!(add_tunnel_xml(TUNNELS_FILE, &dup).unwrap_err().contains("exists already"));
        let mut empty = new_row();
        empty.user = " ".into();
        assert!(add_tunnel_xml(TUNNELS_FILE, &empty).is_err());
    }

    #[test]
    fn values_with_markup_characters_are_escaped() {
        let mut row = new_row();
        row.user = "a&b<c".into();
        let next = add_tunnel_xml(TUNNELS_FILE, &row).unwrap();
        assert_eq!(parse_tunnels(&next).unwrap()[1].user, "a&b<c");
    }

    #[test]
    fn mail_server_aliases_are_grouped_into_receive_and_send() {
        let entries: Vec<(String, String)> = [("host", "imap.x"), ("port", "993"), ("connectionSecurity", "SSL"), ("password", "p"), ("smtpHost", "smtp.x"), ("smtpPort", "587"), ("outbox", "Sent")]
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        let dto = build("mailServerIMAP_dev", &entries, "Mail server (IMAP)".into(), None);
        let labels: Vec<&str> = dto.groups.iter().map(|g| g.label.as_str()).collect();
        assert_eq!(labels, vec!["Receive", "Send"]);
        let send: Vec<&str> = dto.groups[1].props.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(send, vec!["smtpHost", "smtpPort", "outbox"]);
        let pw = dto.groups[0].props.iter().find(|p| p.name == "password").unwrap();
        assert!(pw.secret && pw.value.is_empty());
    }

    #[test]
    fn database_alias_connection_is_read_from_leaves_or_the_jdbc_url() {
        let leaves = "<c><host>db</host><port>3307</port><database>data</database><user>u</user><password>p</password></c>";
        let a = alias_db_connection(leaves).unwrap();
        assert_eq!((a.host.as_str(), a.port, a.database.as_str(), a.user.as_str()), ("db", 3307, "data", "u"));
        let url = "<c><url>jdbc:mariadb://adito-db:3306/cloud_data_alias</url><user>u</user><password>p</password></c>";
        let b = alias_db_connection(url).unwrap();
        assert_eq!((b.host.as_str(), b.port, b.database.as_str()), ("adito-db", 3306, "cloud_data_alias"));
        assert!(alias_db_connection("<c><host>db</host></c>").is_none());
    }
}
