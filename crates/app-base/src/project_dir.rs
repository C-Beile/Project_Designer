//! Zielordner eines neuen Projekts (leer anlegen oder klonen).

use std::path::{Path, PathBuf};

/// A folder name for the project: one plain name, no path.
pub fn validate_project_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Enter a project name.".into());
    }
    if name == "." || name == ".." || name.chars().any(|c| matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control()) || name.ends_with('.') {
        return Err("The project name must be a plain folder name without path characters.".into());
    }
    Ok(name.to_string())
}

/// `<location>/<name>`, which must not exist yet or be empty.
pub fn target_dir(location: &str, name: &str) -> Result<PathBuf, String> {
    let name = validate_project_name(name)?;
    let location = location.trim();
    if location.is_empty() {
        return Err("Choose the project location.".into());
    }
    let dir = Path::new(location).join(&name);
    if dir.exists() && std::fs::read_dir(&dir).map(|mut d| d.next().is_some()).unwrap_or(true) {
        return Err(format!("The folder {} already exists and is not empty.", dir.display()));
    }
    std::fs::create_dir_all(location).map_err(|e| format!("The location cannot be created: {e}"))?;
    Ok(dir)
}
