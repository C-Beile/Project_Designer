//! A field whose script or text file lies in the folder of another name (the field was renamed or copied from
//! another field and kept the old folder) gets a copy of the file in the folder of its own name in the official
//! output, and its property points there. The old file stays where it was.

use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

const LINK_PREFIX: &str = "%aditoprj%/";

#[derive(Debug, Default, Clone)]
pub struct UnshareReport {
    pub copies_made: usize,
}

struct Link {
    line: usize,
    tag: String,
    rel: String,
    /// Folder the file of this property belongs to, derived from the position of the property in the object.
    canonical: Option<String>,
}

/// Folder of the file of a property: `<object folder>/entityfields/<field>/children/<field>/...`.
fn canonical_folder(base: &str, stack: &[(String, Option<String>)]) -> Option<String> {
    let mut parts: Vec<String> = vec![base.to_string()];
    for (tag, name) in stack.iter().skip(1) {
        match tag.as_str() {
            "entityFields" => parts.push("entityfields".into()),
            "children" => parts.push("children".into()),
            _ => match name {
                Some(n) => parts.push(n.to_lowercase()),
                None => return None,
            },
        }
    }
    Some(parts.join("/"))
}

fn collect_links(text: &str, base: &str) -> Vec<Link> {
    let mut stack: Vec<(String, Option<String>)> = Vec::new();
    let mut links = Vec::new();
    // The closing tag of a text that runs over several lines.
    let mut in_text: Option<String> = None;
    for (i, raw) in text.split('\n').enumerate() {
        let line = raw.trim();
        if let Some(close) = &in_text {
            if line.contains(close.as_str()) {
                in_text = None;
            }
            continue;
        }
        if line.starts_with("<?") || line.is_empty() {
            continue;
        }
        if let Some(rest) = line.strip_prefix("</") {
            let tag = rest.trim_end_matches('>');
            if stack.last().is_some_and(|(t, _)| t == tag) {
                stack.pop();
            }
            continue;
        }
        let Some(open_end) = line.find('>') else { continue };
        if !line.starts_with('<') {
            continue;
        }
        let tag = line[1..open_end].split_whitespace().next().unwrap_or("").to_string();
        let self_closing = line[..open_end].ends_with('/');
        let rest = &line[open_end + 1..];
        let closed_here = rest.contains(&format!("</{tag}>"));
        if self_closing {
            continue;
        }
        if closed_here {
            let value = rest.trim_end_matches(&format!("</{tag}>")[..]);
            if tag == "name" {
                if let Some(top) = stack.last_mut() {
                    if top.1.is_none() {
                        top.1 = Some(value.to_string());
                    }
                }
            } else if let Some(rel) = value.strip_prefix(LINK_PREFIX) {
                links.push(Link { line: i, tag: tag.clone(), rel: rel.to_string(), canonical: canonical_folder(base, &stack) });
            }
        } else if !rest.trim().is_empty() {
            in_text = Some(format!("</{tag}>"));
        } else {
            stack.push((tag, None));
        }
    }
    links
}

fn aod_files(output_dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack: Vec<PathBuf> = Vec::new();
    for entry in fs::read_dir(output_dir).into_iter().flatten().flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if entry.path().is_dir() && !matches!(name.as_str(), "aliasDefinition" | ".liquibase" | "node_modules" | "dist" | "language" | "preferences" | ".forge-incremental-cache") {
            stack.push(entry.path());
        }
    }
    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(&dir).into_iter().flatten().flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().is_some_and(|e| e == "aod") {
                out.push(path);
            }
        }
    }
    out
}

/// The copy of a script is written with CRLF line endings; the file it was copied from stays as it was.
fn with_crlf(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(bytes.len() + bytes.len() / 20);
    for &b in bytes.iter().filter(|&&b| b != b'\r') {
        if b == b'\n' {
            out.push(b'\r');
        }
        out.push(b);
    }
    out
}

/// Where the field of a link keeps its file, when that is not where the link points to.
fn misplaced_target(link: &Link) -> Option<String> {
    let folder = link.canonical.as_deref()?;
    if !folder.contains("/entityfields/") || !link.rel.contains("/entityfields/") {
        return None;
    }
    let file_name = Path::new(&link.rel).file_name()?.to_string_lossy().into_owned();
    let target = format!("{folder}/{file_name}");
    // A path that differs only in the case of its letters points to the same file.
    if target.eq_ignore_ascii_case(&link.rel) {
        None
    } else {
        Some(target)
    }
}

/// For diagnosis: each link with the folder its field would keep it in.
pub fn link_folders(text: &str, base: &str) -> Vec<(String, Option<String>)> {
    collect_links(text, base).into_iter().map(|l| (l.rel, l.canonical)).collect()
}

/// The files a model links to that are not in the folder of their field: the official output leaves them as they were.
pub fn misplaced_links(text: &str, base: &str) -> std::collections::HashSet<String> {
    collect_links(text, base).iter().filter(|l| misplaced_target(l).is_some()).map(|l| l.rel.clone()).collect()
}

/// Gives every field whose file is in the folder of another name a copy in the folder of its own name.
pub fn run_linked_unshare(output_dir: &Path) -> io::Result<UnshareReport> {
    let mut report = UnshareReport::default();
    for aod in aod_files(output_dir) {
        let Ok(bytes) = fs::read(&aod) else { continue };
        if !bytes.windows(LINK_PREFIX.len()).any(|w| w == LINK_PREFIX.as_bytes()) {
            continue;
        }
        let text = String::from_utf8_lossy(&bytes).into_owned();
        let Some(folder) = aod.parent().and_then(|p| p.strip_prefix(output_dir).ok()) else { continue };
        let base = folder.to_string_lossy().replace('\\', "/");
        let links = collect_links(&text, &base);
        let mut lines: Vec<String> = text.split('\n').map(str::to_string).collect();
        let mut changed = false;
        for l in &links {
            let Some(target) = misplaced_target(l) else { continue };
            let from = output_dir.join(&l.rel);
            let to = output_dir.join(&target);
            if !to.exists() {
                let Ok(data) = fs::read(&from) else { continue };
                if let Some(parent) = to.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::write(&to, with_crlf(&data))?;
                report.copies_made += 1;
            }
            lines[l.line] = lines[l.line].replace(&format!("{LINK_PREFIX}{}", l.rel), &format!("{LINK_PREFIX}{target}"));
            changed = true;
        }
        if changed {
            fs::write(&aod, lines.join("\n").as_bytes())?;
        }
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_renamed_field_gets_a_copy_of_its_file_in_its_own_folder() {
        let root = std::env::temp_dir().join(format!("forge-unshare-renamed-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let dir = root.join("entity").join("E_entity");
        fs::create_dir_all(dir.join("entityfields").join("addone_action")).unwrap();
        fs::write(dir.join("entityfields").join("addone_action").join("onActionProcess.js"), "old\n").unwrap();
        let aod = "<entity>\r\n  <name>E_entity</name>\r\n  <entityFields>\r\n    <entityActionField>\r\n      <name>AddTwo_action</name>\r\n      <onActionProcess>%aditoprj%/entity/E_entity/entityfields/addone_action/onActionProcess.js</onActionProcess>\r\n    </entityActionField>\r\n  </entityFields>\r\n</entity>";
        fs::write(dir.join("E_entity.aod"), aod).unwrap();
        assert_eq!(run_linked_unshare(&root).unwrap().copies_made, 1);
        assert!(dir.join("entityfields").join("addone_action").join("onActionProcess.js").exists());
        assert!(fs::read_to_string(dir.join("E_entity.aod")).unwrap().contains("entityfields/addtwo_action/onActionProcess.js"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_second_field_that_shares_a_file_gets_its_own_copy() {
        let root = std::env::temp_dir().join(format!("forge-unshare-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let dir = root.join("entity").join("E_entity");
        fs::create_dir_all(dir.join("entityfields").join("addone_action")).unwrap();
        fs::write(dir.join("entityfields").join("addone_action").join("onActionProcess.js"), "old\n").unwrap();
        let aod = "<entity>\r\n  <name>E_entity</name>\r\n  <entityFields>\r\n    <entityActionField>\r\n      <name>AddOne_action</name>\r\n      <onActionProcess>%aditoprj%/entity/E_entity/entityfields/addone_action/onActionProcess.js</onActionProcess>\r\n    </entityActionField>\r\n    <entityActionField>\r\n      <name>AddTwo_action</name>\r\n      <onActionProcess>%aditoprj%/entity/E_entity/entityfields/addone_action/onActionProcess.js</onActionProcess>\r\n    </entityActionField>\r\n  </entityFields>\r\n</entity>";
        fs::write(dir.join("E_entity.aod"), aod).unwrap();
        let report = run_linked_unshare(&root).unwrap();
        assert_eq!(report.copies_made, 1);
        assert_eq!(fs::read_to_string(dir.join("entityfields").join("addtwo_action").join("onActionProcess.js")).unwrap(), "old\r\n");
        let text = fs::read_to_string(dir.join("E_entity.aod")).unwrap();
        assert!(text.contains("entityfields/addtwo_action/onActionProcess.js"));
        assert!(text.contains("entityfields/addone_action/onActionProcess.js"));
        let _ = fs::remove_dir_all(&root);
    }
}
