//! Folds the preferences of every module into the preferences of the project: a module that ships its
//! own custom configuration properties adds them to the project's preferences, and its own
//! preferences folder is not part of the result (the official output has only the project's file).

use std::fs;
use std::io;
use std::path::Path;

const PROJECT_FOLDER: &str = "_____PREFERENCES_PROJECT";
/// The two lists of custom properties: configuration properties and plain custom properties.
const WRAPPERS: &[&str] = &["customConfigProperties", "customProperties"];

#[derive(Debug, Default, Clone)]
pub struct PreferencesMergeReport {
    pub merged_modules: usize,
}

fn read(path: &Path) -> Option<String> {
    fs::read(path).ok().map(|b| String::from_utf8_lossy(&b).into_owned())
}

/// The lines inside the `wrapper` list of a preferences file.
fn wrapper_children(text: &str, wrapper: &str) -> Option<Vec<String>> {
    let (open, close) = (format!("<{wrapper}>"), format!("</{wrapper}>"));
    let normalized = text.replace("\r\n", "\n");
    let lines: Vec<&str> = normalized.split('\n').collect();
    let first = lines.iter().position(|l| l.trim() == open)?;
    let last = lines.iter().skip(first + 1).position(|l| l.trim() == close)? + first + 1;
    Some(lines[first + 1..last].iter().map(|l| l.to_string()).collect())
}

/// Version of the transpiler a project asks for, as (year, minor).
fn transpiler_version(project_home: &Path) -> Option<(u32, u32)> {
    let text = fs::read_to_string(project_home.join("package.json")).ok()?;
    let at = text.find("\"aditotranspile\"")?;
    let rest = &text[at..];
    let quote = rest[rest.find(':')? + 1..].find('"')? + rest.find(':')? + 2;
    let version: Vec<u32> = rest[quote..].split('"').next()?.split('.').filter_map(|p| p.trim_start_matches(|c: char| !c.is_ascii_digit()).parse().ok()).collect();
    Some((*version.first()?, *version.get(1)?))
}

/// Merges the module preferences below `<output_dir>/preferences` into the project preferences.
/// `project_home` tells which transpiler version the project asks for: from 2026.1 on the official output leaves out the
/// editor AI assistant switch when it only repeats its default.
pub fn run_preferences_merge(project_home: &Path, output_dir: &Path) -> io::Result<PreferencesMergeReport> {
    let root = output_dir.join("preferences");
    let mut report = PreferencesMergeReport::default();
    let target_file = root.join(PROJECT_FOLDER).join(format!("{PROJECT_FOLDER}.aod"));
    if !target_file.is_file() {
        return Ok(report);
    }
    let mut folders: Vec<String> = fs::read_dir(&root)?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n != PROJECT_FOLDER)
        .collect();
    folders.sort();

    let Some(target_text) = read(&target_file) else { return Ok(report) };
    let mut lines: Vec<String> = target_text.replace("\r\n", "\n").split('\n').map(str::to_string).collect();
    let mut changed = false;
    if transpiler_version(project_home).is_some_and(|v| v >= (2026, 1)) {
        let before = lines.len();
        lines.retain(|l| l.trim() != "<ckeditorAIAssistantEnabled v=\"true\" />");
        changed |= lines.len() != before;
    }
    for folder in &folders {
        let dir = root.join(folder);
        if let Some(text) = read(&dir.join(format!("{folder}.aod"))) {
            for wrapper in WRAPPERS {
                let Some(children) = wrapper_children(&text, wrapper) else { continue };
                let close = format!("</{wrapper}>");
                match lines.iter().position(|l| l.trim() == close) {
                    Some(at) => {
                        for (i, child) in children.into_iter().enumerate() {
                            lines.insert(at + i, child);
                        }
                    }
                    None => {
                        if let Some(end) = lines.iter().rposition(|l| l.trim_start().starts_with("</preferences>")) {
                            let mut block = vec![format!("  <{wrapper}>")];
                            block.extend(children);
                            block.push(format!("  {close}"));
                            for (i, line) in block.into_iter().enumerate() {
                                lines.insert(end + i, line);
                            }
                        }
                    }
                }
            }
        }
        fs::remove_dir_all(&dir)?;
        report.merged_modules += 1;
        changed = true;
    }
    if changed {
        fs::write(&target_file, lines.join("\r\n").as_bytes())?;
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn module_properties_are_appended_to_the_project_preferences() {
        let tmp = std::env::temp_dir().join(format!("prefs-merge-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let prefs = tmp.join("preferences");
        fs::create_dir_all(prefs.join(PROJECT_FOLDER)).unwrap();
        fs::create_dir_all(prefs.join("_____PREFERENCES_receipt")).unwrap();
        fs::write(
            prefs.join(PROJECT_FOLDER).join(format!("{PROJECT_FOLDER}.aod")),
            "<preferences>\r\n  <customConfigProperties>\r\n    <a/>\r\n  </customConfigProperties>\r\n</preferences>",
        )
        .unwrap();
        fs::write(
            prefs.join("_____PREFERENCES_receipt").join("_____PREFERENCES_receipt.aod"),
            "<preferences>\r\n  <customConfigProperties>\r\n    <b/>\r\n  </customConfigProperties>\r\n</preferences>",
        )
        .unwrap();
        let report = run_preferences_merge(&tmp, &tmp).unwrap();
        assert_eq!(report.merged_modules, 1);
        let merged = fs::read_to_string(prefs.join(PROJECT_FOLDER).join(format!("{PROJECT_FOLDER}.aod"))).unwrap();
        assert!(merged.contains("<a/>\r\n    <b/>\r\n  </customConfigProperties>"));
        assert!(!prefs.join("_____PREFERENCES_receipt").exists());
        let _ = fs::remove_dir_all(&tmp);
    }
}
