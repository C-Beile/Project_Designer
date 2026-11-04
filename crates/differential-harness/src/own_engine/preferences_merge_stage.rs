//! Folds the preferences of every module into the preferences of the project: a module that ships its
//! own custom configuration properties adds them to the project's preferences, and its own
//! preferences folder is not part of the result (the official output has only the project's file).

use std::fs;
use std::io;
use std::path::Path;

const PROJECT_FOLDER: &str = "_____PREFERENCES_PROJECT";
const OPEN: &str = "<customConfigProperties>";
const CLOSE: &str = "</customConfigProperties>";

#[derive(Debug, Default, Clone)]
pub struct PreferencesMergeReport {
    pub merged_modules: usize,
}

fn read(path: &Path) -> Option<String> {
    fs::read(path).ok().map(|b| String::from_utf8_lossy(&b).into_owned())
}

/// The lines inside the `customConfigProperties` wrapper of a preferences file.
fn config_children(text: &str) -> Option<Vec<String>> {
    let normalized = text.replace("\r\n", "\n");
    let lines: Vec<&str> = normalized.split('\n').collect();
    let open = lines.iter().position(|l| l.trim() == OPEN)?;
    let close = lines.iter().skip(open + 1).position(|l| l.trim() == CLOSE)? + open + 1;
    Some(lines[open + 1..close].iter().map(|l| l.to_string()).collect())
}

/// Merges the module preferences below `<output_dir>/preferences` into the project preferences.
pub fn run_preferences_merge(output_dir: &Path) -> io::Result<PreferencesMergeReport> {
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
    if folders.is_empty() {
        return Ok(report);
    }

    let Some(target_text) = read(&target_file) else { return Ok(report) };
    let mut lines: Vec<String> = target_text.replace("\r\n", "\n").split('\n').map(str::to_string).collect();
    for folder in &folders {
        let dir = root.join(folder);
        if let Some(text) = read(&dir.join(format!("{folder}.aod"))) {
            if let Some(children) = config_children(&text) {
                match lines.iter().position(|l| l.trim() == CLOSE) {
                    Some(close) => {
                        for (i, child) in children.into_iter().enumerate() {
                            lines.insert(close + i, child);
                        }
                    }
                    None => {
                        if let Some(end) = lines.iter().rposition(|l| l.trim_start().starts_with("</preferences>")) {
                            let mut block = vec![format!("  {OPEN}")];
                            block.extend(children);
                            block.push(format!("  {CLOSE}"));
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
    }
    fs::write(&target_file, lines.join("\r\n").as_bytes())?;
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
        let report = run_preferences_merge(&tmp).unwrap();
        assert_eq!(report.merged_modules, 1);
        let merged = fs::read_to_string(prefs.join(PROJECT_FOLDER).join(format!("{PROJECT_FOLDER}.aod"))).unwrap();
        assert!(merged.contains("<a/>\r\n    <b/>\r\n  </customConfigProperties>"));
        assert!(!prefs.join("_____PREFERENCES_receipt").exists());
        let _ = fs::remove_dir_all(&tmp);
    }
}
