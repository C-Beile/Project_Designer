// Findet die Module des Projekts (npm-Pakete in `node_modules`) und bringt sie in Modul-Reihenfolge.
// Nutzt das Crate `npm-modules`. Die Reihenfolge selbst steht in `merge::order`.

use std::path::{Path, PathBuf};

use crate::merge::order::order_modules;

#[derive(Debug, Clone)]
pub struct SourceModule {
    /// npm-Name, beim Projekt der Name aus `package.json`.
    pub name: String,
    pub root: PathBuf,
    pub is_project: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum DiscoverError {
    #[error("Module konnten nicht aufgelöst werden: {0}")]
    Resolve(String),
}

/// Module in Modul-Reihenfolge: niedrigste Priorität zuerst, das Projekt zuletzt.
pub fn discover_modules(project_root: &Path) -> Result<Vec<SourceModule>, DiscoverError> {
    // Wie beim Designer: installierte Module gelten, auch wenn ein Versionsbereich nicht passt.
    let graph = npm_modules::resolve_lenient(project_root).map_err(|e| DiscoverError::Resolve(e.to_string()))?;
    let mut modules: Vec<SourceModule> = graph
        .modules
        .values()
        .map(|m| SourceModule { name: m.name.clone(), root: m.path.clone(), is_project: false })
        .collect();
    modules.push(SourceModule { name: graph.project.name.clone(), root: graph.project.path.clone(), is_project: true });
    Ok(order_modules(modules))
}
