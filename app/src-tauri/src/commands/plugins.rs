//! Feature-Plugins: ein Befehl für alle Plugin-Aufrufe und die Liste für die Oberfläche.

use super::blocking;
use plugin_api::FeatureRegistry;
use serde::Serialize;
use std::sync::Arc;
use tauri::State;

#[derive(Serialize)]
pub struct PluginInfo {
    pub id: &'static str,
    pub name: &'static str,
    pub available: bool,
}

/// Leitet `command` mit `args` an das angemeldete Plugin weiter. Fehlt es: Fehlertext "nicht installiert".
#[tauri::command]
pub async fn plugin_call(registry: State<'_, Arc<FeatureRegistry>>, plugin: String, command: String, args: serde_json::Value) -> Result<serde_json::Value, String> {
    let registry = Arc::clone(&registry);
    blocking(move || registry.call(&plugin, &command, args)).await?
}

/// Die angemeldeten Plugins; `available` ist false, wenn eine Abhängigkeit fehlt.
#[tauri::command]
pub fn plugin_list(registry: State<'_, Arc<FeatureRegistry>>) -> Vec<PluginInfo> {
    registry
        .ids()
        .into_iter()
        .filter_map(|id| registry.get(id).map(|p| PluginInfo { id: p.id(), name: p.name(), available: registry.is_available(id) }))
        .collect()
}
