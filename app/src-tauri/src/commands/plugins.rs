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
    crate::commands::guard_async("plugin_call", async {
    let registry = Arc::clone(&registry);
    let summary = args_summary(&args);
    let (p, c) = (plugin.clone(), command.clone());
    let result = blocking(move || registry.call(&plugin, &command, args)).await?;
    if let Err(e) = &result {
        // Jeder Fehler eines Plugin-Befehls kommt ins Protokoll (Datei im Log-Ordner), damit er später nachlesbar ist.
        let _ = app_base::crashlog::write_entry("ERROR", &format!("plugin_call {p}.{c} ({summary}): {e}"));
    }
    result
}).await
}

/// Argumente für das Protokoll: Namen und gekürzte Werte; Geheimnisse (Passwort, Schlüssel, Token) werden verdeckt.
fn args_summary(args: &serde_json::Value) -> String {
    let Some(map) = args.as_object() else { return args.to_string().chars().take(120).collect() };
    map.iter()
        .map(|(k, v)| {
            let lower = k.to_ascii_lowercase();
            if ["pass", "secret", "token", "key"].iter().any(|w| lower.contains(w)) {
                format!("{k}=***")
            } else {
                let text: String = v.to_string().chars().take(120).collect();
                format!("{k}={text}")
            }
        })
        .collect::<Vec<_>>()
        .join(", ")
}

/// Die angemeldeten Plugins; `available` ist false, wenn eine Abhängigkeit fehlt.
#[tauri::command]
pub fn plugin_list(registry: State<'_, Arc<FeatureRegistry>>) -> Vec<PluginInfo> {
    crate::commands::guard("plugin_list", || {
    registry
        .ids()
        .into_iter()
        .filter_map(|id| registry.get(id).map(|p| PluginInfo { id: p.id(), name: p.name(), available: registry.is_available(id) }))
        .collect()
})
}
