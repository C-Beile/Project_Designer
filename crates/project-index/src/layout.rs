//! Welche Ordner des Projekts Objekte enthalten, und wie ein Pfad zu (Typ, Name) wird.

/// Object families the editors/validators dispatch on (`object_type_for_leaf_path`). Kept as is
/// from the earlier rounds: the folder names were verified against the real corpus there
/// (aod-format.md §2/§3, p4-editor-*-notes.md).
pub const OBJECT_FOLDERS: &[(&str, &str)] = &[
    ("entity", "entity"),
    ("neonView", "neonView"),
    ("neonContext", "neonContext"),
    ("neonDashboard", "neonDashboard"),
    ("aliasDefinition", "aliasDefinition"),
    ("language", "language"),
    ("system", "system"),
    ("preferences", "preferences"),
    ("application", "application"),
    ("entityWebservice", "entityWebservice"),
    ("report", "report"),
];

/// Every disk folder holding model objects; `neonView` has no folder of its own in the tree
/// (views hang below their contexts) but must be indexed to resolve those references.
pub const SCANNED_FOLDERS: &[&str] = &[
    "system",
    "preferences",
    "application",
    "neonContext",
    "neonNotificationType",
    "entity",
    "neonDashboard",
    "rendererDefinition",
    "process",
    "serviceDefinition",
    "entityWebservice",
    "report",
    "language",
    "role",
    "aliasDefinition",
    "neonView",
];

/// `rel` is a path inside the project (separators `/` or `\`). Returns `(object_type, name)` for
/// `<scanned folder>/<name>/<name>.aod` and `None` for everything else.
pub fn object_of(rel: &str) -> Option<(&'static str, String)> {
    let mut parts = rel.split(['/', '\\']).filter(|p| !p.is_empty());
    let folder = parts.next()?;
    let name = parts.next()?;
    let file = parts.next()?;
    if parts.next().is_some() {
        return None;
    }
    let object_type = SCANNED_FOLDERS.iter().find(|f| **f == folder)?;
    (file.strip_suffix(".aod") == Some(name)).then(|| (*object_type, name.to_string()))
}

/// Position of the type in `OBJECT_FOLDERS` (the order Problems and Usages are listed in).
pub fn object_folder_rank(object_type: &str) -> Option<usize> {
    OBJECT_FOLDERS.iter().position(|(_, t)| *t == object_type)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn object_of_accepts_only_the_object_file() {
        assert_eq!(object_of("entity/A_entity/A_entity.aod"), Some(("entity", "A_entity".to_string())));
        assert_eq!(object_of("entity\\A_entity\\A_entity.aod"), Some(("entity", "A_entity".to_string())));
        assert_eq!(object_of("entity/A_entity/other.aod"), None);
        assert_eq!(object_of("entity/A_entity/sub/A_entity.aod"), None);
        assert_eq!(object_of("docs/A/A.aod"), None);
        assert_eq!(object_of("entity/A_entity"), None);
    }
}
