// Language merge stage of the own transpiler. A module ships its translations as its own language
// object (`_____LANGUAGE_de_activity` for language `de`). The reference transpiler writes ONE
// object per language (`_____LANGUAGE_de`): every entry of every module and of the project, each
// key once, sorted by key. The per-module objects are not part of the result.
// Verified against a clean reference run of a real project (69 `de` sources, 5479 entries).

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::Path;

#[derive(Debug, Default, Clone)]
pub struct LanguageMergeReport {
    pub merged_languages: usize,
    pub merged_objects: usize,
    pub entries: usize,
}

fn read_lf(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    Some(String::from_utf8_lossy(&bytes).replace("\r\n", "\n"))
}

fn indent_of(line: &str) -> usize {
    line.len() - line.trim_start().len()
}

/// The text between `<tag>` and `</tag>` on one line of the head of a language object.
fn head_value(lines: &[String], tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    lines.iter().take_while(|l| l.trim() != "<keyValueMap>").find_map(|l| l.trim().strip_prefix(open.as_str()).and_then(|r| r.strip_suffix(close.as_str())).map(str::to_string))
}

/// (head lines up to and including `<keyValueMap>`, entries as (key, lines), tail from `</keyValueMap>`).
type Parsed = (Vec<String>, Vec<(String, Vec<String>)>, Vec<String>);

fn parse(text: &str) -> Option<Parsed> {
    let lines: Vec<String> = text.split('\n').map(str::to_string).collect();
    let map_open = lines.iter().position(|l| l.trim() == "<keyValueMap>")?;
    let map_close = lines.iter().rposition(|l| l.trim() == "</keyValueMap>")?;
    let mut entries = Vec::new();
    let mut i = map_open + 1;
    while i < map_close {
        if lines[i].trim() == "<stringEntry>" {
            let indent = indent_of(&lines[i]);
            let mut j = i + 1;
            while j < map_close && !(lines[j].trim() == "</stringEntry>" && indent_of(&lines[j]) == indent) {
                j += 1;
            }
            if j >= map_close {
                return None;
            }
            let key = lines[i + 1..j].iter().find_map(|l| l.trim().strip_prefix("<name>").and_then(|r| r.strip_suffix("</name>"))).unwrap_or("").to_string();
            entries.push((key, lines[i..=j].to_vec()));
            i = j + 1;
        } else {
            i += 1;
        }
    }
    Some((lines[..=map_open].to_vec(), entries, lines[map_close..].to_vec()))
}

/// Merges `language/_____LANGUAGE_<lang>_<module>` into `language/_____LANGUAGE_<lang>`.
pub fn run_language_merge(output_dir: &Path) -> io::Result<LanguageMergeReport> {
    let root = output_dir.join("language");
    let mut report = LanguageMergeReport::default();
    if !root.is_dir() {
        return Ok(report);
    }
    let mut folders: Vec<String> = fs::read_dir(&root)?.filter_map(|e| e.ok()).filter(|e| e.path().is_dir()).map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    folders.sort();

    let prefix = "_____LANGUAGE_";
    let mut parts: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for folder in &folders {
        let Some(rest) = folder.strip_prefix(prefix) else { continue };
        let Some((lang, _module)) = rest.split_once('_') else { continue };
        let base = format!("{prefix}{lang}");
        if folders.contains(&base) {
            parts.entry(base).or_default().push(folder.clone());
        }
    }

    for (base, contributors) in parts {
        let base_file = root.join(&base).join(format!("{base}.aod"));
        let Some(base_text) = read_lf(&base_file) else { continue };
        let Some((head, base_entries, tail)) = parse(&base_text) else { continue };
        let base_lang = head_value(&head, "language");

        let mut all: BTreeMap<String, Vec<String>> = BTreeMap::new();
        let mut used: Vec<&String> = Vec::new();
        for folder in &contributors {
            let Some(text) = read_lf(&root.join(folder).join(format!("{folder}.aod"))) else { continue };
            let Some((part_head, entries, _)) = parse(&text) else { continue };
            if head_value(&part_head, "language") != base_lang {
                continue;
            }
            for (key, block) in entries {
                all.insert(key, block);
            }
            used.push(folder);
        }
        // The object of the project itself is read last, so its entry wins over a module's.
        for (key, block) in base_entries {
            all.insert(key, block);
        }

        report.entries += all.len();
        let mut out = head;
        for (_, block) in all {
            out.extend(block);
        }
        out.extend(tail);
        fs::write(&base_file, out.join("\r\n").as_bytes())?;
        for folder in used {
            fs::remove_dir_all(root.join(folder))?;
            report.merged_objects += 1;
        }
        report.merged_languages += 1;
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn language(name: &str, lang: &str, entries: &[(&str, &str)]) -> String {
        let mut s = format!("<language>\r\n  <name>{name}</name>\r\n  <language>{lang}</language>\r\n  <keyValueMap>\r\n");
        for (k, v) in entries {
            s.push_str(&format!("    <stringEntry>\r\n      <name>{k}</name>\r\n      <value>{v}</value>\r\n    </stringEntry>\r\n"));
        }
        s.push_str("  </keyValueMap>\r\n</language>");
        s
    }

    fn put(root: &Path, folder: &str, text: &str) {
        let dir = root.join("language").join(folder);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(format!("{folder}.aod")), text).unwrap();
    }

    #[test]
    fn merges_the_module_languages_into_one_sorted_object_per_language() {
        let out = std::env::temp_dir().join(format!("forge-lang-merge-{}", std::process::id()));
        let _ = fs::remove_dir_all(&out);
        put(&out, "_____LANGUAGE_de", &language("_____LANGUAGE_de", "de", &[("Vacation", "Urlaub"), ("Shared", "Projekt")]));
        put(&out, "_____LANGUAGE_de_activity", &language("_____LANGUAGE_de_activity", "de", &[("Task", "Aufgabe"), ("Shared", "Modul")]));
        put(&out, "_____LANGUAGE_en", &language("_____LANGUAGE_en", "en", &[("Task", "Task")]));
        put(&out, "_____LANGUAGE_EXTRA", "<language>\r\n  <name>_____LANGUAGE_EXTRA</name>\r\n</language>");

        let report = run_language_merge(&out).unwrap();
        assert_eq!((report.merged_languages, report.merged_objects, report.entries), (1, 1, 3));
        let merged = fs::read_to_string(out.join("language/_____LANGUAGE_de/_____LANGUAGE_de.aod")).unwrap();
        let keys: Vec<&str> = merged.split("<stringEntry>").skip(1).map(|b| b.split("<name>").nth(1).unwrap().split("</name>").next().unwrap()).collect();
        assert_eq!(keys, vec!["Shared", "Task", "Vacation"]);
        assert!(merged.contains("<value>Projekt</value>") && !merged.contains("<value>Modul</value>"));
        assert!(!out.join("language/_____LANGUAGE_de_activity").exists());
        assert!(out.join("language/_____LANGUAGE_en").is_dir() && out.join("language/_____LANGUAGE_EXTRA").is_dir());
    }
}
