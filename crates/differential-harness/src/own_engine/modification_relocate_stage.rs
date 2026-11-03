// Relocation stage of the own transpiler. A modification ships the scripts and documentation it
// inserts next to its own file (`modification/<id>/process.js`) and the inserted element refers to
// them as `%aditoprj%/modification/<id>/process.js`. The reference transpiler files such a script
// below the object it now belongs to, following the position of the element in the object:
//   <type>/<object>/<container>/<item name>/.../<element tag>.<ext>      (all lower case)
// for example `serviceDefinition/x_service/implementations/eventmessage_impl/process.js`, and
// rewrites the reference accordingly. Verified against a clean reference run of a real project.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

const MARKER: &str = "%aditoprj%/modification/";

#[derive(Debug, Default, Clone)]
pub struct RelocateReport {
    pub files_moved: usize,
    pub objects_rewritten: usize,
    pub missing_sources: usize,
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

/// `<tag>` or `<tag attr..>` opening line, returns the tag name.
fn open_tag(trimmed: &str) -> Option<&str> {
    let rest = trimmed.strip_prefix('<')?;
    if rest.starts_with('/') || rest.starts_with('?') || rest.starts_with('!') || trimmed.ends_with("/>") || !trimmed.ends_with('>') {
        return None;
    }
    // A line like `<tag>text</tag>` is a leaf, not an opening line.
    if trimmed[1..].contains('<') {
        return None;
    }
    let end = rest.find(|c: char| c == '>' || c.is_whitespace())?;
    Some(&rest[..end])
}

/// `<tag>text</tag>` leaf line: (tag, text).
fn leaf(trimmed: &str) -> Option<(&str, &str)> {
    let rest = trimmed.strip_prefix('<')?;
    let tag_end = rest.find('>')?;
    let tag = &rest[..tag_end];
    if tag.starts_with('/') || tag.contains(' ') || tag.ends_with('/') {
        return None;
    }
    let body = &rest[tag_end + 1..];
    let close = format!("</{tag}>");
    body.strip_suffix(close.as_str()).map(|text| (tag, text))
}

fn to_crlf(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(bytes.len() + bytes.len() / 20);
    for &b in bytes.iter().filter(|&&b| b != b'\r') {
        if b == b'\n' {
            out.push(b'\r');
        }
        out.push(b);
    }
    out
}

pub fn run_modification_relocation(output_dir: &Path) -> io::Result<RelocateReport> {
    let mut report = RelocateReport::default();
    let source_root = output_dir.join("modification");
    if !source_root.is_dir() {
        return Ok(report);
    }
    let mut files = Vec::new();
    collect_aod(output_dir, &mut files);

    for file in files {
        let Ok(bytes) = fs::read(&file) else { continue };
        let Ok(text) = String::from_utf8(bytes) else { continue };
        if !text.contains(MARKER) {
            continue;
        }
        let Ok(rel) = file.strip_prefix(output_dir) else { continue };
        let mut parts = rel.components();
        let type_dir = parts.next().map(|c| c.as_os_str().to_string_lossy().into_owned()).unwrap_or_default();

        let lines: Vec<&str> = text.split('\n').collect();
        let mut stack: Vec<String> = Vec::new();
        let mut out: Vec<String> = Vec::with_capacity(lines.len());
        let mut moves: Vec<(PathBuf, PathBuf)> = Vec::new();
        let mut changed = false;

        for (i, raw) in lines.iter().enumerate() {
            let cr = if raw.ends_with('\r') { "\r" } else { "" };
            let trimmed = raw.trim();
            if let Some(tag) = open_tag(trimmed) {
                let name = lines.get(i + 1).and_then(|next| leaf(next.trim())).filter(|(t, _)| *t == "name").map(|(_, v)| v.to_string());
                stack.push(name.unwrap_or_else(|| tag.to_string()));
                out.push((*raw).to_string());
                continue;
            }
            if trimmed.starts_with("</") {
                stack.pop();
                out.push((*raw).to_string());
                continue;
            }
            if let Some((tag, value)) = leaf(trimmed) {
                if let Some(reference) = value.strip_prefix(MARKER) {
                    if let Some((id, source_rel)) = reference.split_once('/') {
                        let ext = Path::new(source_rel).extension().and_then(|e| e.to_str()).unwrap_or("js");
                        let mut dest_rel = PathBuf::from(&type_dir);
                        for (depth, segment) in stack.iter().enumerate() {
                            // The object folder keeps its name; everything below it is lower case.
                            dest_rel.push(if depth == 0 { segment.clone() } else { segment.to_lowercase() });
                        }
                        dest_rel.push(format!("{tag}.{ext}"));
                        let reference_new = format!("%aditoprj%/{}", dest_rel.to_string_lossy().replace('\\', "/"));
                        let indent = &raw[..raw.len() - raw.trim_start().len()];
                        out.push(format!("{indent}<{tag}>{reference_new}</{tag}>{cr}"));
                        moves.push((source_root.join(id).join(source_rel), output_dir.join(&dest_rel)));
                        changed = true;
                        continue;
                    }
                }
            }
            out.push((*raw).to_string());
        }

        if !changed {
            continue;
        }
        for (from, to) in moves {
            let Ok(content) = fs::read(&from) else {
                report.missing_sources += 1;
                continue;
            };
            if let Some(parent) = to.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::write(&to, to_crlf(&content))?;
            report.files_moved += 1;
        }
        fs::write(&file, out.join("\n").as_bytes())?;
        report.objects_rewritten += 1;
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn files_an_inserted_script_below_its_object_and_rewrites_the_reference() {
        let out = std::env::temp_dir().join(format!("forge-relocate-{}", std::process::id()));
        let _ = fs::remove_dir_all(&out);
        fs::create_dir_all(out.join("modification/abc")).unwrap();
        fs::write(out.join("modification/abc/process.js"), "a\nb").unwrap();
        fs::create_dir_all(out.join("serviceDefinition/X_service")).unwrap();
        let aod = "<serviceDefinition>\r\n  <name>X_service</name>\r\n  <implementations>\r\n    <serviceImplementation>\r\n      <name>Impl_One</name>\r\n      <process>%aditoprj%/modification/abc/process.js</process>\r\n    </serviceImplementation>\r\n  </implementations>\r\n</serviceDefinition>";
        fs::write(out.join("serviceDefinition/X_service/X_service.aod"), aod).unwrap();

        let report = run_modification_relocation(&out).unwrap();
        assert_eq!((report.files_moved, report.objects_rewritten), (1, 1));
        let text = fs::read_to_string(out.join("serviceDefinition/X_service/X_service.aod")).unwrap();
        assert!(text.contains("<process>%aditoprj%/serviceDefinition/X_service/implementations/impl_one/process.js</process>\r\n"));
        assert_eq!(fs::read(out.join("serviceDefinition/X_service/implementations/impl_one/process.js")).unwrap(), b"a\r\nb");
    }
}
