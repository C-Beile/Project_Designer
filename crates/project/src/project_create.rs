//! Creating an empty project. Cloning a Git repository is a command of the git plugin.

use std::path::PathBuf;

use app_base::project_dir::target_dir;

/// Creates an empty project: its package.json (type `project`) and a .gitignore. The folders of the models appear with the first object.
pub fn create_empty_project(location: &str, name: &str) -> Result<PathBuf, String> {
    let dir = target_dir(location, name)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let package_name = name.trim().to_lowercase().replace(' ', "-");
    let package = format!("{{\r\n    \"name\": \"{package_name}\",\r\n    \"version\": \"0.0.1\",\r\n    \"adito\": {{\r\n        \"type\": \"project\"\r\n    }},\r\n    \"dependencies\": {{}}\r\n}}\r\n");
    std::fs::write(dir.join("package.json"), package).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(".gitignore"), "node_modules/\r\ndist/\r\n").map_err(|e| e.to_string())?;
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use app_base::project_dir::validate_project_name;

    #[test]
    fn project_names_are_plain_folder_names() {
        assert!(validate_project_name("clemens-onboarding").is_ok());
        assert!(validate_project_name("../x").is_err());
        assert!(validate_project_name("a\\b").is_err());
        assert!(validate_project_name("").is_err());
    }

    #[test]
    fn an_empty_project_has_a_project_package_and_refuses_a_filled_folder() {
        let tmp = std::env::temp_dir().join(format!("forge-newproj-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let dir = create_empty_project(tmp.to_str().unwrap(), "My Project").unwrap();
        let package = std::fs::read_to_string(dir.join("package.json")).unwrap();
        assert!(package.contains("\"type\": \"project\"") && package.contains("my-project"));
        assert!(create_empty_project(tmp.to_str().unwrap(), "My Project").is_err());
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
