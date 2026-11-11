use crate::parallel::{io_threads, parallel_map};
use regex::{NoExpand, Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const SKIPPED_DIRS: [&str; 7] = ["node_modules", "dist", ".git", ".idea", ".vscode", ".aditoprj", ".forge-incremental-cache"];
const MAX_HITS: usize = 2000;
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_LINE_CHARS: usize = 300;

#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOptions {
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default)]
    pub regex: bool,
    #[serde(default)]
    pub whole_word: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct SearchHit {
    pub path: String,
    pub line: usize,
    pub column: usize,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct SearchResult {
    pub hits: Vec<SearchHit>,
    pub files_searched: usize,
    pub files_with_hits: usize,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ReplaceResult {
    pub files_changed: usize,
    pub replacements: usize,
    pub skipped: Vec<String>,
}

fn build(query: &str, options: &SearchOptions) -> Result<Regex, String> {
    if query.is_empty() {
        return Err("Enter a search text.".into());
    }
    let mut pattern = if options.regex { query.to_string() } else { regex::escape(query) };
    if options.whole_word {
        pattern = format!(r"\b(?:{pattern})\b");
    }
    RegexBuilder::new(&pattern)
        .case_insensitive(!options.case_sensitive)
        .multi_line(true)
        .build()
        .map_err(|e| format!("The search expression is not valid: {e}"))
}

fn collect(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_dir() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !SKIPPED_DIRS.contains(&name.as_str()) {
                collect(&path, out);
            }
        } else if kind.is_file() {
            out.push(path);
        }
    }
}

fn read_text(path: &Path) -> Option<String> {
    let meta = std::fs::metadata(path).ok()?;
    if meta.len() > MAX_FILE_BYTES {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    if bytes.iter().take(8192).any(|b| *b == 0) {
        return None;
    }
    String::from_utf8(bytes).ok()
}

fn clip(line: &str) -> String {
    let trimmed = line.trim();
    if trimmed.chars().count() > MAX_LINE_CHARS {
        let cut: String = trimmed.chars().take(MAX_LINE_CHARS).collect();
        format!("{cut}…")
    } else {
        trimmed.to_string()
    }
}

fn hits_of(path: &Path, re: &Regex) -> Vec<SearchHit> {
    let Some(text) = read_text(path) else { return Vec::new() };
    let shown = path.to_string_lossy().replace('\\', "/");
    let mut hits = Vec::new();
    for (index, raw) in text.split('\n').enumerate() {
        let line = raw.strip_suffix('\r').unwrap_or(raw);
        if let Some(found) = re.find(line) {
            let column = line[..found.start()].chars().count() + 1;
            hits.push(SearchHit { path: shown.clone(), line: index + 1, column, text: clip(line) });
        }
    }
    hits
}

pub fn search(roots: &[PathBuf], query: &str, options: &SearchOptions) -> Result<SearchResult, String> {
    let re = build(query, options)?;
    let mut files = Vec::new();
    for root in roots {
        collect(root, &mut files);
    }
    let per_file = parallel_map(&files, io_threads(), |file| hits_of(file, &re));
    let files_searched = files.len();
    let files_with_hits = per_file.iter().filter(|h| !h.is_empty()).count();
    let mut hits: Vec<SearchHit> = per_file.into_iter().flatten().collect();
    let truncated = hits.len() > MAX_HITS;
    hits.truncate(MAX_HITS);
    Ok(SearchResult { hits, files_searched, files_with_hits, truncated })
}

fn inside(roots: &[PathBuf], file: &Path) -> bool {
    let Ok(file) = file.canonicalize() else { return false };
    roots.iter().filter_map(|r| r.canonicalize().ok()).any(|r| file.starts_with(r))
}

pub fn replace(roots: &[PathBuf], files: &[PathBuf], query: &str, options: &SearchOptions, replacement: &str) -> Result<ReplaceResult, String> {
    let re = build(query, options)?;
    let mut result = ReplaceResult { files_changed: 0, replacements: 0, skipped: Vec::new() };
    for file in files {
        let shown = file.to_string_lossy().replace('\\', "/");
        if !inside(roots, file) {
            result.skipped.push(shown);
            continue;
        }
        let Some(text) = read_text(file) else {
            result.skipped.push(shown);
            continue;
        };
        let count = re.find_iter(&text).count();
        if count == 0 {
            continue;
        }
        let changed = if options.regex { re.replace_all(&text, replacement).into_owned() } else { re.replace_all(&text, NoExpand(replacement)).into_owned() };
        if platform::fs::atomic_write(file, changed.as_bytes()).is_err() {
            result.skipped.push(shown);
            continue;
        }
        result.files_changed += 1;
        result.replacements += count;
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("forge-content-search-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        for (path, content) in [
            ("entity/A/onInit.js", "var a = 1;\r\nlet Foo = foo();\r\n"),
            ("entity/A/A.aod", "<name>Foo_entity</name>\n"),
            ("node_modules/m/x.js", "foo foo"),
            ("dist/entity/A/onInit.js", "foo"),
        ] {
            let file = root.join(path);
            std::fs::create_dir_all(file.parent().unwrap()).unwrap();
            std::fs::write(file, content).unwrap();
        }
        std::fs::write(root.join("binary.bin"), [b'f', b'o', b'o', 0, 1, 2]).unwrap();
        root
    }

    #[test]
    fn finds_lines_with_position_and_skips_dependencies_output_and_binaries() {
        let root = project("find");
        let result = search(&[root.clone()], "foo", &SearchOptions::default()).unwrap();
        let spots: Vec<(String, usize, usize)> = result.hits.iter().map(|h| (h.path.rsplit('/').next().unwrap().to_string(), h.line, h.column)).collect();
        assert!(spots.contains(&("onInit.js".to_string(), 2, 5)));
        assert!(spots.contains(&("A.aod".to_string(), 1, 7)));
        assert_eq!(result.hits.len(), 2);
        assert_eq!(result.files_with_hits, 2);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn respects_case_whole_word_and_regex() {
        let root = project("options");
        let case = SearchOptions { case_sensitive: true, ..Default::default() };
        assert_eq!(search(&[root.clone()], "foo", &case).unwrap().hits.len(), 1);
        let word = SearchOptions { whole_word: true, ..Default::default() };
        assert_eq!(search(&[root.clone()], "foo", &word).unwrap().hits.len(), 1);
        let re = SearchOptions { regex: true, ..Default::default() };
        assert_eq!(search(&[root.clone()], r"var \w+ = \d", &re).unwrap().hits.len(), 1);
        assert!(search(&[root.clone()], "(", &re).is_err());
        assert!(search(&[root.clone()], "", &SearchOptions::default()).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn replaces_literally_in_the_given_files_only_and_keeps_line_endings() {
        let root = project("replace");
        let file = root.join("entity/A/onInit.js");
        let result = replace(&[root.clone()], &[file.clone()], "foo", &SearchOptions::default(), "$bar").unwrap();
        assert_eq!((result.files_changed, result.replacements), (1, 2));
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "var a = 1;\r\nlet $bar = $bar();\r\n");
        assert_eq!(std::fs::read_to_string(root.join("entity/A/A.aod")).unwrap(), "<name>Foo_entity</name>\n");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn refuses_files_outside_the_roots() {
        let root = project("outside");
        let other = project("other");
        let result = replace(&[root.clone()], &[other.join("entity/A/A.aod")], "Foo", &SearchOptions::default(), "X").unwrap();
        assert_eq!((result.files_changed, result.skipped.len()), (0, 1));
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&other);
    }
}
