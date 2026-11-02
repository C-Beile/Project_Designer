//! File operations behind the tree's context menu: copy an object under a new name and delete an
//! object. Both only work on the standard object layout `<root>/<type>/<Name>/<Name>.aod`; anything
//! else is refused instead of guessed.
//!
//! Business rules: a copy keeps all references of the original (it points at the same other
//! objects) but is self-consistent (its own name and its own folder paths). A delete removes the
//! whole object folder and never touches module objects below `node_modules`.

use std::fs;
use std::path::{Path, PathBuf};

/// Folder-safe object name: letters, digits, underscore, hyphen and dot-free.
pub fn valid_object_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 100 && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

pub struct ObjectLocation {
    pub dir: PathBuf,
    pub type_folder: String,
    pub name: String,
}

/// Validates `<root>/<type>/<Name>/<Name>.aod` and returns its parts.
pub fn locate_object(aod: &Path) -> Result<ObjectLocation, String> {
    let file_stem = aod.file_stem().and_then(|s| s.to_str()).ok_or("Not an object file.")?;
    if aod.extension().and_then(|e| e.to_str()) != Some("aod") {
        return Err("Not an object file.".into());
    }
    let dir = aod.parent().ok_or("Not an object file.")?;
    let name = dir.file_name().and_then(|s| s.to_str()).ok_or("Not an object file.")?;
    if name != file_stem {
        return Err("The object does not use the standard folder layout.".into());
    }
    let type_folder = dir.parent().and_then(|p| p.file_name()).and_then(|s| s.to_str()).ok_or("The object does not use the standard folder layout.")?;
    Ok(ObjectLocation { dir: dir.to_path_buf(), type_folder: type_folder.to_string(), name: name.to_string() })
}

fn copy_dir(from: &Path, to: &Path) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(from).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let target = to.join(entry.file_name());
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if kind.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else if kind.is_file() {
            fs::copy(entry.path(), &target).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// The `.aod` text of the copy: its own `<name>` and its own folder paths.
pub fn rewrite_for_copy(text: &str, type_folder: &str, old: &str, new: &str) -> Result<String, String> {
    let name_tag = format!("<name>{old}</name>");
    if !text.contains(&name_tag) {
        return Err("The object file does not contain its own name element.".into());
    }
    let renamed = text.replacen(&name_tag, &format!("<name>{new}</name>"), 1);
    Ok(renamed.replace(&format!("/{type_folder}/{old}/"), &format!("/{type_folder}/{new}/")))
}

/// Copies the object at `aod` as `new_name` below `dest_root/<type>/`. Returns the new `.aod`.
pub fn copy_object(aod: &Path, dest_root: &Path, new_name: &str) -> Result<PathBuf, String> {
    let loc = locate_object(aod)?;
    crate::new_object::validate_name(dest_root, &loc.type_folder, new_name)?;
    let dest_dir = dest_root.join(&loc.type_folder).join(new_name);
    if dest_dir.exists() {
        return Err(crate::new_object::MSG_EXISTS.into());
    }
    let source_bytes = fs::read(aod).map_err(|e| e.to_string())?;
    let source_text = String::from_utf8(source_bytes).map_err(|_| "The object file is not UTF-8 text.".to_string())?;
    let new_text = rewrite_for_copy(&source_text, &loc.type_folder, &loc.name, new_name)?;
    if let Err(e) = copy_dir(&loc.dir, &dest_dir) {
        let _ = fs::remove_dir_all(&dest_dir);
        return Err(e);
    }
    let old_aod = dest_dir.join(format!("{}.aod", loc.name));
    let new_aod = dest_dir.join(format!("{new_name}.aod"));
    let finish = || -> Result<(), String> {
        fs::write(&old_aod, new_text.as_bytes()).map_err(|e| e.to_string())?;
        fs::rename(&old_aod, &new_aod).map_err(|e| e.to_string())
    };
    if let Err(e) = finish() {
        let _ = fs::remove_dir_all(&dest_dir);
        return Err(e);
    }
    Ok(new_aod)
}

/// Deletes the folder of the object at `aod`. Module objects are refused.
pub fn delete_object(aod: &Path) -> Result<(), String> {
    let normalized = aod.to_string_lossy().replace('\\', "/").to_lowercase();
    if normalized.contains("/node_modules/") {
        return Err("Objects of modules are read-only and cannot be deleted.".into());
    }
    let loc = locate_object(aod)?;
    fs::remove_dir_all(&loc.dir).map_err(|e| format!("The object could not be deleted: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("forge-tree-ops-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn make_entity(root: &Path, name: &str) -> PathBuf {
        let dir = root.join("entity").join(name);
        fs::create_dir_all(dir.join("sub")).unwrap();
        let aod = dir.join(format!("{name}.aod"));
        fs::write(&aod, format!("<entity>\r\n  <name>{name}</name>\r\n  <valueProcess>%aditoprj%/entity/{name}/sub/v.js</valueProcess>\r\n  <other>%aditoprj%/entity/Other/x.js</other>\r\n</entity>")).unwrap();
        fs::write(dir.join("sub").join("v.js"), "var a = 1;").unwrap();
        aod
    }

    #[test]
    fn names_are_checked() {
        assert!(valid_object_name("Person_copy-2"));
        assert!(!valid_object_name(""));
        assert!(!valid_object_name("a/b"));
        assert!(!valid_object_name("a b"));
        assert!(!valid_object_name(".."));
    }

    #[test]
    fn only_the_standard_layout_is_accepted() {
        assert!(locate_object(Path::new("C:/p/entity/A/A.aod")).is_ok());
        assert!(locate_object(Path::new("C:/p/entity/A/B.aod")).is_err());
        assert!(locate_object(Path::new("C:/p/entity/A/A.js")).is_err());
    }

    #[test]
    fn copy_gets_its_own_name_and_folder_paths_but_keeps_other_references() {
        let root = scratch("copy");
        let aod = make_entity(&root, "Person");
        let new_aod = copy_object(&aod, &root, "Person2").unwrap();
        assert_eq!(new_aod, root.join("entity").join("Person2").join("Person2.aod"));
        let text = fs::read_to_string(&new_aod).unwrap();
        assert!(text.contains("<name>Person2</name>"));
        assert!(text.contains("/entity/Person2/sub/v.js"));
        assert!(text.contains("/entity/Other/x.js"));
        assert!(text.contains("\r\n"));
        assert_eq!(fs::read_to_string(root.join("entity/Person2/sub/v.js")).unwrap(), "var a = 1;");
        assert!(aod.exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn copy_refuses_existing_targets_and_bad_names_and_leaves_nothing_behind() {
        let root = scratch("copy-refuse");
        let aod = make_entity(&root, "Person");
        make_entity(&root, "Taken");
        assert!(copy_object(&aod, &root, "Taken").unwrap_err().contains("already exists"));
        assert!(copy_object(&aod, &root, "../x").is_err());
        let broken = root.join("entity").join("Broken");
        fs::create_dir_all(&broken).unwrap();
        fs::write(broken.join("Broken.aod"), "<entity><name>Other</name></entity>").unwrap();
        assert!(copy_object(&broken.join("Broken.aod"), &root, "Fresh").is_err());
        assert!(!root.join("entity").join("Fresh").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn copy_can_target_another_project_root() {
        let a = scratch("copy-a");
        let b = scratch("copy-b");
        let aod = make_entity(&a, "Person");
        copy_object(&aod, &b, "Person").unwrap();
        assert!(b.join("entity/Person/Person.aod").exists());
        let _ = fs::remove_dir_all(&a);
        let _ = fs::remove_dir_all(&b);
    }

    #[test]
    fn delete_removes_the_object_folder_only() {
        let root = scratch("delete");
        let a = make_entity(&root, "A");
        let b = make_entity(&root, "B");
        delete_object(&a).unwrap();
        assert!(!root.join("entity/A").exists());
        assert!(b.exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn delete_refuses_module_objects_and_foreign_layouts() {
        let root = scratch("delete-refuse");
        let module = make_entity(&root.join("node_modules").join("@x").join("m"), "M");
        assert!(delete_object(&module).unwrap_err().contains("read-only"));
        assert!(module.exists());
        assert!(delete_object(&root.join("entity").join("A").join("B.aod")).is_err());
        let _ = fs::remove_dir_all(&root);
    }
}
