//! Type definitions of the JDito API for the code editor's completion, hover and error checks.
//!
//! The definitions are the `@aditosoftware/jdito-types` package that the project itself has in
//! its `node_modules`. They are only read, never written, and are not shipped with the app.

use serde::Serialize;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct TypeFile {
    /// Path inside the package, with forward slashes (`index.d.ts`, `dist/definition_vars.ts`).
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct JditoTypes {
    pub version: String,
    pub files: Vec<TypeFile>,
}

const MAX_BYTES: u64 = 8 * 1024 * 1024;

/// The package files of the project, or `None` when the project has no jdito-types installed.
pub fn read(project_root: &Path) -> Option<JditoTypes> {
    let pkg = project_root.join("node_modules").join("@aditosoftware").join("jdito-types");
    if !pkg.join("index.d.ts").is_file() {
        return None;
    }
    let version = fs::read_to_string(pkg.join("package.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|v| v.get("version").and_then(|x| x.as_str().map(str::to_string)))
        .unwrap_or_default();
    let mut files = Vec::new();
    let mut total = 0u64;
    let mut take = |rel: String, path: &Path| -> bool {
        let Ok(content) = fs::read_to_string(path) else { return true };
        total += content.len() as u64;
        files.push(TypeFile { path: rel, content });
        total <= MAX_BYTES
    };
    take("index.d.ts".into(), &pkg.join("index.d.ts"));
    if let Ok(entries) = fs::read_dir(pkg.join("dist")) {
        let mut items: Vec<_> = entries.flatten().filter(|e| e.path().extension().is_some_and(|x| x == "ts")).collect();
        items.sort_by_key(|e| e.file_name());
        for e in items {
            if !take(format!("dist/{}", e.file_name().to_string_lossy()), &e.path()) {
                break;
            }
        }
    }
    Some(JditoTypes { version, files })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_project_without_the_package_has_no_types() {
        let dir = std::env::temp_dir().join(format!("forge-jdito-none-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        assert!(read(&dir).is_none());
    }

    #[test]
    fn the_package_files_are_read_in_order_with_the_version() {
        let dir = std::env::temp_dir().join(format!("forge-jdito-pkg-{}", std::process::id()));
        let pkg = dir.join("node_modules/@aditosoftware/jdito-types");
        fs::create_dir_all(pkg.join("dist")).unwrap();
        fs::write(pkg.join("index.d.ts"), "export * from \"./dist/definition_b\";").unwrap();
        fs::write(pkg.join("package.json"), "{\"version\":\"2024.2.0\"}").unwrap();
        fs::write(pkg.join("dist/definition_b.ts"), "export const b: number;").unwrap();
        fs::write(pkg.join("dist/definition_a.ts"), "export const a: number;").unwrap();
        fs::write(pkg.join("dist/readme.md"), "x").unwrap();
        let t = read(&dir).unwrap();
        assert_eq!(t.version, "2024.2.0");
        let paths: Vec<_> = t.files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, vec!["index.d.ts", "dist/definition_a.ts", "dist/definition_b.ts"]);
    }

    #[test]
    fn the_real_package_of_a_corpus_project_loads_when_present() {
        let root = Path::new(r"C:\Users\ClemensBeile\Desktop\GitRepos_ADITO\Vendira_basic");
        if let Some(t) = read(root) {
            assert!(t.files.len() > 40);
            assert!(t.files.iter().any(|f| f.path == "dist/definition_vars.ts"));
        }
    }
}
