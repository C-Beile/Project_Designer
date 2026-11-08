//! Schreibschutz fuer Objekte installierter Module (node_modules).

use std::path::Path;

pub fn is_under_node_modules(path: &Path) -> bool {
    path.components()
        .any(|c| c.as_os_str().to_str().is_some_and(|s| s.eq_ignore_ascii_case("node_modules")))
}

/// Objects of installed modules belong to their publisher and are never changed by Forge.
pub fn ensure_writable(path: &Path) -> Result<(), String> {
    if is_under_node_modules(path) {
        return Err(format!(
            "'{}' belongs to an installed module (node_modules) and is read-only; change it in the module's own repository or through a modification in the project",
            path.display()
        ));
    }
    Ok(())
}
