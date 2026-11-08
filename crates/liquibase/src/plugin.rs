//! Liquibase als Feature-Plugin (braucht `database` und `ssh-tunnel`). Befehlsnamen wie die
//! früheren Tauri-Befehle, Argumente als JSON mit camelCase-Feldern.
//!
//! Die Ausgabe-Zeilen des Updates gehen als Event `forge://build-output` an die Oberfläche.
//! Den Ordner der Designer-Installation liefert die App über `InstallDirProvider` (Einstellungen).

use crate::{connections, plan, target, update};
use database::db_session::DbManager;
use plugin_api::feature::{to_json as json, unknown_command};
use plugin_api::{Args, EventSink, FeaturePlugin};
use serde_json::Value;
use std::sync::Arc;

/// Gibt den in den Einstellungen gewählten Designer-Ordner zurück (None: nicht gesetzt).
pub type InstallDirProvider = Arc<dyn Fn() -> Option<String> + Send + Sync>;

pub struct LiquibasePlugin {
    db: Arc<DbManager>,
    events: Arc<dyn EventSink>,
    install_dir: InstallDirProvider,
}

impl LiquibasePlugin {
    pub fn new(db: Arc<DbManager>, events: Arc<dyn EventSink>, install_dir: InstallDirProvider) -> Self {
        Self { db, events, install_dir }
    }

    /// Nur nach der Bestätigung des Ziels in der Oberfläche aufrufen.
    fn run_update(&self, a: &Args<'_>) -> Result<Value, String> {
        let emit = |error: bool, line: &str| self.events.emit("forge://build-output", serde_json::json!({ "line": line, "error": error }));
        json(update(
            &self.db,
            a.opt_string("system")?,
            &a.string("alias")?,
            &a.root()?,
            a.opt_string("connectionAlias")?.as_deref(),
            a.get("useDist")?,
            (self.install_dir)(),
            &emit,
        )?)
    }
}

impl FeaturePlugin for LiquibasePlugin {
    fn id(&self) -> &'static str {
        "liquibase"
    }

    fn name(&self) -> &'static str {
        "Liquibase"
    }

    fn requires(&self) -> &'static [&'static str] {
        &["database", "ssh-tunnel"]
    }

    fn call(&self, command: &str, args: Value) -> Result<Value, String> {
        let a = Args(&args);
        match command {
            "liquibase_plan" => json(plan(&a.root()?, &a.string("alias")?)),
            "liquibase_connections" => json(connections(&self.db, a.opt_string("system")?)?),
            "liquibase_target" => json(target(&self.db, a.opt_string("system")?, &a.string("alias")?, a.opt_string("connectionAlias")?.as_deref())?),
            "liquibase_update" => self.run_update(&a),
            _ => Err(unknown_command(self.id(), command)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use plugin_api::FeatureRegistry;
    use serde_json::json;

    struct NoEvents;
    impl EventSink for NoEvents {
        fn emit(&self, _event: &str, _payload: Value) {}
    }

    fn plugin() -> LiquibasePlugin {
        LiquibasePlugin::new(Arc::default(), Arc::new(NoEvents), Arc::new(|| None))
    }

    #[test]
    fn plugin_needs_database_and_tunnel() {
        let p = plugin();
        assert_eq!((p.id(), p.name(), p.requires()), ("liquibase", "Liquibase", &["database", "ssh-tunnel"][..]));
        let mut reg = FeatureRegistry::new();
        reg.register(Box::new(plugin()));
        let err = reg.call("liquibase", "liquibase_plan", json!({})).unwrap_err();
        assert!(err.contains("'database' ist nicht installiert"), "{err}");
    }

    #[test]
    fn unknown_command_is_reported() {
        assert_eq!(plugin().call("liquibase_nope", json!({})).unwrap_err(), "Unbekannter Befehl 'liquibase_nope' im Plugin 'liquibase'");
    }

    #[test]
    fn missing_and_wrong_arguments_are_reported() {
        let p = plugin();
        assert_eq!(p.call("liquibase_plan", json!({ "projectRoot": "x" })).unwrap_err(), "Argument 'alias' fehlt");
        assert_eq!(p.call("liquibase_target", json!({})).unwrap_err(), "Argument 'alias' fehlt");
        assert_eq!(p.call("liquibase_update", json!({ "alias": "a", "projectRoot": "x" })).unwrap_err(), "Argument 'useDist' fehlt");
        let err = p.call("liquibase_update", json!({ "alias": "a", "projectRoot": "x", "useDist": "yes" })).unwrap_err();
        assert!(err.starts_with("Argument 'useDist' ist ungültig"), "{err}");
    }

    #[test]
    fn connections_without_a_session_fail_cleanly() {
        assert!(plugin().call("liquibase_connections", json!({})).is_err());
    }
}
