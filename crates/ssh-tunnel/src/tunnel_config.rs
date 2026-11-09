//! Tunnel-Konfiguration (`*_tunnelconfig.xml`): Einträge lesen, ergänzen und löschen.
//! Die Datei wird byte-genau bearbeitet; nur der betroffene Eintrag ändert sich.

use crate::tunnel_core::TunnelEntry;
use quick_xml::events::Event;
use quick_xml::Reader;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
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

/// All `TunnelConfigDataModel` entries of `tunnelconfig.xml`.
pub fn parse_tunnels(xml: &str) -> Result<Vec<TunnelEntry>, String> {
    let mut reader = Reader::from_str(xml);
    let mut out = Vec::new();
    let mut current: Option<[String; 5]> = None;
    let mut field: Option<usize> = None;
    loop {
        match reader.read_event().map_err(|e| plugin_api::at!(format!("tunnelconfig is not valid XML: {e}")))? {
            Event::Start(e) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).into_owned();
                if name == "TunnelConfigDataModel" {
                    current = Some(Default::default());
                } else if current.is_some() {
                    field = ["tunnelHostAddress", "tunnelHostPort", "targetServerAddress", "targetServerPort", "user"]
                        .iter()
                        .position(|n| *n == name);
                }
            }
            Event::Text(t) => {
                if let (Some(cur), Some(i)) = (current.as_mut(), field) {
                    cur[i] = t.unescape().map_err(|e| plugin_api::at!(e.to_string()))?.trim().to_string();
                }
            }
            Event::End(e) => {
                if e.name().as_ref() == b"TunnelConfigDataModel" {
                    if let Some(c) = current.take() {
                        if let (Ok(tp), Ok(pp)) = (c[1].parse::<u16>(), c[3].parse::<u16>()) {
                            out.push(TunnelEntry { tunnel_host: c[0].clone(), tunnel_port: tp, target_host: c[2].clone(), target_port: pp, user: c[4].clone() });
                        }
                    }
                }
                field = None;
            }
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(out)
}

pub fn read_tunnel_rows(project_root: &Path, reference: &str) -> Result<Vec<TunnelRowDto>, String> {
    let path = resolve_config_path(project_root, reference)?;
    let xml = std::fs::read_to_string(&path).map_err(|e| plugin_api::at!(format!("tunnel config not readable ({}): {e}", path.display())))?;
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
    let xml = std::fs::read_to_string(&path).map_err(|e| plugin_api::at!(format!("tunnel config not readable ({}): {e}", path.display())))?;
    let next = change(&xml)?;
    parse_tunnels(&next).map_err(|e| plugin_api::at!(format!("The change would break the file: {e}")))?;
    app_base::fs_guard::ensure_writable(&path)?;
    platform::fs::atomic_write(&path, next.as_bytes()).map_err(|e| plugin_api::at!(format!("tunnel config could not be written ({}): {e}", path.display())))?;
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
}
