//! Deploy als Feature-Plugin (braucht `database`). Befehlsnamen wie die früheren Tauri-Befehle,
//! Argumente als JSON mit camelCase-Feldern. Teilt den `DbManager` mit dem Datenbank-Plugin.

use crate::{artifact_deploy, system_deploy};
use database::db_session::DbManager;
use plugin_api::feature::{to_json as json, unknown_command};
use plugin_api::{ArtifactStore, Args, FeaturePlugin};
use serde_json::Value;
use std::sync::Arc;

pub struct DeployPlugin {
    db: Arc<DbManager>,
    /// Der letzte Transpile-Lauf im Speicher. Der Besitzer des Laufs füllt ihn (`artifact_store`), die `*_build`-Befehle lesen ihn.
    artifacts: Arc<ArtifactStore>,
}

impl DeployPlugin {
    pub fn new(db: Arc<DbManager>) -> Self {
        Self { db, artifacts: Arc::default() }
    }

    /// Hierhin legt der Transpile-Lauf seine Modelle ab.
    pub fn artifact_store(&self) -> Arc<ArtifactStore> {
        self.artifacts.clone()
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
            // Kam der letzte Transpile-Lauf des Projekts vom neuen Transpiler, gilt sein Ergebnis im Speicher (ohne `dist`).
            // Sonst wie bisher aus `dist`.
            "deploy_plan" => match self.build_for(&a)? {
                Some(set) => json(artifact_deploy::plan_artifacts(db, &set, a.get("force")?, a.opt("mapping")?)?),
                None => json(system_deploy::plan(db, &a.root()?, a.get("force")?, a.opt("mapping")?)?),
            },
            "deploy_show_changes" => match self.build_for(&a)? {
                Some(set) => json(artifact_deploy::show_changes(db, &set, &a.string("key")?, a.opt("mapping")?)?),
                None => json(system_deploy::show_changes(db, &a.root()?, &a.string("key")?, a.opt("mapping")?)?),
            },
            // Der einzige Schreibweg: `confirmed` ist erst nach dem Klick im Deploy-Dialog true.
            "deploy_execute" => match self.build_for(&a)? {
                Some(set) => {
                    let root = a.root()?;
                    let version = std::fs::read_to_string(root.join(".aditoprj").join("project.version")).unwrap_or_default();
                    json(artifact_deploy::execute_artifacts(db, &set, &a.get::<Vec<String>>("keys")?, a.get("force")?, a.opt("mapping")?, a.get("confirmed")?, version.trim())?)
                }
                None => json(system_deploy::execute(db, &a.root()?, &a.get::<Vec<String>>("keys")?, a.get("force")?, a.opt("mapping")?, a.get("confirmed")?)?),
            },
            // Deploy aus dem Speicher (letzter Transpile-Lauf), ohne `dist`.
            "deploy_plan_build" => json(artifact_deploy::plan_artifacts(db, &self.build()?, a.get("force")?, a.opt("mapping")?)?),
            "deploy_execute_build" => {
                let version = a.opt::<String>("projectVersion")?.unwrap_or_default();
                json(artifact_deploy::execute_artifacts(db, &self.build()?, &a.get::<Vec<String>>("keys")?, a.get("force")?, a.opt("mapping")?, a.get("confirmed")?, &version)?)
            }
            // Nur Lesen: Stimmt das Format der Artefakte mit dem System überein?
            "deploy_check_format" => json(artifact_deploy::compare_with_remote(db, &self.build()?)?),
            "deploy_build_info" => json(self.artifacts.get().map(|set| set.len())),
            _ => Err(unknown_command(self.id(), command)),
        }
    }
}

impl DeployPlugin {
    /// Der Satz im Speicher, wenn er zu dem Projekt im Befehl gehört. Ohne Projekt im Befehl: keiner.
    fn build_for(&self, a: &Args) -> Result<Option<Arc<Vec<plugin_api::BuildArtifact>>>, String> {
        let Ok(root) = a.root() else { return Ok(None) };
        Ok(self.artifacts.get_for_root(&root.to_string_lossy()))
    }

    fn build(&self) -> Result<Arc<Vec<plugin_api::BuildArtifact>>, String> {
        self.artifacts.get().ok_or_else(|| "There is no transpile result in memory yet; run a transpile first.".to_string())
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
    fn build_commands_need_a_transpile_result() {
        let plugin = DeployPlugin::new(Arc::default());
        let err = plugin.call("deploy_plan_build", json!({ "force": false })).unwrap_err();
        assert!(err.contains("no transpile result"), "{err}");
        assert_eq!(plugin.call("deploy_build_info", json!({})).unwrap(), json!(null));
        plugin.artifact_store().set(vec![plugin_api::BuildArtifact { folder: "entity".into(), name: "A".into(), content: b"x".to_vec() }]);
        assert_eq!(plugin.call("deploy_build_info", json!({})).unwrap(), json!(1));
    }

    #[test]
    fn the_deploy_dialog_commands_use_the_memory_result_of_the_same_project() {
        let plugin = DeployPlugin::new(Arc::default());
        // Ohne Satz im Speicher: der alte Weg über `dist`.
        let err = plugin.call("deploy_plan", json!({ "projectRoot": "C:/nowhere/p", "force": false })).unwrap_err();
        assert!(err.contains("Not connected") || err.contains("dist"), "{err}");
        // Mit Satz für dieses Projekt: der neue Weg, kein Hinweis auf `dist` mehr.
        plugin.artifact_store().set_for_root("C:/nowhere/p", Some(Arc::new(vec![plugin_api::BuildArtifact { folder: "entity".into(), name: "A".into(), content: b"x".to_vec() }])));
        let err = plugin.call("deploy_plan", json!({ "projectRoot": "C:/NOWHERE/p/", "force": false })).unwrap_err();
        assert!(!err.contains("dist"), "{err}");
        // Anderes Projekt: wieder der alte Weg.
        let err = plugin.call("deploy_plan", json!({ "projectRoot": "C:/nowhere/other", "force": false })).unwrap_err();
        assert!(err.contains("Not connected") || err.contains("dist"), "{err}");
    }

    #[test]
    fn unknown_command_is_reported() {
        let plugin = DeployPlugin::new(Arc::default());
        assert_eq!(plugin.call("deploy_nope", json!({})).unwrap_err(), "Unbekannter Befehl 'deploy_nope' im Plugin 'deploy'");
    }

    #[test]
    fn missing_and_wrong_arguments_are_reported() {
        let plugin = DeployPlugin::new(Arc::default());
        assert!(plugin.call("deploy_plan", json!({ "projectRoot": "x" })).unwrap_err().starts_with("Argument 'force' fehlt"));
        assert!(plugin.call("deploy_show_changes", json!({ "projectRoot": "x" })).unwrap_err().starts_with("Argument 'key' fehlt"));
        assert!(plugin.call("deploy_execute", json!({ "keys": [], "force": false, "confirmed": true })).unwrap_err().starts_with("Argument 'projectRoot' fehlt"));
        let err = plugin.call("deploy_execute", json!({ "projectRoot": "x", "keys": "a", "force": false, "confirmed": true })).unwrap_err();
        assert!(err.starts_with("Argument 'keys' ist ungültig"), "{err}");
    }
}
