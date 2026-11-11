//! Finds the ADITO projects inside one folder (the folder where all projects of a person live).
//! Only the direct subfolders are looked at, so a scan stays fast even next to large `node_modules`.

use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct FoundProject {
    pub path: String,
    pub name: String,
}

/// Folders that hold the objects of a project; one of them plus the package file marks a source project.
const OBJECT_FOLDERS: [&str; 5] = ["entity", "system", "aliasDefinition", "neonView", "application"];

/// A project has the `.aditoprj` folder of the Designer, or a package file next to object folders.
pub fn is_adito_project(dir: &Path) -> bool {
    if dir.join(".aditoprj").is_dir() {
        return true;
    }
    dir.join("package.json").is_file() && OBJECT_FOLDERS.iter().any(|f| dir.join(f).is_dir())
}

/// The projects directly inside `folder` (or `folder` itself when it is one), sorted by name.
pub fn find_projects(folder: &Path) -> Result<Vec<FoundProject>, String> {
    if is_adito_project(folder) {
        let name = folder.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        return Ok(vec![FoundProject { name, path: folder.to_string_lossy().into_owned() }]);
    }
    let entries = std::fs::read_dir(folder).map_err(|e| format!("The folder cannot be read: {e}"))?;
    let mut found: Vec<FoundProject> = entries
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .map(|e| e.path())
        .filter(|p| !p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with('.') || n == "node_modules" || n == "dist"))
        .filter(|p| is_adito_project(p))
        .map(|p| FoundProject { name: p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(), path: p.to_string_lossy().into_owned() })
        .collect();
    found.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("forge-discover-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn finds_projects_by_marker_and_skips_the_rest() {
        let root = temp("all");
        std::fs::create_dir_all(root.join("Pichler/.aditoprj")).unwrap();
        std::fs::create_dir_all(root.join("hermes/entity")).unwrap();
        std::fs::write(root.join("hermes/package.json"), "{}").unwrap();
        std::fs::create_dir_all(root.join("notes")).unwrap();
        std::fs::create_dir_all(root.join(".hidden/.aditoprj")).unwrap();
        std::fs::create_dir_all(root.join("node_modules/.aditoprj")).unwrap();
        let names: Vec<String> = find_projects(&root).unwrap().into_iter().map(|p| p.name).collect();
        assert_eq!(names, vec!["hermes", "Pichler"]);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_project_folder_chosen_directly_lists_itself() {
        let root = temp("self");
        std::fs::create_dir_all(root.join(".aditoprj")).unwrap();
        assert_eq!(find_projects(&root).unwrap().len(), 1);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_project_folder_does_not_list_its_own_subfolders() {
        let root = temp("nested");
        std::fs::create_dir_all(root.join(".aditoprj")).unwrap();
        std::fs::create_dir_all(root.join("dist/entity")).unwrap();
        std::fs::write(root.join("dist/package.json"), "{}").unwrap();
        let found = find_projects(&root).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].path, root.to_string_lossy());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_missing_folder_is_an_error() {
        assert!(find_projects(Path::new("Z:/does/not/exist")).is_err());
    }
}
