//! Namenspruefung fuer neue Objekte (Dialog "Neu", Kopieren, Umbenennen). Gemeinsame Basis von
//! `new_object` und `tree_ops`, damit beide nicht im Kreis voneinander abhaengen.

use std::fs;
use std::path::{Path, PathBuf};

/// Folder-safe object name: letters, digits, underscore, hyphen and dot-free.
pub fn valid_object_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 100 && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn module_has(root: &Path, folder: &str, name: &str) -> Option<String> {
    let nm = root.join("node_modules");
    let scopes = fs::read_dir(&nm).ok()?;
    for scope in scopes.flatten() {
        let sp = scope.path();
        let packages: Vec<PathBuf> = if scope.file_name().to_string_lossy().starts_with('@') {
            fs::read_dir(&sp).map(|r| r.flatten().map(|e| e.path()).collect()).unwrap_or_default()
        } else {
            vec![sp]
        };
        for p in packages {
            if p.join(folder).join(name).is_dir() {
                return Some(p.file_name()?.to_string_lossy().into_owned());
            }
        }
    }
    None
}

pub const MSG_EMPTY: &str = "String is empty.";
pub const MSG_SYSTEM_NAME: &str = "Name is part of systemname.";
pub const MSG_EXISTS: &str = "Name already exists in this project or model.";
/// Prefix every role of a project carries (corpus: `PROJECT_Sales`, `PROJECT_THHIT_DepartmentAdmin`).
pub const ROLE_PREFIX: &str = "PROJECT_";
/// Marks names the Designer reserves for its own objects.
pub const SYSTEM_PREFIX: &str = "_____";

/// Names reserved for exactly one model type (stage 3 of the name check). The original keeps its list in code
/// that is not part of the specification, so nothing is listed here: every known reserved name carries the
/// system prefix and is already refused by stage 2.
const RESERVED_NAMES: &[(&str, &str)] = &[];

/// Stage 3 on an explicit table, so the rule itself is testable.
pub fn check_reserved(table: &[(&str, &str)], folder: &str, name: &str) -> Result<(), String> {
    match table.iter().find(|(reserved, _)| reserved.eq_ignore_ascii_case(name)) {
        Some((_, only)) if *only != folder => Err(format!("Name is only valid for type {only}.")),
        _ => Ok(()),
    }
}

/// Checks the name in the six stages of the original name dialog, in its order and with its messages:
/// empty, system name, reserved for another type, already existing, syntax, type specific rule (roles).
/// `Ok` when the object may be created.
pub fn validate_name(root: &Path, folder: &str, name: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err(MSG_EMPTY.into());
    }
    if name.starts_with(SYSTEM_PREFIX) || name.contains('#') {
        return Err(MSG_SYSTEM_NAME.into());
    }
    check_reserved(RESERVED_NAMES, folder, name)?;
    let own = root.join(folder);
    if let Ok(entries) = fs::read_dir(&own) {
        for e in entries.flatten() {
            if e.file_name().to_string_lossy().eq_ignore_ascii_case(name) {
                return Err(MSG_EXISTS.into());
            }
        }
    }
    if module_has(root, folder, name).is_some() {
        return Err(MSG_EXISTS.into());
    }
    if !valid_object_name(name) {
        return Err("The name may only contain letters, digits, '_' and '-'.".into());
    }
    if name.starts_with(|c: char| c.is_ascii_digit()) {
        return Err("The name must not start with a digit.".into());
    }
    if folder == "role" && !name.starts_with(ROLE_PREFIX) {
        return Err(format!("Must start with {ROLE_PREFIX}"));
    }
    Ok(())
}
