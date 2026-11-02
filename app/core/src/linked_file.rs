//! Read/write access to `%aditoprj%`-relative linked files (aod-format.md §1.1) - the mechanism
//! behind Ziel B.3's JDito code field (`entityField.valueProcess` points at a linked `.js` file,
//! not inline code in the `.aod` document itself). Kept as a tiny, generic pair of commands
//! (`read_linked_file`/`write_linked_file`) rather than something entity-specific, since every
//! object type has `%aditoprj%`-relative process fields (architecture.md §6: stable, generic
//! command surface).
//!
//! Write-back goes through `forge_core::platform::fs::atomic_write` - the same real
//! temp-file-then-rename primitive `ProjectHandle::save()` uses (architecture.md §4) - so a
//! crash mid-write can never leave a linked `.js` file half-written, exactly like `.aod` saves.

use std::path::{Path, PathBuf};

/// Resolves a `%aditoprj%/...`-style reference (or an already-relative path) against a project
/// root. `%aditoprj%` is ADITO's own placeholder for "this project's root folder"
/// (aod-format.md §1.1); real values also observed as plain project-relative paths, so both
/// forms are accepted.
pub fn resolve_linked_path(project_root: &Path, reference: &str) -> PathBuf {
    let relative = reference.strip_prefix("%aditoprj%/").unwrap_or(reference);
    project_root.join(relative)
}

pub fn read_linked_file(project_root: &Path, reference: &str) -> Result<String, String> {
    let path = resolve_linked_path(project_root, reference);
    std::fs::read_to_string(&path).map_err(|e| format!("failed to read linked file '{}': {e}", path.display()))
}

pub fn write_linked_file(project_root: &Path, reference: &str, content: &str) -> Result<(), String> {
    let path = resolve_linked_path(project_root, reference);
    crate::tree::ensure_writable(&path)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("failed to create '{}': {e}", dir.display()))?;
    }
    forge_core::platform::fs::atomic_write(&path, content.as_bytes())
        .map_err(|e| format!("failed to write linked file '{}': {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_the_aditoprj_placeholder_against_the_project_root() {
        let root = Path::new("C:/proj");
        let resolved = resolve_linked_path(
            root,
            "%aditoprj%/entity/THHIT_Tour_entity/entityfields/country/valueProcess.js",
        );
        assert_eq!(
            resolved,
            root.join("entity/THHIT_Tour_entity/entityfields/country/valueProcess.js")
        );
    }

    // Regression: linked files of module objects resolve against the package folder, not against a
    // folder derived from nothing (which produced `C:/process/<Name>/process.js`).
    #[test]
    fn linked_files_resolve_against_the_owning_package_root() {
        let base = std::env::temp_dir().join(format!("forge-app-linked-root-test-{}", std::process::id()));
        let package = base.join("node_modules").join("@aditosoftware").join("document-template");
        let layouts = [
            (package.clone(), "process", "AddressFormatter_lib", "process.js"),
            (package.clone(), "entity", "Doc_entity", "entityfields/title/valueProcess.js"),
            (base.clone(), "process", "Project_lib", "process.js"),
        ];
        for (root, folder, name, file) in &layouts {
            let dir = root.join(folder).join(name);
            std::fs::create_dir_all(dir.join(Path::new(file).parent().unwrap())).unwrap();
            std::fs::write(dir.join(file), "// code").unwrap();
            std::fs::write(dir.join(format!("{name}.aod")), "<x/>").unwrap();
            let aod = dir.join(format!("{name}.aod"));
            let owner = crate::project_actor::object_project_root(&aod).unwrap();
            assert_eq!(owner, *root);
            let reference = format!("%aditoprj%/{folder}/{name}/{file}");
            assert_eq!(read_linked_file(&owner, &reference).unwrap(), "// code");
        }
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn write_then_read_round_trips_through_atomic_write() {
        let dir = std::env::temp_dir().join(format!("forge-app-linked-file-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        write_linked_file(&dir, "valueProcess.js", "// JDito process\nresult.string(1);").unwrap();
        let content = read_linked_file(&dir, "valueProcess.js").unwrap();

        assert_eq!(content, "// JDito process\nresult.string(1);");
        std::fs::remove_dir_all(&dir).ok();
    }
}
