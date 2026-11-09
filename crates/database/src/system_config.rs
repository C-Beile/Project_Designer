//! Read-only views on the two per-system export files that the system editor shows: the alias
//! configs of `*_serverconfig_system.xml` and the tunnel list of `*_tunnelconfig.xml`.
//!
//! Business rule: passwords, keys and tokens never leave this module. A secret property is
//! reported as present or absent only; its value is dropped while parsing.
//!
//! Assumption (not verified against the original Designer): besides the system DB alias, the
//! original lists further alias configs; their storage in the export file is unknown, so only a
//! node `aliasconfig` with one child node per alias is read generically.

use crate::db_session::{attr, DbAlias};
pub use ssh_tunnel::tunnel_config::{add_tunnel_row, add_tunnel_xml, delete_tunnel_row, delete_tunnel_xml, parse_tunnels, read_tunnel_rows, resolve_config_path, TunnelRowDto};
use quick_xml::events::Event;
use quick_xml::Reader;
use serde::Serialize;
use std::path::Path;

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
        match reader.read_event().map_err(|e| plugin_api::at!(format!("serverconfig is not valid XML: {e}")))? {
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
    let xml = std::fs::read_to_string(&path).map_err(|e| plugin_api::at!(format!("server config not readable ({}): {e}", path.display())))?;
    parse_alias_configs(&xml)
}

/// Zustand des Datenbank-Tunnels eines Systems fuer die Oberflaeche.
#[derive(serde::Serialize)]
pub struct SystemTunnelState {
    /// A forward to the database host of this system's alias is open.
    pub db_tunnel_up: bool,
    /// host:port the database tunnel points to (None: the tunnel config has no such entry).
    pub target: Option<String>,
    /// Why the state could not be determined (config files missing or unreadable).
    pub problem: Option<String>,
}

/// Is the tunnel to this system's database open? Looks up the tunnel entry that leads to the
/// database host of the system alias in the server config and asks the tunnel manager.
pub fn system_tunnel_state(project_root: &Path, tunnel_ref: &str, server_ref: &str, tunnels: &ssh_tunnel::tunnels::TunnelManager) -> SystemTunnelState {
    use crate::db_session::{find_db_tunnel, parse_system_alias};
    let result = (|| -> Result<(bool, Option<String>), String> {
        let tunnel_path = resolve_config_path(project_root, tunnel_ref)?;
        let server_path = resolve_config_path(project_root, server_ref)?;
        let alias = parse_system_alias(&std::fs::read_to_string(&server_path).map_err(|e| plugin_api::at!(e.to_string()))?)?;
        let entries = parse_tunnels(&std::fs::read_to_string(&tunnel_path).map_err(|e| plugin_api::at!(e.to_string()))?)?;
        Ok(match find_db_tunnel(&entries, &alias) {
            Some(t) => (tunnels.local_port(&t.target_host, t.target_port).is_some(), Some(format!("{}:{}", t.target_host, t.target_port))),
            None => (false, None),
        })
    })();
    match result {
        Ok((up, target)) => SystemTunnelState { db_tunnel_up: up, target, problem: None },
        Err(e) => SystemTunnelState { db_tunnel_up: false, target: None, problem: Some(e) },
    }
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

/// Takes over a config file chosen anywhere on the computer (for example a tunnel config from the
/// download folder) and returns the path to write into the system, in the form the Designer uses
/// (`$PROJECTHOME/...`). A file inside the project is referenced where it is; any other file is
/// copied to `others/cloud`, replacing an older copy with the same name, so the project always
/// points at the chosen file's content. Only XML files up to 5 MB are accepted.
pub fn import_config_file(project_root: &Path, source: &Path) -> Result<String, String> {
    let name = source.file_name().and_then(|n| n.to_str()).ok_or("The chosen file has no name.")?;
    if !name.to_ascii_lowercase().ends_with(".xml") {
        return Err("Choose an XML file.".into());
    }
    if name.contains(['/', '\\']) || name.starts_with('.') {
        return Err("The file name is not allowed.".into());
    }
    let meta = std::fs::metadata(source).map_err(|e| format!("The file cannot be read: {e}"))?;
    if !meta.is_file() || meta.len() > 5 * 1024 * 1024 {
        return Err("Choose an XML file smaller than 5 MB.".into());
    }
    if let Ok(rel) = source.strip_prefix(project_root) {
        return Ok(format!("$PROJECTHOME/{}", rel.to_string_lossy().replace('\\', "/")));
    }
    let folder = project_root.join("others").join("cloud");
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let target = folder.join(name);
    if target != source {
        std::fs::copy(source, &target).map_err(|e| format!("The file could not be copied into the project: {e}"))?;
    }
    Ok(format!("$PROJECTHOME/others/cloud/{name}"))
}

#[cfg(test)]
mod import_config_tests {
    use super::*;

    #[test]
    fn copies_a_config_into_others_cloud_and_replaces_an_older_copy() {
        let root = std::env::temp_dir().join(format!("forge-cfg-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let outside = std::env::temp_dir().join(format!("forge-cfg-out-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        let src = outside.join("t.xml");
        std::fs::write(&src, "<a/>").unwrap();
        assert_eq!(import_config_file(&root, &src).unwrap(), "$PROJECTHOME/others/cloud/t.xml");
        std::fs::write(&src, "<b/>").unwrap();
        import_config_file(&root, &src).unwrap();
        assert_eq!(std::fs::read_to_string(root.join("others/cloud/t.xml")).unwrap(), "<b/>");
    }

    #[test]
    fn references_a_config_that_is_already_inside_the_project() {
        let root = std::env::temp_dir().join(format!("forge-cfg3-{}", std::process::id()));
        std::fs::create_dir_all(root.join("others/cloud")).unwrap();
        let src = root.join("others/cloud/in.xml");
        std::fs::write(&src, "<a/>").unwrap();
        assert_eq!(import_config_file(&root, &src).unwrap(), "$PROJECTHOME/others/cloud/in.xml");
    }

    #[test]
    fn refuses_other_file_types() {
        let root = std::env::temp_dir().join(format!("forge-cfg2-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let src = root.join("x.txt");
        std::fs::write(&src, "x").unwrap();
        assert!(import_config_file(&root, &src).is_err());
    }
}
