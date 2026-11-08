//! Deploy als Feature-Plugin (braucht `database`). Befehlsnamen wie die früheren Tauri-Befehle,
//! Argumente als JSON mit camelCase-Feldern. Teilt den `DbManager` mit dem Datenbank-Plugin.

use crate::system_deploy;
use database::db_session::DbManager;
use plugin_api::feature::{to_json as json, unknown_command};
use plugin_api::{Args, FeaturePlugin};
use serde_json::Value;
use std::sync::Arc;

pub struct DeployPlugin {
    db: Arc<DbManager>,
}

impl DeployPlugin {
    pub fn new(db: Arc<DbManager>) -> Self {
        Self { db }
    }
}

impl FeaturePlugin for DeployPlugin {
    fn id(&self) -> &'static str {
        "deploy"
    }

    fn name(&self) -> &'static str {
        "Deploy"
    }

    fn requires(&self) -> &'static [&'static str] {
        &["database"]
    }

    fn call(&self, command: &str, args: Value) -> Result<Value, String> {
        let a = Args(&args);
        let db = &*self.db;
        match command {
            "deploy_overview" => json(system_deploy::deploy_overview(db, &a.root()?)?),
            "deploy_plan" => json(system_deploy::plan(db, &a.root()?, a.get("force")?, a.opt("mapping")?)?),
            "deploy_show_changes" => json(system_deploy::show_changes(db, &a.root()?, &a.string("key")?, a.opt("mapping")?)?),
            // Der einzige Schreibweg: `confirmed` ist erst nach dem Klick im Deploy-Dialog true.
            "deploy_execute" => json(system_deploy::execute(db, &a.root()?, &a.get::<Vec<String>>("keys")?, a.get("force")?, a.opt("mapping")?, a.get("confirmed")?)?),
            _ => Err(unknown_command(self.id(), command)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use plugin_api::FeatureRegistry;
    use serde_json::json;

    fn registry() -> FeatureRegistry {
        let mut reg = FeatureRegistry::new();
        reg.register(Box::new(DeployPlugin::new(Arc::default())));
        reg
    }

    #[test]
    fn plugin_needs_the_database_plugin() {
        let plugin = DeployPlugin::new(Arc::default());
        assert_eq!((plugin.id(), plugin.name(), plugin.requires()), ("deploy", "Deploy", &["database"][..]));
        let err = registry().call("deploy", "deploy_overview", json!({ "projectRoot": "x" })).unwrap_err();
        assert!(err.contains("'database' ist nicht installiert"), "{err}");
    }

    #[test]
    fn unknown_command_is_reported() {
        let plugin = DeployPlugin::new(Arc::default());
        assert_eq!(plugin.call("deploy_nope", json!({})).unwrap_err(), "Unbekannter Befehl 'deploy_nope' im Plugin 'deploy'");
    }

    #[test]
    fn missing_and_wrong_arguments_are_reported() {
        let plugin = DeployPlugin::new(Arc::default());
        assert_eq!(plugin.call("deploy_plan", json!({ "projectRoot": "x" })).unwrap_err(), "Argument 'force' fehlt");
        assert_eq!(plugin.call("deploy_show_changes", json!({ "projectRoot": "x" })).unwrap_err(), "Argument 'key' fehlt");
        assert_eq!(plugin.call("deploy_execute", json!({ "keys": [], "force": false, "confirmed": true })).unwrap_err(), "Argument 'projectRoot' fehlt");
        let err = plugin.call("deploy_execute", json!({ "projectRoot": "x", "keys": "a", "force": false, "confirmed": true })).unwrap_err();
        assert!(err.starts_with("Argument 'keys' ist ungültig"), "{err}");
    }
}
