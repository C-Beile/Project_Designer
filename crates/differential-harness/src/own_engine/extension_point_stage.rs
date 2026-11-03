// Extension point stage of the own transpiler. A module marks the places where other modules may
// plug in with an extension point element (`<entityActionFieldExtensionPoint>`, `<neonViewExtensionPoint>`,
// ...). Modifications insert their elements into its `<implementations>`. The reference transpiler
// leaves no extension point in the result: the implementations take the place of the extension point
// element (same position, one nesting level up), and an extension point without implementations
// disappears. Verified against a clean reference run of a real project (no extension point left in
// any of ~9500 files).

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

#[derive(Debug, Default, Clone)]
pub struct ExtensionPointReport {
    pub objects_rewritten: usize,
    pub extension_points_resolved: usize,
}

fn collect_aod(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if path.file_name().is_some_and(|n| n == "modification" || n == ".forge-incremental-cache" || n == "node_modules") {
                continue;
            }
            collect_aod(&path, out);
        } else if path.extension().is_some_and(|e| e == "aod") {
            out.push(path);
        }
    }
}

fn indent_of(line: &str) -> usize {
    line.len() - line.trim_start().len()
}

/// The tag of an extension point opening line (`<xyzExtensionPoint>`), if the line is one.
fn extension_point_tag(line: &str) -> Option<&str> {
    let trimmed = line.trim();
    let tag = trimmed.strip_prefix('<')?.strip_suffix('>')?;
    if tag.ends_with("ExtensionPoint") && !tag.contains(|c: char| c == '<' || c == '/' || c.is_whitespace()) {
        Some(tag)
    } else {
        None
    }
}

fn resolve(lines: &[String]) -> (Vec<String>, usize) {
    let mut out: Vec<String> = Vec::with_capacity(lines.len());
    let mut resolved = 0;
    let mut i = 0;
    while i < lines.len() {
        let Some(tag) = extension_point_tag(lines[i].trim_end_matches('\r')) else {
            out.push(lines[i].clone());
            i += 1;
            continue;
        };
        let indent = indent_of(&lines[i]);
        let close = format!("</{tag}>");
        let Some(end) = (i + 1..lines.len()).find(|&j| indent_of(&lines[j]) == indent && lines[j].trim() == close) else {
            out.push(lines[i].clone());
            i += 1;
            continue;
        };
        let inner = &lines[i + 1..end];
        let open = inner.iter().position(|l| indent_of(l) == indent + 2 && l.trim() == "<implementations>");
        if let Some(open) = open {
            if let Some(shut) = (open + 1..inner.len()).find(|&j| indent_of(&inner[j]) == indent + 2 && inner[j].trim() == "</implementations>") {
                for line in &inner[open + 1..shut] {
                    out.push(if line.len() >= 4 && line.starts_with("    ") { line[4..].to_string() } else { line.clone() });
                }
            }
        }
        resolved += 1;
        i = end + 1;
    }
    (out, resolved)
}

pub fn run_extension_point_resolution(output_dir: &Path) -> io::Result<ExtensionPointReport> {
    let mut report = ExtensionPointReport::default();
    let mut files = Vec::new();
    collect_aod(output_dir, &mut files);
    for file in files {
        let Ok(bytes) = fs::read(&file) else { continue };
        let Ok(text) = String::from_utf8(bytes) else { continue };
        if !text.contains("ExtensionPoint>") {
            continue;
        }
        let mut lines: Vec<String> = text.split('\n').map(str::to_string).collect();
        let mut total = 0;
        loop {
            let (next, resolved) = resolve(&lines);
            if resolved == 0 {
                break;
            }
            total += resolved;
            lines = next;
        }
        if total > 0 {
            fs::write(&file, lines.join("\n").as_bytes())?;
            report.objects_rewritten += 1;
            report.extension_points_resolved += total;
        }
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_an_extension_point_by_its_implementations_and_drops_an_empty_one() {
        let out = std::env::temp_dir().join(format!("forge-ext-point-{}", std::process::id()));
        let _ = fs::remove_dir_all(&out);
        fs::create_dir_all(out.join("entity/A")).unwrap();
        let aod = "<entity>\r\n  <name>A</name>\r\n  <entityActionFieldExtensionPoint>\r\n    <name>Point</name>\r\n    <implementations>\r\n      <entityActionField>\r\n        <name>One</name>\r\n      </entityActionField>\r\n    </implementations>\r\n  </entityActionFieldExtensionPoint>\r\n  <entityActionFieldExtensionPoint>\r\n    <name>Empty</name>\r\n  </entityActionFieldExtensionPoint>\r\n  <entityActionField>\r\n    <name>Two</name>\r\n  </entityActionField>\r\n</entity>";
        fs::write(out.join("entity/A/A.aod"), aod).unwrap();
        let report = run_extension_point_resolution(&out).unwrap();
        assert_eq!(report.extension_points_resolved, 2);
        let text = fs::read_to_string(out.join("entity/A/A.aod")).unwrap();
        assert_eq!(text, "<entity>\r\n  <name>A</name>\r\n  <entityActionField>\r\n    <name>One</name>\r\n  </entityActionField>\r\n  <entityActionField>\r\n    <name>Two</name>\r\n  </entityActionField>\r\n</entity>");
    }
}
