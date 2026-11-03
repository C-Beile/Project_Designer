// Alias merge stage of the own transpiler. A module can contribute database entities to an alias
// that lives in another module: its alias definition names the target in `<targetAliasName>`
// (for example `Activity_Data_alias` -> `Data_alias`). The reference transpiler writes ONE alias
// definition per target: the base alias (the module that owns the target, e.g. `sharedalias`) keeps
// its own entities first, then come the entities of every contributing alias, sorted by name. The
// contributing aliases do not appear in the result at all; the files that belong to their entities
// (documentation, scripts) move below the target alias folder and the `%aditoprj%/` references
// follow. Empty `<documentation>` and `<syncIds>` elements are not written.
// Verified against a clean reference run of a real project (Data_alias: 49 contributing aliases).

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

const TARGET_OPEN: &str = "<targetAliasName>";
const TARGET_CLOSE: &str = "</targetAliasName>";

struct Contributor {
    folder: String,
    entities: Vec<(String, Vec<String>)>,
}

fn to_lf(text: &str) -> String {
    text.replace("\r\n", "\n")
}

fn target_of(text: &str) -> Option<String> {
    let start = text.find(TARGET_OPEN)? + TARGET_OPEN.len();
    let end = text[start..].find(TARGET_CLOSE)? + start;
    let name = text[start..end].trim();
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}

fn indent_of(line: &str) -> usize {
    line.len() - line.trim_start().len()
}

/// Splits the lines of an alias into the entity blocks (`<entityDb>` ... `</entityDb>` at the
/// indentation of the first one) and returns (lines before the first block, blocks, lines after
/// the last block). `None` when the file has no entity at all.
fn split_entities(lines: &[String]) -> Option<(Vec<String>, Vec<(String, Vec<String>)>, Vec<String>)> {
    let first = lines.iter().position(|l| l.trim() == "<entityDb>")?;
    let indent = indent_of(&lines[first]);
    let mut blocks = Vec::new();
    let mut i = first;
    let mut last_end = first;
    while i < lines.len() {
        if lines[i].trim() == "<entityDb>" && indent_of(&lines[i]) == indent {
            let mut j = i + 1;
            while j < lines.len() && !(lines[j].trim() == "</entityDb>" && indent_of(&lines[j]) == indent) {
                j += 1;
            }
            if j >= lines.len() {
                return None;
            }
            let name = lines[i + 1..j].iter().find_map(|l| l.trim().strip_prefix("<name>").and_then(|r| r.strip_suffix("</name>"))).unwrap_or("").to_string();
            blocks.push((name, lines[i..=j].to_vec()));
            last_end = j;
            i = j + 1;
        } else if lines[i].trim() == "</entities>" {
            break;
        } else {
            i += 1;
        }
    }
    Some((lines[..first].to_vec(), blocks, lines[last_end + 1..].to_vec()))
}

fn rewrite_block(block: &[String], from_folder: &str, to_folder: &str) -> Vec<String> {
    let from = format!("%aditoprj%/aliasDefinition/{from_folder}/");
    let to = format!("%aditoprj%/aliasDefinition/{to_folder}/");
    block
        .iter()
        .filter(|l| {
            let t = l.trim();
            t != "<documentation></documentation>" && t != "<syncIds></syncIds>"
        })
        .map(|l| l.replace(&from, &to))
        .collect()
}

/// Scripts and documentation of a rewritten alias come out with CRLF line endings.
fn normalize_sidecars_to_crlf(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            normalize_sidecars_to_crlf(&path);
            continue;
        }
        let is_text = path.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("js") || e.eq_ignore_ascii_case("adoc"));
        let Ok(bytes) = fs::read(&path) else { continue };
        if !is_text {
            continue;
        }
        let mut out = Vec::with_capacity(bytes.len() + bytes.len() / 20);
        for &b in bytes.iter().filter(|&&b| b != CR) {
            if b == LF {
                out.push(CR);
            }
            out.push(b);
        }
        if out != bytes {
            let _ = fs::write(&path, &out);
        }
    }
}

const CR: u8 = 13;
const LF: u8 = 10;

fn move_tree(src: &Path, dest: &Path) -> io::Result<()> {
    fs::create_dir_all(dest)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let to = dest.join(entry.file_name());
        if entry.path().is_dir() {
            move_tree(&entry.path(), &to)?;
        } else {
            fs::copy(entry.path(), &to)?;
        }
    }
    Ok(())
}

#[derive(Debug, Default, Clone)]
pub struct AliasMergeReport {
    pub merged_targets: usize,
    pub merged_aliases: usize,
    pub merged_entities: usize,
}

/// Merges the contributing aliases below `<output_dir>/aliasDefinition` into their target aliases.
pub fn run_alias_merge(output_dir: &Path) -> io::Result<AliasMergeReport> {
    let root = output_dir.join("aliasDefinition");
    let mut report = AliasMergeReport::default();
    if !root.is_dir() {
        return Ok(report);
    }
    let mut folders: Vec<String> = fs::read_dir(&root)?.filter_map(|e| e.ok()).filter(|e| e.path().is_dir()).map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    folders.sort();

    let mut by_target: BTreeMap<String, Vec<Contributor>> = BTreeMap::new();
    for folder in &folders {
        let file = root.join(folder).join(format!("{folder}.aod"));
        let Ok(bytes) = fs::read(&file) else { continue };
        let text = to_lf(&String::from_utf8_lossy(&bytes));
        let Some(target) = target_of(&text) else { continue };
        let lines: Vec<String> = text.split('\n').map(str::to_string).collect();
        let entities = split_entities(&lines).map(|(_, blocks, _)| blocks).unwrap_or_default();
        by_target.entry(target).or_default().push(Contributor { folder: folder.clone(), entities });
    }

    for (target, contributors) in by_target {
        let base_file = root.join(&target).join(format!("{target}.aod"));
        let Ok(bytes) = fs::read(&base_file) else { continue };
        let base_text = to_lf(&String::from_utf8_lossy(&bytes));
        let base_lines: Vec<String> = base_text.split('\n').map(str::to_string).collect();
        let Some((head, base_blocks, tail)) = split_entities(&base_lines) else { continue };

        let mut merged: Vec<(String, Vec<String>)> = Vec::new();
        for c in &contributors {
            for (name, block) in &c.entities {
                merged.push((name.clone(), rewrite_block(block, &c.folder, &target)));
            }
        }
        merged.sort_by(|a, b| a.0.cmp(&b.0));

        let mut out: Vec<String> = head;
        for (_, block) in &base_blocks {
            out.extend(rewrite_block(block, &target, &target));
        }
        report.merged_entities += merged.len();
        for (_, block) in merged {
            out.extend(block);
        }
        out.extend(tail);
        let text = out.join("\r\n");
        fs::write(&base_file, text.as_bytes())?;

        for c in &contributors {
            let dir = root.join(&c.folder);
            let sub = dir.join("aliasdefinitionsub");
            if sub.is_dir() {
                move_tree(&sub, &root.join(&target).join("aliasdefinitionsub"))?;
            }
            fs::remove_dir_all(&dir)?;
            report.merged_aliases += 1;
        }
        normalize_sidecars_to_crlf(&root.join(&target));
        report.merged_targets += 1;
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(label: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("forge-alias-merge-{label}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    fn alias(name: &str, target: Option<&str>, entities: &[&str], doc_for: Option<&str>) -> String {
        let mut s = String::from("<aliasDefinition>\r\n  <name>");
        s.push_str(name);
        s.push_str("</name>\r\n  <aliasDefinitionSub>\r\n    <aliasDefDb>\r\n");
        if let Some(t) = target {
            s.push_str(&format!("      {TARGET_OPEN}{t}{TARGET_CLOSE}\r\n"));
        }
        s.push_str("      <entityGroup>\r\n        <name>entityGroup</name>\r\n        <entities>\r\n");
        for e in entities {
            s.push_str(&format!("          <entityDb>\r\n            <name>{e}</name>\r\n"));
            if let Some(f) = doc_for {
                s.push_str(&format!("            <documentation>%aditoprj%/aliasDefinition/{f}/aliasdefinitionsub/{e}/documentation.adoc</documentation>\r\n"));
            }
            s.push_str("            <documentation></documentation>\r\n            <syncIds></syncIds>\r\n          </entityDb>\r\n");
        }
        s.push_str("        </entities>\r\n      </entityGroup>\r\n    </aliasDefDb>\r\n  </aliasDefinitionSub>\r\n</aliasDefinition>");
        s
    }

    fn put(root: &Path, rel: &str, text: &str) {
        let p = root.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, text).unwrap();
    }

    #[test]
    fn merges_contributing_aliases_into_the_target_with_the_base_entities_first_and_the_rest_sorted() {
        let out = scratch("merge");
        put(&out, "aliasDefinition/Data_alias/Data_alias.aod", &alias("Data_alias", None, &["DATABASECHANGELOG"], None));
        put(&out, "aliasDefinition/B_alias/B_alias.aod", &alias("B_alias", Some("Data_alias"), &["ZETA", "ALPHA"], Some("B_alias")));
        put(&out, "aliasDefinition/B_alias/aliasdefinitionsub/ALPHA/documentation.adoc", "= Alpha");
        put(&out, "aliasDefinition/C_alias/C_alias.aod", &alias("C_alias", Some("Data_alias"), &["MIDDLE"], None));
        put(&out, "aliasDefinition/Other/Other.aod", &alias("Other", None, &["KEEP"], None));

        let report = run_alias_merge(&out).unwrap();
        assert_eq!((report.merged_targets, report.merged_aliases, report.merged_entities), (1, 2, 3));
        let merged = fs::read_to_string(out.join("aliasDefinition/Data_alias/Data_alias.aod")).unwrap();
        let names: Vec<&str> = merged.split("<name>").skip(1).map(|s| s.split("</name>").next().unwrap()).filter(|n| *n != "Data_alias" && *n != "entityGroup").collect();
        assert_eq!(names, vec!["DATABASECHANGELOG", "ALPHA", "MIDDLE", "ZETA"]);
        assert!(merged.contains("%aditoprj%/aliasDefinition/Data_alias/aliasdefinitionsub/ALPHA/documentation.adoc"));
        assert!(!merged.contains("<documentation></documentation>") && !merged.contains("<syncIds></syncIds>"));
        assert!(!merged.replace("\r\n", "").contains('\n'));
        assert!(!out.join("aliasDefinition/B_alias").exists() && !out.join("aliasDefinition/C_alias").exists());
        assert!(out.join("aliasDefinition/Data_alias/aliasdefinitionsub/ALPHA/documentation.adoc").is_file());
        assert!(out.join("aliasDefinition/Other/Other.aod").is_file());
    }

    #[test]
    fn leaves_a_project_without_contributing_aliases_untouched() {
        let out = scratch("none");
        put(&out, "aliasDefinition/Only/Only.aod", &alias("Only", None, &["X"], None));
        let report = run_alias_merge(&out).unwrap();
        assert_eq!(report.merged_targets, 0);
        assert!(fs::read_to_string(out.join("aliasDefinition/Only/Only.aod")).unwrap().contains("<documentation></documentation>"));
    }
}
